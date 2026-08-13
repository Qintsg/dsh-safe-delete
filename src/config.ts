/**
 * 插件配置模块：定义配置项 schema 与解析校验逻辑。
 *
 * @project dsh-safe-delete
 * @file config.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import z from '@deepseek-ai/schemastery'

export { DEFAULT_TRASH_DIR_NAME } from './trash/paths.js'

/** 删除命令劫持模式。 */
export const DELETE_HIJACK_MODES = ['off', 'block', 'ask'] as const

/** 删除命令劫持模式类型。 */
export type DeleteHijackMode = (typeof DELETE_HIJACK_MODES)[number]

/** 恢复冲突处理策略。 */
export const RESTORE_CONFLICT_MODES = ['rename', 'skip', 'overwrite'] as const

/** 恢复冲突处理策略类型。 */
export type RestoreConflictMode = (typeof RESTORE_CONFLICT_MODES)[number]

/** 插件配置项（可选项，默认值由 Config schema 填充）。 */
export interface Config {
  /** 回收区根目录（绝对路径）；留空时使用工作区下的 `.dsh-trash`。 */
  trashDir?: string
  /** 回收区文件保留天数，超过后惰性清理；0 表示不按时间清理。 */
  retentionDays?: number
  /** 回收区总大小上限（字节）；0 表示不限制。 */
  maxSizeBytes?: number
  /** 单次删除条目数达到该阈值时需审批确认；0 表示始终确认。 */
  confirmThreshold?: number
  /** 恢复时目标路径已存在的默认处理策略。 */
  restoreConflict?: RestoreConflictMode
  /** 删除命令劫持模式（bash/pwsh 的 rm/Remove-Item 等）。 */
  deleteHijack?: DeleteHijackMode
  /** 预留：fs 服务删除方法拦截开关（fs 服务具备删除能力后启用）。 */
  interceptFsDelete?: boolean
}

/** 配置 schema：由 schemastery 填充默认值并校验。 */
export const Config: z<Config> = z.object({
  trashDir: z.string().default(''),
  retentionDays: z.number().default(30),
  maxSizeBytes: z.number().default(5 * 1024 ** 3),
  confirmThreshold: z.number().default(10),
  restoreConflict: z.union(RESTORE_CONFLICT_MODES).default('rename'),
  deleteHijack: z.union(DELETE_HIJACK_MODES).default('block'),
  interceptFsDelete: z.boolean().default(false),
})

/** 配置解析后的完整形态。 */
export type ResolvedConfig = Required<Config>

/**
 * 校验配置并返回解析后的完整配置。
 *
 * :param config: 原始配置（未填写的字段已被 schema 默认值填充）
 * :returns: 解析后的完整配置
 * :raises ValueError: 当 retentionDays、maxSizeBytes 或 confirmThreshold 为负数时
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved = config as ResolvedConfig
  if (resolved.retentionDays < 0) {
    throw new Error(`safe-delete: retentionDays must be >= 0, got ${resolved.retentionDays}`)
  }
  if (resolved.maxSizeBytes < 0) {
    throw new Error(`safe-delete: maxSizeBytes must be >= 0, got ${resolved.maxSizeBytes}`)
  }
  if (resolved.confirmThreshold < 0) {
    throw new Error(`safe-delete: confirmThreshold must be >= 0, got ${resolved.confirmThreshold}`)
  }
  return resolved
}
