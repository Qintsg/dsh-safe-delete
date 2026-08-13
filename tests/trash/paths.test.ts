/**
 * 回收区路径解析模块单元测试。
 *
 * @project dsh-safe-delete
 * @file paths.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  conflictPath,
  DEFAULT_TRASH_DIR_NAME,
  entryId,
  EXTERNAL_DIR_NAME,
  FILES_DIR_NAME,
  formatTimestamp,
  isPathInside,
  mapToTrashRelative,
  normalizeForCompare,
  resolveTrashRoot,
  timestampSuffix,
  trashEntryPath,
  trashMetaPath,
} from '../../src/trash/paths.js'

/** 平台无关的工作区绝对路径。 */
const WS = resolve('/ws')

/** 平台无关的工作区外绝对路径。 */
const OUTSIDE = resolve('/outside')

describe('entryId / formatTimestamp / timestampSuffix', () => {
  it('entryId 形如时间戳-随机后缀', () => {
    const id = entryId(new Date(2026, 7, 13, 22, 30, 45))
    expect(id).toMatch(/^20260813T223045-[0-9a-f]{4}$/)
  })

  it('entryId 两次生成不同', () => {
    expect(entryId(new Date(2026, 7, 13, 22, 30, 45))).not.toBe(entryId(new Date(2026, 7, 13, 22, 30, 45)))
  })

  it('formatTimestamp 补零', () => {
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102T030405')
  })

  it('timestampSuffix 带点前缀', () => {
    expect(timestampSuffix(new Date(2026, 7, 13, 22, 30, 45))).toBe('.20260813T223045')
  })
})

describe('resolveTrashRoot', () => {
  it('trashDir 为空时使用工作区下的默认回收区', () => {
    expect(resolveTrashRoot('', WS)).toBe(resolve(WS, DEFAULT_TRASH_DIR_NAME))
  })

  it('trashDir 显式配置时使用之（绝对化）', () => {
    expect(resolveTrashRoot(resolve('/trash'), WS)).toBe(resolve('/trash'))
  })

  it('trashDir 为相对路径时抛出异常', () => {
    expect(() => resolveTrashRoot('trash', WS)).toThrow(/absolute/)
  })

  it('两者皆空时抛出异常', () => {
    expect(() => resolveTrashRoot('', undefined)).toThrow(/workspace/)
  })
})

describe('isPathInside / normalizeForCompare', () => {
  it('子路径在父路径内', () => {
    expect(isPathInside(join(WS, 'src', 'a.ts'), WS)).toBe(true)
  })

  it('相等视为在内', () => {
    expect(isPathInside(WS, WS)).toBe(true)
  })

  it('兄弟路径不在父路径内', () => {
    expect(isPathInside(join(OUTSIDE, 'a.ts'), WS)).toBe(false)
  })

  it('前缀相似但不是子路径', () => {
    expect(isPathInside(join(resolve('/ws-other'), 'a.ts'), WS)).toBe(false)
  })

  it('normalizeForCompare 返回绝对路径', () => {
    expect(normalizeForCompare('a/b.ts')).toBe(normalizeForCompare(resolve('a/b.ts')))
  })
})

describe('mapToTrashRelative', () => {
  it('工作区内文件映射为相对路径（正斜杠）', () => {
    const rel = mapToTrashRelative(join(WS, 'src', 'index.ts'), WS, 'id1')
    expect(rel).toBe('src/index.ts')
  })

  it('工作区内嵌套目录映射正确', () => {
    const rel = mapToTrashRelative(join(WS, 'a', 'b', 'c.txt'), WS, 'id1')
    expect(rel).toBe('a/b/c.txt')
  })

  it('工作区外文件落入 _external 且带条目 ID 前缀', () => {
    const rel = mapToTrashRelative(join(OUTSIDE, 'notes.txt'), WS, '20260813T223045-ab12')
    expect(rel).toBe(`${EXTERNAL_DIR_NAME}/20260813T223045-ab12-notes.txt`)
  })

  it('无工作区时一律落入 _external', () => {
    const rel = mapToTrashRelative(join(WS, 'a.txt'), undefined, 'id1')
    expect(rel).toBe(`${EXTERNAL_DIR_NAME}/id1-a.txt`)
  })
})

describe('trashEntryPath / trashMetaPath / conflictPath', () => {
  it('trashEntryPath 拼出 files/ 下路径', () => {
    expect(trashEntryPath(resolve('/trash'), 'src/index.ts')).toBe(resolve('/trash', FILES_DIR_NAME, 'src/index.ts'))
  })

  it('trashMetaPath 拼出 entries/ 下路径', () => {
    expect(trashMetaPath(resolve('/trash'), 'id1')).toBe(resolve('/trash', 'entries', 'id1.json'))
  })

  it('conflictPath 追加后缀', () => {
    expect(conflictPath('src/index.ts', '.20260813T223045')).toBe('src/index.ts.20260813T223045')
  })
})
