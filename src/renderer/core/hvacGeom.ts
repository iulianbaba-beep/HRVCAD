// Connection geometry of HVAC elements and moves that keep the ductwork attached.
import type { AirSystem, Duct, HvacModel, HvacUnit, Plenum, Terminal, Vec2, Vec3 } from './types'
import { unitPorts } from '../calc/network'

export const UNIT_BOX = { w: 0.7, d: 0.6, h: 0.6 }
/** Spigot height of the unit ports above the unit base (ports on top of a floor-standing unit). */
export const unitPortZ = (u: HvacUnit) => u.z + UNIT_BOX.h + 0.05

export interface Connector { id: string; kind: 'port' | 'plenum' | 'terminal'; system: AirSystem; p: Vec2; z: number }

export function connectorsOf(h: HvacModel, levelId?: string): Connector[] {
  const out: Connector[] = []
  for (const u of h.units) {
    if (levelId && u.levelId !== levelId) continue
    const ports = unitPorts(u)
    for (const s of Object.keys(ports) as AirSystem[]) out.push({ id: u.id, kind: 'port', system: s, p: ports[s], z: unitPortZ(u) })
  }
  for (const pl of h.plenums) if (!levelId || pl.levelId === levelId) out.push({ id: pl.id, kind: 'plenum', system: pl.system, p: pl.pos, z: pl.z })
  for (const t of h.terminals) if (!levelId || t.levelId === levelId) out.push({ id: t.id, kind: 'terminal', system: t.system, p: t.pos, z: t.z })
  return out
}

const near = (a: Vec2, b: Vec2, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) < tol

/** Connector(s) of an element, in world coordinates. */
function elementConnectors(h: HvacModel, id: string): Connector[] {
  return connectorsOf(h).filter(c => c.id === id)
}

/**
 * Apply a change of position/height to a unit, plenum or terminal and drag the attached duct ends along:
 * every duct vertex sitting on one of the element's connectors (in plan) moves with it; a vertex that was at
 * the connector height follows the new height.
 */
export function moveHvacElement(h: HvacModel, id: string, patch: Partial<HvacUnit & Plenum & Terminal>): HvacModel {
  const before = elementConnectors(h, id)
  const next: HvacModel = {
    units: h.units.map(u => (u.id === id ? { ...u, ...patch } as HvacUnit : u)),
    plenums: h.plenums.map(u => (u.id === id ? { ...u, ...patch } as Plenum : u)),
    terminals: h.terminals.map(u => (u.id === id ? { ...u, ...patch } as Terminal : u)),
    ducts: h.ducts
  }
  const after = elementConnectors(next, id)
  const tol = before.some(c => c.kind === 'plenum') ? 0.35 : 0.08
  next.ducts = h.ducts.map(d => {
    let changed = false
    const pts = d.pts.map(q => {
      for (let i = 0; i < before.length; i++) {
        const b = before[i], a = after[i]
        if (!a || !near(q, b.p, tol)) continue
        changed = true
        const nz = Math.abs(q.z - b.z) < 0.02 ? a.z : q.z
        return { x: q.x + (a.p.x - b.p.x), y: q.y + (a.p.y - b.p.y), z: nz }
      }
      return q
    })
    return changed ? { ...d, pts } : d
  })
  return next
}

/**
 * Build the 3D polyline of a new duct drawn at elevation `ductZ`: if it starts or ends on a connector at another
 * height (unit spigot on the floor, ceiling terminal), add the vertical riser/drop so the run really connects.
 */
export function withRisers(plan: Vec2[], ductZ: number, start: Connector | null, end: Connector | null): Vec3[] {
  const pts: Vec3[] = plan.map(p => ({ x: p.x, y: p.y, z: ductZ }))
  if (start && Math.abs(start.z - ductZ) > 0.01) pts.unshift({ x: plan[0].x, y: plan[0].y, z: start.z })
  if (end && Math.abs(end.z - ductZ) > 0.01) pts.push({ x: plan[plan.length - 1].x, y: plan[plan.length - 1].y, z: end.z })
  return pts
}

/** Free (unconnected) ends of a duct: not on a connector and not on another duct of the same system. */
export function freeEnds(h: HvacModel, d: Duct): Vec3[] {
  const cons = connectorsOf(h, d.levelId)
  const out: Vec3[] = []
  for (const e of [d.pts[0], d.pts[d.pts.length - 1]]) {
    const onCon = cons.some(c => near(c.p, e, c.kind === 'plenum' ? 0.35 : 0.16))
    const onDuct = h.ducts.some(o => o.id !== d.id && o.levelId === d.levelId && o.pts.some(q => near(q, e, 0.06)))
    if (!onCon && !onDuct) out.push(e)
  }
  return out
}
