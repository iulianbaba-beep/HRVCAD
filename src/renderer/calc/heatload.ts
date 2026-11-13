// Room heat load — simplified SR EN 12831-1 room method:
//   Φ_HL = Φ_T + Φ_V,  Φ_T = Σ H_T,k · (θint − θe),  Φ_V = 0,34 · q_v · (θint − θsupply)
// Transmission through exterior walls, windows/doors, interior walls to colder rooms, ground floor (f_g1·f_g2),
// ceiling to an unheated attic (b_u) or roof; thermal bridges by ΔU_TB. Infiltration from an air-change rate.
import type { Level, Locality, Project, Room, Vec2, Wall } from '../core/types'
import { roomGeometry } from '../core/rooms'
import { closestOnSegment, faceOffsets, wallPolygons, wallThickness } from '../core/walls'
import { wallTypeU, layersResistance, RS } from '../core/thermal'
import { LOCALITIES } from '../library/defaults'
import type { AirflowResult } from './airflow'
import { facadeWalls } from './checks'

export interface HeatLoadElement { kind: 'wall' | 'window' | 'door' | 'interior' | 'floor' | 'ceiling'; area: number; U: number; dT: number; phi: number; label: string }
export interface RoomHeat {
  roomId: string; name: string; area: number; volume: number; tempInt: number
  elements: HeatLoadElement[]
  phiT: number; phiV: number; phiInf: number; phi: number
  /** Ventilation load without heat recovery, for comparison. */
  phiVnoHRV: number
}
export interface HeatLoadResult {
  locality: Locality; thetaE: number; thetaMean: number
  rooms: RoomHeat[]
  total: number; totalNoHRV: number
  efficiency: number
}

const F_G1 = 1.45 // EN 12831-1 annual temperature variation factor (default)
const B_ATTIC = 0.9 // temperature reduction factor for an unheated attic (default)
const THETA_MEAN = 10 // annual mean outdoor temperature (simplification), °C

