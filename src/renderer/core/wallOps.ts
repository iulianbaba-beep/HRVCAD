// Pure editing operations on walls (reference-line based, AutoCAD semantics).
import type { Opening, Vec2, Wall } from './types'
import { newId } from './types'
import { add, len, mulv, norm, sub } from './walls'

const EPS = 1e-6

export const wallLength = (w: Wall) => len(sub(w.b, w.a))
export const pointAt = (w: Wall, t: number): Vec2 => add(w.a, mulv(sub(w.b, w.a), t))

/** Parameter t of p projected on the infinite reference line of w (0 at a, 1 at b). */
export function paramOf(w: Wall, p: Vec2): number {
  const ab = sub(w.b, w.a)
  const l2 = ab.x * ab.x + ab.y * ab.y
  return l2 > 0 ? ((p.x - w.a.x) * ab.x + (p.y - w.a.y) * ab.y) / l2 : 0
}

export type Seg = [Vec2, Vec2]

/** Reference lines of walls as cutting/boundary segments. */
export const refSegs = (walls: Wall[]): Seg[] => walls.map(w => [w.a, w.b])

/** Footprint edges (faces and end caps) of walls, from wallPolygons output. */
export const footprintSegs = (polys: Iterable<Vec2[]>): Seg[] => {
  const out: Seg[] = []
  for (const poly of polys) for (let i = 0; i < poly.length; i++) out.push([poly[i], poly[(i + 1) % poly.length]])
  return out
}

/** Params along w's (infinite) reference line where the given segments cross it. */
export function cutParams(w: Wall, segs: Seg[]): number[] {
  const ts: number[] = []
  const d = sub(w.b, w.a)
  for (const [p, q] of segs) {
    const e = sub(q, p)
    const den = d.x * e.y - d.y * e.x
    if (Math.abs(den) < 1e-12) continue
    const r = sub(p, w.a)
    const t = (r.x * e.y - r.y * e.x) / den
    const u = (r.x * d.y - r.y * d.x) / den
    if (u >= -1e-4 && u <= 1 + 1e-4) ts.push(t)
  }
  return ts.sort((x, y) => x - y)
}

/** Re-host openings on a piece [t0,t1] of the original wall; openings not fully inside are dropped. */
function rehost(openings: Opening[] | undefined, L: number, t0: number, t1: number, keepIds: boolean): Opening[] {
  const s0 = t0 * L, s1 = t1 * L
  return (openings ?? [])
    .filter(o => o.offset - o.width / 2 >= s0 - EPS && o.offset + o.width / 2 <= s1 + EPS)
    .map(o => ({ ...o, id: keepIds ? o.id : newId('op'), offset: o.offset - s0 }))
}

/** Sub-wall between params t0 < t1 of w. */
export function piece(w: Wall, t0: number, t1: number, keepId: boolean): Wall {
  return {
    ...w,
    id: keepId ? w.id : newId('wall'),
    a: pointAt(w, t0),
    b: pointAt(w, t1),
    openings: rehost(w.openings, wallLength(w), t0, t1, keepId)
  }
}

/**
 * TRIM (quick mode): remove the portion of w around `pick` bounded by the nearest crossings with other walls.
 * Returns the replacement walls, or null when nothing bounds the picked portion.
 */
export function trimWall(w: Wall, cutters: Seg[], pick: Vec2): Wall[] | null {
  const tp = paramOf(w, pick)
  const cuts = cutParams(w, cutters).filter(t => t > EPS && t < 1 - EPS)
  let lo = 0, hi = 1
  for (const t of cuts) {
    if (t < tp) lo = Math.max(lo, t)
    if (t > tp) hi = Math.min(hi, t)
  }
  if (lo === 0 && hi === 1) return null
  const out: Wall[] = []
  if (lo > EPS) out.push(piece(w, 0, lo, true))
  if (hi < 1 - EPS) out.push(piece(w, hi, 1, out.length === 0))
  return out
}

/**
 * EXTEND (quick mode): lengthen the end of w nearest to `pick` to the first wall its reference line meets.
 * Returns the updated wall or null if there is no boundary in that direction.
 */
export function extendWall(w: Wall, boundaries: Seg[], pick: Vec2): Wall | null {
  const atB = paramOf(w, pick) >= 0.5
  let best: number | null = null
  for (const t of cutParams(w, boundaries)) {
    if (atB && t > 1 + EPS && (best === null || t < best)) best = t
    if (!atB && t < -EPS && (best === null || t > best)) best = t
  }
  if (best === null) return null
  const p = pointAt(w, best)
  const L = wallLength(w)
  if (atB) return { ...w, b: p }
  // Extending at a shifts the origin: keep openings in place.
  const shift = -best * L
  return { ...w, a: p, openings: (w.openings ?? []).map(o => ({ ...o, offset: o.offset + shift })) }
}

