/**
 * trash_list 工具：查看回收区条目（恢复前的检索）。
 *
 * @project dsh-safe-delete
 * @file trash-list.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from '../config.js'
import { listEntries } from '../trash/ops.js'
import { resolveTrashRoot } from '../trash/paths.js'

/** 工具参数。 */
export interface TrashListToolArgs {
  pattern?: string
  limit?: number
}

/**
 * 注册 trash_list 工具。
 *
 * :param ctx: 插件上下文
 * :param getConfig: 当前生效配置读取器（settings 实时源）
 */
export function applyTrashListTool(ctx: Context, getConfig: () => ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'trash_list',
    description: 'List entries in the safe-delete trash area, optionally filtered by a pattern matching the original path '
      + '(`*` and `?` wildcards). Use it to find entries before restoring.',
    parameters: {
      pattern: { type: 'string', description: 'Glob pattern matching the tail of the original path, e.g. `*.tmp`.' },
      limit: { type: 'number', description: 'Maximum number of entries to return (default 50).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                originalPath: { type: 'string', required: true },
                trashPath: { type: 'string', required: true },
                deletedAt: { type: 'string', required: true },
                type: { type: 'string', required: true },
                sizeBytes: { type: 'number', required: true },
              },
            },
          },
          total: { type: 'number', required: true },
        },
      },
      render: (_args, value) => {
        if (value.entries.length === 0) {
          return [{ type: 'text', text: '(trash is empty)' }]
        }
        const lines = value.entries.map((entry) =>
          `${entry.id}  ${entry.type}  ${entry.deletedAt}  ${entry.originalPath}`)
        lines.push(`total ${value.total}${value.entries.length < value.total ? ` (showing ${value.entries.length})` : ''}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args: TrashListToolArgs, exec: ToolRunContext) {
      const config = getConfig()
      const workspace = exec.agent?.session.header.cwd
      const trashRoot = resolveTrashRoot(config.trashDir, workspace)
      const result = await listEntries({ trashRoot, pattern: args.pattern, limit: args.limit })
      return {
        entries: result.entries.map((entry) => ({
          id: entry.id,
          originalPath: entry.originalPath,
          trashPath: entry.trashPath,
          deletedAt: entry.deletedAt,
          type: entry.type,
          sizeBytes: entry.sizeBytes,
        })),
        total: result.total,
      }
    },
  }))
}
