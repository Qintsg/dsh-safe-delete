/**
 * 回收区核心操作模块单元测试（真实临时目录端到端）。
 *
 * @project dsh-safe-delete
 * @file ops.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readManifest } from '../../src/trash/manifest.js'
import { globToRegExp, listEntries, purgeEntries, restoreEntries, safeDelete } from '../../src/trash/ops.js'
import { trashEntryPath } from '../../src/trash/paths.js'

/** 每次测试独立的临时根目录（回收区）。 */
let root: string

/** 模拟工作区（root 之外）。 */
let ws: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-safe-delete-ops-'))
  root = join(base, 'trash')
  ws = join(base, 'ws')
  await mkdir(ws, { recursive: true })
})

afterEach(async () => {
  await rm(join(root, '..'), { recursive: true, force: true })
})

/** 断言路径存在。 */
async function expectExists(path: string): Promise<void> {
  await expect(access(path)).resolves.toBeUndefined()
}

/** 断言路径不存在。 */
async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow()
}

describe('safeDelete', () => {
  it('文件移入回收区并记录元数据', async () => {
    const file = join(ws, 'a.txt')
    await writeFile(file, 'hello')
    const result = await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false, now: new Date('2026-08-13T10:00:00.000Z') })
    expect(result.skipped).toEqual([])
    expect(result.entries).toHaveLength(1)
    const entry = result.entries[0]!
    expect(entry.originalPath).toBe(file)
    expect(entry.trashPath).toBe('a.txt')
    expect(entry.type).toBe('file')
    expect(entry.sizeBytes).toBe(5)
    await expectMissing(file)
    expect(await readFile(trashEntryPath(root, 'a.txt'), 'utf8')).toBe('hello')
    expect(await readManifest(root)).toEqual(result.entries)
  })

  it('目录需 recursive 才删除', async () => {
    const dir = join(ws, 'd')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'x.txt'), 'x')
    const noRecursive = await safeDelete({ trashRoot: root, workspace: ws, paths: [dir], recursive: false })
    expect(noRecursive.entries).toEqual([])
    expect(noRecursive.skipped[0]?.reason).toContain('recursive')
    await expectExists(dir)

    const recursive = await safeDelete({ trashRoot: root, workspace: ws, paths: [dir], recursive: true })
    expect(recursive.entries).toHaveLength(1)
    await expectMissing(dir)
    expect(await readFile(trashEntryPath(root, 'd/x.txt'), 'utf8')).toBe('x')
  })

  it('不存在的路径记入 skipped 不中断', async () => {
    const file = join(ws, 'a.txt')
    await writeFile(file, 'x')
    const result = await safeDelete({ trashRoot: root, workspace: ws, paths: [join(ws, 'missing.txt'), file], recursive: false })
    expect(result.skipped).toEqual([{ path: join(ws, 'missing.txt'), reason: 'not found' }])
    expect(result.entries).toHaveLength(1)
  })

  it('同名文件再次删除追加时间戳后缀', async () => {
    const file = join(ws, 'a.txt')
    await writeFile(file, '1')
    await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false, now: new Date('2026-08-13T10:00:00.000Z') })
    await writeFile(file, '2')
    const second = await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false, now: new Date('2026-08-13T11:00:00.000Z') })
    expect(second.entries[0]?.trashPath).toBe('a.txt.20260813T110000')
    expect(await readFile(trashEntryPath(root, 'a.txt'), 'utf8')).toBe('1')
    expect(await readFile(trashEntryPath(root, 'a.txt.20260813T110000'), 'utf8')).toBe('2')
  })

  it('工作区外文件落入 _external', async () => {
    const outside = join(root, '..', 'outside.txt')
    await writeFile(outside, 'o')
    const result = await safeDelete({ trashRoot: root, workspace: ws, paths: [outside], recursive: false })
    expect(result.entries[0]?.trashPath).toMatch(/^_external\//)
    await expectMissing(outside)
  })
})

describe('listEntries', () => {
  it('按 pattern 过滤并按 limit 截断', async () => {
    for (const name of ['a.tmp', 'b.txt', 'c.tmp']) {
      const file = join(ws, name)
      await writeFile(file, name)
      await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false })
    }
    const all = await listEntries({ trashRoot: root })
    expect(all.total).toBe(3)
    const tmp = await listEntries({ trashRoot: root, pattern: '*.tmp' })
    expect(tmp.total).toBe(2)
    const limited = await listEntries({ trashRoot: root, limit: 1 })
    expect(limited.entries).toHaveLength(1)
    expect(limited.total).toBe(3)
  })
})

