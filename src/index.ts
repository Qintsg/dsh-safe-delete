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
import { Config, resolveConfig, type ResolvedConfig } from './config.js'
import { applyPurgeTool } from './tools/purge.js'
import { applyRestoreTool } from './tools/restore.js'
import { applySafeDeleteTool } from './tools/safe-delete.js'
import { applyTrashListTool } from './tools/trash-list.js'

export * from './config.js'

/** Cordis 插件名，用于 loader 诊断与组合配置。 */
export const name = 'safe-delete'

/** 插件运行时依赖的服务。 */
export const inject = ['tools', 'systemPrompt']

/**
 * 插件主体：校验配置，注册四个安全删除工具与系统提示引导。
 *
 * :param ctx: Cordis 上下文（当前 Fiber）
 * :param config: 插件配置（默认值已由 schemastery 填充）
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config as ResolvedConfig)
  let current = resolved
  const getConfig = (): ResolvedConfig => current
  // M4 接入 settings 服务后，配置变更通过 watch 更新 current 实现实时生效。

  ctx.logger('safe-delete').info(
    '回收区配置已加载: %s（保留 %d 天，上限 %s）',
    current.trashDir || '(工作区 .dsh-trash)',
    current.retentionDays,
    current.maxSizeBytes === 0 ? '不限' : `${current.maxSizeBytes} 字节`,
  )

  ctx.systemPrompt.section({
    name: 'tool:safe-delete',
    order: 106,
    text: 'Deleting files: prefer the safe_delete tool (moves files into a restorable trash area) over rm/Remove-Item. '
      + 'Set `permanent: true` only when the deletion must be irreversible (e.g. cleaning node_modules). '
      + 'Use trash_list / restore to recover deleted files, and purge to empty the trash permanently.',
  })

  applySafeDeleteTool(ctx, getConfig)
  applyTrashListTool(ctx, getConfig)
  applyRestoreTool(ctx, getConfig)
  applyPurgeTool(ctx, getConfig)
}
