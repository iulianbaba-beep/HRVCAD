import type { Underlay, Vec2 } from '../core/types'
import { activeLevel, emitBus, findUnderlay, store, updateUnderlay } from '../core/store'
import { calibrateTransform, dist, formatLength, parseLength, rotateTransform } from '../core/geom'
import { t } from '../i18n'
import { prompt, tools, type OverlayShape, type Tool } from './tool'

const unit = () => store.get().project.settings.displayUnit
const fmt = (m: number) => formatLength(m, unit())

/** The underlay a tool should act on: the selected one, else the topmost on the active level. */
export function targetUnderlay(): Underlay | null {
  const s = store.get()
  const sel = findUnderlay(s.ui.selectedUnderlayId)
  if (sel) return sel.underlay
  const ul = activeLevel(s).underlays
  return ul.length ? ul[ul.length - 1] : null
}

function requireUnlocked(): Underlay | null {
  const u = targetUnderlay()
  if (!u) { store.log(t('tool.needUnderlay'), 'warn'); return null }
  if (u.locked) { store.log(t('tool.underlayLocked'), 'warn'); return null }
  store.setUI({ selectedUnderlayId: u.id })
  return u
}

/** Width of an underlay in world metres (along its local X). */
export function underlayWorldWidth(u: Underlay): number {
  const w = u.kind === 'vector' ? u.bounds.max.x - u.bounds.min.x : u.pxWidth
  return w * u.transform.scale
}

export function calibrateTool(): Tool | null {
  const u = requireUnlocked()
  if (!u) return null
  let a: Vec2 | null = null, b: Vec2 | null = null, cur: Vec2 | null = null
  const tool: Tool = {
    id: 'underlay.calibrate',
    basePoint: () => a,
    start: () => prompt(t('tool.cal.p1')),
    pick(p) {
      if (!a) { a = p; prompt(t('tool.cal.p2')); return }
      if (!b) {
        if (dist(a, p) < 1e-9) { store.log(t('tool.cal.zero'), 'warn'); return }
        b = p
        prompt(t('tool.cal.len', { cur: fmt(dist(a, b)), u: unit() }), true)
      }
    },
    move(p) { cur = p },
    input(text) {
      if (!a || !b) return false
      const len = parseLength(text, unit())
      if (len == null) { store.log(t('tool.cal.invalid'), 'warn'); return true }
      const k = len / dist(a, b)
      const pa = a, pb = b
      updateUnderlay(t('cmd.underlay.calibrate'), u.id, x => ({ ...x, transform: calibrateTransform(x.transform, pa, pb, len), calibrated: true }))
      const nu = findUnderlay(u.id)!.underlay
      store.log(t('tool.cal.done', { name: u.name, k: k.toPrecision(6), w: fmt(underlayWorldWidth(nu)) }), 'info')
      tools.finish()
      emitBus('zoomExtents')
      return true
    },
    overlay(): OverlayShape[] {
      const out: OverlayShape[] = []
      if (a) out.push({ kind: 'point', p: a })
      const end = b ?? cur
      if (a && end) out.push({ kind: 'line', a, b: end, label: fmt(dist(a, end)) })
      if (b) out.push({ kind: 'point', p: b })
      return out
    }
  }
  return tool
}

export function moveTool(): Tool | null {
  const u = requireUnlocked()
  if (!u) return null
  let base: Vec2 | null = null, cur: Vec2 | null = null
  return {
    id: 'underlay.move',
    basePoint: () => base,
    start: () => prompt(t('tool.move.base')),
    pick(p) {
      if (!base) { base = p; prompt(t('tool.move.dest')); return }
      const dx = p.x - base.x, dy = p.y - base.y
      updateUnderlay(t('cmd.underlay.move'), u.id, x => ({
        ...x, transform: { ...x.transform, offset: { x: x.transform.offset.x + dx, y: x.transform.offset.y + dy } }
      }))
      store.log(t('tool.move.done', { d: fmt(Math.hypot(dx, dy)) }))
      tools.finish()
    },
    move(p) { cur = p },
    overlay: () => (base && cur ? [{ kind: 'line', a: base, b: cur, label: fmt(dist(base, cur)), dashed: true }] : [])
  }
}

export function rotateTool(): Tool | null {
  const u = requireUnlocked()
  if (!u) return null
  let pivot: Vec2 | null = null, ref: Vec2 | null = null, cur: Vec2 | null = null
  const apply = (angle: number) => {
    const pv = pivot!
    updateUnderlay(t('cmd.underlay.rotate'), u.id, x => ({ ...x, transform: rotateTransform(x.transform, pv, angle) }))
    store.log(t('tool.rot.done', { a: ((angle * 180) / Math.PI).toFixed(2) }))
    tools.finish()
  }
  return {
    id: 'underlay.rotate',
    basePoint: () => pivot,
    start: () => prompt(t('tool.rot.pivot')),
    pick(p) {
      if (!pivot) { pivot = p; prompt(t('tool.rot.ref')); return }
      if (!ref) { ref = p; prompt(t('tool.rot.angle'), true); return }
      const a0 = Math.atan2(ref.y - pivot.y, ref.x - pivot.x)
      const a1 = Math.atan2(p.y - pivot.y, p.x - pivot.x)
      apply(a1 - a0)
    },
    move(p) { cur = p },
    input(text) {
      if (!pivot || !ref) return false
      const deg = parseFloat(text.replace(',', '.'))
      if (!Number.isFinite(deg)) return false
      apply((deg * Math.PI) / 180)
      return true
    },
    overlay() {
      const out: OverlayShape[] = []
      if (pivot) out.push({ kind: 'point', p: pivot })
      if (pivot && ref) out.push({ kind: 'line', a: pivot, b: ref, dashed: true })
      const end = ref ? cur : cur
      if (pivot && end) {
        const label = ref
          ? `${(((Math.atan2(end.y - pivot.y, end.x - pivot.x) - Math.atan2(ref.y - pivot.y, ref.x - pivot.x)) * 180) / Math.PI).toFixed(1)}°`
          : undefined
        out.push({ kind: 'line', a: pivot, b: end, label })
      }
      return out
    }
  }
}

export function measureTool(): Tool {
  let a: Vec2 | null = null, cur: Vec2 | null = null
  return {
    id: 'tool.measure',
    basePoint: () => a,
    start: () => prompt(t('tool.measure.p1')),
    pick(p) {
      if (!a) { a = p; prompt(t('tool.measure.p2')); return }
      const dx = p.x - a.x, dy = p.y - a.y
      store.log(t('tool.measure.result', {
        d: fmt(Math.hypot(dx, dy)), dx: fmt(Math.abs(dx)), dy: fmt(Math.abs(dy)),
        a: ((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)
      }))
      a = null // repeat until Esc, like AutoCAD
      prompt(t('tool.measure.p1'))
    },
    move(p) { cur = p },
    overlay: () => (a && cur ? [{ kind: 'point', p: a }, { kind: 'line', a, b: cur, label: fmt(dist(a, cur)) }] : [])
  }
}
