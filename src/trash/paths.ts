/**
 * 回收区路径解析模块：回收区根目录解析、条目 ID 生成、原始路径到
 * 回收区相对路径的映射。
 *
 * @project dsh-safe-delete
 * @file paths.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'

/** 回收区根目录下的文件区子目录名（人类可读，镜像相对路径树）。 */
export const FILES_DIR_NAME = 'files'

/** 回收区根目录下的条目元数据子目录名。 */
export const ENTRIES_DIR_NAME = 'entries'

/** 回收区根目录下的索引文件名（追加式 JSONL）。 */
export const MANIFEST_FILE_NAME = 'manifest.jsonl'

/** 回收区根目录下的人类说明文件名。 */
export const TRASH_README_FILE_NAME = 'README.md'

/** 工作区外文件落盘的目录名（防 `../` 逃逸相对路径映射）。 */
export const EXTERNAL_DIR_NAME = '_external'

/** 平台路径比较是否大小写不敏感（Windows/macOS 默认折叠）。 */
export const PATH_CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

/** 默认回收区目录名（位于工作区之下）。 */
export const DEFAULT_TRASH_DIR_NAME = '.dsh-trash'

/**
 * 生成唯一条目 ID：毫秒时间戳 + 随机后缀。
 *
 * :param now: 当前时间（默认取实际时间）
 * :returns: 形如 `20260813T223045-3f2a` 的条目 ID
 */
export function entryId(now: Date = new Date()): string {
  const stamp = formatTimestamp(now)
  const random = randomBytes(2).toString('hex')
  return `${stamp}-${random}`
}

/** 补零到两位数字。 */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 格式化时间为 `yyyyMMddTHHmmss`（本地时区）。
 *
 * :param date: 待格式化时间
 * :returns: 时间戳字符串
 */
export function formatTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

/**
 * 生成删除冲突后缀：`.yyyyMMddTHHmmss`（同名文件再次删除时追加）。
 *
 * :param date: 删除时间
 * :returns: 形如 `.20260813T223045` 的后缀
 */
export function timestampSuffix(date: Date): string {
  return `.${formatTimestamp(date)}`
}

/**
 * 解析回收区根目录：显式配置优先，否则用工作区下的 `.dsh-trash`。
 *
 * :param trashDir: 配置的回收区根目录（须为绝对路径或空字符串）
 * :param workspace: 当前会话工作区（绝对路径），trashDir 为空时必填
 * :returns: 回收区根目录绝对路径
 * :raises ValueError: trashDir 非空但非绝对路径，或两者皆为空时
 */
export function resolveTrashRoot(trashDir: string, workspace: string | undefined): string {
  if (trashDir !== '') {
    if (!isAbsolute(trashDir)) {
      throw new Error(`safe-delete: trashDir must be an absolute path, got "${trashDir}"`)
    }
    return resolve(trashDir)
  }
  if (workspace === undefined || workspace === '') {
    throw new Error('safe-delete: trashDir is empty and no session workspace is available')
  }
  return resolve(workspace, DEFAULT_TRASH_DIR_NAME)
}

/**
 * 判断子路径是否位于父路径之内（规范化前缀比较，Windows 大小写不敏感）。
 *
 * :param child: 子路径（绝对路径）
 * :param parent: 父路径（绝对路径）
 * :returns: child 位于 parent 内（或相等）时为 true
 */
export function isPathInside(child: string, parent: string): boolean {
  const childNorm = normalizeForCompare(child)
  const parentNorm = normalizeForCompare(parent)
  if (childNorm === parentNorm) return true
  return childNorm.startsWith(`${parentNorm}${sep}`)
}

/**
 * 将路径规范化为比较基准（绝对化 + 平台大小写折叠）。
 *
 * :param path: 待规范化路径
 * :returns: 规范化后的比较字符串
 */
export function normalizeForCompare(path: string): string {
  const absolute = resolve(path)
  return PATH_CASE_INSENSITIVE ? absolute.toLowerCase() : absolute
}

/**
 * 将原始绝对路径映射为回收区 `files/` 下的相对路径。
 *
 * :param originalPath: 被删除文件的原始绝对路径
 * :param workspace: 当前会话工作区（绝对路径）
 * :param id: 条目 ID（工作区外文件命名使用）
 * :returns: 回收区相对路径（正斜杠分隔），如 `src/index.ts` 或
 *   `_external/20260813T223045-3f2a-notes.txt`
 */
export function mapToTrashRelative(originalPath: string, workspace: string | undefined, id: string): string {
  const absolute = resolve(originalPath)
  if (workspace !== undefined && isPathInside(absolute, workspace)) {
    const rel = relative(workspace, absolute)
    return rel.split(sep).join('/')
  }
  const name = basename(absolute)
  return `${EXTERNAL_DIR_NAME}/${id}-${name}`
}

/**
 * 计算回收区中某条目的 `files/` 下绝对路径。
 *
 * :param trashRoot: 回收区根目录
 * :param relPath: 回收区相对路径（mapToTrashRelative 的输出）
 * :returns: 回收区文件区中的绝对路径
 */
export function trashEntryPath(trashRoot: string, relPath: string): string {
  return resolve(trashRoot, FILES_DIR_NAME, relPath)
}

/**
 * 计算回收区中某条目的元数据文件路径。
 *
 * :param trashRoot: 回收区根目录
 * :param id: 条目 ID
 * :returns: `entries/<id>.json` 的绝对路径
 */
export function trashMetaPath(trashRoot: string, id: string): string {
  return resolve(trashRoot, ENTRIES_DIR_NAME, `${id}.json`)
}

/**
 * 同名冲突时生成新路径：在原名后追加时间戳后缀。
 *
 * :param base: 回收区相对路径（如 `src/index.ts`）
 * :param suffix: 时间戳后缀（timestampSuffix 的输出）
 * :returns: 追加后缀后的路径（如 `src/index.ts.20260813T223045`）
 */
export function conflictPath(base: string, suffix: string): string {
  return `${base}${suffix}`
}
