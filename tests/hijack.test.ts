/**
 * 删除命令劫持模块单元测试。
 *
 * @project dsh-safe-delete
 * @file hijack.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'
import { Config } from '../src/config.js'
import {
  analyzeDeleteCommand,
  FORCE_DELETE_MARKER,
  shellDialectOf,
  stripQuotedAndComments,
} from '../src/hijack.js'
import { createMockHarness, createFakeSettings, getListener } from './helpers/mock-context.js'

/** 调用 pre-execute 监听器。 */
async function runPreExecute(harness: ReturnType<typeof createMockHarness>, toolName: string, command: string): Promise<unknown> {
  const listener = getListener(harness, 'tools/pre-execute')
  const exec = { name: toolName, arguments: { command } } as never
  return await listener(exec, async () => ({ kind: 'allow' as const }))
}

describe('analyzeDeleteCommand', () => {
  it('bash: rm / rmdir / unlink 命中', () => {
    expect(analyzeDeleteCommand('rm -rf dist', 'bash').isDelete).toBe(true)
    expect(analyzeDeleteCommand('rmdir old-dir', 'bash').isDelete).toBe(true)
    expect(analyzeDeleteCommand('unlink a.txt', 'bash').isDelete).toBe(true)
  })

  it('bash: 非删除命令不命中', () => {
    expect(analyzeDeleteCommand('ls -la', 'bash').isDelete).toBe(false)
    expect(analyzeDeleteCommand('npm install', 'bash').isDelete).toBe(false)
    expect(analyzeDeleteCommand('echo hello world', 'bash').isDelete).toBe(false)
  })

  it('bash: 引号与注释内文本不误报', () => {
    expect(analyzeDeleteCommand('echo "rm -rf /"', 'bash').isDelete).toBe(false)
    expect(analyzeDeleteCommand("echo 'rm file'", 'bash').isDelete).toBe(false)
    expect(analyzeDeleteCommand('ls # rm -rf everything', 'bash').isDelete).toBe(false)
  })

  it('pwsh: Remove-Item 及别名命中（大小写不敏感）', () => {
    expect(analyzeDeleteCommand('Remove-Item -Recurse -Force dist', 'pwsh').isDelete).toBe(true)
    expect(analyzeDeleteCommand('remove-item a.txt', 'pwsh').isDelete).toBe(true)
    expect(analyzeDeleteCommand('del a.txt', 'pwsh').isDelete).toBe(true)
    expect(analyzeDeleteCommand('erase a.txt', 'pwsh').isDelete).toBe(true)
    expect(analyzeDeleteCommand('rd old-dir', 'pwsh').isDelete).toBe(true)
    expect(analyzeDeleteCommand('rmdir old-dir', 'pwsh').isDelete).toBe(true)
    expect(analyzeDeleteCommand('rm a.txt', 'pwsh').isDelete).toBe(true)
  })

  it('逃生标记放行', () => {
    expect(analyzeDeleteCommand(`${FORCE_DELETE_MARKER} rm -rf dist`, 'bash').forced).toBe(true)
    expect(analyzeDeleteCommand(`$env:${FORCE_DELETE_MARKER}; Remove-Item x`, 'pwsh').forced).toBe(true)
  })

  it('引号内的逃生标记不生效', () => {
    const result = analyzeDeleteCommand(`echo "${FORCE_DELETE_MARKER} rm -rf x"`, 'bash')
    expect(result.forced).toBe(false)
    expect(result.isDelete).toBe(false)
  })
})

describe('stripQuotedAndComments', () => {
  it('剥离引号内容与注释', () => {
    expect(stripQuotedAndComments('rm a.txt # comment')).toBe('rm a.txt  ')
    expect(stripQuotedAndComments('echo "rm x"')).toBe('echo  ')
  })
})

describe('shellDialectOf', () => {
  it('映射 bash/pwsh，其余为 undefined', () => {
    expect(shellDialectOf('bash')).toBe('bash')
    expect(shellDialectOf('pwsh')).toBe('pwsh')
    expect(shellDialectOf('safe_delete')).toBeUndefined()
  })
})

describe('applyDeleteHijack（集成）', () => {
  it('block 模式拒绝删除命令并引导 safe_delete', async () => {
    const harness = createMockHarness()
    apply(harness.ctx, Config({ deleteHijack: 'block' }))
    const decision = await runPreExecute(harness, 'bash', 'rm -rf dist')
    expect(decision).toMatchObject({ kind: 'deny' })
    expect((decision as { reason: string }).reason).toContain('safe_delete')
  })

  it('block 模式放行非删除命令', async () => {
    const harness = createMockHarness()
    apply(harness.ctx, Config({ deleteHijack: 'block' }))
    expect(await runPreExecute(harness, 'bash', 'ls -la')).toEqual({ kind: 'allow' })
  })

  it('block 模式放行携带逃生标记的删除命令', async () => {
    const harness = createMockHarness()
    apply(harness.ctx, Config({ deleteHijack: 'block' }))
    expect(await runPreExecute(harness, 'bash', `${FORCE_DELETE_MARKER} rm -rf dist`)).toEqual({ kind: 'allow' })
  })

  it('off 模式放行所有删除命令', async () => {
    const harness = createMockHarness()
    apply(harness.ctx, Config({ deleteHijack: 'off' }))
    expect(await runPreExecute(harness, 'bash', 'rm -rf dist')).toEqual({ kind: 'allow' })
  })

  it('ask 模式返回 ask 决策', async () => {
    const harness = createMockHarness()
    apply(harness.ctx, Config({ deleteHijack: 'ask' }))
    const decision = await runPreExecute(harness, 'pwsh', 'Remove-Item x.txt')
    expect(decision).toMatchObject({ kind: 'ask' })
  })

  it('非 shell 工具不拦截', async () => {
    const harness = createMockHarness()
    apply(harness.ctx, Config({ deleteHijack: 'block' }))
    expect(await runPreExecute(harness, 'safe_delete', 'rm -rf x')).toEqual({ kind: 'allow' })
  })

  it('无 command 参数的工具不拦截', async () => {
    const harness = createMockHarness()
    apply(harness.ctx, Config({ deleteHijack: 'block' }))
    const listener = getListener(harness, 'tools/pre-execute')
    const exec = { name: 'bash', arguments: {} } as never
    expect(await listener(exec, async () => ({ kind: 'allow' as const }))).toEqual({ kind: 'allow' })
  })

  it('配置实时生效：block → off 后放行', async () => {
    const fake = createFakeSettings(Config({ deleteHijack: 'block' }))
    const harness = createMockHarness(fake.scope as never)
    apply(harness.ctx, Config({ deleteHijack: 'block' }))
    expect(await runPreExecute(harness, 'bash', 'rm -rf dist')).toMatchObject({ kind: 'deny' })
    // 模拟用户在 DSH Web 设置面板改为 off：scope 值变化 → watch 触发 → 实时生效。
    fake.setValue(Config({ deleteHijack: 'off' }))
    expect(await runPreExecute(harness, 'bash', 'rm -rf dist')).toEqual({ kind: 'allow' })
  })
})
