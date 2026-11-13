// Design airflows per room and system balance.
import type { NormProfile, Project, Room, RoomRule } from '../core/types'
import { roomGeometry } from '../core/rooms'

export interface RoomFlow {
  roomId: string; levelId: string; name: string; type: Room['type']; area: number
  supply: number; extract: number
  rule: RoomRule
  overridden: boolean
}

export interface AirflowResult {
  profile: NormProfile
  rooms: RoomFlow[]
  area: number // total ventilated floor area A_NE
  qNominal: number | null // DIN formula value
  qExtractMin: number
  qSupplyRaw: number
  qTotal: number // balanced system flow, m³/h
  supplyTotal: number
  extractTotal: number
  notes: string[]
}

/** DIN 1946-6 nominal outdoor air flow for a dwelling of area A (m²). */
export const dinNominal = (A: number, fLst = 1) => fLst * (-0.002 * A * A + 1.15 * A + 11)

const DEFAULT_PERSONS: Partial<Record<Room['type'], number>> = { bedroom: 2, kids: 1, guest: 1 }

export function computeAirflows(p: Project): AirflowResult {
  const profile = p.norms.find(n => n.id === p.settings.ventilationNorm) ?? p.norms[0]
  const notes: string[] = []
  const rooms: RoomFlow[] = []
  for (const level of p.levels) {
    const geo = roomGeometry(level, p.library)
    for (const r of level.rooms) {
      const g = geo.get(r.id)
      rooms.push({
        roomId: r.id, levelId: level.id, name: r.name, type: r.type, area: g?.area ?? r.area,
        supply: 0, extract: 0, rule: profile.rooms[r.type], overridden: false
      })
    }
  }
  const byId = new Map(p.levels.flatMap(l => l.rooms).map(r => [r.id, r]))
  const A = rooms.reduce((s, r) => s + r.area, 0)
  const qExtractMin = rooms.reduce((s, r) => s + (r.rule.extract ?? 0), 0)
  let qNominal: number | null = null
  let qTotal: number

  if (profile.method === 'din1946') {
    qNominal = dinNominal(A, profile.levelFactor)
    qTotal = Math.max(qNominal, qExtractMin)
    const fSum = rooms.reduce((s, r) => s + (r.rule.supplyFactor ?? 0), 0)
    for (const r of rooms) {
      if (r.rule.supplyFactor && fSum > 0) r.supply = (qTotal * r.rule.supplyFactor) / fSum
      if (r.rule.extract && qExtractMin > 0) r.extract = (qTotal * r.rule.extract) / qExtractMin
    }
    if (fSum === 0) notes.push('noSupplyRooms')
    if (qExtractMin === 0) notes.push('noExtractRooms')
  } else {
    for (const r of rooms) {
      const room = byId.get(r.roomId)!
      const persons = room.persons ?? DEFAULT_PERSONS[r.type] ?? 0
      r.supply = (r.rule.supplyFixed ?? 0) + (r.rule.supplyPerM2 ?? 0) * r.area + (r.rule.supplyPerPerson ?? 0) * persons
      r.extract = r.rule.extract ?? 0
    }
    const s = rooms.reduce((a, r) => a + r.supply, 0), e = rooms.reduce((a, r) => a + r.extract, 0)
    qTotal = Math.max(s, e)
    // Balance: scale the smaller side up to the larger
    if (s > 0 && s < qTotal) for (const r of rooms) r.supply *= qTotal / s
    if (e > 0 && e < qTotal) for (const r of rooms) r.extract *= qTotal / e
  }

  // Manual overrides win; report the resulting imbalance.
  for (const r of rooms) {
    const room = byId.get(r.roomId)!
    if (room.supplyOverride != null) { r.supply = room.supplyOverride; r.overridden = true }
    if (room.extractOverride != null) { r.extract = room.extractOverride; r.overridden = true }
  }
  const supplyTotal = rooms.reduce((a, r) => a + r.supply, 0)
  const extractTotal = rooms.reduce((a, r) => a + r.extract, 0)
  if (Math.abs(supplyTotal - extractTotal) > 0.05 * Math.max(supplyTotal, extractTotal, 1)) notes.push('imbalance')
  return {
    profile, rooms, area: A, qNominal, qExtractMin, qSupplyRaw: supplyTotal, qTotal: Math.max(supplyTotal, extractTotal),
    supplyTotal, extractTotal, notes
  }
}
