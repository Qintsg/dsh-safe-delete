/**
 * 回收区索引与清理模块单元测试。
 *
 * @project dsh-safe-delete
 * @file manifest.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendEntry,
  ensureTrashRoot,
  readEntryMeta,
  readManifest,
  rebuildManifest,
  removeEntries,
  removeEntryMeta,
  sweep,
  writeEntryMeta,
  type TrashEntry,
} from '../../src/trash/manifest.js'
import { MANIFEST_FILE_NAME, TRASH_README_FILE_NAME, trashEntryPath } from '../../src/trash/paths.js'

/** 每次测试独立的临时根目录。 */
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-safe-delete-manifest-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 构造一条条目。 */
function makeEntry(overrides: Partial<TrashEntry> & { id: string }): TrashEntry {
  return {
    originalPath: `/origin/${overrides.id}.txt`,
    trashPath: `${overrides.id}.txt`,
    deletedAt: '2026-08-13T00:00:00.000Z',
    type: 'file',
    sizeBytes: 10,
    ...overrides,
  }
}

/** 播种一个可恢复的条目（含回收文件与元数据与索引）。 */
async function seedEntry(entry: TrashEntry): Promise<void> {
  await mkdir(join(root, 'files'), { recursive: true })
  await writeFile(trashEntryPath(root, entry.trashPath), 'data')
  await writeEntryMeta(root, entry)
  await appendEntry(root, entry)
}

describe('ensureTrashRoot', () => {
  it('创建目录结构与 README', async () => {
    await ensureTrashRoot(root)
    await expect(readFile(join(root, 'README.md'), 'utf8')).resolves.toContain('回收区')
    await expect(readFile(join(root, 'files', 'README.md'))).rejects.toThrow()
  })

  it('重复调用幂等', async () => {
    await ensureTrashRoot(root)
    await ensureTrashRoot(root)
    expect(await readFile(join(root, TRASH_README_FILE_NAME), 'utf8')).toContain('回收区')
  })
})

describe('manifest 读写', () => {
  it('appendEntry 后 readManifest 往返一致', async () => {
    const entry = makeEntry({ id: 'a' })
    await seedEntry(entry)
    const entries = await readManifest(root)
    expect(entries).toEqual([entry])
  })

  it('readManifest 缺失时返回空表', async () => {
    expect(await readManifest(root)).toEqual([])
  })

  it('readManifest 容忍损坏行', async () => {
    await writeFile(join(root, MANIFEST_FILE_NAME), '{broken}\n{"id":"ok","originalPath":"/o","trashPath":"t","deletedAt":"2026-01-01T00:00:00.000Z","type":"file","sizeBytes":1}\n', 'utf8')
    const entries = await readManifest(root)
    expect(entries.map((entry) => entry.id)).toEqual(['ok'])
  })

  it('rebuildManifest 从 entries/ 重建索引', async () => {
    const entry = makeEntry({ id: 'a' })
    await writeEntryMeta(root, entry)
    const rebuilt = await rebuildManifest(root)
    expect(rebuilt).toEqual([entry])
    expect(await readManifest(root)).toEqual([entry])
  })

  it('removeEntries 剔除指定条目', async () => {
    const a = makeEntry({ id: 'a' })
    const b = makeEntry({ id: 'b' })
    await seedEntry(a)
    await seedEntry(b)
    await removeEntries(root, new Set(['a']))
    expect((await readManifest(root)).map((entry) => entry.id)).toEqual(['b'])
  })

  it('readEntryMeta / removeEntryMeta', async () => {
    const entry = makeEntry({ id: 'a' })
    await writeEntryMeta(root, entry)
    expect(await readEntryMeta(root, 'a')).toEqual(entry)
    expect(await readEntryMeta(root, 'missing')).toBeUndefined()
    await removeEntryMeta(root, 'a')
    expect(await readEntryMeta(root, 'a')).toBeUndefined()
  })
})

describe('sweep', () => {
  it('清理过期条目（retentionDays）', async () => {
    const old = makeEntry({ id: 'old', deletedAt: '2026-07-01T00:00:00.000Z' })
    const fresh = makeEntry({ id: 'fresh', deletedAt: '2026-08-10T00:00:00.000Z' })
    await seedEntry(old)
    await seedEntry(fresh)
    const result = await sweep(root, { retentionDays: 30, maxSizeBytes: 0, now: new Date('2026-08-13T00:00:00.000Z') })
    expect(result.removedIds).toEqual(['old'])
    expect((await readManifest(root)).map((entry) => entry.id)).toEqual(['fresh'])
    await expect(readFile(trashEntryPath(root, old.trashPath))).rejects.toThrow()
  })

  it('retentionDays 为 0 时不过期清理', async () => {
    const old = makeEntry({ id: 'old', deletedAt: '2020-01-01T00:00:00.000Z' })
    await seedEntry(old)
    const result = await sweep(root, { retentionDays: 0, maxSizeBytes: 0, now: new Date('2026-08-13T00:00:00.000Z') })
    expect(result.removedIds).toEqual([])
    expect(await readManifest(root)).toHaveLength(1)
  })

  it('超大小上限时从旧到新清理', async () => {
    const first = makeEntry({ id: 'first', sizeBytes: 100, deletedAt: '2026-08-01T00:00:00.000Z' })
    const second = makeEntry({ id: 'second', sizeBytes: 50, deletedAt: '2026-08-02T00:00:00.000Z' })
    await seedEntry(first)
    await seedEntry(second)
    const result = await sweep(root, { retentionDays: 0, maxSizeBytes: 120, now: new Date('2026-08-13T00:00:00.000Z') })
    expect(result.removedIds).toEqual(['first'])
    expect((await readManifest(root)).map((entry) => entry.id)).toEqual(['second'])
  })

  it('清理孤儿索引（files/ 中已不存在）', async () => {
    const entry = makeEntry({ id: 'orphan' })
    await writeEntryMeta(root, entry)
    await appendEntry(root, entry)
    const result = await sweep(root, { retentionDays: 0, maxSizeBytes: 0 })
    expect(result.orphanedIds).toEqual(['orphan'])
    expect(await readManifest(root)).toEqual([])
  })

  it('文件实际存在时不清除', async () => {
    const entry = makeEntry({ id: 'keep' })
    await seedEntry(entry)
    const result = await sweep(root, { retentionDays: 0, maxSizeBytes: 0 })
    expect(result.removedIds).toEqual([])
    expect(result.orphanedIds).toEqual([])
    expect(await readManifest(root)).toHaveLength(1)
  })
})
