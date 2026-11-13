// Wall modify tools: grips, move/copy/rotate/mirror, offset, split, trim, extend, doors & windows.
import type { Opening, OpeningKind, Vec2, Wall } from '../core/types'
import { activeLevel, emitBus, store, updateLevel } from '../core/store'
import { dist, formatLength, parseLength } from '../core/geom'
import { closestOnSegment, faceOffsets, wallPolygons, wallThickness } from '../core/walls'
import {
  extendWall, footprintSegs, mirrorAcross, moveJoinedEndpoints, offsetWall, openingOverlaps, paramOf, placeOpening, rotateAbout,
  splitWall, transformWall, translate, trimWall, wallLength, type PointMap
} from '../core/wallOps'
import { t } from '../i18n'
import { prompt, tools, type OverlayShape, type Tool } from './tool'

const unit = () => store.get().project.settings.displayUnit
const fmt = (m: number) => formatLength(m, unit())
const lvl = () => activeLevel()
const setWalls = (label: string, fn: (ws: Wall[]) => Wall[]) => updateLevel(label, lvl().id, l => ({ ...l, walls: fn(l.walls) }))

/** Selected walls on the active level. */
function selection(): Wall[] {
  const ids = new Set(store.get().ui.selectedWallIds)
  return lvl().walls.filter(w => ids.has(w.id))
}