describe('restoreEntries', () => {
  it('恢复到原路径', async () => {
    const file = join(ws, 'r.txt')
    await writeFile(file, 'data')
    const { entries } = await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false })
    const result = await restoreEntries({ trashRoot: root, ids: [entries[0]!.id], onConflict: 'rename' })
    expect(result.restored).toEqual([{ id: entries[0]!.id, path: file }])
    expect(result.failed).toEqual([])
    expect(await readFile(file, 'utf8')).toBe('data')
    expect(await readManifest(root)).toEqual([])
  })

  it('目标存在且 rename：生成递增命名', async () => {
    const file = join(ws, 'c.txt')
    await writeFile(file, 'new')
    const { entries } = await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false })
    await writeFile(file, 'new-content')
    const result = await restoreEntries({ trashRoot: root, ids: [entries[0]!.id], onConflict: 'rename' })
    expect(result.restored[0]?.path).toBe(join(ws, 'c (1).txt'))
    expect(await readFile(join(ws, 'c (1).txt'), 'utf8')).toBe('new')
    expect(await readFile(file, 'utf8')).toBe('new-content')
  })

  it('目标存在且 skip：跳过并报告', async () => {
    const file = join(ws, 's.txt')
    await writeFile(file, 'old')
    const { entries } = await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false })
    await writeFile(file, 'blocking')
    const result = await restoreEntries({ trashRoot: root, ids: [entries[0]!.id], onConflict: 'skip' })
    expect(result.restored).toEqual([])
    expect(result.failed[0]?.reason).toContain('exists')
  })

  it('目标存在且 overwrite：覆盖恢复', async () => {
    const file = join(ws, 'o.txt')
    await writeFile(file, 'old')
    const { entries } = await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false })
    await writeFile(file, 'blocking')
    const result = await restoreEntries({ trashRoot: root, ids: [entries[0]!.id], onConflict: 'overwrite' })
    expect(result.restored[0]?.path).toBe(file)
    expect(await readFile(file, 'utf8')).toBe('old')
  })

  it('按 pattern 批量恢复', async () => {
    for (const name of ['p1.tmp', 'p2.tmp']) {
      const file = join(ws, name)
      await writeFile(file, name)
      await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false })
    }
    const result = await restoreEntries({ trashRoot: root, pattern: '*.tmp', onConflict: 'rename' })
    expect(result.restored).toHaveLength(2)
    await expectExists(join(ws, 'p1.tmp'))
    await expectExists(join(ws, 'p2.tmp'))
  })

  it('回收数据缺失时清理孤儿索引', async () => {
    const file = join(ws, 'g.txt')
    await writeFile(file, 'x')
    const { entries } = await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false })
    await rm(trashEntryPath(root, 'g.txt'), { force: true })
    const result = await restoreEntries({ trashRoot: root, ids: [entries[0]!.id], onConflict: 'rename' })
    expect(result.failed[0]?.reason).toBe('trash data missing')
    expect(await readManifest(root)).toEqual([])
  })
})

describe('purgeEntries', () => {
  it('按 ids 彻底清除', async () => {
    const file = join(ws, 'p.txt')
    await writeFile(file, 'x')
    const { entries } = await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false })
    const result = await purgeEntries({ trashRoot: root, ids: [entries[0]!.id], all: false })
    expect(result.purged).toEqual([entries[0]!.id])
    await expectMissing(trashEntryPath(root, 'p.txt'))
    expect(await readManifest(root)).toEqual([])
  })

  it('all 清除全部', async () => {
    for (const name of ['q1.txt', 'q2.txt']) {
      const file = join(ws, name)
      await writeFile(file, name)
      await safeDelete({ trashRoot: root, workspace: ws, paths: [file], recursive: false })
    }
    const result = await purgeEntries({ trashRoot: root, all: true })
    expect(result.purged).toHaveLength(2)
    expect(await readManifest(root)).toEqual([])
  })
})

describe('globToRegExp', () => {
  it('*.tmp 匹配尾部', () => {
    const re = globToRegExp('*.tmp')
    expect(re.test('/a/b/c.tmp')).toBe(true)
    expect(re.test('/a/b/c.txt')).toBe(false)
    expect(re.test('/a/b/c.tmp/x')).toBe(false)
  })

  it('? 匹配单字符', () => {
    const re = globToRegExp('a?.txt')
    expect(re.test('/x/ab.txt')).toBe(true)
    expect(re.test('/x/a.txt')).toBe(false)
  })

  it('特殊字符转义', () => {
    const re = globToRegExp('a+.txt')
    expect(re.test('/x/a+.txt')).toBe(true)
    expect(re.test('/x/aa.txt')).toBe(false)
  })
})
