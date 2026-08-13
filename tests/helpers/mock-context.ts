/**
 * 测试辅助：mock Cordis Context、工具执行环境与 settings 服务。
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

/** 事件监听器形态。 */
export type MockListener = (...args: never[]) => unknown

/** Fake settings scope（installSettingsSection 消费）。 */
export interface FakeSettingsScope<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void): () => void
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}

/** Mock 上下文与收集器。 */
export interface MockHarness {
  ctx: Context
  tools: MockToolDef[]
  sections: MockSection[]
  /** 事件名 → 监听器列表。 */
  events: Map<string, MockListener[]>
}

/**
 * 创建 fake settings scope 与其值控制器。
 *
 * :param initial: 初始解析值
 * :returns: scope 与 setValue（触发 watch）
 */
export function createFakeSettings<T>(initial: T): {
  scope: FakeSettingsScope<T>
  setValue: (next: T) => void
} {
  let value = initial
  const watchers: Array<(next: T, prev: T) => void> = []
  return {
    scope: {
      get: () => value,
      watch: (callback) => {
        watchers.push(callback)
        return () => undefined
      },
      update: async () => undefined,
      replace: async () => undefined,
    },
    setValue: (next: T) => {
      const prev = value
      value = next
      for (const watcher of watchers) watcher(next, prev)
    },
  }
}

/**
 * 创建 mock Cordis 上下文：tools.register / systemPrompt.section /
 * on / inject 均被收集或注入。
 *
 * :param settings: 可选 fake settings scope；提供后 inject(['settings'])
 *   会回调并返回该 scope
 * :returns: mock 上下文与收集结果
 */
export function createMockHarness(settings?: FakeSettingsScope<unknown>): MockHarness {
  const tools: MockToolDef[] = []
  const sections: MockSection[] = []
  const events = new Map<string, MockListener[]>()
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
    on: (event: string, listener: MockListener): void => {
      const list = events.get(event) ?? []
      list.push(listener)
      events.set(event, list)
    },
    fiber: { state: 0 },
    inject: (keys: string[], callback: (scoped: Context) => void): void => {
      if (settings === undefined || !keys.includes('settings')) return
      callback({
        settings: {
          register: (): FakeSettingsScope<unknown> => settings,
        },
        effect: (fn: () => unknown): (() => void) => {
          fn()
          return () => undefined
        },
      } as unknown as Context)
    },
  } as unknown as Context
  return { ctx, tools, sections, events }
}

/** 按名称查找已注册工具。 */
export function findTool(harness: MockHarness, name: string): MockToolDef {
  const tool = harness.tools.find((item) => item.name === name)
  if (tool === undefined) throw new Error(`tool ${name} not registered`)
  return tool
}

/** 按事件名获取监听器（无则抛错）。 */
export function getListener(harness: MockHarness, event: string): MockListener {
  const listener = harness.events.get(event)?.[0]
  if (listener === undefined) throw new Error(`no listener for ${event}`)
  return listener
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
