/**
 * 设置卡片 i18n 模块单元测试。
 *
 * @project dsh-safe-delete
 * @file i18n.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { describe, expect, it } from 'vitest'
import { LOCALE_IDS, resolveDict } from '../src/client/i18n.js'

describe('resolveDict', () => {
  it('zh 前缀返回中文文案', () => {
    const dict = resolveDict('zh-CN')
    expect(dict.title).toContain('安全删除')
    expect(dict.save).toBe('保存')
    expect(dict.options.deleteHijack).toMatchObject({ block: '拦截（拒绝并引导）', ask: '询问（转人工审批）', off: '关闭' })
    expect(dict.options.restoreConflict).toMatchObject({ rename: '重命名（自动加后缀）', skip: '跳过', overwrite: '覆盖' })
  })

  it('zh 大小写不敏感', () => {
    expect(resolveDict('ZH-Hans')).toBe(resolveDict('zh-CN'))
  })

  it('en 返回英文文案', () => {
    const dict = resolveDict('en')
    expect(dict.title).toContain('Safe Delete')
    expect(dict.save).toBe('Save')
    expect(dict.options.deleteHijack.block).toBe('Block (deny and guide)')
  })

  it('未知语言回退英文', () => {
    expect(resolveDict('fr')).toBe(resolveDict('en'))
    expect(resolveDict(undefined)).toBe(resolveDict('en'))
  })

  it('字段/提示/选项键齐全（两种语言一致）', () => {
    const zh = resolveDict('zh-CN')
    const en = resolveDict('en')
    const keys = ['trashDir', 'retentionDays', 'maxSizeBytes', 'confirmThreshold', 'restoreConflict', 'deleteHijack', 'interceptFsDelete']
    for (const key of keys) {
      expect(zh.fields[key]).toBeTruthy()
      expect(en.fields[key]).toBeTruthy()
    }
    expect(zh.options.deleteHijack).toHaveProperty('block')
    expect(zh.options.deleteHijack).toHaveProperty('ask')
    expect(zh.options.deleteHijack).toHaveProperty('off')
    expect(zh.options.restoreConflict).toHaveProperty('rename')
    expect(zh.options.restoreConflict).toHaveProperty('skip')
    expect(zh.options.restoreConflict).toHaveProperty('overwrite')
  })

  it('字典标识列表非空', () => {
    expect(LOCALE_IDS).toContain('zh')
    expect(LOCALE_IDS).toContain('en')
  })
})
