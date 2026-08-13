/**
 * 删除命令劫持模块：监听 tools/pre-execute，检测 bash/pwsh 删除命令，
 * 按配置 block（拒绝并引导）或 ask（转人工审批）；识别 DSH_FORCE_DELETE
 * 逃生标记时放行真实删除。
 *
 * @project dsh-safe-delete
 * @file hijack.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { DeleteHijackMode } from './config.js'

/** 逃生标记：命令中携带此标记时放行真实删除（防阻断设计）。 */
export const FORCE_DELETE_MARKER = 'DSH_FORCE_DELETE=1'

/** bash 删除命令检测正则（词边界匹配）。 */
const BASH_DELETE_PATTERNS: RegExp[] = [
  /\brm\b/u,
  /\brmdir\b/u,
  /\bunlink\b/u,
]

/** pwsh 删除命令检测正则（命令大小写不敏感，含内置别名）。 */
const PWSH_DELETE_PATTERNS: RegExp[] = [
  /Remove-Item/iu,
  /\bdel\b/iu,
  /\berase\b/iu,
  /\brd\b/iu,
  /\brmdir\b/iu,
  /\brm\b/iu,
]

/** 工具名 → shell 方言映射。 */
export type ShellDialect = 'bash' | 'pwsh'

/** 从工具名推断 shell 方言。 */
export function shellDialectOf(toolName: string): ShellDialect | undefined {
  if (toolName === 'bash') return 'bash'
  if (toolName === 'pwsh') return 'pwsh'
  return undefined
}

/**
 * 剥离单双引号内的内容与 `#` 注释（启发式，避免引号/注释内文本误报）。
 *
 * :param command: 原始命令
 * :returns: 剥离后的命令文本
 */
export function stripQuotedAndComments(command: string): string {
  return command
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/gu, ' ')
    .replace(/#.*$/gmu, ' ')
}

/**
 * 提取 pwsh 中嵌入的 `bash -c "..."` 调用内容（Windows 上模型常用
 * bash 语法，删除命令常藏在引号内，需单独检测）。
 *
 * :param command: 原始 pwsh 命令
 * :returns: 提取到的 bash 命令内容列表（未剥离引号嵌套）
 */
export function extractBashCommands(command: string): string[] {
  const re = /(?:wsl(?:\.exe)?\s+)?bash(?:\.exe)?\s+-c\s+(['"])((?:\\.|(?!\1).)*)\1/giu
  const found: string[] = []
  for (const match of command.matchAll(re)) {
    if (match[2] !== undefined) found.push(match[2])
  }
  return found
}

/**
 * 分析命令：是否删除命令、是否携带逃生标记。
 * pwsh 命令会额外检测嵌入的 bash -c 内容（剥离后再检测）。
 *
 * :param command: 原始命令
 * :param dialect: shell 方言
 * :returns: 分析结果
 */
export function analyzeDeleteCommand(command: string, dialect: ShellDialect): { isDelete: boolean; forced: boolean } {
  const patterns = dialect === 'bash' ? BASH_DELETE_PATTERNS : PWSH_DELETE_PATTERNS
  const texts = [stripQuotedAndComments(command)]
  if (dialect === 'pwsh') {
    for (const inner of extractBashCommands(command)) {
      texts.push(stripQuotedAndComments(inner))
    }
  }
  return {
    isDelete: texts.some((text) => patterns.some((pattern) => pattern.test(text))),
    forced: texts.some((text) => text.includes(FORCE_DELETE_MARKER)),
  }
}

/**
 * 注册删除命令劫持钩子（tools/pre-execute waterfall）。
 * 行为随 getMode() 实时变化：off 放行、block 拒绝、ask 转审批。
 *
 * :param ctx: 插件上下文
 * :param getMode: 当前劫持模式读取器（settings 实时源）
 */
export function applyDeleteHijack(ctx: Context, getMode: () => DeleteHijackMode): void {
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    const mode = getMode()
    if (mode === 'off') return next()
    const dialect = shellDialectOf(exec.name)
    if (dialect === undefined) return next()
    const command = (exec.arguments as { command?: unknown } | null)?.command
    if (typeof command !== 'string') return next()
    const { isDelete, forced } = analyzeDeleteCommand(command, dialect)
    if (!isDelete || forced) return next()
    if (mode === 'block') {
      return {
        kind: 'deny',
        reason: 'Delete commands (rm/Remove-Item) are intercepted by dsh-safe-delete. '
          + 'Use the safe_delete tool instead: it moves files into a restorable trash area. '
          + 'If permanent deletion is truly intended, prefix the command with DSH_FORCE_DELETE=1 '
          + 'or call safe_delete with permanent: true.',
      }
    }
    return {
      kind: 'ask',
      reason: 'dsh-safe-delete detected a delete command; confirm permanent deletion or cancel and use safe_delete instead.',
    }
  })
}
