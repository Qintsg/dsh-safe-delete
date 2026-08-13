/**
 * dsh-safe-delete 浏览器半区：在 DSH Web 设置面板的「插件」页注册
 * 安全删除配置卡片，经 host 的同源 HTTP 路由读写配置。
 *
 * @project dsh-safe-delete
 * @file index.tsx
 * @author Qintsg
 * @date 2026-08-13
 */
import { useEffect, useState, type ReactNode } from 'react'
import { resolveDict, type CardDict } from './i18n.js'

/** 与 host 端 settings-route.ts 一致的路由。 */
const SETTINGS_ROUTE = '/_dsh/safe-delete/settings'

/** 配置字段清单（标签与提示由字典提供）。 */
interface FieldSpec {
  key: string
  kind: 'text' | 'number' | 'select' | 'boolean'
  options?: string[]
}

const FIELDS: FieldSpec[] = [
  { key: 'trashDir', kind: 'text' },
  { key: 'retentionDays', kind: 'number' },
  { key: 'maxSizeBytes', kind: 'number' },
  { key: 'confirmThreshold', kind: 'number' },
  { key: 'restoreConflict', kind: 'select', options: ['rename', 'skip', 'overwrite'] },
  { key: 'deleteHijack', kind: 'select', options: ['block', 'ask', 'off'] },
  { key: 'interceptFsDelete', kind: 'boolean' },
]

/** 设置快照（与 host 返回一致）。 */
interface SettingsSnapshot {
  writable: boolean
  settings: {
    value: Record<string, unknown>
    revision: number
    applies: string
  }
}

interface ApiSuccess<T> {
  ok: true
  value: T
}

interface ApiFailure {
  ok: false
  error: { code: string; message: string }
}

type ApiResponse<T> = ApiSuccess<T> | ApiFailure

/** 最小 slots 服务面（运行时由 DSH 注入）。 */
interface SlotsFace {
  inject(key: string, effect: () => unknown): void
  register(entry: Record<string, unknown>, component: unknown): unknown
}

/** 最小浏览器上下文面。 */
interface ClientCtx {
  get(name: string): unknown
  effect(callback: () => unknown, label?: string): void
  on(name: string, listener: (...args: unknown[]) => void): () => void
}

/** 卡片 props（渲染器注入）。 */
interface CardProps {
  children?: never
}

async function apiRequest<T>(init?: RequestInit): Promise<T> {
  const response = await fetch(SETTINGS_ROUTE, { credentials: 'same-origin', ...init })
  const body = await response.json() as ApiResponse<T>
  if (!response.ok || !body.ok) {
    const failure = body as ApiFailure
    throw new Error(failure.error?.message ?? `safe-delete request failed with HTTP ${response.status}`)
  }
  return body.value
}

/** 草稿态：数字字段用字符串承载（输入友好）。 */
interface Draft {
  trashDir: string
  retentionDays: string
  maxSizeBytes: string
  confirmThreshold: string
  restoreConflict: string
  deleteHijack: string
  interceptFsDelete: boolean
}

function draftOf(value: Record<string, unknown>): Draft {
  return {
    trashDir: typeof value.trashDir === 'string' ? value.trashDir : '',
    retentionDays: String(value.retentionDays ?? 30),
    maxSizeBytes: String(value.maxSizeBytes ?? 5368709120),
    confirmThreshold: String(value.confirmThreshold ?? 10),
    restoreConflict: typeof value.restoreConflict === 'string' ? value.restoreConflict : 'rename',
    deleteHijack: typeof value.deleteHijack === 'string' ? value.deleteHijack : 'block',
    interceptFsDelete: value.interceptFsDelete === true,
  }
}

/** 数字解析：非法输入回退默认值。 */
function numberOr(raw: string, fallback: number): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function valueOf(draft: Draft): Record<string, unknown> {
  return {
    trashDir: draft.trashDir.trim(),
    retentionDays: numberOr(draft.retentionDays, 30),
    maxSizeBytes: numberOr(draft.maxSizeBytes, 5368709120),
    confirmThreshold: numberOr(draft.confirmThreshold, 10),
    restoreConflict: draft.restoreConflict,
    deleteHijack: draft.deleteHijack,
    interceptFsDelete: draft.interceptFsDelete,
  }
}

/** 表单字段组件（标签/提示/选项标签均来自字典）。 */
function Field({ spec, dict, value, onChange }: {
  spec: FieldSpec
  dict: CardDict
  value: string | boolean
  onChange: (next: string | boolean) => void
}): ReactNode {
  const optionLabels = dict.options[spec.key]
  return (
    <label className="sdl-field">
      <span>{dict.fields[spec.key] ?? spec.key}</span>
      {spec.kind === 'boolean' ? (
        <input type="checkbox" checked={value === true} onChange={(event) => { onChange(event.target.checked) }} />
      ) : spec.kind === 'select' ? (
        <select value={String(value)} onChange={(event) => { onChange(event.target.value) }}>
          {spec.options?.map((option) => (
            <option key={option} value={option}>{optionLabels?.[option] ?? option}</option>
          ))}
        </select>
      ) : (
        <input
          type={spec.kind === 'number' ? 'number' : 'text'}
          value={String(value)}
          onChange={(event) => { onChange(event.target.value) }}
        />
      )}
      {dict.hints[spec.key] === undefined ? null : <small>{dict.hints[spec.key]}</small>}
    </label>
  )
}

