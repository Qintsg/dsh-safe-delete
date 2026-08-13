/**
 * 测试辅助：mock Cordis Context 与工具执行环境。
 *
 * @project dsh-safe-delete
 * @file mock-context.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/** Mock 工具定义形态（仅测试关心的字段）。 */
export interface MockToolDef {
  name: string
  execute: (args: never, exec: ToolRunContext) => Promise<unknown>
}

/** Mock 系统提示 section 形态。 */
export interface MockSection {
  name: string
  text: string
}

/** Mock 上下文与收集器。 */
export interface MockHarness {
  ctx: Context
  tools: MockToolDef[]
  sections: MockSection[]
}

/**
 * 创建 mock Cordis 上下文：tools.register 与 systemPrompt.section 收集调用。
 *
 * :returns: mock 上下文与收集结果
 */
export function createMockHarness(): MockHarness {
  const tools: MockToolDef[] = []
  const sections: MockSection[] = []
  const ctx = {
    tools: {
      register: (def: { name: string; execute: MockToolDef['execute'] }): void => {
        tools.push(def as MockToolDef)
      },
    },
    systemPrompt: {
      section: (section: MockSection): void => {
        sections.push(section)
      },
    },
    logger: (): { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void } => ({
      info: () => undefined,
      warn: () => undefined,
    }),
  } as unknown as Context
  return { ctx, tools, sections }
}

/** 按名称查找已注册工具。 */
export function findTool(harness: MockHarness, name: string): MockToolDef {
  const tool = harness.tools.find((item) => item.name === name)
  if (tool === undefined) throw new Error(`tool ${name} not registered`)
  return tool
}

/**
 * 构造最小工具执行环境。
 *
 * :param cwd: 会话工作区（undefined 表示无）
 * :returns: ToolRunContext 形态的执行环境
 */
export function fakeExec(cwd?: string): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: cwd === undefined ? undefined : { session: { header: { cwd } } },
  } as unknown as ToolRunContext
}
