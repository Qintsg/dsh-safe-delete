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
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Config, resolveConfig, type Config as ConfigType, type ResolvedConfig } from './config.js'
import { applyDeleteHijack } from './hijack.js'
import { installSettingsRoute } from './settings-route.js'
import { applyPurgeTool } from './tools/purge.js'
import { applyRestoreTool } from './tools/restore.js'
import { applySafeDeleteTool } from './tools/safe-delete.js'
import { applyTrashListTool } from './tools/trash-list.js'

export * from './config.js'

/** Cordis 插件名，用于 loader 诊断与组合配置。 */
export const name = 'safe-delete'

/** 插件运行时依赖的服务。 */
export const inject = ['tools', 'systemPrompt']

/** settings 命名空间（小写 kebab-case）。 */
const SETTINGS_NS = settingsNamespace('safe-delete')

/**
 * 插件主体：校验配置，注册安全删除工具、删除命令劫持与
 * settings 实时配置（DSH Web 设置面板）。
 *
 * :param ctx: Cordis 上下文（当前 Fiber）
 * :param config: 插件配置（默认值已由 schemastery 填充）
 */
export function apply(ctx: Context, config: ConfigType): void {
  const resolved = resolveConfig(config as ResolvedConfig)
  // 当前生效配置：组合配置为初始值；settings 服务存在时经
  // setSource/onChange 链路刷新为设置面板的解析值（applies: live）。
  let sourceThunk: () => ResolvedConfig = () => resolved
  let current = resolved
  const getConfig = (): ResolvedConfig => current
  const refreshConfig = (): void => {
    current = sourceThunk()
  }

  ctx.logger('safe-delete').info(
    '回收区配置已加载: %s（保留 %d 天，上限 %s，劫持模式 %s）',
    current.trashDir || '(工作区 .dsh-trash)',
    current.retentionDays,
    current.maxSizeBytes === 0 ? '不限' : `${current.maxSizeBytes} 字节`,
    current.deleteHijack,
  )

  installSettingsSection(ctx, SETTINGS_NS, Config, config, {
    setSource: (source) => {
      sourceThunk = () => source() as ResolvedConfig
    },
    onChange: () => {
      refreshConfig()
      ctx.logger('safe-delete').info('配置已更新: 劫持模式 %s', current.deleteHijack)
    },
    validate: (value) => {
      resolveConfig(value)
    },
  })

  ctx.systemPrompt.section({
    name: 'tool:safe-delete',
    order: 106,
    text: 'Deleting files: prefer the safe_delete tool (moves files into a restorable trash area) over rm/Remove-Item. '
      + 'Set `permanent: true` only when the deletion must be irreversible (e.g. cleaning node_modules). '
      + 'Use trash_list / restore to recover deleted files, and purge to empty the trash permanently. '
      + 'Do not put deletions into script files (rm / Remove-Item / fs.rmSync / os.remove inside .sh/.ps1/.js/.py): '
      + 'scripts run outside delete interception, so files are lost without the trash safety net.',
  })

  applySafeDeleteTool(ctx, getConfig)
  applyTrashListTool(ctx, getConfig)
  applyRestoreTool(ctx, getConfig)
  applyPurgeTool(ctx, getConfig)
  applyDeleteHijack(ctx, () => getConfig().deleteHijack, getConfig)
  // DSH Web 设置卡片的后端路由（webServer 服务存在时生效）。
  installSettingsRoute(ctx)
}