/** 设置卡片主组件。 */
function SafeDeleteCard({ dict }: CardProps & { dict: CardDict }): ReactNode {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | undefined>(undefined)
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const load = (): void => {
    setBusy(true)
    setError(undefined)
    apiRequest<SettingsSnapshot>()
      .then((next) => {
        setSnapshot(next)
        setDraft(draftOf(next.settings.value))
      })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { setBusy(false) })
  }

  useEffect(load, [])

  if (snapshot === undefined || draft === undefined) {
    return (
      <div className="sdl-card">
        <h4>{dict.title}</h4>
        {error === undefined ? <p className="sdl-muted">{dict.loading}</p> : <p className="sdl-error">{error} <button type="button" onClick={load}>{dict.retry}</button></p>}
      </div>
    )
  }

  const update = (key: keyof Draft, next: string | boolean): void => {
    setDraft(current => current === undefined ? current : { ...current, [key]: next })
  }

  const save = (): void => {
    if (draft === undefined) return
    setBusy(true)
    setMessage(undefined)
    setError(undefined)
    apiRequest<SettingsSnapshot>({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', expectedRevision: snapshot.settings.revision, value: valueOf(draft) }),
    })
      .then((next) => {
        setSnapshot(next)
        setMessage(dict.saved)
      })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { setBusy(false) })
  }

  return (
    <div className="sdl-card">
      <h4>{dict.title}</h4>
      {!snapshot.writable ? <p className="sdl-warn">{dict.readOnly}</p> : null}
      {message === undefined ? null : <p className="sdl-ok">{message}</p>}
      {error === undefined ? null : <p className="sdl-error">{error}</p>}
      <div className="sdl-grid">
        {FIELDS.map((spec) => (
          <Field
            key={spec.key}
            spec={spec}
            dict={dict}
            value={draft[spec.key as keyof Draft]}
            onChange={(next) => { update(spec.key as keyof Draft, next) }}
          />
        ))}
      </div>
      <div className="sdl-actions">
        <button type="button" className="sdl-primary" disabled={!snapshot.writable || busy} onClick={save}>
          {busy ? dict.saving : dict.save}
        </button>
        <button type="button" disabled={busy} onClick={load}>{dict.reload}</button>
      </div>
    </div>
  )
}

const CSS = `
.sdl-card{display:grid;gap:10px;padding:14px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-subtle,#dedbd5) 86%,transparent);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 96%,transparent)}
.sdl-card h4{margin:0;font-size:13px}
.sdl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.sdl-field{display:grid;gap:4px;align-content:start}
.sdl-field>span{font-size:11px;font-weight:600}
.sdl-field>small{font-size:10px;color:var(--dsw-alias-fg-muted,#77736d);line-height:1.4}
.sdl-field input[type=text],.sdl-field input[type=number],.sdl-field select{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-subtle,#d9d5ce);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:12px;padding:7px 9px}
.sdl-field select{height:32px}
.sdl-field input[type=checkbox]{width:16px;height:16px}
.sdl-actions{display:flex;gap:8px}
.sdl-actions button{padding:6px 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-subtle,#d9d5ce);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:12px;cursor:pointer}
.sdl-actions .sdl-primary{background:#6758d4;border-color:#6758d4;color:#fff;font-weight:600}
.sdl-actions button:disabled{opacity:.55;cursor:default}
.sdl-muted{font-size:11px;color:var(--dsw-alias-fg-muted,#77736d);margin:0}
.sdl-error{font-size:11px;color:#aa3939;margin:0;display:flex;gap:8px;align-items:center}
.sdl-ok{font-size:11px;color:#267d52;margin:0}
.sdl-warn{font-size:11px;color:#986818;margin:0}
@media(max-width:720px){.sdl-grid{grid-template-columns:1fr}}
`

function installStyles(): () => void {
  const id = 'dsh-safe-delete/client'
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.pluginCss = id
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** 读取 DSH 当前语言（locale 服务存在时）。 */
function readLocaleId(ctx: ClientCtx): string | undefined {
  const locale = ctx.get('locale') as { getLocale?: () => { id?: string } } | undefined
  return locale?.getLocale?.()?.id
}

/** 浏览器半区入口：注册设置卡片（文案跟随 DSH 语言）。 */
export function apply(ctx: ClientCtx): void {
  ctx.effect(installStyles, 'dsh-safe-delete: styles')
  const slots = ctx.get('slots') as SlotsFace | undefined
  if (slots === undefined) return
  const dict = resolveDict(readLocaleId(ctx))
  slots.inject('settings.plugin.item', () => slots.register({
    name: 'settings.plugin.item',
    id: 'safe-delete',
    order: 30,
    inject: () => ({ dict }),
  }, SafeDeleteCard))
}
