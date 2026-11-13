// Placement of the HRV unit, plenums, terminals and manual duct routing.
import type { AirSystem, Duct, HvacModel, Vec2, Vec3 } from '../core/types'
import { newId } from '../core/types'
import { activeLevel, store, updateHvac } from '../core/store'
import { dist, formatLength, parseLength } from '../core/geom'
import { roomGeometry, SUPPLY_ROOMS, EXTRACT_ROOMS } from '../core/rooms'
import { closestOnSegment } from '../core/walls'
import { analyse } from '../calc'
import { autoSize, pickSize, unitPorts } from '../calc/network'
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
      const u = { id: newId('hru'), typeId: ui().unitTypeId, levelId: activeLevel().id, pos: p, z: activeLevel().elevation + 0.3, rotation }
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
  return {
    id: 'hvac.plenum',
    basePoint: () => null,
    start: () => prompt(t('tool.plenum.pick', { s: t(`system.${ui().plenumSystem}` as any) })),
    pick(p) {
      const pl = { id: newId('pl'), typeId: ui().plenumTypeId, levelId: activeLevel().id, pos: p, z: ductZ(), system: ui().plenumSystem }
      updateHvac(t('cmd.hvac.plenum'), h => ({ ...h, plenums: [...h.plenums, pl] }))
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

/** Connection points a duct may start/end at, with the system they imply. */
function connectors(): { p: Vec2; system: AirSystem | null; label: string }[] {
  const h = P().hvac
  const lvl = activeLevel().id
  const out: { p: Vec2; system: AirSystem | null; label: string }[] = []
  for (const u of h.units.filter(u => u.levelId === lvl)) {
    const ports = unitPorts(u)
    for (const s of ['supply', 'extract', 'outdoor', 'exhaust'] as AirSystem[]) out.push({ p: ports[s], system: s, label: s })
  }
  for (const pl of h.plenums.filter(x => x.levelId === lvl)) out.push({ p: pl.pos, system: pl.system, label: 'plenum' })
  for (const tr of h.terminals.filter(x => x.levelId === lvl)) out.push({ p: tr.pos, system: tr.system, label: 'terminal' })
  for (const d of h.ducts.filter(x => x.levelId === lvl)) for (const q of d.pts) out.push({ p: q, system: d.system, label: 'duct' })
  return out
}

export function ductTool(): Tool {
  const pts: Vec2[] = []
  let system: AirSystem | null = null
  let cur: Vec2 | null = null
  const near = (p: Vec2) => connectors().find(c => dist(c.p, p) < 0.08)
  const commit = () => {
    if (pts.length < 2) { pts.length = 0; return }
    const sys = system ?? ui().ductSystem
    const mat = P().library.hvac.ductMaterials.find(m => m.id === ui().ductMaterialId) ?? P().library.hvac.ductMaterials[0]
    const z = ductZ()
    const duct: Duct = {
      id: newId('duct'), levelId: activeLevel().id, system: sys, materialId: mat.id,
      sizeId: ui().ductSizeId !== 'auto' && mat.sizes.some(s => s.id === ui().ductSizeId) ? ui().ductSizeId : mat.sizes[0].id,
      pts: pts.map(p => ({ x: p.x, y: p.y, z }) as Vec3), locked: ui().ductSizeId !== 'auto'
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
  }
  return {
    id: 'hvac.duct',
    basePoint: () => pts[pts.length - 1] ?? null,
    start: () => prompt(t('tool.duct.first')),
    pick(p) {
      const c = near(p)
      const q = c ? c.p : p
      if (!pts.length && c?.system) system = c.system
      if (pts.length && dist(pts[pts.length - 1], q) < 1e-6) return
      pts.push(q)
      // Reaching a terminal, plenum or unit port ends the run.
      if (pts.length >= 2 && c && c.label !== 'duct') { commit(); prompt(t('tool.duct.first')); return }
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
