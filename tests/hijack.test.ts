/**
 * 删除命令劫持模块单元测试。
 *
 * @project dsh-safe-delete
 * @file hijack.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'
import { Config } from '../src/config.js'
import {
  analyzeDeleteCommand,
  extractRmTargets,
  FORCE_DELETE_MARKER,
  shellDialectOf,
  stripQuotedAndComments,
  sumTargetSize,
} from '../src/hijack.js'
import {
  createMockHarness,
  createFakeSettings,
  getListener,
  type FakeSandboxPolicy,
} from './helpers/mock-context.js'

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

  it('pwsh: 嵌入 bash -c 的 rm 命中（Windows 常见写法）', () => {
    expect(analyzeDeleteCommand('bash -c "rm -rf dist"', 'pwsh').isDelete).toBe(true)
    expect(analyzeDeleteCommand("bash -c 'rm /tmp/x'", 'pwsh').isDelete).toBe(true)
    expect(analyzeDeleteCommand('wsl bash -c "rm /mnt/e/x"', 'pwsh').isDelete).toBe(true)
    expect(analyzeDeleteCommand('bash.exe -c "rmdir old"', 'pwsh').isDelete).toBe(true)
  })

  it('pwsh: bash -c 内引号中的 rm 不误报', () => {
    expect(analyzeDeleteCommand("bash -c \"echo 'rm x'\"", 'pwsh').isDelete).toBe(false)
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

  it('ssh/scp 远程命令完全放行（remote，引号包裹与裸 rm 均放行）', () => {
    expect(analyzeDeleteCommand('ssh user@host "rm -rf /path"', 'pwsh').remote).toBe(true)
    expect(analyzeDeleteCommand('ssh user@host "rm -rf /path"', 'pwsh').isDelete).toBe(false)
    expect(analyzeDeleteCommand('ssh user@host rm -rf /path', 'pwsh').remote).toBe(true)
    expect(analyzeDeleteCommand("ssh user@host 'rm -rf /path'", 'bash').remote).toBe(true)
    expect(analyzeDeleteCommand('ssh.exe user@host rm -rf /x', 'pwsh').remote).toBe(true)
    expect(analyzeDeleteCommand('scp -r local user@host:/path', 'pwsh').remote).toBe(true)
  })

  it('引号内的 ssh 字样不误判为远程命令', () => {
    const result = analyzeDeleteCommand('echo "use ssh now" && rm -rf /x', 'pwsh')
    expect(result.remote).toBe(false)
    expect(result.isDelete).toBe(true)
  })
})

describe('extractRmTargets', () => {
  it('bash: 提取 rm/rmdir/unlink 目标并跳过命令词与 flag', () => {
    expect(extractRmTargets('rm -rf /a /b', 'bash')).toEqual(['/a', '/b'])
    expect(extractRmTargets('rmdir old-dir', 'bash')).toEqual(['old-dir'])
    expect(extractRmTargets('/bin/rm -rf dist', 'bash')).toEqual(['dist'])
    expect(extractRmTargets('unlink a.txt', 'bash')).toEqual(['a.txt'])
  })

  it('pwsh: 提取 Remove-Item 目标（含逗号分隔与带值 flag）', () => {
    expect(extractRmTargets('Remove-Item -Recurse -Force C:\\a, C:\\b', 'pwsh')).toEqual(['C:\\a', 'C:\\b'])
    expect(extractRmTargets('rm -Path x.txt -ErrorAction SilentlyContinue', 'pwsh')).toEqual(['x.txt'])
    expect(extractRmTargets('del a.txt', 'pwsh')).toEqual(['a.txt'])
    expect(extractRmTargets('rd -Recurse old-dir', 'pwsh')).toEqual(['old-dir'])
  })
})

describe('sumTargetSize', () => {
  it('累计存在路径大小，目录递归估算，缺失路径跳过', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-hijack-size-'))
    try {
      await writeFile(join(dir, 'a.bin'), 'x'.repeat(30))
      await writeFile(join(dir, 'b.txt'), 'y')
      const total = await sumTargetSize([join(dir, 'a.bin'), join(dir, 'b.txt'), join(dir, 'missing.bin')], undefined)
      expect(total).toBe(31)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/** 构造 full access / 受限 sandboxPolicy mock。 */
