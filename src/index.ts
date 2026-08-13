/**
 * dsh-safe-delete 插件入口：拦截文件删除操作，将文件移入回收区
 * 而非直接销毁，并提供恢复与彻底清除能力。
 *
 * @project dsh-safe-delete
 * @file index.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig } from './config.js'
import type { Config } from './config.js'

export * from './config.js'

/** Cordis 插件名，用于 loader 诊断与组合配置。 */
export const name = 'safe-delete'

/** 插件运行时依赖的服务。 */
export const inject: string[] = []

/**
 * 插件主体：校验配置并注册安全删除相关能力。
 *
 * :param ctx: Cordis 上下文（当前 Fiber）
 * :param config: 插件配置（默认值已由 schemastery 填充）
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.logger('safe-delete').info(
    '回收区配置已加载: %s（保留 %d 天，阈值 %d）',
    resolved.trashDir || '(默认)',
    resolved.retentionDays,
    resolved.confirmThreshold,
  )
  // TODO(实现阶段): 注册回收区初始化、删除拦截、恢复与清除工具
}
