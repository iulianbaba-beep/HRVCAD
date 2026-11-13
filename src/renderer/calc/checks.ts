// Model consistency checks (beyond the hydraulic analysis): connections, systems, heights, building envelope.
import type { Project, Vec2 } from '../core/types'
import { connectorsOf, freeEnds } from '../core/hvacGeom'
import { levelFootprint, roomGeometry } from '../core/rooms'
import { closestOnSegment, wallThickness } from '../core/walls'
import type { AirflowResult } from './airflow'
import type { NetworkResult } from './network'

export interface Check { kind: string; id?: string; detail?: string; severity: 'error' | 'warn' | 'info' }

function inPoly(p: Vec2, poly: Vec2[]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

/** Walls whose type is "interior" but which sit on the outer boundary of the building. */
export function facadeWalls(p: Project, levelId: string): Set<string> {
  const level = p.levels.find(l => l.id === levelId)
  const out = new Set<string>()
  if (!level) return out
  const fp = levelFootprint(level, p.library)
  if (fp.length < 3) return out
  for (const w of level.walls) {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
    if (L < 0.2) continue
    const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }
    const n = { x: -(w.b.y - w.a.y) / L, y: (w.b.x - w.a.x) / L }
    const d = wallThickness(w, p.library) + 0.2
    const outside = !inPoly({ x: m.x + n.x * d, y: m.y + n.y * d }, fp) || !inPoly({ x: m.x - n.x * d, y: m.y - n.y * d }, fp)
    if (outside) out.add(w.id)
  }
  return out
}

export function modelChecks(p: Project, air: AirflowResult, net: NetworkResult): Check[] {
  const out: Check[] = []
  const h = p.hvac
  // 1. Duct ends: free, wrong system, or at the wrong height
  for (const d of h.ducts) {
    if (freeEnds(h, d).length) out.push({ kind: 'freeEnd', id: d.id, severity: 'error' })
    const cons = connectorsOf(h, d.levelId)
    for (const e of [d.pts[0], d.pts[d.pts.length - 1]]) {
      for (const c of cons) {
        const tol = c.kind === 'plenum' ? 0.35 : 0.16
        if (Math.hypot(c.p.x - e.x, c.p.y - e.y) > tol) continue
        if (c.system !== d.system) out.push({ kind: 'systemMismatch', id: d.id, detail: c.system, severity: 'error' })
        else if (c.kind !== 'plenum' && Math.abs(c.z - e.z) > 0.1) out.push({ kind: 'zGap', id: d.id, detail: `${Math.abs(c.z - e.z).toFixed(2)}`, severity: 'error' })
      }
    }
  }
  // 2. Outdoor-air intake / exhaust grilles
  for (const sys of ['outdoor', 'exhaust'] as const) {
    if (h.units.length && !h.terminals.some(t => t.system === sys)) out.push({ kind: 'missingGrille', detail: sys, severity: 'error' })
  }
  // 3. Plenums: one per system, and every plenum fed from the unit
  for (const sys of ['supply', 'extract'] as const) {
    const n = h.plenums.filter(x => x.system === sys).length
    const radial = h.ducts.some(d => d.system === sys && p.library.hvac.ductMaterials.find(m => m.id === d.materialId)?.kind === 'semirigid')
    if (radial && n === 0) out.push({ kind: 'missingPlenum', detail: sys, severity: 'warn' })
  }
  // 4. Rooms with a design flow but no terminal of that system
  for (const rf of air.rooms) {
    const terms = net.terminals.filter(t => t.roomId === rf.roomId)
    if (rf.supply > 0.5 && !terms.some(t => t.system === 'supply')) out.push({ kind: 'roomNoSupply', id: rf.roomId, detail: rf.name, severity: 'warn' })
    if (rf.extract > 0.5 && !terms.some(t => t.system === 'extract')) out.push({ kind: 'roomNoExtract', id: rf.roomId, detail: rf.name, severity: 'warn' })
  }
  // 5. Unit location
  for (const u of h.units) {
    const level = p.levels.find(l => l.id === u.levelId)
    if (!level) continue
    const geo = roomGeometry(level, p.library)
    const r = level.rooms.find(x => { const g = geo.get(x.id); return g && inPoly(u.pos, g.polygon) })
    if (r && ['bedroom', 'kids', 'guest', 'living', 'livingKitchen', 'study'].includes(r.type)) out.push({ kind: 'unitInHabitable', detail: r.name, severity: 'warn' })
  }
  // 6. Envelope
  for (const level of p.levels) {
    const fac = facadeWalls(p, level.id)
    for (const w of level.walls) {
      if (!fac.has(w.id)) continue
      if (p.library.wallTypes.find(t => t.id === w.typeId)?.category === 'interior') out.push({ kind: 'facadeInterior', id: w.id, detail: level.name, severity: 'warn' })
    }
    const above = p.levels.filter(l => l.elevation > level.elevation + 0.01).sort((a, b) => a.elevation - b.elevation)[0]
    if (above && !above.walls.length && !above.rooms.length && level.ceilingTypeId == null && level.rooms.length) {
      out.push({ kind: 'emptyLevelAbove', detail: `${above.name}|${level.name}`, severity: 'warn' })
    }
    for (const u of level.underlays) if (!u.calibrated && u.visible) out.push({ kind: 'uncalibrated', detail: u.name, severity: 'info' })
  }
  void closestOnSegment
  return out
}
