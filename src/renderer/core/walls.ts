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

/** Clip a convex polygon to the band s0 ≤ dot(p − origin, d) ≤ s1. */
export function clipBand(poly: Vec2[], origin: Vec2, d: Vec2, s0: number, s1: number): Vec2[] {
  const half = (pts: Vec2[], keep: (s: number) => boolean, edge: number): Vec2[] => {
    const out: Vec2[] = []
    const sOf = (p: Vec2) => (p.x - origin.x) * d.x + (p.y - origin.y) * d.y
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length]
      const sp = sOf(p), sq = sOf(q)
      const ip = keep(sp), iq = keep(sq)
      if (ip) out.push(p)
      if (ip !== iq) {
        const t = (edge - sp) / (sq - sp)
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
      }
    }
    return out
  }
  let r = poly
  if (Number.isFinite(s0)) r = half(r, s => s >= s0, s0)
  if (r.length && Number.isFinite(s1)) r = half(r, s => s <= s1, s1)
  return r.length >= 3 ? r : []
}

export interface WallPiece { poly: Vec2[]; z0: number; z1: number }

/** Solid pieces of a wall (footprint + height range) after cutting door/window openings. */
export function wallPieces(w: Wall, poly: Vec2[], height: number): WallPiece[] {
  const ops = [...(w.openings ?? [])].sort((x, y) => x.offset - y.offset)
  if (!ops.length) return [{ poly, z0: 0, z1: height }]
  const d = norm(sub(w.b, w.a))
  const out: WallPiece[] = []
  let s = -Infinity
  for (const o of ops) {
    const o0 = o.offset - o.width / 2, o1 = o.offset + o.width / 2
    const full = clipBand(poly, w.a, d, s, o0)
    if (full.length) out.push({ poly: full, z0: 0, z1: height })
    const mid = clipBand(poly, w.a, d, o0, o1)
    if (mid.length) {
      if (o.sill > 0) out.push({ poly: mid, z0: 0, z1: Math.min(o.sill, height) })
      const head = o.sill + o.height
      if (head < height) out.push({ poly: mid, z0: head, z1: height })
    }
    s = o1
  }
  const tail = clipBand(poly, w.a, d, s, Infinity)
  if (tail.length) out.push({ poly: tail, z0: 0, z1: height })
  return out
}
