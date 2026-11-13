// Room / footprint detection by rasterising wall footprints and flood-filling free space.
// Robust against imperfect joins: any gap smaller than ~2 cells still closes the room.
import type { Vec2 } from './types'

export interface Raster {
  w: number; h: number; cell: number; ox: number; oy: number
  solid: Uint8Array // 1 = wall
}

const MAX_CELLS = 2_500_000

export function rasterize(polys: Vec2[][], cell = 0.025, margin = 1): Raster | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of polys) for (const v of p) {
    if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y; if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y
  }
  if (!Number.isFinite(minX)) return null
  minX -= margin; minY -= margin; maxX += margin; maxY += margin
  while (((maxX - minX) / cell) * ((maxY - minY) / cell) > MAX_CELLS) cell *= 1.5
  const w = Math.ceil((maxX - minX) / cell), h = Math.ceil((maxY - minY) / cell)
  const solid = new Uint8Array(w * h)
  for (const poly of polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const v of poly) { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y) }
    const i0 = Math.max(0, Math.floor((x0 - minX) / cell) - 1), i1 = Math.min(w - 1, Math.ceil((x1 - minX) / cell) + 1)
    const j0 = Math.max(0, Math.floor((y0 - minY) / cell) - 1), j1 = Math.min(h - 1, Math.ceil((y1 - minY) / cell) + 1)
    for (let j = j0; j <= j1; j++) {
      const y = minY + (j + 0.5) * cell
      // scanline crossings (works for any simple polygon)
      const xs: number[] = []
      for (let k = 0, l = poly.length - 1; k < poly.length; l = k++) {
        const a = poly[k], b = poly[l]
        if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // dilate by half a cell so touching walls seal against each other
        const a = Math.max(i0, Math.floor((xs[k] - minX) / cell - 0.5)), b = Math.min(i1, Math.ceil((xs[k + 1] - minX) / cell - 0.5))
        for (let i = a; i <= b; i++) solid[j * w + i] = 1
      }
    }
  }
  return { w, h, cell, ox: minX, oy: minY, solid }
}

export interface Region { mask: Uint8Array; count: number; touchesBorder: boolean }

export function cellOf(r: Raster, p: Vec2): number {
  const i = Math.floor((p.x - r.ox) / r.cell), j = Math.floor((p.y - r.oy) / r.cell)
  if (i < 0 || j < 0 || i >= r.w || j >= r.h) return -1
  return j * r.w + i
}

export function flood(r: Raster, start: number, visited?: Uint8Array): Region | null {
  if (start < 0 || r.solid[start]) return null
  const mask = new Uint8Array(r.w * r.h)
  const stack = [start]
  mask[start] = 1
  let count = 0, touches = false
  while (stack.length) {
    const c = stack.pop()!
    count++
    if (visited) visited[c] = 1
    const i = c % r.w, j = (c / r.w) | 0
    if (i === 0 || j === 0 || i === r.w - 1 || j === r.h - 1) touches = true
    const nb = [i > 0 ? c - 1 : -1, i < r.w - 1 ? c + 1 : -1, j > 0 ? c - r.w : -1, j < r.h - 1 ? c + r.w : -1]
    for (const n of nb) if (n >= 0 && !mask[n] && !r.solid[n]) { mask[n] = 1; stack.push(n) }
  }
  return { mask, count, touchesBorder: touches }
}

/** Outer boundary of a region mask as a polygon (world coords), traced along cell edges then simplified. */
export function contour(r: Raster, mask: Uint8Array, tol?: number): Vec2[] {
  const { w, h } = r
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < w && j < h ? mask[j * w + i] : 0)
  // Find the lowest-left boundary cell, then walk the outer edge (square tracing on the corner lattice).
  let si = -1, sj = -1
  outer: for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (mask[j * w + i]) { si = i; sj = j; break outer }
  if (si < 0) return []
  // Corner-lattice walk keeping the region on the left. dirs: 0 +x, 1 +y, 2 −x, 3 −y
  const pts: [number, number][] = []
  let x = si, y = sj, dir = 0
  const startX = x, startY = y
  let guard = 0
  do {
    pts.push([x, y])
    // cells adjacent to the corner (x,y) in walking frame
    const left = (d: number) => {
      // cell to the left-front of the current edge
      switch (d) { case 0: return at(x, y); case 1: return at(x - 1, y); case 2: return at(x - 1, y - 1); default: return at(x, y - 1) }
    }
    const right = (d: number) => {
      switch (d) { case 0: return at(x, y - 1); case 1: return at(x, y); case 2: return at(x - 1, y); default: return at(x - 1, y - 1) }
    }
    // turn preference: right turn if the right-front cell is inside, straight if left inside, else left turn
    if (right(dir)) dir = (dir + 3) % 4
    else if (!left(dir)) dir = (dir + 1) % 4
    if (dir === 0) x++; else if (dir === 1) y++; else if (dir === 2) x--; else y--
    if (++guard > 4 * w * h) break
  } while (x !== startX || y !== startY)
  const world = pts.map(([i, j]) => ({ x: r.ox + i * r.cell, y: r.oy + j * r.cell }))
  return simplify(world, tol ?? r.cell * 1.6)
}

