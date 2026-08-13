/**
 * 回收区索引与元数据模块：条目类型定义、manifest.jsonl 读写、
 * 条目元数据读写、索引重建、惰性清理（sweep）。
 *
 * @project dsh-safe-delete
 * @file manifest.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { access, appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { removeRecursive } from './move.js'
import {
  ENTRIES_DIR_NAME,
  FILES_DIR_NAME,
  MANIFEST_FILE_NAME,
  TRASH_README_FILE_NAME,
  trashEntryPath,
  trashMetaPath,
} from './paths.js'

/** 回收区条目元数据。 */
export interface TrashEntry {
  /** 条目 ID（`yyyyMMddTHHmmss-xxxx`）。 */
  id: string
  /** 原始绝对路径。 */
  originalPath: string
  /** 回收区 `files/` 下的相对路径。 */
  trashPath: string
  /** 删除时间（ISO 8601）。 */
  deletedAt: string
  /** 条目类型。 */
  type: 'file' | 'directory'
  /** 字节数（目录为递归估算）。 */
  sizeBytes: number
  /** 来源会话（可选）。 */
  sourceSession?: string
}

/** 回收区 README 内容（人类找回指引）。 */
const TRASH_README = [
  '# 回收区（.dsh-trash）',
  '',
  '这里是 dsh-safe-delete 插件的回收区。被"安全删除"的文件会移入 `files/` 目录，',
  '而非直接销毁。',
  '',
  '## 手动找回（人类）',
  '',
  '打开 `files/` 目录，按熟悉的目录结构找到文件，直接移回原位置即可。',
  '同名文件多次删除时，后删除的会带有时间戳后缀（如 `a.txt.20260813T223045`）。',
  '',
  '## 通过工具找回（模型）',
  '',
  '使用 `trash_list` 查看回收区，`restore` 恢复条目，`purge` 彻底清除。',
  '',
  '> 注意：`entries/` 与 `manifest.jsonl` 为元数据与索引，请勿手动修改；',
  '> 手动移动或删除 `files/` 中的文件后，索引会在下次操作时自动校正。',
  '',
].join('\n')

/**
 * 确保回收区目录结构存在（files/、entries/、README.md）。
 *
 * :param trashRoot: 回收区根目录
 * :raises Error: 创建失败
 */
export async function ensureTrashRoot(trashRoot: string): Promise<void> {
  await mkdir(resolve(trashRoot, FILES_DIR_NAME), { recursive: true })
  await mkdir(resolve(trashRoot, ENTRIES_DIR_NAME), { recursive: true })
  const readme = resolve(trashRoot, TRASH_README_FILE_NAME)
  try {
    await readFile(readme)
  } catch {
    await writeFile(readme, TRASH_README, 'utf8')
  }
}

/**
 * 读取 manifest 索引：缺失或损坏时尝试从 entries/ 重建，仍无则返回空表。
 *
 * :param trashRoot: 回收区根目录
 * :returns: 条目列表（按 deletedAt 升序）
 * :raises Error: 重建也失败时
 */
export async function readManifest(trashRoot: string): Promise<TrashEntry[]> {
  const manifestPath = resolve(trashRoot, MANIFEST_FILE_NAME)
  try {
    const text = await readFile(manifestPath, 'utf8')
    return parseManifestLines(text)
  } catch {
    // manifest 缺失或损坏：从 entries/ 重建。
    return rebuildManifest(trashRoot)
  }
}

/** 解析 manifest 文本行（容忍损坏行）。 */
function parseManifestLines(text: string): TrashEntry[] {
  const entries: TrashEntry[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      entries.push(JSON.parse(line) as TrashEntry)
    } catch {
      // 容忍单行损坏，跳过。
    }
  }
  return sortByDeletedAt(entries)
}

/** 按删除时间升序排序。 */
function sortByDeletedAt(entries: TrashEntry[]): TrashEntry[] {
  return entries.toSorted((a, b) => a.deletedAt.localeCompare(b.deletedAt))
}

/**
 * 从 entries/*.json 重建 manifest 索引（全量重写）。
 *
 * :param trashRoot: 回收区根目录
 * :returns: 重建后的条目列表
 * :raises Error: 写入失败
 */
export async function rebuildManifest(trashRoot: string): Promise<TrashEntry[]> {
  const metaDir = resolve(trashRoot, ENTRIES_DIR_NAME)
  let files: string[]
  try {
    files = await readdir(metaDir)
  } catch {
    files = []
  }
  const entries: TrashEntry[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const meta = JSON.parse(await readFile(resolve(metaDir, file), 'utf8')) as TrashEntry
      if (typeof meta.id === 'string' && typeof meta.originalPath === 'string') {
        entries.push(meta)
      }
    } catch {
      // 单个元数据损坏：跳过，不阻塞整体重建。
    }
  }
  await writeManifest(trashRoot, entries)
  return sortByDeletedAt(entries)
}

/** 全量写入 manifest 索引。 */
async function writeManifest(trashRoot: string, entries: TrashEntry[]): Promise<void> {
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n')
  await writeFile(resolve(trashRoot, MANIFEST_FILE_NAME), lines === '' ? '' : `${lines}\n`, 'utf8')
}

