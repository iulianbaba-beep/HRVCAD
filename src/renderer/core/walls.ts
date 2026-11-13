// Wall footprint geometry: face offsets from the reference line and mitred corners at L-joins.
import type { Library, Vec2, Wall, WallJustification } from './types'
import { wallTypeThickness } from './thermal'

const JOIN_TOL = 1e-3 // m

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const mulv = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
export const len = (a: Vec2) => Math.hypot(a.x, a.y)
export const norm = (a: Vec2): Vec2 => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l } }
export const leftNormal = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x })
const near = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < JOIN_TOL && Math.abs(a.y - b.y) < JOIN_TOL

/** Offsets of the left and right faces from the reference line, measured along the left normal (L ≥ R). */
export function faceOffsets(j: WallJustification, t: number): { L: number; R: number } {
  if (j === 'left') return { L: 0, R: -t }
  if (j === 'right') return { L: t, R: 0 }
  return { L: t / 2, R: -t / 2 }
}

export function wallThickness(w: Wall, lib: Library): number {
  const t = lib.wallTypes.find(x => x.id === w.typeId)
  return t ? wallTypeThickness(t) : 0.25
}

function intersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d.x * e.y - d.y * e.x
  if (Math.abs(den) < 1e-9) return null
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den
  return { x: p.x + d.x * t, y: p.y + d.y * t }
}

/** Faces of a wall seen from endpoint P looking outward along the wall. */
function outwardFaces(w: Wall, atA: boolean, t: number) {
  const d = norm(sub(w.b, w.a))
  const n = leftNormal(d)
  const { L, R } = faceOffsets(w.justification, t)
  const P = atA ? w.a : w.b
  const u = atA ? d : mulv(d, -1)
  const nu = leftNormal(u) // = n if atA else −n
  const [lo, ro] = atA ? [L, R] : [-R, -L]
  return { P, u, left: add(P, mulv(nu, lo)), right: add(P, mulv(nu, ro)), n }
}

/**
 * Footprint polygons [startLeft, endLeft, endRight, startRight] for all walls of a level,
 * with mitred corners where exactly two walls meet at an endpoint.
 */
export function wallPolygons(walls: Wall[], lib: Library): Map<string, Vec2[]> {
  const out = new Map<string, Vec2[]>()
  const th = new Map(walls.map(w => [w.id, wallThickness(w, lib)]))
  for (const w of walls) {
    const t = th.get(w.id)!
    const d = norm(sub(w.b, w.a))
    if (len(sub(w.b, w.a)) < 1e-6) continue
    const n = leftNormal(d)
    const { L, R } = faceOffsets(w.justification, t)
    const poly = [add(w.a, mulv(n, L)), add(w.b, mulv(n, L)), add(w.b, mulv(n, R)), add(w.a, mulv(n, R))]

    for (const atA of [true, false]) {
      const P = atA ? w.a : w.b
      const others: { o: Wall; atA: boolean }[] = []
      for (const o of walls) {
        if (o.id === w.id) continue
        if (near(o.a, P)) others.push({ o, atA: true })
        else if (near(o.b, P)) others.push({ o, atA: false })
      }
      if (others.length !== 1) continue
      const W = outwardFaces(w, atA, t)
      const N = outwardFaces(others[0].o, others[0].atA, th.get(others[0].o.id)!)
      const x1 = intersect(W.left, W.u, N.right, N.u) // W.left meets N.right
      const x2 = intersect(W.right, W.u, N.left, N.u) // W.right meets N.left
      const maxD = 6 * Math.max(t, th.get(others[0].o.id)!)
      if (!x1 || !x2 || len(sub(x1, P)) > maxD || len(sub(x2, P)) > maxD) continue
      // Map outward-frame left/right back to the wall's own polygon slots.
      if (atA) { poly[0] = x1; poly[3] = x2 } else { poly[2] = x1; poly[1] = x2 }
    }
    out.set(w.id, poly)
  }
  return out
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Distance from p to segment ab and the closest point. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { q: Vec2; d: number; t: number } {
  const ab = sub(b, a)
  const l2 = ab.x * ab.x + ab.y * ab.y
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2)) : 0
  const q = { x: a.x + ab.x * t, y: a.y + ab.y * t }
  return { q, d: Math.hypot(p.x - q.x, p.y - q.y), t }
}
