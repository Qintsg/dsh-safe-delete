/**
 * 文件移动模块单元测试（使用真实临时目录）。
 *
 * @project dsh-safe-delete
 * @file move.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyRecursive, moveEntry, removeRecursive, statSize, unlinkFile } from '../../src/trash/move.js'

/** 每次测试独立的临时根目录。 */
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-safe-delete-move-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('moveEntry', () => {
  it('同卷移动文件：源消失、目标存在且内容一致', async () => {
    const source = join(root, 'a.txt')
    const dest = join(root, 'sub', 'b.txt')
    await writeFile(source, 'hello')
    await moveEntry(source, dest)
    await expect(readFile(source)).rejects.toThrow()
    expect(await readFile(dest, 'utf8')).toBe('hello')
  })

  it('同卷移动目录（递归）', async () => {
    const source = join(root, 'dir')
    const dest = join(root, 'moved')
    await mkdir(join(source, 'inner'), { recursive: true })
    await writeFile(join(source, 'inner', 'x.txt'), 'x')
    await moveEntry(source, dest)
    expect(await readFile(join(dest, 'inner', 'x.txt'), 'utf8')).toBe('x')
    await expect(readFile(join(source, 'inner', 'x.txt'))).rejects.toThrow()
  })

  it('跨盘（EXDEV）回退为 copy + delete', async () => {
    const source = join(root, 'a.txt')
    const dest = join(root, 'sub', 'b.txt')
    await writeFile(source, 'content')
    const exdev = Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
    const renameFn = vi.fn(async () => { throw exdev })
    await moveEntry(source, dest, renameFn)
    expect(renameFn).toHaveBeenCalledTimes(2) // 首次失败 + 只读重试
    expect(await readFile(dest, 'utf8')).toBe('content')
    await expect(readFile(source)).rejects.toThrow()
  })

  it('非跨盘错误直接抛出', async () => {
    const source = join(root, 'a.txt')
    const dest = join(root, 'b.txt')
    await writeFile(source, 'x')
    const boom = new Error('EACCES')
    ;(boom as NodeJS.ErrnoException).code = 'EACCES'
    await expect(moveEntry(source, dest, async () => { throw boom })).rejects.toThrow('EACCES')
    expect(await readFile(source, 'utf8')).toBe('x')
  })
})

describe('copyRecursive', () => {
  it('递归复制嵌套目录与文件', async () => {
    const source = join(root, 'src')
    const dest = join(root, 'dst')
    await mkdir(join(source, 'a', 'b'), { recursive: true })
    await writeFile(join(source, 'a', 'one.txt'), '1')
    await writeFile(join(source, 'a', 'b', 'two.txt'), '2')
    await copyRecursive(source, dest)
    expect(await readFile(join(dest, 'a', 'one.txt'), 'utf8')).toBe('1')
    expect(await readFile(join(dest, 'a', 'b', 'two.txt'), 'utf8')).toBe('2')
  })

  it('复制单个文件', async () => {
    const source = join(root, 'f.txt')
    const dest = join(root, 'nested', 'g.txt')
    await writeFile(source, 'data')
    await copyRecursive(source, dest)
    expect(await readFile(dest, 'utf8')).toBe('data')
  })
})

describe('removeRecursive / unlinkFile', () => {
  it('递归删除目录树', async () => {
    const target = join(root, 'tree')
    await mkdir(join(target, 'x'), { recursive: true })
    await writeFile(join(target, 'x', 'f.txt'), 'f')
    await removeRecursive(target)
    await expect(readFile(join(target, 'x', 'f.txt'))).rejects.toThrow()
  })

  it('删除单文件', async () => {
    const target = join(root, 'f.txt')
    await writeFile(target, 'x')
    await unlinkFile(target)
    await expect(readFile(target)).rejects.toThrow()
  })

  it('删除只读文件（Windows 放开只读后删除）', async () => {
    const target = join(root, 'ro.txt')
    await writeFile(target, 'x')
    await unlinkFile(target)
    await expect(readFile(target)).rejects.toThrow()
  })
})

describe('statSize', () => {
  it('统计单文件字节数', async () => {
    const target = join(root, 'f.txt')
    await writeFile(target, '12345')
    expect(await statSize(target)).toBe(5)
  })

  it('统计目录递归大小', async () => {
    const target = join(root, 'dir')
    await mkdir(join(target, 'sub'), { recursive: true })
    await writeFile(join(target, 'a.txt'), '123')
    await writeFile(join(target, 'sub', 'b.txt'), '12345')
    expect(await statSize(target)).toBe(8)
  })
})