/** Wall whose body or reference line is under p (pick tolerance in metres). */
export function wallAt(p: Vec2, tol = 0.25): Wall | null {
  const s = store.get()
  const level = lvl()
  const polys = wallPolygons(level.walls, s.project.library)
  let best: Wall | null = null, bd = tol
  for (const w of level.walls) {
    const poly = polys.get(w.id)
    const d = closestOnSegment(p, w.a, w.b).d
    const inside = poly && pointInPoly(p, poly)
    const score = inside ? 0 : d
    if (score < bd) { bd = score; best = w }
  }
  return best
}
function pointInPoly(p: Vec2, poly: Vec2[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

const ghost = (walls: Wall[], f: PointMap): OverlayShape[] =>
  walls.map(w => ({ kind: 'line' as const, a: f(w.a), b: f(w.b), dashed: true }))

function needSelection(): Wall[] | null {
  const ws = selection()
  if (!ws.length) { store.log(t('tool.needWallSelection'), 'warn'); return null }
  return ws
}

// ---------------------------------------------------------------- grips (stretch)
export function gripTool(wallId: string, end: 'a' | 'b'): Tool | null {
  const w = lvl().walls.find(x => x.id === wallId)
  if (!w) return null
  const from = w[end]
  let cur: Vec2 | null = null
  return {
    id: 'modify.grip',
    basePoint: () => from,
    start: () => prompt(t('tool.grip.prompt')),
    pick(p) {
      setWalls(t('tool.grip.label'), ws => moveJoinedEndpoints(ws, from, p))
      tools.finish()
    },
    move(p) { cur = p },
    input(text) {
      // Typed length = new wall length keeping the other end fixed
      const L = parseLength(text, unit())
      if (L == null) return false
      const other = end === 'a' ? w.b : w.a
      const d = { x: from.x - other.x, y: from.y - other.y }
      const k = L / Math.hypot(d.x, d.y)
      tools.pick({ x: other.x + d.x * k, y: other.y + d.y * k })
      return true
    },
    overlay: () => cur ? [{ kind: 'line', a: end === 'a' ? cur : w.a, b: end === 'a' ? w.b : cur, label: fmt(dist(end === 'a' ? cur : w.a, end === 'a' ? w.b : cur)) }] : []
  }
}

// ---------------------------------------------------------------- move / copy
export function moveWallsTool(copy: boolean): Tool | null {
  const ws = needSelection()
  if (!ws) return null
  let base: Vec2 | null = null, cur: Vec2 | null = null
  const id = copy ? 'modify.copy' : 'modify.move'
  return {
    id,
    basePoint: () => base,
    start: () => prompt(t(copy ? 'tool.copy.base' : 'tool.move.base')),
    pick(p) {
      if (!base) { base = p; prompt(t(copy ? 'tool.copy.dest' : 'tool.move.dest')); return }
      const f = translate(p.x - base.x, p.y - base.y)
      if (copy) {
        const copies = ws.map(w => transformWall(w, f, false, true))
        setWalls(t('cmd.modify.copy'), all => [...all, ...copies])
        return // AutoCAD COPY repeats until Esc / Enter
      }
      const ids = new Set(ws.map(w => w.id))
      setWalls(t('cmd.modify.move'), all => all.map(w => (ids.has(w.id) ? transformWall(w, f, false, false) : w)))
      tools.finish()
    },
    move(p) { cur = p },
    input(text) {
      if (!base || !cur) return false
      const L = parseLength(text, unit())
      if (L == null) return false
      const d = dist(base, cur) || 1
      tools.pick({ x: base.x + ((cur.x - base.x) / d) * L, y: base.y + ((cur.y - base.y) / d) * L })
      return true
    },
    overlay() {
      if (!base || !cur) return []
      return [...ghost(ws, translate(cur.x - base.x, cur.y - base.y)), { kind: 'line', a: base, b: cur, label: fmt(dist(base, cur)), dashed: true }]
    }
  }
}

// ---------------------------------------------------------------- rotate
export function rotateWallsTool(): Tool | null {
  const ws = needSelection()
  if (!ws) return null
  let pivot: Vec2 | null = null, cur: Vec2 | null = null
  const apply = (ang: number) => {
    const f = rotateAbout(pivot!, ang)
    const ids = new Set(ws.map(w => w.id))
    setWalls(t('cmd.modify.rotate'), all => all.map(w => (ids.has(w.id) ? transformWall(w, f, false, false) : w)))
    store.log(t('tool.rot.done', { a: ((ang * 180) / Math.PI).toFixed(2) }))
    tools.finish()
  }
  return {
    id: 'modify.rotate',
    basePoint: () => pivot,
    start: () => prompt(t('tool.rot.pivot')),
    pick(p) {
      if (!pivot) { pivot = p; prompt(t('tool.rotw.angle'), true); return }
      apply(Math.atan2(p.y - pivot.y, p.x - pivot.x))
    },
    move(p) { cur = p },
    input(text) {
      if (!pivot) return false
      const deg = parseFloat(text.replace(',', '.'))
      if (!Number.isFinite(deg)) return false
      apply((deg * Math.PI) / 180)
      return true
    },
    overlay() {
      if (!pivot || !cur) return []
      const ang = Math.atan2(cur.y - pivot.y, cur.x - pivot.x)
      return [...ghost(ws, rotateAbout(pivot, ang)), { kind: 'line', a: pivot, b: cur, label: `${((ang * 180) / Math.PI).toFixed(1)}°`, dashed: true }]
    }
  }
}

// ---------------------------------------------------------------- mirror
export function mirrorWallsTool(): Tool | null {
  const ws = needSelection()
  if (!ws) return null
  let p1: Vec2 | null = null, cur: Vec2 | null = null
  return {
    id: 'modify.mirror',
    basePoint: () => p1,
    start: () => prompt(t('tool.mirror.p1')),
    pick(p) {
      if (!p1) { p1 = p; prompt(t('tool.mirror.p2')); return }
      if (dist(p1, p) < 1e-6) return
      const f = mirrorAcross(p1, p)
      const copies = ws.map(w => transformWall(w, f, true, true))
      setWalls(t('cmd.modify.mirror'), all => [...all, ...copies])
      store.setUI({ selectedWallIds: copies.map(c => c.id) })
      tools.finish()
    },
    move(p) { cur = p },
    overlay() {
      if (!p1 || !cur || dist(p1, cur) < 1e-6) return []
      return [...ghost(ws, mirrorAcross(p1, cur)), { kind: 'line', a: p1, b: cur, dashed: true }]
    }
  }
}

// ---------------------------------------------------------------- offset
export function offsetTool(): Tool {
  let d: number | null = null, target: Wall | null = null, cur: Vec2 | null = null
  return {
    id: 'modify.offset',
    basePoint: () => null,
    start: () => prompt(t('tool.offset.dist', { u: unit() }), true),
    input(text) {
      if (d !== null) return false
      const L = parseLength(text, unit())
      if (L == null) { store.log(t('tool.cal.invalid'), 'warn'); return true }
      d = L
      prompt(t('tool.offset.pick'))
      return true
    },
    pick(p) {
      if (d === null) return
      if (!target) {
        target = wallAt(p)
        if (target) prompt(t('tool.offset.side'))
        return
      }
      const w = target
      const side = Math.sign((w.b.x - w.a.x) * (p.y - w.a.y) - (w.b.y - w.a.y) * (p.x - w.a.x)) || 1
      const nw = offsetWall(w, side * d)
      setWalls(t('cmd.modify.offset'), all => [...all, nw])
      target = null
      prompt(t('tool.offset.pick')) // repeat like AutoCAD
    },
    move(p) { cur = p },
    overlay() {
      if (!target || !cur || d === null) return []
      const w = target
      const side = Math.sign((w.b.x - w.a.x) * (cur.y - w.a.y) - (w.b.y - w.a.y) * (cur.x - w.a.x)) || 1
      const nw = offsetWall(w, side * d)
      return [{ kind: 'line', a: nw.a, b: nw.b, dashed: true, label: fmt(d) }]
    }
  }
}

// ---------------------------------------------------------------- split / trim / extend (pick walls)
function pickTool(id: string, promptKey: Parameters<typeof t>[0], act: (w: Wall, p: Vec2) => boolean): Tool {
  let hover: Wall | null = null
  return {
    id,
    basePoint: () => null,
    start: () => prompt(t(promptKey)),
    pick(p) {
      const w = wallAt(p)
      if (!w) return
      if (!act(w, p)) store.log(t('tool.pick.nothing'), 'warn')
    },
    move(p) { hover = wallAt(p) },
    overlay: () => (hover ? [{ kind: 'line', a: hover.a, b: hover.b }] : [])
  }
}

/** Faces and end caps of every other wall on the level: TRIM cutting edges / EXTEND boundaries. */
function cutters(w: Wall) {
  const polys = wallPolygons(lvl().walls, store.get().project.library)
  polys.delete(w.id)
  return footprintSegs(polys.values())
}

export const splitTool = () => pickTool('modify.split', 'tool.split.pick', (w, p) => {
  const r = splitWall(w, p)
  if (!r) return false
  setWalls(t('cmd.modify.split'), all => all.flatMap(x => (x.id === w.id ? r : [x])))
  return true
})

export const trimTool = () => pickTool('modify.trim', 'tool.trim.pick', (w, p) => {
  const r = trimWall(w, cutters(w), p)
  if (!r) return false
  setWalls(t('cmd.modify.trim'), all => all.flatMap(x => (x.id === w.id ? r : [x])))
  return true
})

export const extendTool = () => pickTool('modify.extend', 'tool.extend.pick', (w, p) => {
  const r = extendWall(w, cutters(w), p)
  if (!r) return false
  setWalls(t('cmd.modify.extend'), all => all.map(x => (x.id === w.id ? r : x)))
  return true
})

// ---------------------------------------------------------------- doors & windows
export function openingTool(kind: OpeningKind): Tool {
  let preview: { w: Wall; o: Opening } | null = null
  const proto = (): Omit<Opening, 'id' | 'offset'> => {
    const ui = store.get().ui
    return kind === 'door'
      ? { kind, width: ui.doorDefaults.width, height: ui.doorDefaults.height, sill: 0, hinge: 'start', swing: 'left', U: ui.doorDefaults.U }
      : { kind, width: ui.windowDefaults.width, height: ui.windowDefaults.height, sill: ui.windowDefaults.sill, hinge: 'start', swing: 'left', U: ui.windowDefaults.U }
  }
  const build = (p: Vec2) => {
    const w = wallAt(p, 0.6)
    if (!w) return null
    const o = placeOpening(w, p, proto())
    if (!o) return null
    // Door swing towards the side the cursor is on; hinge at the nearer end.
    const side = (w.b.x - w.a.x) * (p.y - w.a.y) - (w.b.y - w.a.y) * (p.x - w.a.x)
    o.swing = side >= 0 ? 'left' : 'right'
    o.hinge = paramOf(w, p) * wallLength(w) < o.offset ? 'start' : 'end'
    return { w, o }
  }
  return {
    id: kind === 'door' ? 'build.door' : 'build.window',
    basePoint: () => null,
    start: () => prompt(t(kind === 'door' ? 'tool.door.pick' : 'tool.window.pick')),
    pick(p) {
      const r = build(p)
      if (!r) { store.log(t('tool.opening.noWall'), 'warn'); return }
      if (openingOverlaps(r.w, r.o)) { store.log(t('tool.opening.overlap'), 'warn'); return }
      setWalls(t(kind === 'door' ? 'cmd.build.door' : 'cmd.build.window'),
        all => all.map(x => (x.id === r.w.id ? { ...x, openings: [...(x.openings ?? []), r.o] } : x)))
    },
    move(p) { preview = build(p) },
    overlay() {
      if (!preview) return []
      const { w, o } = preview
      const lib = store.get().project.library
      const d = { x: (w.b.x - w.a.x) / wallLength(w), y: (w.b.y - w.a.y) / wallLength(w) }, n = { x: -d.y, y: d.x }
      const { L, R } = faceOffsets(w.justification, wallThickness(w, lib))
      const P = (s: number, off: number) => ({ x: w.a.x + d.x * s + n.x * off, y: w.a.y + d.y * s + n.y * off })
      const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2
      return [
        { kind: 'poly', pts: [P(s0, L), P(s1, L), P(s1, R), P(s0, R)] },
        { kind: 'line', a: P(s0, L + 0.25), b: P(s1, L + 0.25), label: `${fmt(o.width)} · ${fmt(o.offset - o.width / 2)}` }
      ]
    }
  }
}

// ---------------------------------------------------------------- instant commands
export function flipSelected() {
  const ws = needSelection()
  if (!ws) return
  const ids = new Set(ws.map(w => w.id))
  setWalls(t('cmd.modify.flip'), all => all.map(w => {
    if (!ids.has(w.id)) return w
    const j = w.justification === 'left' ? 'right' : w.justification === 'right' ? 'left' : 'center'
    return { ...w, justification: j, openings: (w.openings ?? []).map(o => ({ ...o, swing: o.swing === 'left' ? 'right' : 'left' })) }
  }))
}

export function selectAllWalls() {
  store.setUI({ selectedWallIds: lvl().walls.map(w => w.id), selectedOpeningId: null, selectedUnderlayId: null })
  emitBus('overlay')
}
