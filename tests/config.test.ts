/**
 * 配置模块单元测试。
 *
 * @project dsh-safe-delete
 * @file config.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { describe, expect, it } from 'vitest'
import {
  Config,
  DEFAULT_TRASH_DIR_NAME,
  DELETE_HIJACK_MODES,
  RESTORE_CONFLICT_MODES,
  resolveConfig,
} from '../src/config.js'

describe('Config schema', () => {
  it('为未填写的字段填充默认值', () => {
    const config = Config({})
    expect(config.trashDir).toBe('')
    expect(config.retentionDays).toBe(30)
    expect(config.maxSizeBytes).toBe(5 * 1024 ** 3)
    expect(config.confirmThreshold).toBe(10)
    expect(config.restoreConflict).toBe('rename')
    expect(config.deleteHijack).toBe('block')
    expect(config.interceptFsDelete).toBe(false)
  })

  it('保留用户显式填写的字段', () => {
    const config = Config({
      trashDir: '/tmp/trash',
      retentionDays: 7,
      maxSizeBytes: 1024,
      confirmThreshold: 1,
      restoreConflict: 'skip',
      deleteHijack: 'off',
      interceptFsDelete: true,
    })
    expect(config).toEqual({
      trashDir: '/tmp/trash',
      retentionDays: 7,
      maxSizeBytes: 1024,
      confirmThreshold: 1,
      restoreConflict: 'skip',
      deleteHijack: 'off',
      interceptFsDelete: true,
    })
  })

  it('restoreConflict 只接受枚举值', () => {
    expect(() => Config({ restoreConflict: 'delete' })).toThrow()
  })

  it('deleteHijack 只接受枚举值', () => {
    expect(() => Config({ deleteHijack: 'allow' })).toThrow()
  })

  it('默认回收区目录名为 .dsh-trash', () => {
    expect(DEFAULT_TRASH_DIR_NAME).toBe('.dsh-trash')
  })

  it('枚举常量与类型一致', () => {
    expect(DELETE_HIJACK_MODES).toEqual(['off', 'block', 'ask'])
    expect(RESTORE_CONFLICT_MODES).toEqual(['rename', 'skip', 'overwrite'])
  })
})

describe('resolveConfig', () => {
  it('返回解析后的完整配置', () => {
    const resolved = resolveConfig(Config({ trashDir: '/tmp/trash' }))
    expect(resolved).toEqual({
      trashDir: '/tmp/trash',
      retentionDays: 30,
      maxSizeBytes: 5 * 1024 ** 3,
      confirmThreshold: 10,
      restoreConflict: 'rename',
      deleteHijack: 'block',
      interceptFsDelete: false,
    })
  })

  it('retentionDays 为负数时抛出异常', () => {
    expect(() => resolveConfig(Config({ retentionDays: -1 }))).toThrow(/retentionDays/)
  })

  it('maxSizeBytes 为负数时抛出异常', () => {
    expect(() => resolveConfig(Config({ maxSizeBytes: -1 }))).toThrow(/maxSizeBytes/)
  })

  it('confirmThreshold 为负数时抛出异常', () => {
    expect(() => resolveConfig(Config({ confirmThreshold: -1 }))).toThrow(/confirmThreshold/)
  })
})
