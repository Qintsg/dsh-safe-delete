/**
 * 插件配置模块：定义配置项 schema 与解析逻辑。
 *
 * @project dsh-safe-delete
 * @file config.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import z from '@deepseek-ai/schemastery'

/** 插件配置项（可选项，默认值由 Config schema 填充）。 */
export interface Config {
  /** 回收区根目录；留空时使用 DSH_HOME 下的默认回收区。 */
  trashDir?: string
  /** 回收区文件保留天数，超过后自动清理；0 表示不自动清理。 */
  retentionDays?: number
  /** 单次删除文件数达到该阈值时需二次确认；0 表示始终确认。 */
  confirmThreshold?: number
}

/** 配置 schema：由 schemastery 填充默认值。 */
export const Config: z<Config> = z.object({
  trashDir: z.string().default(''),
  retentionDays: z.number().default(30),
  confirmThreshold: z.number().default(10),
})

/** 默认回收区目录名（位于 DSH_HOME 之下）。 */
export const DEFAULT_TRASH_DIR_NAME = 'trash'

/** 配置解析后的完整形态。 */
export type ResolvedConfig = Required<Config>

/**
 * 校验配置并返回解析后的完整配置。
 *
 * :param config: 原始配置（未填写的字段已被 schema 默认值填充）
 * :returns: 解析后的完整配置
 * :raises ValueError: 当 retentionDays 为负数或 confirmThreshold 为负数时
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved = config as ResolvedConfig
  if (resolved.retentionDays < 0) {
    throw new Error(`safe-delete: retentionDays must be >= 0, got ${resolved.retentionDays}`)
  }
  if (resolved.confirmThreshold < 0) {
    throw new Error(`safe-delete: confirmThreshold must be >= 0, got ${resolved.confirmThreshold}`)
  }
  return resolved
}