/**
 * 追加一个条目到 manifest 索引。
 *
 * :param trashRoot: 回收区根目录
 * :param entry: 条目
 * :raises Error: 追加失败
 */
export async function appendEntry(trashRoot: string, entry: TrashEntry): Promise<void> {
  await appendFile(resolve(trashRoot, MANIFEST_FILE_NAME), `${JSON.stringify(entry)}\n`, 'utf8')
}

/**
 * 从 manifest 索引剔除指定条目（保留其余行）。
 *
 * :param trashRoot: 回收区根目录
 * :param ids: 待剔除的条目 ID 集合
 * :raises Error: 写入失败
 */
export async function removeEntries(trashRoot: string, ids: ReadonlySet<string>): Promise<void> {
  const entries = await readManifest(trashRoot)
  await writeManifest(trashRoot, entries.filter((entry) => !ids.has(entry.id)))
}

/**
 * 读取单个条目元数据。
 *
 * :param trashRoot: 回收区根目录
 * :param id: 条目 ID
 * :returns: 条目元数据；不存在或损坏时返回 undefined
 */
export async function readEntryMeta(trashRoot: string, id: string): Promise<TrashEntry | undefined> {
  try {
    const meta = JSON.parse(await readFile(trashMetaPath(trashRoot, id), 'utf8')) as TrashEntry
    return meta.id === id ? meta : undefined
  } catch {
    return undefined
  }
}

/**
 * 写入单个条目元数据（entries/<id>.json）。
 *
 * :param trashRoot: 回收区根目录
 * :param entry: 条目
 * :raises Error: 写入失败
 */
export async function writeEntryMeta(trashRoot: string, entry: TrashEntry): Promise<void> {
  await mkdir(resolve(trashRoot, ENTRIES_DIR_NAME), { recursive: true })
  await writeFile(trashMetaPath(trashRoot, entry.id), `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
}

/**
 * 删除单个条目元数据。
 *
 * :param trashRoot: 回收区根目录
 * :param id: 条目 ID
 */
export async function removeEntryMeta(trashRoot: string, id: string): Promise<void> {
  await rm(trashMetaPath(trashRoot, id), { force: true })
}

/** 惰性清理选项。 */
export interface SweepOptions {
  /** 保留天数；0 表示不按时间清理。 */
  retentionDays: number
  /** 总大小上限（字节）；0 表示不限制。 */
  maxSizeBytes: number
  /** 当前时间（默认取实际时间）。 */
  now?: Date
}

/** 惰性清理结果。 */
export interface SweepResult {
  /** 被清理（文件 + 索引删除）的条目 ID。 */
  removedIds: string[]
  /** 仅清理索引的孤儿条目 ID（files/ 中已不存在）。 */
  orphanedIds: string[]
}

/**
 * 惰性清理：过期条目、超大小上限的旧条目、孤儿索引。
 * 任一步骤失败不影响整体，失败项记录日志由调用方处理。
 *
 * :param trashRoot: 回收区根目录
 * :param options: 清理选项
 * :returns: 清理结果
 */
export async function sweep(trashRoot: string, options: SweepOptions): Promise<SweepResult> {
  const now = options.now ?? new Date()
  const entries = await readManifest(trashRoot)
  const removedIds: string[] = []
  const orphanedIds: string[] = []

  // 1. 一致性：files/ 中已不存在的条目 → 清理索引（人类手动恢复/删除）。
  const existing: TrashEntry[] = []
  for (const entry of entries) {
    if (await exists(trashEntryPath(trashRoot, entry.trashPath))) {
      existing.push(entry)
    } else {
      orphanedIds.push(entry.id)
    }
  }

  // 2. 过期条目。
  let remaining = existing
  if (options.retentionDays > 0) {
    const cutoff = now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000
    const expired = remaining.filter((entry) => new Date(entry.deletedAt).getTime() < cutoff)
    remaining = remaining.filter((entry) => !expired.includes(entry))
    for (const entry of expired) {
      await removeEntryFiles(trashRoot, entry)
      removedIds.push(entry.id)
    }
  }

  // 3. 超大小上限：按 deletedAt 从旧到新清除。
  if (options.maxSizeBytes > 0) {
    let total = remaining.reduce((sum, entry) => sum + entry.sizeBytes, 0)
    for (const entry of remaining) {
      if (total <= options.maxSizeBytes) break
      await removeEntryFiles(trashRoot, entry)
      removedIds.push(entry.id)
      total -= entry.sizeBytes
    }
  }

  const allRemoved = new Set([...removedIds, ...orphanedIds])
  if (allRemoved.size > 0) {
    await removeEntries(trashRoot, allRemoved)
  }
  return { removedIds, orphanedIds }
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

/** 删除条目的回收文件与元数据。 */
async function removeEntryFiles(trashRoot: string, entry: TrashEntry): Promise<void> {
  await removeRecursive(trashEntryPath(trashRoot, entry.trashPath))
  await removeEntryMeta(trashRoot, entry.id)
}