/** Split w at the projection of p. */
export function splitWall(w: Wall, p: Vec2): [Wall, Wall] | null {
  const t = paramOf(w, p)
  if (t <= EPS || t >= 1 - EPS) return null
  return [piece(w, 0, t, true), piece(w, t, 1, false)]
}

/** Parallel copy of w at signed distance d along its left normal. */
export function offsetWall(w: Wall, d: number): Wall {
  const dir = norm(sub(w.b, w.a))
  const n = { x: -dir.y, y: dir.x }
  return { ...w, id: newId('wall'), a: add(w.a, mulv(n, d)), b: add(w.b, mulv(n, d)), openings: (w.openings ?? []).map(o => ({ ...o, id: newId('op') })) }
}

/** Mirror the wall body to the other side of its reference line. */
export function flipWall(w: Wall): Wall {
  const j = w.justification === 'left' ? 'right' : w.justification === 'right' ? 'left' : 'center'
  return { ...w, justification: j, openings: (w.openings ?? []).map(o => ({ ...o, swing: o.swing === 'left' ? 'right' : 'left' })) }
}

export type PointMap = (p: Vec2) => Vec2

/** Apply a point transform to a wall. `reverses` = true for mirror transforms (keeps faces/swing consistent). */
export function transformWall(w: Wall, f: PointMap, reverses: boolean, newIds: boolean): Wall {
  const a = f(w.a), b = f(w.b)
  const ops = (w.openings ?? []).map(o => ({ ...o, id: newIds ? newId('op') : o.id }))
  if (!reverses) return { ...w, id: newIds ? newId('wall') : w.id, a, b, openings: ops }
  // A mirror flips handedness; swapping the ends restores it, so the justification stays valid.
  const L = wallLength(w)
  return {
    ...w, id: newIds ? newId('wall') : w.id, a: b, b: a,
    openings: ops.map(o => ({ ...o, offset: L - o.offset, hinge: o.hinge === 'start' ? 'end' : 'start' }))
  }
}

export const translate = (dx: number, dy: number): PointMap => p => ({ x: p.x + dx, y: p.y + dy })
export const rotateAbout = (c: Vec2, ang: number): PointMap => {
  const co = Math.cos(ang), si = Math.sin(ang)
  return p => ({ x: c.x + co * (p.x - c.x) - si * (p.y - c.y), y: c.y + si * (p.x - c.x) + co * (p.y - c.y) })
}
export const mirrorAcross = (p1: Vec2, p2: Vec2): PointMap => {
  const d = norm(sub(p2, p1))
  return p => {
    const v = sub(p, p1)
    const k = v.x * d.x + v.y * d.y
    const proj = add(p1, mulv(d, k))
    return { x: 2 * proj.x - p.x, y: 2 * proj.y - p.y }
  }
}

/** Move every wall endpoint coincident with `from` to `to` (keeps joins when stretching). */
export function moveJoinedEndpoints(walls: Wall[], from: Vec2, to: Vec2, tol = 1e-3): Wall[] {
  const near = (p: Vec2) => Math.abs(p.x - from.x) < tol && Math.abs(p.y - from.y) < tol
  return walls.map(w => {
    const ma = near(w.a), mb = near(w.b)
    if (!ma && !mb) return w
    const nw: Wall = { ...w, a: ma ? to : w.a, b: mb ? to : w.b }
    if (ma && w.openings?.length) {
      // Keep openings fixed in the world when the start point moves.
      const d0 = norm(sub(w.b, w.a)), d1 = norm(sub(nw.b, nw.a))
      nw.openings = w.openings.map(o => {
        const pos = add(w.a, mulv(d0, o.offset))
        const v = sub(pos, nw.a)
        return { ...o, offset: v.x * d1.x + v.y * d1.y }
      })
    }
    return nw
  })
}

/** Place a new opening at the projection of p, clamped inside the wall. Returns null if it does not fit. */
export function placeOpening(w: Wall, p: Vec2, proto: Omit<Opening, 'id' | 'offset'>): Opening | null {
  const L = wallLength(w)
  if (proto.width > L - 0.02) return null
  const s = Math.min(L - proto.width / 2 - 0.01, Math.max(proto.width / 2 + 0.01, paramOf(w, p) * L))
  return { ...proto, id: newId('op'), offset: s }
}

/** True if an opening overlaps any other opening on the same wall. */
export function openingOverlaps(w: Wall, o: Opening): boolean {
  return (w.openings ?? []).some(x => x.id !== o.id && Math.abs(x.offset - o.offset) < (x.width + o.width) / 2 - EPS)
}
