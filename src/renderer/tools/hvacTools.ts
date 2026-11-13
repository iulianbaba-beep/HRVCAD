// Placement of the HRV unit, plenums, terminals and manual duct routing.
import type { AirSystem, Duct, HvacModel, Vec2, Vec3 } from '../core/types'
import { newId } from '../core/types'
import { activeLevel, store, updateHvac } from '../core/store'
import { dist, formatLength, parseLength } from '../core/geom'
import { roomGeometry, SUPPLY_ROOMS, EXTRACT_ROOMS } from '../core/rooms'
import { closestOnSegment } from '../core/walls'
import { analyse } from '../calc'
import { autoSize, pickSize } from '../calc/network'
import { connectorsOf, withRisers, type Connector } from '../core/hvacGeom'
import { t } from '../i18n'
import { prompt, tools, type OverlayShape, type Tool } from './tool'

const P = () => store.get().project
const ui = () => store.get().ui
const ceilingZ = () => activeLevel().elevation + activeLevel().height
const ductZ = () => ceilingZ() - P().settings.ductBelowCeiling

function inPoly(p: Vec2, poly: Vec2[]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

export function unitTool(): Tool {
  let cur: Vec2 | null = null
  let rotation = 0
  return {
    id: 'hvac.unit',
    basePoint: () => null,
    start: () => prompt(t('tool.unit.pick')),
    pick(p) {
      const u = { id: newId('hru'), typeId: ui().unitTypeId, levelId: activeLevel().id, pos: p, z: activeLevel().elevation, rotation }
      // One unit per project (residential): replace an existing one.
      updateHvac(t('cmd.hvac.unit'), h => ({ ...h, units: [u] }))
      tools.finish()
    },
    move(p) { cur = p },
    input(text) {
      const d = parseFloat(text.replace(',', '.'))
      if (!Number.isFinite(d)) return false
      rotation = (d * Math.PI) / 180
      return true
    },
    overlay(): OverlayShape[] {
      if (!cur) return []
      const c = Math.cos(rotation), s = Math.sin(rotation)
      const R = (x: number, y: number) => ({ x: cur!.x + c * x - s * y, y: cur!.y + s * x + c * y })
      return [{ kind: 'poly', pts: [R(-0.35, -0.3), R(0.35, -0.3), R(0.35, 0.3), R(-0.35, 0.3)] }]
    }
  }
}

export function plenumTool(): Tool {
  // Default to the system that has no plenum yet on this level (one for supply, one for extract).
  const have = new Set(P().hvac.plenums.filter(x => x.levelId === activeLevel().id).map(x => x.system))
  if (have.has(ui().plenumSystem) && !have.has(ui().plenumSystem === 'supply' ? 'extract' : 'supply')) {
    store.setUI({ plenumSystem: ui().plenumSystem === 'supply' ? 'extract' : 'supply' })
  }
  const promptNow = () => prompt(t('tool.plenum.pick', { s: t(`system.${ui().plenumSystem}` as any) }))
  return {
    id: 'hvac.plenum',
    basePoint: () => null,
    start: promptNow,
    pick(p) {
      const pl = { id: newId('pl'), typeId: ui().plenumTypeId, levelId: activeLevel().id, pos: p, z: ductZ(), system: ui().plenumSystem }
      updateHvac(t('cmd.hvac.plenum'), h => ({ ...h, plenums: [...h.plenums, pl] }))
      store.log(t('tool.plenum.added', { s: t(`system.${pl.system}` as any) }))
      tools.finish()
    },
    input(text) {
      const k = text.trim().toUpperCase()
      if (k === 'I' || k === 'R') { store.setUI({ plenumSystem: 'supply' }); promptNow(); return true }
      if (k === 'E' || k === 'X') { store.setUI({ plenumSystem: 'extract' }); promptNow(); return true }
      return false
    },
    overlay: () => []
  }
}

/** Terminal system from the room it is placed in: supply rooms → supply, extract rooms → extract. */
function systemFor(p: Vec2): AirSystem | null {
  const forced = ui().terminalSystem
  if (forced !== 'auto') return forced
  const level = activeLevel()
  const geo = roomGeometry(level, P().library)
  for (const r of level.rooms) {
    const g = geo.get(r.id)
    if (g && inPoly(p, g.polygon)) {
      if (SUPPLY_ROOMS.includes(r.type)) return 'supply'
      if (EXTRACT_ROOMS.includes(r.type)) return 'extract'
      return null
    }
  }
  return null
}

export function terminalTool(): Tool {
  let cur: Vec2 | null = null
  return {
    id: 'hvac.terminal',
    basePoint: () => null,
    start: () => prompt(t('tool.terminal.pick')),
    pick(p) {
      const sys = systemFor(p)
      if (!sys) { store.log(t('tool.terminal.noSystem'), 'warn'); return }
      const lib = P().library.hvac
      const use = sys === 'exhaust' ? 'outdoor' : sys
      const type = lib.terminals.find(x => x.use === use) ?? lib.terminals.find(x => x.use === 'both') ?? lib.terminals[0]
      const z = sys === 'outdoor' || sys === 'exhaust' ? ductZ() : ceilingZ()
      const term = { id: newId('term'), typeId: type.id, levelId: activeLevel().id, pos: p, z, system: sys, flowOverride: null }
      updateHvac(t('cmd.hvac.terminal'), h => ({ ...h, terminals: [...h.terminals, term] }))
      store.log(t('tool.terminal.added', { s: t(`system.${sys}` as any) }))
    },
    move(p) { cur = p },
    overlay: () => (cur ? [{ kind: 'point', p: cur }] : [])
  }
}

/** Connection points a duct may start/end at: unit ports, plenums, terminals, and vertices of other ducts. */
function connectors(): (Connector | { id: string; kind: 'duct'; system: AirSystem; p: Vec2; z: number })[] {
  const h = P().hvac
  const lvl = activeLevel().id
  const out: (Connector | { id: string; kind: 'duct'; system: AirSystem; p: Vec2; z: number })[] = connectorsOf(h, lvl)
  for (const d of h.ducts.filter(x => x.levelId === lvl)) for (const q of d.pts) out.push({ id: d.id, kind: 'duct', system: d.system, p: q, z: q.z })
  return out
}

export function ductTool(): Tool {
  const pts: Vec2[] = []
  let system: AirSystem | null = null
  let cur: Vec2 | null = null
  const near = (p: Vec2) => {
    const cs = connectors()
    // exact connectors first (ports/terminals within 8 cm, plenum body within 35 cm), then duct vertices
    return cs.find(c => c.kind !== 'duct' && c.kind !== 'plenum' && dist(c.p, p) < 0.08)
      ?? cs.find(c => c.kind === 'plenum' && dist(c.p, p) < 0.35)
      ?? cs.find(c => c.kind === 'duct' && dist(c.p, p) < 0.08)
  }
  let startCon: ReturnType<typeof near> = undefined
  let endCon: ReturnType<typeof near> = undefined
  const commit = () => {
    if (pts.length < 2) { pts.length = 0; return }
    let sys = system ?? ui().ductSystem
    // System consistency between the two ends
    const sEnd = endCon && endCon.kind !== 'duct' ? endCon : undefined
    const sStart = startCon && startCon.kind !== 'duct' ? startCon : undefined
    if (sStart && sEnd && sStart.system !== sEnd.system) {
      const h = P().hvac
      const freePlenum = (c: typeof sEnd) => c.kind === 'plenum' && !h.ducts.some(d => d.pts.some(q => dist(q, c.p) < 0.35))
      if (freePlenum(sEnd)) {
        updateHvac(t('res.system'), x => ({ ...x, plenums: x.plenums.map(pl => (pl.id === sEnd.id ? { ...pl, system: sStart.system as 'supply' | 'extract' } : pl)) }))
        store.log(t('tool.duct.plenumSwitched', { s: t(`system.${sStart.system}` as any) }), 'warn')
      } else if (freePlenum(sStart)) {
        updateHvac(t('res.system'), x => ({ ...x, plenums: x.plenums.map(pl => (pl.id === sStart.id ? { ...pl, system: sEnd.system as 'supply' | 'extract' } : pl)) }))
        sys = sEnd.system
        store.log(t('tool.duct.plenumSwitched', { s: t(`system.${sEnd.system}` as any) }), 'warn')
      } else {
        store.log(t('tool.duct.mismatch', { a: t(`system.${sStart.system}` as any), b: t(`system.${sEnd.system}` as any) }), 'error')
        if (P().settings.checkMode === 'strict') { pts.length = 0; system = null; startCon = endCon = undefined; return }
      }
    }
    const mat = P().library.hvac.ductMaterials.find(m => m.id === ui().ductMaterialId) ?? P().library.hvac.ductMaterials[0]
    const z = ductZ()
    const duct: Duct = {
      id: newId('duct'), levelId: activeLevel().id, system: sys, materialId: mat.id,
      sizeId: ui().ductSizeId !== 'auto' && mat.sizes.some(s => s.id === ui().ductSizeId) ? ui().ductSizeId : mat.sizes[0].id,
      pts: withRisers(pts, z, sStart ?? null, sEnd ?? null), locked: ui().ductSizeId !== 'auto'
    }
    let ends = [pts[0], pts[pts.length - 1]]
    updateHvac(t('cmd.hvac.duct'), h => {
      // Ending in the middle of another duct of the same system inserts a vertex there (a tee).
      const ducts = h.ducts.map(d => {
        if (d.system !== sys) return d
        for (const e of ends) {
          for (let i = 0; i + 1 < d.pts.length; i++) {
            const c = closestOnSegment(e, d.pts[i], d.pts[i + 1])
            if (c.d < 0.08 && c.t > 0.001 && c.t < 0.999) {
              const np = [...d.pts]
              np.splice(i + 1, 0, { x: e.x, y: e.y, z: d.pts[i].z })
              d = { ...d, pts: np }
              break
            }
          }
        }
        return d
      })
      return { ...h, ducts: [...ducts, duct] }
    })
    ends = []
    // Size the new ducts from the network flows (unless a size is pinned), strict mode too.
    if (ui().ductSizeId === 'auto') applyAutoSize(false)
    checkStrict()
    pts.length = 0
    system = null
    startCon = endCon = undefined
  }
  return {
    id: 'hvac.duct',
    basePoint: () => pts[pts.length - 1] ?? null,
    start: () => prompt(t('tool.duct.first')),
    pick(p) {
      const c = near(p)
      // Snap onto ports/terminals exactly; on a plenum keep the clicked point inside its body.
      const q = c ? (c.kind === 'plenum' ? p : c.p) : p
      if (!pts.length) { startCon = c; if (c?.system) system = c.system }
      if (pts.length && dist(pts[pts.length - 1], q) < 1e-6) return
      pts.push(q)
      // Reaching a terminal, plenum or unit port ends the run.
      if (pts.length >= 2 && c && c.kind !== 'duct') { endCon = c; commit(); prompt(t('tool.duct.first')); return }
      prompt(t('tool.duct.next', { s: t(`system.${system ?? ui().ductSystem}` as any) }))
    },
    move(p) { cur = p },
    input(text) {
      if (!pts.length || !cur) return false
      const L = parseLength(text, P().settings.displayUnit)
      if (L == null) return false
      const a = pts[pts.length - 1], d = dist(a, cur) || 1
      tools.pick({ x: a.x + ((cur.x - a.x) / d) * L, y: a.y + ((cur.y - a.y) / d) * L })
      return true
    },
    cancel() { commit() },
    overlay(): OverlayShape[] {
      const all = cur ? [...pts, cur] : pts
      const out: OverlayShape[] = []
      for (let i = 0; i + 1 < all.length; i++) out.push({ kind: 'line', a: all[i], b: all[i + 1], label: i === all.length - 2 ? formatLength(dist(all[i], all[i + 1]), P().settings.displayUnit) : undefined })
      return out
    }
  }
}

/** Resize every unlocked duct from the current flows. */
export function applyAutoSize(log = true) {
  const p = P()
  const res = analyse(p).net
  const changes = autoSize(p, res)
  if (!changes.size) { if (log) store.log(t('tool.autosize.none')); return }
  updateHvac(t('cmd.calc.autosize'), h => ({ ...h, ducts: h.ducts.map(d => (changes.has(d.id) ? { ...d, sizeId: changes.get(d.id)! } : d)) }))
  if (log) store.log(t('tool.autosize.done', { n: changes.size }))
}

/** In strict mode, pinned sizes that exceed vMax are replaced by the smallest compliant size. */
function checkStrict() {
  const p = P()
  if (p.settings.checkMode !== 'strict') return
  const res = analyse(p).net
  const over = res.segments.filter(s => s.overVelocity)
  if (!over.length) return
  const fix = new Map<string, string>()
  for (const s of over) {
    const d = p.hvac.ducts.find(x => x.id === s.ductId)
    const mat = d && p.library.hvac.ductMaterials.find(m => m.id === d.materialId)
    if (d && mat) fix.set(d.id, pickSize(mat, s.q).id)
  }
  updateHvac(t('mode.strict'), h => ({ ...h, ducts: h.ducts.map(d => (fix.has(d.id) ? { ...d, sizeId: fix.get(d.id)!, locked: false } : d)) }))
  store.log(t('strict.resized', { n: fix.size }), 'warn')
}

export function deleteHvac(id: string) {
  updateHvac(t('cmd.edit.delete'), (h: HvacModel) => ({
    units: h.units.filter(x => x.id !== id), plenums: h.plenums.filter(x => x.id !== id),
    terminals: h.terminals.filter(x => x.id !== id), ducts: h.ducts.filter(x => x.id !== id)
  }))
}

/** Add missing vertical risers/drops where a duct end meets a unit port or terminal at another height. */
export function fixRisers() {
  const h = P().hvac
  let n = 0
  const ducts = h.ducts.map(d => {
    const cons = connectorsOf(h, d.levelId).filter(c => c.kind !== 'plenum')
    let pts = [...d.pts]
    const before = n
    const first = pts[0], last = pts[pts.length - 1]
    const cs = cons.find(c => dist(c.p, first) < 0.16), ce = cons.find(c => dist(c.p, last) < 0.16)
    if (cs && Math.abs(cs.z - first.z) > 0.1) { pts = [{ x: cs.p.x, y: cs.p.y, z: cs.z }, { ...first, x: cs.p.x, y: cs.p.y }, ...pts.slice(1)]; n++ }
    if (ce && Math.abs(ce.z - last.z) > 0.1) { pts = [...pts.slice(0, -1), { ...last, x: ce.p.x, y: ce.p.y }, { x: ce.p.x, y: ce.p.y, z: ce.z }]; n++ }
    return n > before ? { ...d, pts } : d
  })
  if (!n) { store.log(t('tool.fix.none')); return }
  updateHvac(t('cmd.hvac.fix'), x => ({ ...x, ducts }))
  store.log(t('tool.fix.done', { n }))
}