function inPoly(p: Vec2, poly: Vec2[]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

export function siteClimate(p: Project): { loc: Locality; thetaE: number } {
  const loc = LOCALITIES.find(l => l.id === p.site.localityId) ?? LOCALITIES[0]
  return { loc, thetaE: p.site.thetaEOverride ?? loc.thetaE }
}

export function computeHeatLoad(p: Project, air: AirflowResult): HeatLoadResult {
  const { loc, thetaE } = siteClimate(p)
  const lib = p.library
  const unit = p.hvac.units[0]
  const eta = unit ? lib.hvac.units.find(u => u.id === unit.typeId)?.efficiency ?? 0 : 0
  const lowest = Math.min(...p.levels.map(l => l.elevation))
  const sortedLevels = [...p.levels].sort((a, b) => a.elevation - b.elevation)
  const rooms: RoomHeat[] = []

  for (const level of p.levels) {
    const geo = roomGeometry(level, lib)
    const polys = wallPolygons(level.walls, lib)
    const roomTemp = (r: Room) => r.tempInt ?? air.profile.rooms[r.type]?.tempInt ?? 20
    const roomAt = (pt: Vec2): Room | null => {
      for (const r of level.rooms) { const g = geo.get(r.id); if (g?.ok && inPoly(pt, g.polygon)) return r }
      return null
    }
    const above = sortedLevels.find(l => l.elevation > level.elevation + 0.01)
    const facade = facadeWalls(p, level.id)
    for (const room of level.rooms) {
      const g = geo.get(room.id)
      if (!g) continue
      const ti = roomTemp(room)
      const H = level.height
      const elements: HeatLoadElement[] = []
      const dTe = ti - thetaE
      // Walk the room boundary; attribute each edge to the nearest wall and look across it.
      const poly = g.polygon
      const usedOpenings = new Set<string>()
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length]
        const L = Math.hypot(b.x - a.x, b.y - a.y)
        if (L < 0.05) continue
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        let wall: Wall | null = null, wd = 0.6
        for (const w of level.walls) {
          const pl = polys.get(w.id)
          if (!pl) continue
          const d = closestOnSegment(mid, w.a, w.b).d - wallThickness(w, lib)
          if (d < wd) { wd = d; wall = w }
        }
        if (!wall) continue
        const wt = lib.wallTypes.find(t => t.id === wall!.typeId)
        if (!wt) continue
        // Point on the other side of the wall
        const dx = b.x - a.x, dy = b.y - a.y
        let nx = dy / L, ny = -dx / L // outward if the polygon is CCW…
        const probeIn = { x: mid.x - nx * 0.05, y: mid.y - ny * 0.05 }
        if (!inPoly(probeIn, poly)) { nx = -nx; ny = -ny }
        const th = wallThickness(wall, lib)
        const across = { x: mid.x + nx * (th + 0.15), y: mid.y + ny * (th + 0.15) }
        const other = roomAt(across)
        // Openings of this wall that lie on this edge
        let openArea = 0
        const wd2 = { x: (wall.b.x - wall.a.x), y: (wall.b.y - wall.a.y) }
        const wl = Math.hypot(wd2.x, wd2.y) || 1
        for (const o of wall.openings ?? []) {
          if (usedOpenings.has(o.id)) continue
          const c = { x: wall.a.x + (wd2.x / wl) * o.offset, y: wall.a.y + (wd2.y / wl) * o.offset }
          const onEdge = closestOnSegment(c, a, b).d < th + 0.2
          if (!onEdge) continue
          usedOpenings.add(o.id)
          const A = o.width * o.height
          openArea += A
          const dT = other ? ti - roomTemp(other) : (wt.category === 'exterior' || facade.has(wall.id) ? dTe : 0)
          if (dT <= 0) continue
          elements.push({ kind: o.kind, area: A, U: o.U, dT, phi: A * o.U * dT, label: o.kind })
        }
        const A = Math.max(0, L * H - openArea)
        if (other) {
          const dT = ti - roomTemp(other)
          if (dT > 0) {
            const U = wallTypeU(wt, lib).U
            elements.push({ kind: 'interior', area: A, U, dT, phi: A * U * dT, label: `${wt.name} → ${other.name}` })
          }
        } else if (wt.category === 'exterior' || facade.has(wall.id)) {
          const U = wallTypeU(wt, lib).U + p.site.thermalBridge
          elements.push({ kind: 'wall', area: A, U, dT: dTe, phi: A * U * dTe, label: wt.name })
        }
      }
      // Floor
      if (level.elevation === lowest && level.slab) {
        const st = lib.slabTypes.find(s => s.id === level.slab!.typeId)
        if (st) {
          const U = 1 / (RS.downward.si + layersResistance(st.layers, lib))
          const fg2 = (ti - THETA_MEAN) / (ti - thetaE)
          const dT = dTe * F_G1 * fg2
          elements.push({ kind: 'floor', area: g.area, U, dT, phi: g.area * U * dT, label: st.name })
        }
      }
      // Ceiling to unheated attic / roof (top level only)
      if (!above && level.ceilingTypeId) {
        const st = lib.slabTypes.find(s => s.id === level.ceilingTypeId)
        if (st) {
          const U = 1 / (RS.upward.si + layersResistance(st.layers, lib) + RS.upward.se) + p.site.thermalBridge
          const b = st.category === 'roof' ? 1 : B_ATTIC
          elements.push({ kind: 'ceiling', area: g.area, U, dT: dTe * b, phi: g.area * U * dTe * b, label: st.name })
        }
      }
      const phiT = elements.reduce((s, e) => s + e.phi, 0)
      const rf = air.rooms.find(r => r.roomId === room.id)
      // Supply air arrives pre-heated by the recovery unit; extract rooms receive transferred room air (no load).
      const qSup = rf?.supply ?? 0
      const phiV = 0.34 * qSup * (1 - eta) * dTe
      const phiVnoHRV = 0.34 * qSup * dTe
      const V = g.area * H
      const phiInf = 0.34 * p.site.infiltrationACH * V * dTe
      rooms.push({ roomId: room.id, name: room.name, area: g.area, volume: V, tempInt: ti, elements, phiT, phiV, phiInf, phi: phiT + phiV + phiInf, phiVnoHRV })
    }
  }
  return {
    locality: loc, thetaE, thetaMean: THETA_MEAN, rooms,
    total: rooms.reduce((s, r) => s + r.phi, 0),
    totalNoHRV: rooms.reduce((s, r) => s + r.phiT + r.phiVnoHRV + r.phiInf, 0),
    efficiency: eta
  }
}
