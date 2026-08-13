/**
 * 设置路由模块：为 DSH Web 设置卡片提供同源 HTTP 读写接口
 * （GET 快照 / POST 保存），读写 settings 服务的 safe-delete 命名空间。
 *
 * @project dsh-safe-delete
 * @file settings-route.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** 浏览器设置卡片使用的精确路由。 */
export const SETTINGS_ROUTE = '/_dsh/safe-delete/settings'

/** settings 命名空间名（与 index.ts 一致）。 */
export const SETTINGS_NAMESPACE = 'safe-delete'

/** 设置快照（client 可读的纯 JSON）。 */
export interface SafeDeleteSettingsSnapshot {
  writable: boolean
  settings: {
    value: Record<string, unknown>
    revision: number
    applies: 'live'
  }
}

/** 保存请求。 */
export interface SaveSettingsRequest {
  action: 'save'
  expectedRevision: number
  value: Record<string, unknown>
}

type SettingsRequest = SaveSettingsRequest

interface JsonError {
  ok: false
  error: { code: string; message: string }
}

interface JsonSuccess<T> {
  ok: true
  value: T
}

type JsonResponse<T> = JsonSuccess<T> | JsonError

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function responseJson<T>(res: ServerResponse, status: number, body: JsonResponse<T>): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.writeHead(status)
  res.end(bytes)
}

function requestError(res: ServerResponse, status: number, code: string, message: string): void {
  responseJson(res, status, { ok: false, error: { code, message } })
}

/** 同源 POST 校验（防跨站提交）。 */
function sameOriginPost(req: IncomingMessage): boolean {
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none'
  const host = req.headers.host
  if (host === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

async function readJson(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new TypeError('Content-Type must be application/json')
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += part.length
    if (bytes > maxBytes) throw new RangeError(`request body exceeds ${maxBytes} bytes`)
    chunks.push(part)
  }
  if (chunks.length === 0) throw new TypeError('request body is empty')
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function parseRequest(value: unknown): SettingsRequest {
  if (!isRecord(value) || value.action !== 'save') throw new TypeError('unsupported action')
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) {
    throw new TypeError('save.expectedRevision must be a non-negative integer')
  }
  if (!isRecord(value.value)) throw new TypeError('save.value must be an object')
  return {
    action: 'save',
    expectedRevision: value.expectedRevision as number,
    value: value.value,
  }
}

function publicMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** settings 服务的只读面（ctx.get('settings')）。 */
interface SettingsServiceFace {
  writable: boolean
  describe(): { ns: string; value: unknown; revision: number; applies: string }[]
  replace(ns: string, section: object, expectedRevision?: number): Promise<void>
}

/** 安全删除设置路由后端。 */
export class SafeDeleteWebBackend {
  constructor(private readonly ctx: Context) {}

  /** 读取当前设置快照。 */
  async snapshot(): Promise<SafeDeleteSettingsSnapshot> {
    const settings = this.ctx.get('settings') as SettingsServiceFace | undefined
    if (settings === undefined) throw new Error('settings service is unavailable')
    const descriptor = settings.describe().find((row) => row.ns === SETTINGS_NAMESPACE)
    if (descriptor === undefined) throw new Error('safe-delete settings namespace is not registered')
    return {
      writable: settings.writable,
      settings: {
        value: descriptor.value as Record<string, unknown>,
        revision: descriptor.revision,
        applies: descriptor.applies as 'live',
      },
    }
  }

  /** 保存设置（经 settings 服务的 schema + validate 校验）。 */
  async save(request: SaveSettingsRequest): Promise<SafeDeleteSettingsSnapshot> {
    const settings = this.ctx.get('settings') as SettingsServiceFace | undefined
    if (settings === undefined) throw new Error('settings service is unavailable')
    if (!settings.writable) throw new Error('settings provider is read-only')
    await settings.replace(SETTINGS_NAMESPACE, request.value, request.expectedRevision)
    return this.snapshot()
  }

  /** 处理路由请求。 */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      try {
        responseJson(res, 200, { ok: true, value: await this.snapshot() })
      } catch (error) {
        this.ctx.logger.warn('safe-delete settings snapshot failed: %s', publicMessage(error))
        requestError(res, 503, 'settings-unavailable', 'safe-delete settings are unavailable')
      }
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      requestError(res, 405, 'method-not-allowed', 'Use GET or POST')
      return
    }
    if (!sameOriginPost(req)) {
      requestError(res, 403, 'origin-rejected', 'The request must originate from this DSH Web application')
      return
    }
    let parsed: SettingsRequest
    try {
      parsed = parseRequest(await readJson(req))
    } catch (error) {
      requestError(res, error instanceof RangeError ? 413 : 400, 'invalid-request', publicMessage(error))
      return
    }
    try {
      responseJson(res, 200, { ok: true, value: await this.save(parsed) })
    } catch (error) {
      // SettingsConflictError 带 code = SETTINGS_CONFLICT。
      const conflict = (error as { code?: unknown } | null)?.code === 'SETTINGS_CONFLICT'
      this.ctx.logger.warn('safe-delete settings save failed: %s', publicMessage(error))
      requestError(res, conflict ? 409 : 400, conflict ? 'settings-conflict' : 'settings-rejected', publicMessage(error))
    }
  }
}

/** webServer 服务的只读面（ctx.get('webServer')）。 */
interface WebServerFace {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * 安装设置路由（webServer 服务存在时）。
 *
 * :param ctx: 插件上下文
 */
export function installSettingsRoute(ctx: Context): void {
  const webServer = ctx.get('webServer') as WebServerFace | undefined
  if (webServer === undefined) return
  const backend = new SafeDeleteWebBackend(ctx)
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: SETTINGS_ROUTE,
    handler: (req, res) => backend.handle(req, res),
  }), 'safe-delete: settings route')
}
