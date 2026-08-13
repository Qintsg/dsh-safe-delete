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
  // 注：interceptFsDelete（预留）不在设置卡片显示——
  // 等 DSH ctx.fs 具备删除能力后再加回表单。代码与文档已保留该配置。
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

/** 折叠箭头图标（自包含，仿官方 chevron-down-outline）。 */
function ChevronIcon(): ReactNode {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 5 4 4 4-4" />
    </svg>
  )
}

/** 表单字段组件（仿官方 ValueField：label 行 + 控件 + hint，纵向堆叠）。 */
function Field({ spec, dict, value, onChange }: {
  spec: FieldSpec
  dict: CardDict
  value: string | boolean
  onChange: (next: string | boolean) => void
}): ReactNode {
  const optionLabels = dict.options[spec.key]
  const id = `sdl-field-${spec.key}`
  return (
    <div className="sdl-field">
      <div className="sdl-fieldHead">
        <label className="sdl-label" htmlFor={id}>{dict.fields[spec.key] ?? spec.key}</label>
      </div>
      {spec.kind === 'boolean' ? (
        <input
          id={id}
          className="sdl-input"
          type="checkbox"
          checked={value === true}
          onChange={(event) => { onChange(event.target.checked) }}
        />
      ) : spec.kind === 'select' ? (
        <select
          id={id}
          className="sdl-input"
          value={String(value)}
          onChange={(event) => { onChange(event.target.value) }}
        >
          {spec.options?.map((option) => (
            <option key={option} value={option}>{optionLabels?.[option] ?? option}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="sdl-input"
          type={spec.kind === 'number' ? 'number' : 'text'}
          value={String(value)}
          placeholder={dict.placeholders[spec.key]}
          onChange={(event) => { onChange(event.target.value) }}
        />
      )}
      {dict.hints[spec.key] === undefined ? null : <p className="sdl-hint">{dict.hints[spec.key]}</p>}
    </div>
  )
}

/** 设置卡片主组件（可收起/展开）。 */
function SafeDeleteCard({ dict }: CardProps & { dict: CardDict }): ReactNode {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | undefined>(undefined)
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)

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
      <li className="sdl-card">
        <button type="button" className="sdl-head" aria-expanded="false">
          <span className="sdl-headText">
            <span className="sdl-name">{dict.title}</span>
            <span className="sdl-desc">{dict.description}</span>
          </span>
          <span className="sdl-chevron"><ChevronIcon /></span>
        </button>
        {error === undefined ? <p className="sdl-muted">{dict.loading}</p> : <p className="sdl-error">{error} <button type="button" onClick={load}>{dict.retry}</button></p>}
      </li>
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
    <li className="sdl-card" data-open={expanded || undefined}>
      <button
        type="button"
        className="sdl-head"
        aria-expanded={expanded}
        onClick={() => { setExpanded(value => !value) }}
      >
        <span className="sdl-headText">
          <span className="sdl-name">{dict.title}</span>
          <span className="sdl-desc">{dict.description}</span>
        </span>
        <span className="sdl-chevron" data-open={expanded || undefined}><ChevronIcon /></span>
      </button>
      {!expanded ? null : (
        <div className="sdl-body">
          {!snapshot.writable ? <p className="sdl-readonly" role="status">{dict.readOnly}</p> : null}
          {message === undefined ? null : <p className="sdl-ok" role="status">{message}</p>}
          {error === undefined ? null : <p className="sdl-error" role="status">{error}</p>}
          <div className="sdl-fields">
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
          <div className="sdl-footer">
            <button type="button" className="sdl-discard" disabled={busy} onClick={load}>{dict.reload}</button>
            <button type="button" className="sdl-save" disabled={!snapshot.writable || busy} onClick={save}>
              {busy ? dict.saving : dict.save}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

const CSS = `
.sdl-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}
.sdl-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.sdl-card[data-open=true]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.sdl-head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.sdl-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.sdl-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.sdl-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.sdl-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.sdl-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.sdl-chevron[data-open=true]{transform:rotate(180deg)}
.sdl-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.sdl-readonly{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.sdl-fields{display:flex;flex-direction:column}
.sdl-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.sdl-field+.sdl-field{border-top:1px solid var(--dsw-alias-border-l2)}
.sdl-fieldHead{display:flex;align-items:center;gap:8px}
.sdl-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.sdl-input{height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);box-sizing:border-box;width:100%}
.sdl-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.sdl-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
select.sdl-input{appearance:auto;cursor:pointer}
input.sdl-input[type=checkbox]{width:18px;height:18px;padding:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.sdl-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.sdl-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2);margin-top:4px}
.sdl-discard,.sdl-save{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.sdl-discard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary)}
.sdl-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.sdl-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.sdl-discard:disabled,.sdl-save:disabled{opacity:.4;cursor:default}
.sdl-discard:focus-visible,.sdl-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sdl-error{flex:1;min-width:0;margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error);display:flex;gap:8px;align-items:center}
.sdl-ok{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-positive)}
.sdl-muted{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
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

/** 读取 DSH 当前语言（locale 服务存在时；快照字段为 active）。 */
function readLocaleId(ctx: ClientCtx): string | undefined {
  const locale = ctx.get('locale') as { getLocale?: () => { active?: string } } | undefined
  return locale?.getLocale?.()?.active
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
