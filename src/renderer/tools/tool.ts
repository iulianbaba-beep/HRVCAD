// Interactive tool framework (AutoCAD-style: prompts on the command line, picks in the viewport).
import type { Vec2 } from '../core/types'
import { store, emitBus } from '../core/store'
import { t } from '../i18n'

export type OverlayShape =
  | { kind: 'line'; a: Vec2; b: Vec2; label?: string; dashed?: boolean }
  | { kind: 'point'; p: Vec2 }
  | { kind: 'arc'; c: Vec2; r: number; a0: number; a1: number }
  | { kind: 'poly'; pts: Vec2[] }

export interface Tool {
  id: string
  /** Base point for ortho constraint, if any. */
  basePoint(): Vec2 | null
  start(): void
  pick(p: Vec2): void
  move?(p: Vec2): void
  /** Text entered on the command line while this tool is active. Return false if not consumed. */
  input?(text: string): boolean
  overlay(): OverlayShape[]
  cancel?(): void
}

let active: Tool | null = null
/** Tools suspended by a transparent command (e.g. measuring during placement). */
const suspended: Tool[] = []

export const tools = {
  get active() { return active },

  start(tool: Tool) {
    suspended.length = 0
    if (active) tools.cancel(false)
    active = tool
    store.setUI({ activeTool: tool.id })
    tool.start()
    emitBus('overlay')
  },

  /** Start a tool on top of the active one; the active one resumes when this one ends. */
  startTransparent(tool: Tool) {
    if (active) suspended.push(active)
    active = tool
    store.setUI({ activeTool: tool.id })
    tool.start()
    emitBus('overlay')
  },

  finish() {
    active = null
    store.setUI({ activeTool: null, prompt: null, awaitingInput: false })
    tools.resume()
    emitBus('overlay')
  },

  resume() {
    const prev = suspended.pop()
    if (!prev) return
    active = prev
    store.setUI({ activeTool: prev.id })
    prev.start()
  },

  cancel(logIt = true) {
    if (!active) return
    active.cancel?.()
    active = null
    store.setUI({ activeTool: null, prompt: null, awaitingInput: false })
    if (logIt) store.log(t('cmdline.cancelled'), 'cmd')
    tools.resume()
    emitBus('overlay')
  },

  /** Apply ortho constraint relative to the tool's base point. */
  constrain(p: Vec2): Vec2 {
    const base = active?.basePoint()
    if (!base || !store.get().ui.ortho) return p
    return Math.abs(p.x - base.x) >= Math.abs(p.y - base.y) ? { x: p.x, y: base.y } : { x: base.x, y: p.y }
  },

  pick(p: Vec2) { active?.pick(tools.constrain(p)); emitBus('overlay') },
  move(p: Vec2) { active?.move?.(tools.constrain(p)); emitBus('overlay') },

  /** Command-line input routed to the active tool: either a typed value or "x,y" coordinates. */
  input(text: string): boolean {
    if (!active) return false
    if (active.input?.(text)) { emitBus('overlay'); return true }
    const m = text.trim().replace(/\s+/g, '').match(/^(-?[0-9]*\.?[0-9]+)[,;](-?[0-9]*\.?[0-9]+)$/)
    if (m) { tools.pick({ x: parseFloat(m[1]), y: parseFloat(m[2]) }); return true }
    return false
  }
}

export function prompt(text: string, awaitingInput = false) {
  store.setUI({ prompt: text, awaitingInput })
}