/** Douglas–Peucker on a closed ring. */
export function simplify(ring: Vec2[], tol: number): Vec2[] {
  if (ring.length < 4) return ring
  // split the ring at the two farthest-apart points
  let far = 0, fd = 0
  for (let i = 1; i < ring.length; i++) { const d = (ring[i].x - ring[0].x) ** 2 + (ring[i].y - ring[0].y) ** 2; if (d > fd) { fd = d; far = i } }
  const dp = (pts: Vec2[]): Vec2[] => {
    if (pts.length < 3) return pts
    const a = pts[0], b = pts[pts.length - 1]
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1
    let idx = 0, md = 0
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / L
      if (d > md) { md = d; idx = i }
    }
    if (md <= tol) return [a, b]
    const l = dp(pts.slice(0, idx + 1)), r = dp(pts.slice(idx))
    return [...l.slice(0, -1), ...r]
  }
  const first = dp(ring.slice(0, far + 1))
  const second = dp([...ring.slice(far), ring[0]])
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}

export function polygonArea(p: Vec2[]): number {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x + p[i].x) * (p[j].y - p[i].y)
  return Math.abs(a) / 2
}

export function centroid(p: Vec2[]): Vec2 {
  let cx = 0, cy = 0, a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j].x * p[i].y - p[i].x * p[j].y
    cx += (p[j].x + p[i].x) * f; cy += (p[j].y + p[i].y) * f; a += f
  }
  if (Math.abs(a) < 1e-12) return p[0]
  return { x: cx / (3 * a), y: cy / (3 * a) }
}

/** A point well inside a region (cell farthest from the boundary, approximated by a few erosion passes). */
export function interiorPoint(r: Raster, mask: Uint8Array): Vec2 {
  let cur = mask
  let last = -1
  for (let k = 0; k < 400; k++) {
    const next = new Uint8Array(cur.length)
    let any = -1
    for (let c = 0; c < cur.length; c++) {
      if (!cur[c]) continue
      const i = c % r.w
      if (i > 0 && i < r.w - 1 && cur[c - 1] && cur[c + 1] && cur[c - r.w] && cur[c + r.w]) { next[c] = 1; any = c }
    }
    if (any < 0) break
    last = any
    cur = next
  }
  if (last < 0) last = mask.indexOf(1)
  const i = last % r.w, j = (last / r.w) | 0
  return { x: r.ox + (i + 0.5) * r.cell, y: r.oy + (j + 0.5) * r.cell }
}

/** All enclosed free regions (rooms) of a raster, as polygons with an interior seed point. */
export function enclosedRegions(r: Raster, minArea = 1): { polygon: Vec2[]; seed: Vec2; area: number }[] {
  const visited = new Uint8Array(r.w * r.h)
  const out: { polygon: Vec2[]; seed: Vec2; area: number }[] = []
  for (let c = 0; c < r.solid.length; c++) {
    if (visited[c] || r.solid[c]) continue
    const reg = flood(r, c, visited)
    if (!reg || reg.touchesBorder) continue
    const polygon = contour(r, reg.mask)
    const area = polygonArea(polygon)
    if (area < minArea) continue
    out.push({ polygon, seed: interiorPoint(r, reg.mask), area })
  }
  return out
}

/** Building footprint: everything not reachable from outside. */
export function footprint(r: Raster): Vec2[] {
  const outside = flood(r, 0)
  if (!outside) return []
  const inside = new Uint8Array(r.w * r.h)
  for (let c = 0; c < inside.length; c++) inside[c] = outside.mask[c] ? 0 : 1
  return contour(r, inside)
}
