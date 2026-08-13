/**
 * 设置卡片国际化模块：中英字典与语言解析（纯函数，可单测）。
 *
 * @project dsh-safe-delete
 * @file i18n.ts
 * @author Qintsg
 * @date 2026-08-13
 */

/** 枚举选项的本地化标签。 */
export interface OptionLabel {
  [value: string]: string
}

/** 卡片文案字典。 */
export interface CardDict {
  title: string
  loading: string
  retry: string
  readOnly: string
  saved: string
  saving: string
  reload: string
  save: string
  /** 字段标签。 */
  fields: Record<string, string>
  /** 字段提示。 */
  hints: Record<string, string>
  /** 枚举选项标签（restoreConflict / deleteHijack 等）。 */
  options: Record<string, OptionLabel>
}

/** 中文文案。 */
const ZH: CardDict = {
  title: '安全删除（dsh-safe-delete）',
  loading: '加载中…',
  retry: '重试',
  readOnly: '当前设置提供方为只读。',
  saved: '已保存，实时生效。',
  saving: '保存中…',
  reload: '重新加载',
  save: '保存',
  fields: {
    trashDir: '回收区目录',
    retentionDays: '保留天数',
    maxSizeBytes: '回收区大小上限（字节）',
    confirmThreshold: '删除确认阈值',
    restoreConflict: '恢复冲突策略',
    deleteHijack: '删除命令劫持',
    interceptFsDelete: '拦截 fs 删除（预留）',
  },
  hints: {
    trashDir: '留空 = 工作区/.dsh-trash（无工作区时 $DSH_HOME/.dsh-safe-delete-trash）',
    retentionDays: '0 = 不按时间清理',
    maxSizeBytes: '0 = 不限；默认 5368709120（5 GiB）',
    confirmThreshold: '单次删除达到该条数需审批；0 = 始终确认',
  },
  options: {
    restoreConflict: {
      rename: '重命名（自动加后缀）',
      skip: '跳过',
      overwrite: '覆盖',
    },
    deleteHijack: {
      block: '拦截（拒绝并引导）',
      ask: '询问（转人工审批）',
      off: '关闭',
    },
  },
}

/** 英文文案。 */
const EN: CardDict = {
  title: 'Safe Delete (dsh-safe-delete)',
  loading: 'Loading…',
  retry: 'Retry',
  readOnly: 'The active settings provider is read-only.',
  saved: 'Saved and applied live.',
  saving: 'Saving…',
  reload: 'Reload',
  save: 'Save',
  fields: {
    trashDir: 'Trash directory',
    retentionDays: 'Retention days',
    maxSizeBytes: 'Trash size cap (bytes)',
    confirmThreshold: 'Confirm threshold',
    restoreConflict: 'Restore conflict',
    deleteHijack: 'Delete hijack',
    interceptFsDelete: 'Intercept fs delete (reserved)',
  },
  hints: {
    trashDir: 'Empty = workspace/.dsh-trash (or $DSH_HOME/.dsh-safe-delete-trash without a workspace)',
    retentionDays: '0 = never expire by time',
    maxSizeBytes: '0 = unlimited; default 5368709120 (5 GiB)',
    confirmThreshold: 'Batch deletions at/above this count require approval; 0 = always confirm',
  },
  options: {
    restoreConflict: {
      rename: 'Rename (auto suffix)',
      skip: 'Skip',
      overwrite: 'Overwrite',
    },
    deleteHijack: {
      block: 'Block (deny and guide)',
      ask: 'Ask (human approval)',
      off: 'Off',
    },
  },
}

const DICTS: Record<string, CardDict> = { zh: ZH, en: EN }

/**
 * 根据 DSH locale id 解析文案字典（zh* → 中文，其余 → 英文）。
 *
 * :param localeId: DSH locale 快照的 id（如 `zh-CN`、`en`）
 * :returns: 对应语言字典
 */
export function resolveDict(localeId: string | undefined): CardDict {
  if (localeId !== undefined && localeId.toLowerCase().startsWith('zh')) return ZH
  return EN
}

/** 语言标签列表（字典选择用）。 */
export const LOCALE_IDS = Object.keys(DICTS)
