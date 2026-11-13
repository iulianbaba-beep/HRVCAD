// Air distribution network analysis (EPANET-like for air): tree solve from the unit ports to the terminals,
// friction (Colebrook–White via Swamee–Jain), local losses, operating point on the fan curve, balancing.
import type { AirSystem, Duct, DuctMaterial, DuctSize, HrvUnitType, HvacUnit, Level, Project, Terminal, TerminalType, Vec2 } from '../core/types'
import { roomGeometry } from '../core/rooms'
import type { AirflowResult } from './airflow'

export const RHO = 1.2 // kg/m³
export const NU = 1.5e-5 // m²/s

export function sizeArea(s: DuctSize): number {
  if (s.d) return (Math.PI * s.d * s.d) / 4
  return (s.w ?? 0.1) * (s.h ?? 0.1)
}
export function hydraulicDiameter(s: DuctSize): number {
  if (s.d) return s.d
  const w = s.w ?? 0.1, h = s.h ?? 0.1
  return (2 * w * h) / (w + h)
}

/** Darcy friction factor (Swamee–Jain explicit approximation of Colebrook–White; laminar 64/Re). */
export function frictionFactor(Re: number, relRough: number): number {
  if (Re < 1) return 0
  if (Re < 2300) return 64 / Re
  return 0.25 / Math.pow(Math.log10(relRough / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2)
}

/** Pressure drop per metre, Pa/m, for flow q (m³/h) in a duct of given size and roughness (mm). */
export function frictionGradient(q: number, size: DuctSize, roughnessMm: number): { R: number; v: number; Re: number } {
  const A = sizeArea(size), D = hydraulicDiameter(size)
  const v = q / 3600 / A
  const Re = (v * D) / NU
  const f = frictionFactor(Re, roughnessMm / 1000 / D)
  return { R: (f / D) * (RHO * v * v) / 2, v, Re }
}

export const dynamicPressure = (v: number) => (RHO * v * v) / 2

/** Unit port positions (world) for a unit instance: ODA, EHA on the −x side; SUP, ETA on the +x side. */
export function unitPorts(u: HvacUnit): Record<AirSystem, Vec2> {
  const c = Math.cos(u.rotation), s = Math.sin(u.rotation)
  const P = (x: number, y: number) => ({ x: u.pos.x + c * x - s * y, y: u.pos.y + s * x + c * y })
  return { outdoor: P(-0.35, 0.18), exhaust: P(-0.35, -0.18), supply: P(0.35, 0.18), extract: P(0.35, -0.18) }
}

export const SYSTEMS: AirSystem[] = ['supply', 'extract', 'outdoor', 'exhaust']
const TOL = 0.06 // m, connection tolerance in plan

export interface SegResult {
  ductId: string; index: number; system: AirSystem
  length: number; q: number; v: number; R: number; dpFriction: number; dpLocal: number
  sizeLabel: string; vMax: number; overVelocity: boolean
}
export interface TerminalResult {
  terminalId: string; system: AirSystem; roomId: string | null; q: number; dpTerminal: number
  pathDp: number; throttle: number; connected: boolean; overFlow: boolean
}
export interface SystemResult {
  system: AirSystem; q: number; indexDp: number; indexTerminal: string | null; connected: boolean
}
export interface NetworkResult {
  unit: HvacUnit | null; unitType: HrvUnitType | null
  segments: SegResult[]; terminals: TerminalResult[]; systems: Record<AirSystem, SystemResult>
  /** Required external pressure on the supply side (supply + outdoor) and extract side (extract + exhaust). */
  requiredSupplySide: number; requiredExtractSide: number
  availableSupplySide: number | null; availableExtractSide: number | null
  qSupply: number; qExtract: number
  ok: boolean
  issues: { kind: string; id?: string; detail?: string }[]
}

export function curvePressure(t: HrvUnitType, q: number): number | null {
  const c = [...t.curve].sort((a, b) => a.q - b.q)
  if (!c.length || q > c[c.length - 1].q) return null
  for (let i = 0; i + 1 < c.length; i++) {
    if (q >= c[i].q && q <= c[i + 1].q) return c[i].dp + ((c[i + 1].dp - c[i].dp) * (q - c[i].q)) / (c[i + 1].q - c[i].q || 1)
  }
  return c[0].dp
}

function inPoly(p: Vec2, poly: Vec2[]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

/** Room containing each terminal and the design flow per terminal (room flow shared between its terminals). */
export function terminalFlows(p: Project, air: AirflowResult): Map<string, { q: number; roomId: string | null }> {
  const out = new Map<string, { q: number; roomId: string | null }>()
  const roomOf = new Map<string, string | null>()
  for (const t of p.hvac.terminals) {
    const level = p.levels.find(l => l.id === t.levelId)
    let rid: string | null = null
    if (level) {
      const geo = roomGeometry(level, p.library)
      for (const r of level.rooms) { const g = geo.get(r.id); if (g && inPoly(t.pos, g.polygon)) { rid = r.id; break } }
    }
    roomOf.set(t.id, rid)
  }
  const counts = new Map<string, number>()
  for (const t of p.hvac.terminals) {
    const rid = roomOf.get(t.id)
    if (rid && (t.system === 'supply' || t.system === 'extract') && t.flowOverride == null) counts.set(`${rid}:${t.system}`, (counts.get(`${rid}:${t.system}`) ?? 0) + 1)
  }
  for (const t of p.hvac.terminals) {
    const rid = roomOf.get(t.id) ?? null
    let q = 0
    if (t.flowOverride != null) q = t.flowOverride
    else if (rid && (t.system === 'supply' || t.system === 'extract')) {
      const rf = air.rooms.find(r => r.roomId === rid)
      const overridesInRoom = p.hvac.terminals.filter(x => roomOf.get(x.id) === rid && x.system === t.system && x.flowOverride != null)
        .reduce((s, x) => s + (x.flowOverride ?? 0), 0)
      const total = rf ? (t.system === 'supply' ? rf.supply : rf.extract) : 0
      q = Math.max(0, total - overridesInRoom) / (counts.get(`${rid}:${t.system}`) || 1)
    } else if (t.system === 'outdoor') q = air.supplyTotal
    else if (t.system === 'exhaust') q = air.extractTotal
    out.set(t.id, { q, roomId: rid })
  }
  return out
}

interface Node { key: string; pos: Vec2; edges: number[]; terminal?: Terminal; plenum?: boolean; plenumId?: string; isRoot?: boolean }
interface Edge { a: number; b: number; duct: Duct; index: number; length: number; mat: DuctMaterial; size: DuctSize; bends: number }

export function analyseNetwork(p: Project, air: AirflowResult): NetworkResult {
  const lib = p.library.hvac
  const unit = p.hvac.units[0] ?? null
  const unitType = unit ? lib.units.find(u => u.id === unit.typeId) ?? null : null
  const tflows = terminalFlows(p, air)
  const issues: NetworkResult['issues'] = []
  const segments: SegResult[] = []
  const terminals: TerminalResult[] = []
  const systems = {} as Record<AirSystem, SystemResult>
  const ports = unit ? unitPorts(unit) : null
  const levelOf = (id: string) => p.levels.find(l => l.id === id)

  for (const sys of SYSTEMS) {
    const nodes: Node[] = []
    const edges: Edge[] = []
    const nodeAt = (pos: Vec2, levelId: string): number => {
      for (let i = 0; i < nodes.length; i++) if (nodes[i].key === levelId && Math.hypot(nodes[i].pos.x - pos.x, nodes[i].pos.y - pos.y) < TOL) return i
      nodes.push({ key: levelId, pos, edges: [] })
      return nodes.length - 1
    }
    const ducts = p.hvac.ducts.filter(d => d.system === sys)
    for (const d of ducts) {
      const mat = lib.ductMaterials.find(m => m.id === d.materialId)
      const size = mat?.sizes.find(s => s.id === d.sizeId) ?? mat?.sizes[0]
      if (!mat || !size) { issues.push({ kind: 'ductNoSize', id: d.id }); continue }
      // Split the polyline at every vertex that coincides with another duct's vertex (tees).
      const pts = d.pts
      let start = 0
      let bends = 0
      let len = 0
      for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) + Math.abs(pts[i].z - pts[i - 1].z)
        const isEnd = i === pts.length - 1
        const shared = !isEnd && ducts.some(o => o.id !== d.id && o.pts.some(q => Math.hypot(q.x - pts[i].x, q.y - pts[i].y) < TOL))
          || (!isEnd && p.hvac.terminals.some(t => t.system === sys && Math.hypot(t.pos.x - pts[i].x, t.pos.y - pts[i].y) < TOL))
        if (isEnd || shared) {
          const a = nodeAt(pts[start], d.levelId), b = nodeAt(pts[i], d.levelId)
          if (a !== b) {
            edges.push({ a, b, duct: d, index: edges.length, length: len, mat, size, bends })
            nodes[a].edges.push(edges.length - 1); nodes[b].edges.push(edges.length - 1)
          }
          start = i; len = 0; bends = 0
        } else {
          // bend at interior vertex: add the turned angle in units of 90°
          const u = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y }, w = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y }
          const cos = (u.x * w.x + u.y * w.y) / ((Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y)) || 1)
          bends += Math.acos(Math.max(-1, Math.min(1, cos))) / (Math.PI / 2)
        }
      }
    }
    // Attach terminals and plenums to nodes
    for (const t of p.hvac.terminals.filter(t => t.system === sys)) {
      const i = nodes.findIndex(n => n.key === t.levelId && Math.hypot(n.pos.x - t.pos.x, n.pos.y - t.pos.y) < TOL + 0.1)
      const f = tflows.get(t.id)!
      if (i < 0) { terminals.push({ terminalId: t.id, system: sys, roomId: f.roomId, q: f.q, dpTerminal: 0, pathDp: 0, throttle: 0, connected: false, overFlow: false }); continue }
      nodes[i].terminal = t
    }
    for (const pl of p.hvac.plenums.filter(x => x.system === sys || (sys === 'supply' && x.system === 'supply'))) {
      if (pl.system !== sys) continue
      const i = nodes.findIndex(n => n.key === pl.levelId && Math.hypot(n.pos.x - pl.pos.x, n.pos.y - pl.pos.y) < 0.35)
      if (i >= 0) { nodes[i].plenum = true; nodes[i].plenumId = pl.id }
    }
    // Plenum: every duct ending within the plenum box connects to the same node
    for (const pl of p.hvac.plenums.filter(x => x.system === sys)) {
      const near = nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.key === pl.levelId && Math.hypot(n.pos.x - pl.pos.x, n.pos.y - pl.pos.y) < 0.35)
      if (near.length > 1) {
        const keep = near[0].i
        for (const { i } of near.slice(1)) {
          for (const e of nodes[i].edges) { const E = edges[e]; if (E.a === i) E.a = keep; if (E.b === i) E.b = keep; nodes[keep].edges.push(e) }
          nodes[i].edges = []
        }
        nodes[keep].plenum = true; nodes[keep].plenumId = pl.id
      }
    }
    // Root: the unit port
    let root = -1
    if (ports && unit) {
      const port = ports[sys]
      root = nodes.findIndex(n => n.key === unit.levelId && Math.hypot(n.pos.x - port.x, n.pos.y - port.y) < 0.15)
    }
    const sysRes: SystemResult = { system: sys, q: 0, indexDp: 0, indexTerminal: null, connected: root >= 0 }
    systems[sys] = sysRes
    if (root < 0) {
      for (const n of nodes) if (n.terminal) {
        const f = tflows.get(n.terminal.id)!
        terminals.push({ terminalId: n.terminal.id, system: sys, roomId: f.roomId, q: f.q, dpTerminal: 0, pathDp: 0, throttle: 0, connected: false, overFlow: false })
      }
      if (ducts.length || p.hvac.terminals.some(t => t.system === sys)) issues.push({ kind: 'noUnitConnection', detail: sys })
      continue
    }
    // BFS tree from the root
    const parentEdge = new Array(nodes.length).fill(-1)
    const order: number[] = []
    const seen = new Uint8Array(nodes.length)
    seen[root] = 1
    const queue = [root]
    while (queue.length) {
      const n = queue.shift()!
      order.push(n)
      for (const e of nodes[n].edges) {
        const E = edges[e]
        const m = E.a === n ? E.b : E.a
        if (seen[m]) { if (parentEdge[n] !== e) issues.push({ kind: 'loop', id: E.duct.id }); continue }
        seen[m] = 1; parentEdge[m] = e; queue.push(m)
      }
    }
    // Flows: post-order accumulation of terminal flows
    const nodeQ = new Array(nodes.length).fill(0)
    for (let k = order.length - 1; k >= 0; k--) {
      const n = order[k]
      if (nodes[n].terminal) nodeQ[n] += tflows.get(nodes[n].terminal!.id)!.q
      const e = parentEdge[n]
      if (e >= 0) { const E = edges[e]; const par = E.a === n ? E.b : E.a; nodeQ[par] += nodeQ[n] }
    }
    sysRes.q = nodeQ[root]
    // Pressure along the tree (pre-order)
    const nodeP = new Array(nodes.length).fill(0)
    const edgeDir = (e: number, from: number) => {
      const E = edges[e]
      const to = E.a === from ? E.b : E.a
      return { x: nodes[to].pos.x - nodes[from].pos.x, y: nodes[to].pos.y - nodes[from].pos.y }
    }
    for (const n of order) {
      const e = parentEdge[n]
      if (e < 0) continue
      const E = edges[e]
      const par = E.a === n ? E.b : E.a
      const q = nodeQ[n]
      const { R, v } = frictionGradient(q, E.size, E.mat.roughness)
      const dpF = R * E.length
      let zeta = E.bends * E.mat.zetaBend90
      // Junction at the parent: tee (branch or through) or plenum
      const pe = parentEdge[par]
      const children = nodes[par].edges.filter(x => x !== pe).length
      if (nodes[par].plenum) {
        // plenum loss counted once per path below
      } else if (children > 1 || (pe >= 0 && children >= 1 && nodes[par].edges.length > 2)) {
        const din = pe >= 0 ? edgeDir(pe, edges[pe].a === par ? edges[pe].b : edges[pe].a) : null
        const dout = edgeDir(e, par)
        const straight = din ? Math.abs((din.x * dout.x + din.y * dout.y) / ((Math.hypot(din.x, din.y) * Math.hypot(dout.x, dout.y)) || 1)) > 0.85 : false
        zeta += straight ? E.mat.zetaTeeThrough : E.mat.zetaTeeBranch
      }
      const dpL = zeta * dynamicPressure(v)
      let dpPlenum = 0
      if (nodes[par].plenum) {
        const pl = p.hvac.plenums.find(x => x.id === nodes[par].plenumId)
        const pt = pl && lib.plenums.find(x => x.id === pl.typeId)
        if (pt) dpPlenum = pt.dpRef * Math.pow(nodeQ[par] / pt.qRef, 2)
      }
      nodeP[n] = nodeP[par] + dpF + dpL + dpPlenum
      segments.push({
        ductId: E.duct.id, index: E.index, system: sys, length: E.length, q, v, R, dpFriction: dpF, dpLocal: dpL + dpPlenum,
        sizeLabel: E.size.label, vMax: E.mat.vMax, overVelocity: v > E.mat.vMax + 1e-9
      })
    }
    // Terminals
    const sysTerms: TerminalResult[] = []
    for (let i = 0; i < nodes.length; i++) {
      const t = nodes[i].terminal
      if (!t) continue
      const f = tflows.get(t.id)!
      const tt = lib.terminals.find(x => x.id === t.typeId) as TerminalType | undefined
      const dpT = tt ? tt.dpRef * Math.pow(f.q / tt.qRef, 2) : 0
      const connected = !!seen[i]
      sysTerms.push({ terminalId: t.id, system: sys, roomId: f.roomId, q: f.q, dpTerminal: dpT, pathDp: nodeP[i] + dpT, throttle: 0, connected, overFlow: !!tt && f.q > tt.maxFlow })
      if (!connected) issues.push({ kind: 'terminalNotConnected', id: t.id })
    }
    const idx = sysTerms.filter(t => t.connected).reduce<TerminalResult | null>((m, t) => (!m || t.pathDp > m.pathDp ? t : m), null)
    if (idx) { sysRes.indexDp = idx.pathDp; sysRes.indexTerminal = idx.terminalId }
    for (const t of sysTerms) t.throttle = t.connected ? sysRes.indexDp - t.pathDp : 0
    terminals.push(...sysTerms)
    for (let i = 0; i < nodes.length; i++) if (!seen[i] && nodes[i].edges.length) { issues.push({ kind: 'ductNotConnected', detail: sys }); break }
  }

  const qSupply = Math.max(systems.supply?.q ?? 0, systems.outdoor?.q ?? 0, air.supplyTotal)
  const qExtract = Math.max(systems.extract?.q ?? 0, systems.exhaust?.q ?? 0, air.extractTotal)
  const requiredSupplySide = (systems.supply?.indexDp ?? 0) + (systems.outdoor?.indexDp ?? 0)
  const requiredExtractSide = (systems.extract?.indexDp ?? 0) + (systems.exhaust?.indexDp ?? 0)
  const availableSupplySide = unitType ? curvePressure(unitType, qSupply) : null
  const availableExtractSide = unitType ? curvePressure(unitType, qExtract) : null
  if (!unit) issues.push({ kind: 'noUnit' })
  if (unitType && (availableSupplySide === null || availableExtractSide === null)) issues.push({ kind: 'unitTooSmall' })
  if (availableSupplySide !== null && availableSupplySide < requiredSupplySide) issues.push({ kind: 'pressureSupply' })
  if (availableExtractSide !== null && availableExtractSide < requiredExtractSide) issues.push({ kind: 'pressureExtract' })
  for (const s of segments) if (s.overVelocity) issues.push({ kind: 'velocity', id: s.ductId })
  for (const t of terminals) if (t.overFlow) issues.push({ kind: 'terminalFlow', id: t.terminalId })
  const ok = !issues.some(i => ['unitTooSmall', 'pressureSupply', 'pressureExtract', 'velocity', 'noUnit', 'terminalFlow'].includes(i.kind))
  return { unit, unitType, segments, terminals, systems, requiredSupplySide, requiredExtractSide, availableSupplySide, availableExtractSide, qSupply, qExtract, ok, issues }
}

/** Smallest size of a material whose velocity at flow q stays under vMax (×margin). */
export function pickSize(mat: DuctMaterial, q: number, margin = 0.95): DuctSize {
  const sorted = [...mat.sizes].sort((a, b) => sizeArea(a) - sizeArea(b))
  return sorted.find(s => q / 3600 / sizeArea(s) <= mat.vMax * margin) ?? sorted[sorted.length - 1]
}

/** Auto-size every unlocked duct from the analysed flows (largest flow on any of its segments). */
export function autoSize(p: Project, res: NetworkResult): Map<string, string> {
  const maxQ = new Map<string, number>()
  for (const s of res.segments) maxQ.set(s.ductId, Math.max(maxQ.get(s.ductId) ?? 0, s.q))
  const out = new Map<string, string>()
  for (const d of p.hvac.ducts) {
    if (d.locked) continue
    const mat = p.library.hvac.ductMaterials.find(m => m.id === d.materialId)
    const q = maxQ.get(d.id)
    if (!mat || q == null) continue
    const s = pickSize(mat, q)
    if (s.id !== d.sizeId) out.set(d.id, s.id)
  }
  return out
}

export const levelZ = (l: Level | undefined) => l?.elevation ?? 0
