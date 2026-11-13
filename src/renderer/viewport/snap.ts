// Object snap: points, nearest-on-line, perpendicular, and AutoCAD-style alignment tracking.
import type { Vec2 } from '../core/types'

export type SnapKind = 'end' | 'near' | 'perp' | 'track' | 'none'

export interface SnapResult {
  world: Vec2
  kind: SnapKind
  /** Segment under the cursor (world coords), highlighted as the reference line. */
  seg?: [Vec2, Vec2]
  /** Tracking guides from an acquired point to the snapped point. */
  guides?: [Vec2, Vec2][]
}

export interface SnapSource {
  points: Float64Array // x,y pairs (world)
  segs: Float64Array // x1,y1,x2,y2 (world)
}

export interface SnapQuery {
  cursor: Vec2
  tol: number // world units corresponding to the pixel tolerance
  base: Vec2 | null // tool base point, for perpendicular and tracking
  acquired: Vec2[] // recently hovered snap points (tracking)
  sources: SnapSource[]
}

export function computeSnap(q: SnapQuery): SnapResult {
  const { cursor: c, tol } = q
  // 1. Point snaps (endpoints, midpoints, centres, corners)
  let best = tol * tol, bp: Vec2 | null = null
  for (const s of q.sources) {
    const a = s.points
    for (let i = 0; i < a.length; i += 2) {
      const dx = a[i] - c.x, dy = a[i + 1] - c.y
      const d = dx * dx + dy * dy
      if (d < best) { best = d; bp = { x: a[i], y: a[i + 1] } }
    }
  }
  if (bp) return { world: bp, kind: 'end' }

  // 2. Segment under the cursor → perpendicular from base, else nearest point on it
  let bestSeg: [Vec2, Vec2] | null = null, bestQ: Vec2 | null = null, bd = tol
  for (const s of q.sources) {
    const g = s.segs
    for (let i = 0; i < g.length; i += 4) {
      const ax = g[i], ay = g[i + 1], bx = g[i + 2], by = g[i + 3]
      const abx = bx - ax, aby = by - ay
      const l2 = abx * abx + aby * aby
      if (l2 < 1e-12) continue
      // quick reject by bbox
      if (c.x < Math.min(ax, bx) - bd || c.x > Math.max(ax, bx) + bd || c.y < Math.min(ay, by) - bd || c.y > Math.max(ay, by) + bd) continue
      const t = Math.max(0, Math.min(1, ((c.x - ax) * abx + (c.y - ay) * aby) / l2))
      const qx = ax + abx * t, qy = ay + aby * t
      const d = Math.hypot(c.x - qx, c.y - qy)
      if (d < bd) { bd = d; bestSeg = [{ x: ax, y: ay }, { x: bx, y: by }]; bestQ = { x: qx, y: qy } }
    }
  }
  if (bestSeg && bestQ) {
    if (q.base) {
      const [a, b] = bestSeg
      const abx = b.x - a.x, aby = b.y - a.y
      const l2 = abx * abx + aby * aby
      const t = ((q.base.x - a.x) * abx + (q.base.y - a.y) * aby) / l2
      if (t >= 0 && t <= 1) {
        const foot = { x: a.x + abx * t, y: a.y + aby * t }
        if (Math.hypot(foot.x - c.x, foot.y - c.y) < tol * 3 && Math.hypot(foot.x - q.base.x, foot.y - q.base.y) > tol) {
          return { world: foot, kind: 'perp', seg: bestSeg }
        }
      }
    }
    return { world: bestQ, kind: 'near', seg: bestSeg }
  }

  // 3. Alignment tracking with acquired points (and the base point)
  const refs = q.base ? [q.base, ...q.acquired] : q.acquired
  let vx: Vec2 | null = null, hy: Vec2 | null = null
  let dvx = tol, dhy = tol
  for (const p of refs) {
    const dx = Math.abs(c.x - p.x), dy = Math.abs(c.y - p.y)
    if (dx < dvx) { dvx = dx; vx = p }
    if (dy < dhy) { dhy = dy; hy = p }
  }
  if (vx && hy && vx !== hy) {
    const w = { x: vx.x, y: hy.y }
    return { world: w, kind: 'track', guides: [[vx, w], [hy, w]] }
  }
  if (vx) { const w = { x: vx.x, y: c.y }; return { world: w, kind: 'track', guides: [[vx, w]] } }
  if (hy) { const w = { x: c.x, y: hy.y }; return { world: w, kind: 'track', guides: [[hy, w]] } }
  return { world: c, kind: 'none' }
}
