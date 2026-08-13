/**
 * restore 工具：将回收区条目恢复到原路径。
 *
 * @project dsh-safe-delete
 * @file restore.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { RESTORE_CONFLICT_MODES, type ResolvedConfig } from '../config.js'
import { restoreEntries } from '../trash/ops.js'
import { resolveTrashRoot } from '../trash/paths.js'

/** 工具参数。 */
export interface RestoreToolArgs {
  ids?: string[]
  pattern?: string
  onConflict?: (typeof RESTORE_CONFLICT_MODES)[number]
}

/**
 * 注册 restore 工具。
 *
 * :param ctx: 插件上下文
 * :param getConfig: 当前生效配置读取器（settings 实时源）
 */
export function applyRestoreTool(ctx: Context, getConfig: () => ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'restore',
    description: 'Restore trash entries back to their original paths. Pass `ids` (from trash_list) or `pattern`. '
      + 'When the target path already exists, `onConflict` decides: rename (auto-suffix, default), skip, or overwrite.',
    parameters: {
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Trash entry ids to restore (mutually exclusive with pattern).',
      },
      pattern: { type: 'string', description: 'Glob pattern matching the tail of the original path (mutually exclusive with ids).' },
      onConflict: {
        type: 'string',
        enum: [...RESTORE_CONFLICT_MODES],
        description: 'Strategy when the target already exists: rename | skip | overwrite (default rename).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          restored: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                path: { type: 'string', required: true },
              },
            },
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
        for (const item of value.restored) {
          lines.push(`restored ${item.id} -> ${item.path}`)
        }
        for (const item of value.failed) {
          lines.push(`failed ${item.id}: ${item.reason}`)
        }
        return [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : '(nothing to restore)' }]
      },
    },
    isConcurrencySafe: () => false,
    async execute(args: RestoreToolArgs, exec: ToolRunContext) {
      if (args.ids === undefined && args.pattern === undefined) {
        throw new Error('either ids or pattern is required')
      }
      if (args.ids !== undefined && args.pattern !== undefined) {
        throw new Error('ids and pattern are mutually exclusive')
      }
      const config = getConfig()
      const workspace = exec.agent?.session.header.cwd
      const trashRoot = resolveTrashRoot(config.trashDir, workspace)
      const result = await restoreEntries({
        trashRoot,
        ids: args.ids,
        pattern: args.pattern,
        onConflict: args.onConflict ?? config.restoreConflict,
      })
      return {
        restored: result.restored,
        failed: result.failed,
      }
    },
  }))
}
