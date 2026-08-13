/**
 * safe_delete 工具：将文件/目录移入回收区（可恢复），或 permanent 真删。
 *
 * @project dsh-safe-delete
 * @file safe-delete.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { lstat } from 'node:fs/promises'
import type { ResolvedConfig } from '../config.js'
import { requestApproval } from '../approval.js'
import { removeRecursive } from '../trash/move.js'
import { safeDelete } from '../trash/ops.js'
import { resolveTrashRoot } from '../trash/paths.js'

/** 工具参数。 */
export interface SafeDeleteToolArgs {
  paths: string[]
  recursive?: boolean
  permanent?: boolean
}

/**
 * 预检可删除的有效条目数（排除不存在、未开 recursive 的目录）。
 *
 * :param paths: 待删除路径
 * :param recursive: 是否允许删除目录
 * :returns: 有效条目数
 */
async function countDeletable(paths: string[], recursive: boolean): Promise<number> {
  let count = 0
  for (const path of paths) {
    try {
      const info = await lstat(path)
      if (info.isDirectory() && !recursive) continue
      count += 1
    } catch {
      // 不存在：跳过。
    }
  }
  return count
}

/**
 * 注册 safe_delete 工具。
 *
 * :param ctx: 插件上下文
 * :param getConfig: 当前生效配置读取器（settings 实时源）
 */
export function applySafeDeleteTool(ctx: Context, getConfig: () => ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'safe_delete',
    description: 'Move files or directories into the trash area instead of permanent removal, so they can be restored later. '
      + 'Use this tool — not rm/Remove-Item — for deletions. Set `permanent: true` only when the files must be truly deleted '
      + 'and must not go to trash (e.g. cleaning node_modules or build artifacts).',
    parameters: {
      paths: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Absolute paths of the files or directories to delete.',
      },
      recursive: { type: 'boolean', description: 'Required to delete directories.' },
      permanent: { type: 'boolean', description: 'When true, delete permanently without trash (requires confirmation).' },
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
              },
            },
          },
          purged: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: 'Paths permanently deleted (permanent mode only).',
          },
          skipped: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                reason: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines: string[] = []
        for (const entry of value.entries) {
          lines.push(`trashed ${entry.originalPath} -> ${entry.trashPath} (id ${entry.id})`)
        }
        for (const path of value.purged) {
          lines.push(`permanently deleted ${path}`)
        }
        for (const item of value.skipped) {
          lines.push(`skipped ${item.path}: ${item.reason}`)
        }
        return [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : '(no entries)' }]
      },
    },
    isConcurrencySafe: () => false,
    async execute(args: SafeDeleteToolArgs, exec: ToolRunContext) {
      if (args.paths.length === 0) {
        throw new Error('paths must contain at least one path')
      }
      const config = getConfig()
      const workspace = exec.agent?.session.header.cwd
      const trashRoot = resolveTrashRoot(config.trashDir, workspace)
      if (args.permanent === true) {
        // 永久删除（不可逆）：必须经审批确认。
        if (!(await requestApproval(ctx, exec, `永久删除 ${args.paths.length} 个路径（跳过回收区）: ${args.paths.join(', ')}`))) {
          throw new Error('permanent deletion was not approved')
        }
        const purged: string[] = []
        const skipped: { path: string; reason: string }[] = []
        for (const path of args.paths) {
          try {
            await removeRecursive(path)
            purged.push(path)
          } catch (error) {
            skipped.push({ path, reason: error instanceof Error ? error.message : String(error) })
          }
        }
        return { entries: [], purged, skipped }
      }
      // 批量删除达到确认阈值时需审批（confirmThreshold: 0 表示始终确认）。
      const deletable = await countDeletable(args.paths, args.recursive ?? false)
      const needsApproval = config.confirmThreshold === 0 || deletable >= config.confirmThreshold
      if (needsApproval && !(await requestApproval(ctx, exec, `移入回收区 ${deletable} 个路径: ${args.paths.join(', ')}`))) {
        throw new Error('deletion was not approved')
      }
      const result = await safeDelete({
        trashRoot,
        workspace,
        paths: args.paths,
        recursive: args.recursive ?? false,
      })
      return {
        entries: result.entries.map((entry) => ({
          id: entry.id,
          originalPath: entry.originalPath,
          trashPath: entry.trashPath,
          deletedAt: entry.deletedAt,
        })),
        purged: [],
        skipped: result.skipped,
      }
    },
  }))
}
