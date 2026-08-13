/**
 * 回收区核心操作模块：safeDelete / listEntries / restoreEntries / purgeEntries。
 * 纯逻辑层，不依赖 DSH 运行时服务（trashRoot 等由调用方解析传入）。
 *
 * @project dsh-safe-delete
 * @file ops.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { access, lstat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { resolve } from 'node:path'
import type { RestoreConflictMode } from '../config.js'
import {
  appendEntry,
  ensureTrashRoot,
  readManifest,
  removeEntries,
  removeEntryMeta,
  writeEntryMeta,
  type TrashEntry,
} from './manifest.js'
import { moveEntry, removeRecursive, statSize } from './move.js'
import {
  conflictPath,
  entryId,
  mapToTrashRelative,
  restoreCandidateNames,
  timestampSuffix,
  trashEntryPath,
} from './paths.js'

/** safeDelete 选项。 */
export interface SafeDeleteOptions {
  /** 回收区根目录（绝对路径）。 */
  trashRoot: string
  /** 当前会话工作区（用于相对路径映射）。 */
  workspace?: string
  /** 待删除的绝对路径列表。 */
  paths: string[]
  /** 目录删除需要为 true。 */
  recursive: boolean
  /** 当前时间（默认取实际时间）。 */
  now?: Date
}

/** safeDelete 结果。 */
export interface SafeDeleteResult {
  /** 成功移入回收区的条目。 */
  entries: TrashEntry[]
  /** 跳过的路径及原因。 */
  skipped: { path: string; reason: string }[]
}

/**
 * 将路径移入回收区（核心安全删除操作）。
 * 顺序：大小估算 → 移动 → 写元数据 → 追加索引；移动成功后元数据失败
 * 不影响文件（索引可在下次操作时校正）。
 *
 * :param options: 操作选项
 * :returns: 成功条目与跳过项
 * :raises Error: 回收区初始化失败
 */
export async function safeDelete(options: SafeDeleteOptions): Promise<SafeDeleteResult> {
  await ensureTrashRoot(options.trashRoot)
  const now = options.now ?? new Date()
  const entries: TrashEntry[] = []
  const skipped: { path: string; reason: string }[] = []

  for (const rawPath of options.paths) {
    const target = resolve(rawPath)
    let info: Stats
    try {
      info = await lstat(target)
    } catch {
      skipped.push({ path: rawPath, reason: 'not found' })
      continue
    }
    if (info.isDirectory() && !options.recursive) {
      skipped.push({ path: rawPath, reason: 'is a directory (recursive required)' })
      continue
    }
    const id = entryId(now)
    let relPath = mapToTrashRelative(target, options.workspace, id)
    let dest = trashEntryPath(options.trashRoot, relPath)
    if (await exists(dest)) {
      relPath = conflictPath(relPath, timestampSuffix(now))
      dest = trashEntryPath(options.trashRoot, relPath)
    }
    const sizeBytes = await statSize(target)
    await moveEntry(target, dest)
    const entry: TrashEntry = {
      id,
      originalPath: target,
      trashPath: relPath,
      deletedAt: now.toISOString(),
      type: info.isDirectory() ? 'directory' : 'file',
      sizeBytes,
    }
    await writeEntryMeta(options.trashRoot, entry)
    await appendEntry(options.trashRoot, entry)
    entries.push(entry)
  }
  return { entries, skipped }
}

/** listEntries 选项。 */
export interface ListOptions {
  /** 回收区根目录。 */
  trashRoot: string
  /** 匹配 originalPath 尾部的模式（`*` 与 `?` 通配）。 */
  pattern?: string
  /** 返回条数上限。 */
  limit?: number
}

/** listEntries 结果。 */
export interface ListResult {
  /** 匹配条目（按删除时间升序）。 */
  entries: TrashEntry[]
  /** 匹配总数（未截断）。 */
  total: number
}

/**
 * 列出回收区条目（可过滤）。
 *
 * :param options: 查询选项
 * :returns: 条目列表与总数
 */
export async function listEntries(options: ListOptions): Promise<ListResult> {
  const all = await readManifest(options.trashRoot)
  const re = options.pattern === undefined ? undefined : globToRegExp(options.pattern)
  const matched = re === undefined ? all : all.filter((entry) => re.test(entry.originalPath))
  const limit = options.limit ?? 50
  return { entries: matched.slice(0, limit), total: matched.length }
}

/** restoreEntries 选项。 */
export interface RestoreOptions {
  /** 回收区根目录。 */
  trashRoot: string
  /** 待恢复的条目 ID 列表（与 pattern 二选一）。 */
  ids?: string[]
  /** 匹配 originalPath 尾部的模式（与 ids 二选一）。 */
  pattern?: string
  /** 目标路径已存在时的处理策略。 */
  onConflict: RestoreConflictMode
}

