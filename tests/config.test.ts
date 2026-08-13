/**
 * 配置模块单元测试。
 *
 * @project dsh-safe-delete
 * @file config.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_TRASH_DIR_NAME, resolveConfig } from '../src/config.js'

describe('Config schema', () => {
  it('为未填写的字段填充默认值', () => {
    const config = Config({})
    expect(config.trashDir).toBe('')
    expect(config.retentionDays).toBe(30)
    expect(config.confirmThreshold).toBe(10)
  })

  it('保留用户显式填写的字段', () => {
    const config = Config({ trashDir: '/tmp/trash', retentionDays: 7, confirmThreshold: 1 })
    expect(config.trashDir).toBe('/tmp/trash')
    expect(config.retentionDays).toBe(7)
    expect(config.confirmThreshold).toBe(1)
  })

  it('默认回收区目录名为 trash', () => {
    expect(DEFAULT_TRASH_DIR_NAME).toBe('trash')
  })
})

describe('resolveConfig', () => {
  it('返回解析后的完整配置', () => {
    const resolved = resolveConfig(Config({ trashDir: '/tmp/trash' }))
    expect(resolved).toEqual({ trashDir: '/tmp/trash', retentionDays: 30, confirmThreshold: 10 })
  })

  it('retentionDays 为负数时抛出异常', () => {
    expect(() => resolveConfig(Config({ retentionDays: -1 }))).toThrow(/retentionDays/)
  })

  it('confirmThreshold 为负数时抛出异常', () => {
    expect(() => resolveConfig(Config({ confirmThreshold: -1 }))).toThrow(/confirmThreshold/)
  })
})
