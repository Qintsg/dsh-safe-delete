/**
 * 工具层集成测试：mock ctx 注册四个工具，驱动 execute 端到端验证。
 *
 * @project dsh-safe-delete
 * @file tools.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'
import { Config } from '../src/config.js'
import {
  createMockHarness,
  fakeExec,
  findTool,
  type FakeApproval,
  type FakeSandboxPolicy,
  type MockHarness,
  type MockToolDef,
} from './helpers/mock-context.js'

/** 测试根目录（含回收区与工作区）。 */
let root: string

/** 模拟工作区。 */
let ws: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-safe-delete-tools-'))
  ws = join(root, 'ws')
  await mkdir(ws, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 注册插件并返回 mock harness。 */
function registerTools(
  config: object = {},
  approval?: FakeApproval,
  sandboxPolicy?: FakeSandboxPolicy,
): MockHarness {
  const harness = createMockHarness(undefined, approval, sandboxPolicy)
  apply(harness.ctx, Config(config))
  return harness
}

/** 构造指定沙箱模式的 sandboxPolicy mock。 */
function sandbox(mode: 'danger-full-access' | 'workspace-write'): FakeSandboxPolicy {
  return { resolve: () => ({ mode }) }
}

/** 断言路径存在。 */
async function expectExists(path: string): Promise<void> {
  await expect(access(path)).resolves.toBeUndefined()
}

/** 断言路径不存在。 */
async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow()
}

/** 一律放行的 fake approval。 */
function allowAllApproval(): FakeApproval {
  return { request: async () => 'allowed-once' }
}

/** 工具执行结果类型。 */
type ToolResult = {
  entries?: { id: string; originalPath: string; trashPath: string }[]
  purged?: string[]
  skipped?: { path: string; reason: string }[]
  restored?: { id: string; path: string }[]
  failed?: { id: string; reason: string }[]
  total?: number
  trashRoot?: string
}

/** 以工作区上下文执行工具。 */
async function runTool(tool: MockToolDef, args: object): Promise<ToolResult> {
  return await tool.execute(args as never, fakeExec(ws)) as ToolResult
}

describe('插件注册', () => {
  it('注册四个工具与一个 systemPrompt 引导', () => {
    const harness = createMockHarness()
    apply(harness.ctx, Config({}))
    expect(harness.tools.map((tool) => tool.name)).toEqual([
      'safe_delete',
      'trash_list',
      'restore',
      'purge',
    ])
    expect(harness.sections).toHaveLength(1)
    expect(harness.sections[0]?.name).toBe('tool:safe-delete')
  })
})

describe('safe_delete 工具', () => {
  it('将文件移入回收区并返回条目', async () => {
    const harness = registerTools({}, allowAllApproval())
    const file = join(ws, 'a.txt')
    await writeFile(file, 'hello')
    const result = await runTool(findTool(harness, 'safe_delete'), { paths: [file] })
    expect(result.entries).toHaveLength(1)
    expect(result.entries?.[0]?.originalPath).toBe(file)
    expect(result.entries?.[0]?.trashPath).toBe('a.txt')
    expect(result.purged).toEqual([])
    expect(result.skipped).toEqual([])
    await expectMissing(file)
    await expectExists(join(ws, '.dsh-trash', 'files', 'a.txt'))
  })

  it('目录需 recursive', async () => {
    const harness = registerTools({}, allowAllApproval())
    const dir = join(ws, 'd')
    await mkdir(dir)
    const result = await runTool(findTool(harness, 'safe_delete'), { paths: [dir] })
    expect(result.entries).toEqual([])
    expect(result.skipped?.[0]?.reason).toContain('recursive')
  })

  it('permanent 模式直接真删', async () => {
    const harness = registerTools({}, allowAllApproval())
    const file = join(ws, 'p.txt')
    await writeFile(file, 'x')
    const result = await runTool(findTool(harness, 'safe_delete'), { paths: [file], permanent: true })
    expect(result.purged).toEqual([file])
    expect(result.entries).toEqual([])
    await expectMissing(file)
  })

  it('空 paths 抛错', async () => {
    const harness = registerTools({}, allowAllApproval())
    await expect(runTool(findTool(harness, 'safe_delete'), { paths: [] })).rejects.toThrow(/at least one/)
  })

  it('超过容量上限且 full access：拒绝移入回收区并提示', async () => {
    const harness = registerTools({ maxSizeBytes: 10 }, allowAllApproval(), sandbox('danger-full-access'))
    const file = join(ws, 'big.bin')
    await writeFile(file, 'x'.repeat(20))
    await expect(runTool(findTool(harness, 'safe_delete'), { paths: [file] })).rejects.toThrow(/trash capacity limit/)
    // 文件未被删除。
    await expectExists(file)
  })

  it('超过容量上限且非 full access：审批通过后移入回收区', async () => {
    const harness = registerTools({ maxSizeBytes: 10 }, allowAllApproval(), sandbox('workspace-write'))
    const file = join(ws, 'big.bin')
    await writeFile(file, 'x'.repeat(20))
    const result = await runTool(findTool(harness, 'safe_delete'), { paths: [file] })
    expect(result.entries).toHaveLength(1)
    await expectMissing(file)
    await expectExists(join(ws, '.dsh-trash', 'files', 'big.bin'))
  })

  it('超过容量上限且非 full access：审批拒绝则中止', async () => {
    const harness = registerTools({ maxSizeBytes: 10 }, { request: async () => false }, sandbox('workspace-write'))
    const file = join(ws, 'big.bin')
    await writeFile(file, 'x'.repeat(20))
    await expect(runTool(findTool(harness, 'safe_delete'), { paths: [file] })).rejects.toThrow(/not approved/)
    await expectExists(file)
  })

  it('未超过容量上限：不受权限影响正常移入回收区', async () => {
    const harness = registerTools({ maxSizeBytes: 100 }, allowAllApproval(), sandbox('danger-full-access'))
    const file = join(ws, 'small.txt')
    await writeFile(file, 'tiny')
    const result = await runTool(findTool(harness, 'safe_delete'), { paths: [file] })
    expect(result.entries).toHaveLength(1)
    await expectMissing(file)
  })

  it('无工作区时回退到 DSH 主目录全局回收区', async () => {
    const fakeHome = join(root, 'fake-dsh-home')
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = fakeHome
    try {
      const harness = registerTools({}, allowAllApproval())
      const file = join(root, 'outside.txt')
      await writeFile(file, 'x')
      const result = await findTool(harness, 'safe_delete').execute({ paths: [file] } as never, fakeExec()) as ToolResult
      expect(result.entries).toHaveLength(1)
      expect(result.trashRoot).toBe(join(fakeHome, '.dsh-safe-delete-trash'))
      await expectExists(join(fakeHome, '.dsh-safe-delete-trash', 'files', '_external'))
      await expectMissing(file)
    } finally {
      if (prev === undefined) {
        delete process.env.DSH_HOME
      } else {
        process.env.DSH_HOME = prev
      }
    }
  })
})