/** restoreEntries 结果。 */
export interface RestoreResult {
  /** 成功恢复的条目（含最终路径）。 */
  restored: { id: string; path: string }[]
  /** 失败条目及原因。 */
  failed: { id: string; reason: string }[]
}

/**
 * 恢复条目到原路径（子条目先于父目录恢复）。
 *
 * :param options: 恢复选项
 * :returns: 恢复结果
 */
export async function restoreEntries(options: RestoreOptions): Promise<RestoreResult> {
  const all = await readManifest(options.trashRoot)
  const targets = selectEntries(all, options.ids, options.pattern)
  // 子先父后：更深的路径先恢复，避免目录恢复挤占子文件位置。
  const ordered = targets.toSorted((a, b) => b.originalPath.length - a.originalPath.length)

  const restored: { id: string; path: string }[] = []
  const failed: { id: string; reason: string }[] = []
  const removedIds = new Set<string>()
  for (const entry of ordered) {
    const source = trashEntryPath(options.trashRoot, entry.trashPath)
    if (!(await exists(source))) {
      // 回收数据已不在（人类手动处理）→ 清理孤儿索引。
      removedIds.add(entry.id)
      failed.push({ id: entry.id, reason: 'trash data missing' })
      continue
    }
    let dest = entry.originalPath
    if (await exists(dest)) {
      if (options.onConflict === 'skip') {
        failed.push({ id: entry.id, reason: `target exists: ${dest}` })
        continue
      }
      if (options.onConflict === 'rename') {
        dest = await firstMissing(restoreCandidateNames(dest))
      } else {
        await removeRecursive(dest)
      }
    }
    try {
      await moveEntry(source, dest)
      await removeEntryMeta(options.trashRoot, entry.id)
      removedIds.add(entry.id)
      restored.push({ id: entry.id, path: dest })
    } catch (error) {
      failed.push({ id: entry.id, reason: errorMessage(error) })
    }
  }
  if (removedIds.size > 0) {
    await removeEntries(options.trashRoot, removedIds)
  }
  return { restored, failed }
}

/** purgeEntries 选项。 */
export interface PurgeOptions {
  /** 回收区根目录。 */
  trashRoot: string
  /** 待清除的条目 ID 列表（与 all 二选一）。 */
  ids?: string[]
  /** true 时清除全部条目。 */
  all: boolean
}

/** purgeEntries 结果。 */
export interface PurgeResult {
  /** 已彻底清除的条目 ID。 */
  purged: string[]
  /** 失败条目及原因。 */
  failed: { id: string; reason: string }[]
}

/**
 * 彻底清除条目（不可逆，调用方须先经审批确认）。
 *
 * :param options: 清除选项
 * :returns: 清除结果
 */
export async function purgeEntries(options: PurgeOptions): Promise<PurgeResult> {
  const all = await readManifest(options.trashRoot)
  const targets = options.all ? all : selectEntries(all, options.ids, undefined)
  const purged: string[] = []
  const failed: { id: string; reason: string }[] = []
  for (const entry of targets) {
    try {
      await removeRecursive(trashEntryPath(options.trashRoot, entry.trashPath))
      await removeEntryMeta(options.trashRoot, entry.id)
      purged.push(entry.id)
    } catch (error) {
      failed.push({ id: entry.id, reason: errorMessage(error) })
    }
  }
  if (purged.length > 0) {
    await removeEntries(options.trashRoot, new Set(purged))
  }
  return { purged, failed }
}

/**
 * 将简单 glob 模式（`*`/`?`）转换为匹配路径尾部的正则。
 *
 * :param pattern: glob 模式，如 `*.tmp`
 * :returns: 锚定尾部的正则
 */
export function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (const char of pattern) {
    if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

/** 按 ids 或 pattern 选择条目（ids 优先且保持传入顺序）。 */
function selectEntries(
  all: TrashEntry[],
  ids: string[] | undefined,
  pattern: string | undefined,
): TrashEntry[] {
  if (ids !== undefined) {
    const byId = new Map(all.map((entry) => [entry.id, entry]))
    return ids
      .map((id) => byId.get(id))
      .filter((entry): entry is TrashEntry => entry !== undefined)
  }
  if (pattern !== undefined) {
    const re = globToRegExp(pattern)
    return all.filter((entry) => re.test(entry.originalPath))
  }
  return []
}

/** 取候选序列中第一个不存在的路径。 */
async function firstMissing(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    if (!(await exists(candidate))) return candidate
  }
  return candidates[candidates.length - 1] ?? ''
}

/** 判断路径是否存在（文件或目录）。 */
async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

/** 提取错误消息。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
