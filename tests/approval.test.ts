/**
 * 审批机制单元测试：permanent / purge / 超阈值 的确认门禁。
 *
 * @project dsh-safe-delete
 * @file approval.test.ts
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
  type MockHarness,
  type MockToolDef,
} from './helpers/mock-context.js'

/** 测试根目录。 */
let root: string

/** 模拟工作区。 */
let ws: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-safe-delete-approval-'))
  ws = join(root, 'ws')
  await mkdir(ws, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 记录审批请求的 fake approval。 */
interface RecordingApproval extends FakeApproval {
  requests: string[]
  outcome: unknown
}

/** 构造记录式 fake approval。 */
function recordingApproval(outcome: unknown): RecordingApproval {
  const requests: string[] = []
  return {
    requests,
    outcome,
    request: async (req: { reason?: string }) => {
      requests.push(req.reason ?? '')
      return outcome
    },
  }
}

/** 注册插件并返回工具。 */
function register(config: object, approval?: FakeApproval): { harness: MockHarness; safeDelete: MockToolDef; purge: MockToolDef } {
  const harness = createMockHarness(undefined, approval)
  apply(harness.ctx, Config(config))
  return { harness, safeDelete: findTool(harness, 'safe_delete'), purge: findTool(harness, 'purge') }
}

/** 断言路径存在。 */
async function expectExists(path: string): Promise<void> {
  await expect(access(path)).resolves.toBeUndefined()
}

describe('permanent 删除确认', () => {
  it('批准后执行永久删除', async () => {
    const approval = recordingApproval('allowed-once')
    const { safeDelete } = register({}, approval)
    const file = join(ws, 'p.txt')
    await writeFile(file, 'x')
    const result = await safeDelete.execute({ paths: [file], permanent: true } as never, fakeExec(ws)) as { purged: string[] }
    expect(result.purged).toEqual([file])
    expect(approval.requests).toHaveLength(1)
    await expect(access(file)).rejects.toThrow()
  })

  it('拒绝后不删除并抛错', async () => {
    const approval = recordingApproval('rejected')
    const { safeDelete } = register({}, approval)
    const file = join(ws, 'p.txt')
    await writeFile(file, 'x')
    await expect(safeDelete.execute({ paths: [file], permanent: true } as never, fakeExec(ws))).rejects.toThrow(/not approved/)
    await expectExists(file)
  })

  it('无审批服务时 fail-closed 拒绝', async () => {
    const { safeDelete } = register({})
    const file = join(ws, 'p.txt')
    await writeFile(file, 'x')
    await expect(safeDelete.execute({ paths: [file], permanent: true } as never, fakeExec(ws))).rejects.toThrow(/not approved/)
    await expectExists(file)
  })
})

describe('purge 确认', () => {
  it('批准后彻底清除', async () => {
    const approval = recordingApproval('allowed-once')
    const { safeDelete, purge } = register({}, approval)
    const file = join(ws, 'x.txt')
    await writeFile(file, 'x')
    await safeDelete.execute({ paths: [file] } as never, fakeExec(ws))
    const result = await purge.execute({ all: true } as never, fakeExec(ws)) as { purged: string[] }
    expect(result.purged).toHaveLength(1)
    // safe_delete 单文件未达阈值不审批，仅 purge 触发一次审批。
    expect(approval.requests).toHaveLength(1)
  })

  it('拒绝后保留回收区条目', async () => {
    const approval = recordingApproval('rejected')
    const { safeDelete, purge } = register({}, approval)
    const file = join(ws, 'x.txt')
    await writeFile(file, 'x')
    await safeDelete.execute({ paths: [file] } as never, fakeExec(ws))
    await expect(purge.execute({ all: true } as never, fakeExec(ws))).rejects.toThrow(/not approved/)
    await expectExists(join(ws, '.dsh-trash', 'files', 'x.txt'))
  })
})

describe('批量删除阈值确认', () => {
  it('达到阈值且批准后执行', async () => {
    const approval = recordingApproval('allowed-once')
    const { safeDelete } = register({ confirmThreshold: 3 }, approval)
    const files = ['a.txt', 'b.txt', 'c.txt'].map((name) => join(ws, name))
    for (const file of files) await writeFile(file, 'x')
    const result = await safeDelete.execute({ paths: files } as never, fakeExec(ws)) as { entries: unknown[] }
    expect(result.entries).toHaveLength(3)
    expect(approval.requests).toHaveLength(1)
  })

  it('达到阈值但拒绝后不执行', async () => {
    const approval = recordingApproval('rejected')
    const { safeDelete } = register({ confirmThreshold: 3 }, approval)
    const files = ['a.txt', 'b.txt', 'c.txt'].map((name) => join(ws, name))
    for (const file of files) await writeFile(file, 'x')
    await expect(safeDelete.execute({ paths: files } as never, fakeExec(ws))).rejects.toThrow(/not approved/)
    await expectExists(files[0]!)
  })

  it('未达阈值不触发审批', async () => {
    const approval = recordingApproval('allowed-once')
    const { safeDelete } = register({ confirmThreshold: 10 }, approval)
    const file = join(ws, 'a.txt')
    await writeFile(file, 'x')
    await safeDelete.execute({ paths: [file] } as never, fakeExec(ws))
    expect(approval.requests).toEqual([])
  })

  it('confirmThreshold 为 0 时始终确认', async () => {
    const approval = recordingApproval('allowed-once')
    const { safeDelete } = register({ confirmThreshold: 0 }, approval)
    const file = join(ws, 'a.txt')
    await writeFile(file, 'x')
    await safeDelete.execute({ paths: [file] } as never, fakeExec(ws))
    expect(approval.requests).toHaveLength(1)
  })

  it('不存在的路径不计入阈值', async () => {
    const approval = recordingApproval('allowed-once')
    const { safeDelete } = register({ confirmThreshold: 2 }, approval)
    const file = join(ws, 'a.txt')
    await writeFile(file, 'x')
    // 2 个路径但仅 1 个有效 → 未达阈值不审批。
    await safeDelete.execute({ paths: [file, join(ws, 'missing.txt')] } as never, fakeExec(ws))
    expect(approval.requests).toEqual([])
  })
})

describe('restore 不受审批约束', () => {
  it('无审批服务时 restore 仍可用', async () => {
    const { harness } = register({})
    const safeDelete = findTool(harness, 'safe_delete')
    const restore = findTool(harness, 'restore')
    const file = join(ws, 'r.txt')
    await writeFile(file, 'data')
    await safeDelete.execute({ paths: [file] } as never, fakeExec(ws))
    const trashList = findTool(harness, 'trash_list')
    const listed = await trashList.execute({} as never, fakeExec(ws)) as { entries: { id: string }[] }
    const result = await restore.execute({ ids: [listed.entries[0]!.id] } as never, fakeExec(ws)) as { restored: unknown[] }
    expect(result.restored).toHaveLength(1)
    expect(await readFile(file, 'utf8')).toBe('data')
  })
})
