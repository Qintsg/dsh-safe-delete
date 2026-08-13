/**
 * purge 工具：彻底清除回收区条目（不可逆，须经确认）。
 *
 * @project dsh-safe-delete
 * @file purge.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from '../config.js'
import { purgeEntries } from '../trash/ops.js'
import { resolveTrashRoot } from '../trash/paths.js'

/** 工具参数。 */
export interface PurgeToolArgs {
  ids?: string[]
  all?: boolean
}

/**
 * 注册 purge 工具。
 *
 * :param ctx: 插件上下文
 * :param getConfig: 当前生效配置读取器（settings 实时源）
 */
export function applyPurgeTool(ctx: Context, getConfig: () => ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'purge',
    description: 'Permanently delete trash entries (irreversible). Pass `ids` or set `all: true` to empty the trash. '
      + 'Requires confirmation.',
    parameters: {
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Trash entry ids to purge (mutually exclusive with all).',
      },
      all: { type: 'boolean', description: 'When true, purge every entry in the trash.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          purged: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: 'Ids of entries permanently deleted.',
          },
          failed: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                reason: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines: string[] = []
        for (const id of value.purged) {
          lines.push(`purged ${id}`)
        }
        for (const item of value.failed) {
          lines.push(`failed ${item.id}: ${item.reason}`)
        }
        return [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : '(nothing purged)' }]
      },
    },
    isConcurrencySafe: () => false,
    async execute(args: PurgeToolArgs, exec: ToolRunContext) {
      if (args.ids === undefined && args.all !== true) {
        throw new Error('either ids or all: true is required')
      }
      if (args.ids !== undefined && args.all === true) {
        throw new Error('ids and all are mutually exclusive')
      }
      const config = getConfig()
      const workspace = exec.agent?.session.header.cwd
      const trashRoot = resolveTrashRoot(config.trashDir, workspace)
      // 确认门禁在 M5 接入（tools/pre-execute 的 ask 或工具内审批）。
      const result = await purgeEntries({ trashRoot, ids: args.ids, all: args.all === true })
      return result
    },
  }))
}