function sandbox(mode: 'danger-full-access' | 'workspace-write'): FakeSandboxPolicy {
  return { resolve: () => ({ mode }) }
}

describe('超大文件容量策略', () => {
  it('block + full access + 超限：deny 并提示容量（可加 DSH_FORCE_DELETE=1）', async () => {
    const harness = createMockHarness(undefined, undefined, sandbox('danger-full-access'))
    apply(harness.ctx, Config({ deleteHijack: 'block', maxSizeBytes: 10 }))
    const dir = await mkdtemp(join(tmpdir(), 'dsh-hijack-big-'))
    try {
      const file = join(dir, 'big.bin')
      await writeFile(file, 'x'.repeat(20))
      const decision = await runPreExecute(harness, 'bash', `rm -f ${file}`)
      expect(decision).toMatchObject({ kind: 'deny' })
      expect((decision as { reason: string }).reason).toContain('trash capacity limit')
      expect((decision as { reason: string }).reason).toContain('DSH_FORCE_DELETE=1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('block + full access + 超限 + 逃生标记：allow', async () => {
    const harness = createMockHarness(undefined, undefined, sandbox('danger-full-access'))
    apply(harness.ctx, Config({ deleteHijack: 'block', maxSizeBytes: 10 }))
    const dir = await mkdtemp(join(tmpdir(), 'dsh-hijack-big-'))
    try {
      const file = join(dir, 'big.bin')
      await writeFile(file, 'x'.repeat(20))
      const decision = await runPreExecute(harness, 'bash', `${FORCE_DELETE_MARKER} rm -f ${file}`)
      expect(decision).toEqual({ kind: 'allow' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('block + 非 full access + 超限：转审批（ask）', async () => {
    const harness = createMockHarness(undefined, undefined, sandbox('workspace-write'))
    apply(harness.ctx, Config({ deleteHijack: 'block', maxSizeBytes: 10 }))
    const dir = await mkdtemp(join(tmpdir(), 'dsh-hijack-big-'))
    try {
      const file = join(dir, 'big.bin')
      await writeFile(file, 'x'.repeat(20))
      const decision = await runPreExecute(harness, 'bash', `rm -f ${file}`)
      expect(decision).toMatchObject({ kind: 'ask' })
      expect((decision as { reason: string }).reason).toContain('trash capacity limit')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('block + 未超限：维持原有 deny 引导 safe_delete', async () => {
    const harness = createMockHarness(undefined, undefined, sandbox('danger-full-access'))
    apply(harness.ctx, Config({ deleteHijack: 'block', maxSizeBytes: 100 }))
    const dir = await mkdtemp(join(tmpdir(), 'dsh-hijack-small-'))
    try {
      const file = join(dir, 'small.txt')
      await writeFile(file, 'tiny')
      const decision = await runPreExecute(harness, 'bash', `rm -f ${file}`)
      expect(decision).toMatchObject({ kind: 'deny' })
      expect((decision as { reason: string }).reason).toContain('safe_delete')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('off 模式：超限也放行', async () => {
    const harness = createMockHarness(undefined, undefined, sandbox('workspace-write'))
    apply(harness.ctx, Config({ deleteHijack: 'off', maxSizeBytes: 10 }))
    const dir = await mkdtemp(join(tmpdir(), 'dsh-hijack-big-'))
    try {
      const file = join(dir, 'big.bin')
      await writeFile(file, 'x'.repeat(20))
      const decision = await runPreExecute(harness, 'bash', `rm -f ${file}`)
      expect(decision).toEqual({ kind: 'allow' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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

  it('block 模式放行 ssh 远程删除命令（完全放行）', async () => {
    const harness = createMockHarness()
    apply(harness.ctx, Config({ deleteHijack: 'block' }))
    expect(await runPreExecute(harness, 'pwsh', 'ssh user@host "rm -rf /var/www"')).toEqual({ kind: 'allow' })
    expect(await runPreExecute(harness, 'bash', 'ssh user@host rm -rf /x')).toEqual({ kind: 'allow' })
    expect(await runPreExecute(harness, 'pwsh', 'scp -r data user@host:/tmp')).toEqual({ kind: 'allow' })
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
