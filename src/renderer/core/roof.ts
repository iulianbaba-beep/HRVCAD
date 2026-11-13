// Roof geometry from a convex eave outline with a pitch per edge (0 = gable end / flat edge).
// Each sloped edge defines a plane rising inward; the roof is their lower envelope (equal-slope hip roof
// when all edges are pitched, gable / mono-pitch when some are 0, flat when none are).
import type { Roof, Vec2, Vec3 } from './types'
import { polygonArea } from './regions'

export interface RoofGeom {
  faces: Vec3[][] // sloped faces (convex, CCW from above)
  gables: Vec3[][] // vertical gable-end walls
  flat: Vec3[] | null // flat roof polygon when no edge is pitched
  ridgeZ: number
  area: number // sloped surface area, m²
  footprintArea: number
}

const sgnArea = (p: Vec2[]) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x - p[i].x) * (p[j].y + p[i].y); return a / 2 }

/** Make the outline counter-clockwise. */
export function ccw(outline: Vec2[]): Vec2[] { return sgnArea(outline) < 0 ? [...outline].reverse() : outline }

export function isConvex(p: Vec2[]): boolean {
  let sign = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length]
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cr) < 1e-9) continue
    const s = Math.sign(cr)
    if (sign && s !== sign) return false
    sign = s
  }
  return true
}

/** Clip polygon to {p : g(p) = ax·p.x + ay·p.y + c ≤ 0}. */
function clip(poly: Vec2[], ax: number, ay: number, c: number): Vec2[] {
  const out: Vec2[] = []
  const g = (p: Vec2) => ax * p.x + ay * p.y + c
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    const gp = g(p), gq = g(q)
    if (gp <= 1e-12) out.push(p)
    if ((gp < -1e-12 && gq > 1e-12) || (gp > 1e-12 && gq < -1e-12)) {
      const t = gp / (gp - gq)
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
    }
  }
  return out
}

export function roofGeometry(roof: Roof, floorZ: number): RoofGeom {
  // Slopes are stored per edge of the outline as drawn; keep them paired with their edges when reversing.
  let outline = roof.outline, slopes = roof.slopes
  if (sgnArea(outline) < 0) {
    const n = outline.length
    outline = [...outline].reverse()
    slopes = outline.map((_, i) => roof.slopes[(n - 2 - i + n) % n] ?? 0)
  }
  const z0 = floorZ + roof.eaveHeight
  const n = outline.length
  const planes = outline.map((a, i) => {
    const b = outline[(i + 1) % n]
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L // inward (left) normal for CCW
    const t = Math.tan(((slopes[i] ?? 0) * Math.PI) / 180)
    return { a, nx, ny, t, sloped: (slopes[i] ?? 0) > 0.01 }
  })
  const z = (k: number, p: Vec2) => z0 + planes[k].t * ((p.x - planes[k].a.x) * planes[k].nx + (p.y - planes[k].a.y) * planes[k].ny)
  const sloped = planes.map((p, i) => (p.sloped ? i : -1)).filter(i => i >= 0)
  const footprintArea = polygonArea(outline)
  if (!sloped.length) {
    return { faces: [], gables: [], flat: outline.map(p => ({ ...p, z: z0 })), ridgeZ: z0, area: footprintArea, footprintArea }
  }
  const envelope = (p: Vec2) => Math.min(...sloped.map(k => z(k, p)))
  const faces: Vec3[][] = []
  let area = 0, ridgeZ = z0
  for (const i of sloped) {
    let poly = outline
    for (const k of sloped) {
      if (k === i) continue
      // z_i(p) − z_k(p) ≤ 0, linear in p
      const P = planes[i], Q = planes[k]
      const ax = P.t * P.nx - Q.t * Q.nx, ay = P.t * P.ny - Q.t * Q.ny
      const c = -P.t * (P.a.x * P.nx + P.a.y * P.ny) + Q.t * (Q.a.x * Q.nx + Q.a.y * Q.ny)
      poly = clip(poly, ax, ay, c)
      if (poly.length < 3) break
    }
    if (poly.length < 3) continue
    const f = poly.map(p => ({ x: p.x, y: p.y, z: z(i, p) }))
    faces.push(f)
    area += polygonArea(poly) / Math.cos(Math.atan(planes[i].t))
    for (const v of f) ridgeZ = Math.max(ridgeZ, v.z)
  }
  // Gable walls under non-sloped edges: sample the envelope along the edge at all face-vertex params.
  const gables: Vec3[][] = []
  for (let i = 0; i < n; i++) {
    if (planes[i].sloped) continue
    const a = outline[i], b = outline[(i + 1) % n]
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy
    const ts = new Set<number>([0, 1])
    for (const f of faces) for (const v of f) {
      const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / L2
      const px = a.x + dx * t, py = a.y + dy * t
      if (t > 1e-6 && t < 1 - 1e-6 && Math.hypot(px - v.x, py - v.y) < 1e-6) ts.add(t)
    }
    // also where the envelope changes plane along the edge (ridge meets the gable)
    for (let u = 0; u < sloped.length; u++) for (let w = u + 1; w < sloped.length; w++) {
      const za = (t: number) => z(sloped[u], { x: a.x + dx * t, y: a.y + dy * t }) - z(sloped[w], { x: a.x + dx * t, y: a.y + dy * t })
      const f0 = za(0), f1 = za(1)
      if (f0 * f1 < 0) ts.add(f0 / (f0 - f1))
    }
    const sorted = [...ts].sort((p, q) => p - q)
    const top = sorted.map(t => { const p = { x: a.x + dx * t, y: a.y + dy * t }; return { ...p, z: envelope(p) } })
    if (top.every(v => v.z - z0 < 1e-6)) continue
    gables.push([{ ...a, z: z0 }, { ...b, z: z0 }, ...top.reverse()])
  }
  return { faces, gables, flat: null, ridgeZ, area, footprintArea }
}

/** Convex hull (Andrew's monotone chain), CCW. */
export function convexHull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Vec2[] = [], upper: Vec2[] = []
  for (const v of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], v) <= 0) lower.pop(); lower.push(v) }
  for (const v of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], v) <= 0) upper.pop(); upper.push(v) }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** Offset a convex CCW polygon outward by d. */
export function offsetConvex(p: Vec2[], d: number): Vec2[] {
  const n = p.length
  const lines = p.map((a, i) => {
    const b = p[(i + 1) % n]
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (b.y - a.y) / L, ny = -(b.x - a.x) / L // outward for CCW
    return { a: { x: a.x + nx * d, y: a.y + ny * d }, dx: b.x - a.x, dy: b.y - a.y }
  })
  return lines.map((l, i) => {
    const m = lines[(i + n - 1) % n]
    const den = m.dx * l.dy - m.dy * l.dx
    if (Math.abs(den) < 1e-12) return l.a
    const t = ((l.a.x - m.a.x) * l.dy - (l.a.y - m.a.y) * l.dx) / den
    return { x: m.a.x + m.dx * t, y: m.a.y + m.dy * t }
  })
}
