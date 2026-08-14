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
import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
// 副作用导入：加载 dsh-sandbox-policy 模块，触发 Context.sandboxPolicy 声明合并。
import '@deepseek-ai/dsh-sandbox-policy'
import type { DeleteHijackMode, ResolvedConfig } from './config.js'
import { statSize } from './trash/move.js'

/** 逃生标记：命令中携带此标记时放行真实删除（防阻断设计）。 */
export const FORCE_DELETE_MARKER = 'DSH_FORCE_DELETE=1'

/** 远程执行客户端（ssh/scp 等，含 Windows .exe 变体）：完全放行，不拦截。 */
const REMOTE_CLIENT_PATTERNS: RegExp[] = [
  /\bssh(?:\.exe)?\b/u,
  /\bscp(?:\.exe)?\b/u,
]

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
 * 分析命令：是否删除命令、是否携带逃生标记、是否远程执行命令。
 * pwsh 命令会额外检测嵌入的 bash -c 内容（剥离后再检测）。
 * ssh/scp 等远程执行客户端完全放行（remote），其携带的远程删除命令
 * 不受本地劫持约束——远程操作由远端自行管理。
 *
 * :param command: 原始命令
 * :param dialect: shell 方言
 * :returns: 分析结果
 */
export function analyzeDeleteCommand(
  command: string,
  dialect: ShellDialect,
): { isDelete: boolean; forced: boolean; remote: boolean } {
  const patterns = dialect === 'bash' ? BASH_DELETE_PATTERNS : PWSH_DELETE_PATTERNS
  const texts = [stripQuotedAndComments(command)]
  if (dialect === 'pwsh') {
    for (const inner of extractBashCommands(command)) {
      texts.push(stripQuotedAndComments(inner))
    }
  }
  const remote = texts.some((text) => REMOTE_CLIENT_PATTERNS.some((pattern) => pattern.test(text)))
  return {
    isDelete: remote ? false : texts.some((text) => patterns.some((pattern) => pattern.test(text))),
    forced: texts.some((text) => text.includes(FORCE_DELETE_MARKER)),
    remote,
  }
}

/**
 * 提取删除命令的目标路径（启发式词法解析）：
 * bash 跳过命令词与 flag；pwsh 额外处理 -Path/-LiteralPath 与带值 flag。
 * 引号包裹的路径会被空白拆分（启发式局限，文档明示）。
 *
 * :param command: 原始命令
 * :param dialect: shell 方言
 * :returns: 候选目标路径（相对路径原样返回，由调用方基于 cwd 解析）
 */
export function extractRmTargets(command: string, dialect: ShellDialect): string[] {
  const tokens = command.split(/\s+/)
  if (dialect === 'bash') {
    let index = 0
    while (index < tokens.length && /^(?:.*[\\/])?(?:rm|rmdir|unlink)$/u.test(tokens[index]!)) index += 1
    while (index < tokens.length && tokens[index]!.startsWith('-')) index += 1
    return tokens.slice(index).filter(Boolean)
  }
  // pwsh：Remove-Item / rm / del / erase / rd / rmdir
  const targets: string[] = []
  let skipNext = false
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false
      continue
    }
    if (/^(?:remove-item|rm|del|erase|rd|rmdir)$/iu.test(token)) continue
    if (token.startsWith('-')) {
      const lower = token.toLowerCase()
      // -Path/-LiteralPath 的值是目标路径（自然落入后续普通 token）；
      // 其余带值 flag（-ErrorAction/-Filter/-Include 等）跳过其值。
      if (!['-path', '-literalpath'].includes(lower)
        && !['-recurse', '-force', '-confirm', '-whatif', '-verbose', '-debug', '-ea'].includes(lower)) {
        skipNext = true
      }
      continue
    }
    for (const part of token.split(',')) {
      const trimmed = part.trim()
      if (trimmed !== '') targets.push(trimmed)
    }
  }
  return targets
}

/**
 * 累计目标路径的总大小（递归，目录为递归估算）。
 * 不存在的路径（lstat 失败）跳过，不阻塞整体。
 *
 * :param targets: 候选路径（相对路径基于 cwd 解析）
 * :param cwd: 会话工作区（无则相对当前进程 cwd）
 * :returns: 字节总数
 */
export async function sumTargetSize(targets: string[], cwd: string | undefined): Promise<number> {
  let total = 0
  for (const target of targets) {
    const absolute = cwd === undefined ? resolve(target) : resolve(cwd, target)
    try {
      total += await statSize(absolute, lstat)
    } catch {
      // 不存在或不可读：跳过。
    }
  }
  return total
}

/**
 * 注册删除命令劫持钩子（tools/pre-execute waterfall）。
 * 行为随 getMode() 实时变化：off 放行、block 拒绝、ask 转审批。
 * 超过回收区容量上限（maxSizeBytes）的删除走独立策略：
 * 非 full access 转审批；full access 需 DSH_FORCE_DELETE=1 才放行，否则拦截并提示。
 *
 * :param ctx: 插件上下文
 * :param getMode: 当前劫持模式读取器（settings 实时源）
 * :param getConfig: 当前生效配置读取器（容量上限等）
 */
export function applyDeleteHijack(ctx: Context, getMode: () => DeleteHijackMode, getConfig: () => ResolvedConfig): void {
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    const mode = getMode()
    if (mode === 'off') return next()
    const dialect = shellDialectOf(exec.name)
    if (dialect === undefined) return next()
    const command = (exec.arguments as { command?: unknown } | null)?.command
    if (typeof command !== 'string') return next()
    const { isDelete, forced, remote } = analyzeDeleteCommand(command, dialect)
    // 远程执行命令（ssh/scp）完全放行；其余删除命令按模式拦截。
    if (!isDelete || forced || remote) return next()
    // 超大文件容量策略：目标总大小超过回收区容量上限时单独处理。
    const config = getConfig()
    const targets = extractRmTargets(command, dialect)
    const totalSize = await sumTargetSize(targets, exec.agent?.session.header.cwd)
    if (config.maxSizeBytes > 0 && totalSize > config.maxSizeBytes) {
      const policy = ctx.sandboxPolicy?.resolve({ session: exec.agent?.session })
      if (policy?.mode === 'danger-full-access') {
        // full access：需显式 DSH_FORCE_DELETE=1（forced 已在上方放行）才永久删除。
        return {
          kind: 'deny',
          reason: `Target size (${totalSize} bytes) exceeds the trash capacity limit (${config.maxSizeBytes} bytes). `
            + 'Prefix the command with DSH_FORCE_DELETE=1 to permanently delete, '
            + 'or adjust maxSizeBytes / use safe_delete.',
        }
      }
      // 非 full access：转人工审批（批准即放行永久删除）。
      return {
        kind: 'ask',
        reason: `Target size (${totalSize} bytes) exceeds the trash capacity limit (${config.maxSizeBytes} bytes); `
          + 'confirm permanent deletion or cancel and use safe_delete instead.',
      }
    }
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
