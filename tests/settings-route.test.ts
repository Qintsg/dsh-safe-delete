/**
 * 设置路由模块单元测试（mock settings/webServer 服务）。
 *
 * @project dsh-safe-delete
 * @file settings-route.test.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  SafeDeleteWebBackend,
  SETTINGS_NAMESPACE,
  SETTINGS_ROUTE,
  installSettingsRoute,
} from '../src/settings-route.js'

/** Mock settings 服务。 */
function mockSettings(initial: Record<string, unknown>): {
  service: {
    writable: boolean
    describe(): { ns: string; value: unknown; revision: number; applies: string }[]
    replace(ns: string, section: object, expectedRevision?: number): Promise<void>
  }
  setWritable: (next: boolean) => void
  current: () => { value: Record<string, unknown>; revision: number }
} {
  let value = initial
  let revision = 1
  let writable = true
  return {
    service: {
      get writable() {
        return writable
      },
      describe: () => [{ ns: SETTINGS_NAMESPACE, value, revision, applies: 'live' }],
      replace: async (ns, section, expectedRevision) => {
        if (ns !== SETTINGS_NAMESPACE) throw new Error('unknown namespace')
        if (expectedRevision !== undefined && expectedRevision !== revision) {
          throw Object.assign(new Error('settings namespace changed since it was read'), { code: 'SETTINGS_CONFLICT' })
        }
        value = section as Record<string, unknown>
        revision += 1
      },
    },
    setWritable: (next) => { writable = next },
    current: () => ({ value, revision }),
  }
}

/** mock 上下文（logger 同时支持函数与对象调用形式）。 */
function mockCtx(settings?: ReturnType<typeof mockSettings>['service']): Context {
  const logger = Object.assign(
    (): { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void } => ({
      info: () => undefined,
      warn: () => undefined,
    }),
    { info: () => undefined, warn: () => undefined },
  )
  return {
    get: (name: string) => (name === 'settings' ? settings : undefined),
    logger,
  } as unknown as Context
}

/** mock 响应收集器。 */
function mockRes(): { res: ServerResponse; status: number; body: string; headers: Record<string, string> } {
  const state = { status: 200, body: '', headers: {} as Record<string, string> }
  const res = {
    setHeader: (name: string, value: string) => { state.headers[name] = value },
    writeHead: (status: number) => { state.status = status },
    end: (bytes: unknown) => { state.body = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes) },
  } as unknown as ServerResponse
  return { res, status: () => state.status, body: () => state.body, headers: () => state.headers }
}

/** 构造可迭代请求体。 */
function mockReq(method: string, body?: string, headers: Record<string, string> = {}): IncomingMessage {
  const req = {
    method,
    headers: { host: '127.0.0.1:3080', ...headers },
    [Symbol.asyncIterator]: body === undefined
      ? async function* () { /* empty */ }
      : async function* () { yield Buffer.from(body) },
  } as unknown as IncomingMessage
  return req
}

describe('SafeDeleteWebBackend.snapshot', () => {
  it('返回命名空间当前值、revision 与 writable', async () => {
    const settings = mockSettings({ trashDir: '/tmp/x' })
    const backend = new SafeDeleteWebBackend(mockCtx(settings.service))
    const snapshot = await backend.snapshot()
    expect(snapshot.writable).toBe(true)
    expect(snapshot.settings.value).toEqual({ trashDir: '/tmp/x' })
    expect(snapshot.settings.revision).toBe(1)
    expect(snapshot.settings.applies).toBe('live')
  })

  it('settings 服务缺失时抛出异常', async () => {
    const backend = new SafeDeleteWebBackend(mockCtx())
    await expect(backend.snapshot()).rejects.toThrow(/unavailable/)
  })
})