describe('trash_list 工具', () => {
  it('列出回收区并支持 pattern 过滤', async () => {
    const harness = registerTools({}, allowAllApproval())
    for (const name of ['a.tmp', 'b.txt']) {
      await writeFile(join(ws, name), name)
      await runTool(findTool(harness, 'safe_delete'), { paths: [join(ws, name)] })
    }
    const all = await runTool(findTool(harness, 'trash_list'), {})
    expect(all.total).toBe(2)
    const filtered = await runTool(findTool(harness, 'trash_list'), { pattern: '*.tmp' })
    expect(filtered.total).toBe(1)
  })
})

describe('restore 工具', () => {
  it('恢复到原路径', async () => {
    const harness = registerTools({}, allowAllApproval())
    const file = join(ws, 'r.txt')
    await writeFile(file, 'data')
    await runTool(findTool(harness, 'safe_delete'), { paths: [file] })
    const listed = await runTool(findTool(harness, 'trash_list'), {})
    const result = await runTool(findTool(harness, 'restore'), { ids: [listed.entries?.[0]?.id] })
    expect(result.restored).toHaveLength(1)
    expect(await readFile(file, 'utf8')).toBe('data')
  })

  it('目标存在时默认 rename 冲突处理', async () => {
    const harness = registerTools({}, allowAllApproval())
    const file = join(ws, 'c.txt')
    await writeFile(file, 'old')
    await runTool(findTool(harness, 'safe_delete'), { paths: [file] })
    await writeFile(file, 'blocking')
    const listed = await runTool(findTool(harness, 'trash_list'), {})
    const result = await runTool(findTool(harness, 'restore'), { ids: [listed.entries?.[0]?.id] })
    expect(result.restored?.[0]?.path).toBe(join(ws, 'c (1).txt'))
  })

  it('ids 与 pattern 同时给出时抛错', async () => {
    const harness = registerTools({}, allowAllApproval())
    await expect(runTool(findTool(harness, 'restore'), { ids: ['a'], pattern: '*.txt' })).rejects.toThrow(/mutually exclusive/)
  })
})

describe('purge 工具', () => {
  it('按 ids 彻底清除', async () => {
    const harness = registerTools({}, allowAllApproval())
    const file = join(ws, 'p.txt')
    await writeFile(file, 'x')
    await runTool(findTool(harness, 'safe_delete'), { paths: [file] })
    const listed = await runTool(findTool(harness, 'trash_list'), {})
    const result = await runTool(findTool(harness, 'purge'), { ids: [listed.entries?.[0]?.id] })
    expect(result.purged).toEqual([listed.entries?.[0]?.id])
    const after = await runTool(findTool(harness, 'trash_list'), {})
    expect(after.total).toBe(0)
  })

  it('all 清空回收区', async () => {
    const harness = registerTools({}, allowAllApproval())
    await writeFile(join(ws, 'x.txt'), 'x')
    await runTool(findTool(harness, 'safe_delete'), { paths: [join(ws, 'x.txt')] })
    const result = await runTool(findTool(harness, 'purge'), { all: true })
    expect(result.purged).toHaveLength(1)
  })

  it('既无 ids 也无 all 时抛错', async () => {
    const harness = registerTools({}, allowAllApproval())
    await expect(runTool(findTool(harness, 'purge'), {})).rejects.toThrow(/ids or all/)
  })
})
