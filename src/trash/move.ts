/**
 * 文件移动模块：跨盘移动（rename → copy+delete 回退）、递归复制与删除、
 * Windows 只读属性处理、大小估算。
 *
 * @project dsh-safe-delete
 * @file move.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rmdir,
  symlink,
  unlink,
  utimes,
} from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, join } from 'node:path'

/** rename 函数签名（可注入以便测试跨盘回退）。 */
export type RenameFn = (source: string, dest: string) => Promise<void>

/** lstat 函数签名（可注入以便测试）。 */
export type LstatFn = (target: string) => Promise<Stats>

/** 是否跨设备错误（rename 跨卷时抛出）。 */
function isCrossDeviceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'EXDEV' || code === 'EPERM'
}

/** 是否权限类错误。 */
function isPermissionError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EPERM'
}

/**
 * 将条目从 source 移动到 dest：优先原子 rename；跨盘（EXDEV）或
 * Windows 权限失败时回退为 copy + delete。
 *
 * :param source: 源路径
 * :param dest: 目标路径
 * :param renameFn: rename 实现（默认为 node:fs 的 rename，测试可注入）
 * :raises Error: 移动失败（回退也失败时抛出真实原因）
 */
export async function moveEntry(source: string, dest: string, renameFn: RenameFn = rename): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  try {
    await renameFn(source, dest)
    return
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error
    // Windows 上只读源文件 rename 会 EPERM：先放开只读再重试一次。
    try {
      await chmod(source, 0o600)
      await renameFn(source, dest)
      return
    } catch {
      // 忽略重试失败，进入 copy + delete 回退。
    }
    await copyRecursive(source, dest)
    await removeRecursive(source)
  }
}

/**
 * 递归复制 source 到 dest：目录递归、符号链接复制链接本身（不跟随）、
 * 尽力保留 mtime。
 *
 * :param source: 源路径
 * :param dest: 目标路径
 * :raises Error: 复制失败
 */
export async function copyRecursive(source: string, dest: string): Promise<void> {
  const info = await lstat(source)
  if (info.isSymbolicLink()) {
    await mkdir(dirname(dest), { recursive: true })
    await symlink(await readlink(source), dest)
    return
  }
  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true })
    for (const child of await readdir(source)) {
      await copyRecursive(join(source, child), join(dest, child))
    }
    await utimes(dest, info.atime, info.mtime)
    return
  }
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(source, dest)
  // 放开复制品的只读位，保证后续移动/删除不受 Windows 属性限制。
  await chmod(dest, 0o600)
  await utimes(dest, info.atime, info.mtime)
}

/**
 * 递归删除 target（文件/目录/符号链接）：Windows 只读文件先放开只读。
 *
 * :param target: 待删除路径
 * :raises Error: 删除失败
 */
export async function removeRecursive(target: string): Promise<void> {
  const info = await lstat(target)
  if (info.isDirectory()) {
    for (const child of await readdir(target)) {
      await removeRecursive(join(target, child))
    }
    await rmdir(target)
    return
  }
  await unlinkFile(target)
}

/**
 * 删除单个文件（符号链接同理）：Windows 只读文件先放开只读。
 *
 * :param target: 待删除路径
 * :raises Error: 删除失败
 */
export async function unlinkFile(target: string): Promise<void> {
  try {
    await unlink(target)
  } catch (error) {
    if (!isPermissionError(error)) throw error
    await chmod(target, 0o600)
    await unlink(target)
  }
}

/**
 * 估算条目大小：文件为字节数，目录为递归累加（符号链接计链接本身）。
 *
 * :param target: 待估算路径
 * :param lstatFn: lstat 实现（测试可注入）
 * :returns: 字节数
 * :raises Error: 读取失败
 */
export async function statSize(target: string, lstatFn: LstatFn = lstat): Promise<number> {
  const info = await lstatFn(target)
  if (info.isDirectory()) {
    let total = 0
    for (const child of await readdir(target)) {
      total += await statSize(join(target, child), lstatFn)
    }
    return total
  }
  return info.size
}