describe('SafeDeleteWebBackend.save', () => {
  it('保存成功并返回新快照', async () => {
    const settings = mockSettings({ retentionDays: 30 })
    const backend = new SafeDeleteWebBackend(mockCtx(settings.service))
    const snapshot = await backend.save({ action: 'save', expectedRevision: 1, value: { retentionDays: 7 } })
    expect(snapshot.settings.value).toEqual({ retentionDays: 7 })
    expect(snapshot.settings.revision).toBe(2)
    expect(settings.current()).toEqual({ value: { retentionDays: 7 }, revision: 2 })
  })

  it('revision 冲突时抛出 SETTINGS_CONFLICT', async () => {
    const settings = mockSettings({})
    const backend = new SafeDeleteWebBackend(mockCtx(settings.service))
    const error = await backend.save({ action: 'save', expectedRevision: 99, value: {} }).catch((reason: unknown) => reason)
    expect((error as { code?: string }).code).toBe('SETTINGS_CONFLICT')
  })
})

describe('SafeDeleteWebBackend.handle', () => {
  it('GET 返回 200 与快照', async () => {
    const settings = mockSettings({ deleteHijack: 'ask' })
    const backend = new SafeDeleteWebBackend(mockCtx(settings.service))
    const { res, status, body } = mockRes()
    await backend.handle(mockReq('GET'), res)
    expect(status()).toBe(200)
    const parsed = JSON.parse(body()) as { ok: boolean; value: { settings: { value: Record<string, unknown> } } }
    expect(parsed.ok).toBe(true)
    expect(parsed.value.settings.value.deleteHijack).toBe('ask')
  })

  it('POST 同源保存成功', async () => {
    const settings = mockSettings({})
    const backend = new SafeDeleteWebBackend(mockCtx(settings.service))
    const { res, status } = mockRes()
    await backend.handle(mockReq('POST', JSON.stringify({ action: 'save', expectedRevision: 1, value: { deleteHijack: 'off' } }), {
      origin: 'http://127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    }), res)
    expect(status()).toBe(200)
    expect(settings.current().value).toEqual({ deleteHijack: 'off' })
  })

  it('跨源 POST 被拒绝（403）', async () => {
    const settings = mockSettings({})
    const backend = new SafeDeleteWebBackend(mockCtx(settings.service))
    const { res, status, body } = mockRes()
    await backend.handle(mockReq('POST', '{}', {
      origin: 'http://evil.example.com',
      'content-type': 'application/json',
    }), res)
    expect(status()).toBe(403)
    expect(body()).toContain('origin-rejected')
  })

  it('非 JSON 请求被拒绝（400）', async () => {
    const settings = mockSettings({})
    const backend = new SafeDeleteWebBackend(mockCtx(settings.service))
    const { res, status } = mockRes()
    await backend.handle(mockReq('POST', 'not json', {
      origin: 'http://127.0.0.1:3080',
      'content-type': 'text/plain',
    }), res)
    expect(status()).toBe(400)
  })

  it('revision 冲突映射为 409', async () => {
    const settings = mockSettings({})
    const backend = new SafeDeleteWebBackend(mockCtx(settings.service))
    const { res, status, body } = mockRes()
    await backend.handle(mockReq('POST', JSON.stringify({ action: 'save', expectedRevision: 99, value: {} }), {
      origin: 'http://127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    }), res)
    expect(status()).toBe(409)
    expect(body()).toContain('settings-conflict')
  })

  it('不支持的方法返回 405', async () => {
    const settings = mockSettings({})
    const backend = new SafeDeleteWebBackend(mockCtx(settings.service))
    const { res, status } = mockRes()
    await backend.handle(mockReq('DELETE'), res)
    expect(status()).toBe(405)
  })
})

describe('installSettingsRoute', () => {
  it('webServer 服务存在时注册路由', () => {
    const register = vi.fn(() => () => undefined)
    const ctx = {
      get: (name: string) => (name === 'webServer' ? { register } : name === 'settings' ? mockSettings({}).service : undefined),
      effect: (fn: () => unknown) => { fn() },
      logger: () => ({ info: () => undefined, warn: () => undefined }),
    } as unknown as Context
    installSettingsRoute(ctx)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0]?.[0]).toMatchObject({ kind: 'exact', path: SETTINGS_ROUTE })
  })

  it('webServer 服务缺失时静默跳过', () => {
    const ctx = {
      get: () => undefined,
      effect: () => undefined,
      logger: () => ({ info: () => undefined, warn: () => undefined }),
    } as unknown as Context
    expect(() => installSettingsRoute(ctx)).not.toThrow()
  })
})
