// DXF R12 export of every level (walls, openings, rooms, ductwork) in millimetres, one layer per element kind.
import { store } from '../core/store'
import { saveFile } from '../core/platform'
import { t } from '../i18n'
import type { AirSystem, Project, Vec2 } from '../core/types'
import { roomGeometry } from '../core/rooms'
import { wallPieces, wallPolygons } from '../core/walls'
import { unitPorts } from '../calc/network'
import { analyse } from '../calc'

const LAYERS: [string, number][] = [
  ['HRV-PERETI', 7], ['HRV-GOLURI', 4], ['HRV-CAMERE', 8], ['HRV-TEXT', 7],
  ['HRV-REFULARE', 5], ['HRV-EXTRACTIE', 30], ['HRV-AER-EXTERIOR', 3], ['HRV-EVACUARE', 33], ['HRV-ECHIPAMENTE', 1]
]
const SYS_LAYER: Record<AirSystem, string> = { supply: 'HRV-REFULARE', extract: 'HRV-EXTRACTIE', outdoor: 'HRV-AER-EXTERIOR', exhaust: 'HRV-EVACUARE' }

export function buildDxf(p: Project): string {
  const out: string[] = []
  const g = (code: number, v: string | number) => out.push(String(code), String(v))
  const MM = 1000
  let yOffset = 0
  const line = (layer: string, a: Vec2, b: Vec2) => {
    g(0, 'LINE'); g(8, layer); g(10, (a.x * MM).toFixed(1)); g(20, ((a.y + yOffset) * MM).toFixed(1)); g(30, 0)
    g(11, (b.x * MM).toFixed(1)); g(21, ((b.y + yOffset) * MM).toFixed(1)); g(31, 0)
  }
  const poly = (layer: string, pts: Vec2[], closed = true) => { for (let i = 0; i + (closed ? 0 : 1) < pts.length; i++) line(layer, pts[i], pts[(i + 1) % pts.length]) }
  const text = (layer: string, p0: Vec2, h: number, s: string) => {
    g(0, 'TEXT'); g(8, layer); g(10, (p0.x * MM).toFixed(1)); g(20, ((p0.y + yOffset) * MM).toFixed(1)); g(30, 0); g(40, (h * MM).toFixed(0)); g(1, s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\r\n]/g, ' '))
  }
  const circle = (layer: string, c: Vec2, r: number) => { g(0, 'CIRCLE'); g(8, layer); g(10, (c.x * MM).toFixed(1)); g(20, ((c.y + yOffset) * MM).toFixed(1)); g(30, 0); g(40, (r * MM).toFixed(1)) }

  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC')
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, LAYERS.length)
  for (const [name, color] of LAYERS) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS') }
  g(0, 'ENDTAB'); g(0, 'ENDSEC')
  g(0, 'SECTION'); g(2, 'ENTITIES')
  const a = analyse(p)
  // Levels are stacked vertically in model space, 5 m apart beyond each level's extents.
  let cursorY = 0
  for (const level of [...p.levels].sort((x, y) => x.elevation - y.elevation)) {
    const polys = wallPolygons(level.walls, p.library)
    const ys = [...polys.values()].flat().map(v => v.y)
    const minY = ys.length ? Math.min(...ys) : 0, maxY = ys.length ? Math.max(...ys) : 0
    yOffset = cursorY - minY
    text('HRV-TEXT', { x: 0, y: maxY + 1 }, 0.35, `${p.name} - ${level.name}`)
    for (const w of level.walls) {
      const pl = polys.get(w.id)
      if (!pl) continue
      for (const pc of wallPieces(w, pl, w.height ?? level.height)) if (pc.z0 <= 1.2 && pc.z1 > 1.2) poly('HRV-PERETI', pc.poly)
      for (const o of w.openings ?? []) {
        const d = { x: (w.b.x - w.a.x), y: (w.b.y - w.a.y) }, L = Math.hypot(d.x, d.y) || 1
        const c = { x: w.a.x + (d.x / L) * o.offset, y: w.a.y + (d.y / L) * o.offset }
        text('HRV-GOLURI', c, 0.12, `${o.kind === 'door' ? 'U' : 'F'} ${Math.round(o.width * 100)}x${Math.round(o.height * 100)}`)
      }
    }
    const geo = roomGeometry(level, p.library)
    for (const r of level.rooms) {
      const gm = geo.get(r.id)
      if (!gm) continue
      poly('HRV-CAMERE', gm.polygon)
      const rf = a.air.rooms.find(x => x.roomId === r.id)
      text('HRV-TEXT', r.seed, 0.18, r.name)
      text('HRV-TEXT', { x: r.seed.x, y: r.seed.y - 0.3 }, 0.12, `${gm.area.toFixed(2)} m2${rf?.supply ? ` Q=${Math.round(rf.supply)}` : ''}${rf?.extract ? ` Q=${Math.round(rf.extract)}` : ''}`)
    }
    for (const d of p.hvac.ducts.filter(x => x.levelId === level.id)) {
      poly(SYS_LAYER[d.system], d.pts, false)
      const s = a.net.segments.find(x => x.ductId === d.id)
      if (s && d.pts.length > 1) text(SYS_LAYER[d.system], { x: (d.pts[0].x + d.pts[1].x) / 2, y: (d.pts[0].y + d.pts[1].y) / 2 + 0.1 }, 0.1, `${s.sizeLabel} ${Math.round(s.q)} m3/h`)
    }
    for (const tr of p.hvac.terminals.filter(x => x.levelId === level.id)) circle(SYS_LAYER[tr.system], tr.pos, 0.1)
    for (const pl of p.hvac.plenums.filter(x => x.levelId === level.id)) poly('HRV-ECHIPAMENTE', [{ x: pl.pos.x - 0.25, y: pl.pos.y - 0.15 }, { x: pl.pos.x + 0.25, y: pl.pos.y - 0.15 }, { x: pl.pos.x + 0.25, y: pl.pos.y + 0.15 }, { x: pl.pos.x - 0.25, y: pl.pos.y + 0.15 }])
    for (const u of p.hvac.units.filter(x => x.levelId === level.id)) {
      const c = Math.cos(u.rotation), s = Math.sin(u.rotation)
      const R = (x: number, y: number) => ({ x: u.pos.x + c * x - s * y, y: u.pos.y + s * x + c * y })
      poly('HRV-ECHIPAMENTE', [R(-0.35, -0.3), R(0.35, -0.3), R(0.35, 0.3), R(-0.35, 0.3)])
      text('HRV-ECHIPAMENTE', R(-0.2, -0.05), 0.12, 'HRV')
      const ports = unitPorts(u)
      for (const k of Object.keys(ports) as AirSystem[]) circle(SYS_LAYER[k], ports[k], 0.05)
    }
    cursorY += maxY - minY + 5
  }
  g(0, 'ENDSEC'); g(0, 'EOF')
  return out.join('\r\n')
}

export async function exportDxf() {
  const p = store.get().project
  const data = new TextEncoder().encode(buildDxf(p))
  const r = await saveFile(`${p.name}.dxf`, [{ name: 'DXF', extensions: ['dxf'] }], data)
  if (r) store.log(t('rep.saved', { name: r.name }))
}
