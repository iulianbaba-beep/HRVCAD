// Rooms, slabs and roofs.
import type { Roof, RoomType, Vec2 } from '../core/types'
import { newId } from '../core/types'
import { activeLevel, store, updateLevel } from '../core/store'
import { dist, formatLength, parseLength } from '../core/geom'
import { detectRegions, guessRoomType, levelFootprint, makeRoom, regionAt, roomGeometry, underlayTextIn } from '../core/rooms'
import { ccw, convexHull, isConvex, offsetConvex } from '../core/roof'
import { t } from '../i18n'
import { prompt, tools, type OverlayShape, type Tool } from './tool'

const lib = () => store.get().project.library
const unit = () => store.get().project.settings.displayUnit

function roomName(type: RoomType | null, text: string, n: number) {
  if (text) return text.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 40)
  return type ? t(`room.${type}` as any) : t('room.defaultName', { n })
}

/** ROOM: click inside an enclosed area. */
export function roomTool(): Tool {
  let hover: Vec2[] | null = null
  return {
    id: 'build.room',
    basePoint: () => null,
    start: () => prompt(t('tool.room.pick')),
    pick(p) {
      const level = activeLevel()
      const geo = roomGeometry(level, lib())
      for (const r of level.rooms) {
        const g = geo.get(r.id)
        if (g?.ok && inside(p, g.polygon)) { store.log(t('tool.room.exists', { name: r.name }), 'warn'); return }
      }
      const reg = regionAt(level, lib(), p)
      if (!reg) { store.log(t('tool.room.open'), 'warn'); return }
      const text = underlayTextIn(level, reg.polygon)
      const type = (text && guessRoomType(text)) || store.get().ui.roomType
      const room = makeRoom(p, reg.polygon, reg.area, roomName(text ? type : null, text, level.rooms.length + 1), type)
      updateLevel(t('cmd.build.room'), level.id, l => ({ ...l, rooms: [...l.rooms, room] }))
      store.log(t('tool.room.added', { name: room.name, a: reg.area.toFixed(2) }))
    },
    move(p) { hover = regionAt(activeLevel(), lib(), p)?.polygon ?? null },
    overlay: (): OverlayShape[] => (hover ? [{ kind: 'poly', pts: hover }] : [])
  }
}

function inside(p: Vec2, poly: Vec2[]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

/** Detect every enclosed room on the active level and name/type them from the plan texts. */
export function detectRooms() {
  const level = activeLevel()
  const geo = roomGeometry(level, lib())
  const regions = detectRegions(level, lib())
  const fresh = regions.filter(r => !level.rooms.some(x => { const g = geo.get(x.id); return g?.ok && inside(r.seed, g.polygon) }))
  if (!fresh.length) { store.log(t('tool.room.none'), 'warn'); return }
  let n = level.rooms.length
  const rooms = fresh.map(r => {
    const text = underlayTextIn(level, r.polygon)
    const type = (text && guessRoomType(text)) || 'other'
    return makeRoom(r.seed, r.polygon, r.area, roomName(text ? type : null, text, ++n), type)
  })
  updateLevel(t('cmd.build.roomDetect'), level.id, l => ({ ...l, rooms: [...l.rooms, ...rooms] }))
  store.log(t('tool.room.detected', { n: rooms.length }))
}

/** Floor slab from the outer boundary of the walls. */
export function autoSlab() {
  const level = activeLevel()
  const fp = levelFootprint(level, lib())
  if (fp.length < 3) { store.log(t('tool.slab.noWalls'), 'warn'); return }
  const lowest = Math.min(...store.get().project.levels.map(l => l.elevation)) === level.elevation
  const cat = lowest ? 'ground' : 'intermediate'
  const typeId = lib().slabTypes.find(s => s.category === cat)?.id ?? lib().slabTypes[0]?.id
  updateLevel(t('cmd.build.slab'), level.id, l => ({ ...l, slab: { typeId, polygon: fp } }))
  store.log(t('tool.slab.done'))
}

/** ROOF: draw a convex eave outline, then a default pitch is applied to every edge (editable per edge). */
export function roofTool(): Tool {
  const pts: Vec2[] = []
  let cur: Vec2 | null = null
  let askingPitch = false
  const finish = (pitch: number) => {
    let outline = ccw(pts)
    if (!isConvex(outline)) { store.log(t('tool.roof.notConvex'), 'warn'); outline = convexHull(outline) }
    const typeId = lib().slabTypes.find(s => s.category === 'roof')?.id ?? lib().slabTypes[0].id
    const roof: Roof = { id: newId('roof'), typeId, outline, slopes: outline.map(() => pitch), eaveHeight: activeLevel().height }
    updateLevel(t('cmd.build.roof'), activeLevel().id, l => ({ ...l, roofs: [...l.roofs, roof] }))
    store.setUI({ selectedRoofId: roof.id, selectedWallIds: [], selectedOpeningId: null })
    tools.finish()
  }
  return {
    id: 'build.roof',
    basePoint: () => pts[pts.length - 1] ?? null,
    start: () => prompt(t('tool.roof.first')),
    pick(p) {
      if (askingPitch) return
      if (pts.length >= 3 && dist(p, pts[0]) < 0.05) { askingPitch = true; prompt(t('tool.roof.pitch'), true); return }
      pts.push(p)
      prompt(t('tool.roof.next'))
    },
    move(p) { cur = p },
    input(text) {
      const k = text.trim().toUpperCase()
      if (!askingPitch && (k === 'I' || k === 'C') && pts.length >= 3) { askingPitch = true; prompt(t('tool.roof.pitch'), true); return true }
      if (askingPitch) {
        const v = parseFloat(text.replace(',', '.'))
        if (!Number.isFinite(v) || v < 0 || v > 75) { store.log(t('tool.roof.badPitch'), 'warn'); return true }
        finish(v)
        return true
      }
      if (pts.length && cur) {
        const L = parseLength(text, unit())
        if (L != null) { const a = pts[pts.length - 1], d = dist(a, cur) || 1; tools.pick({ x: a.x + ((cur.x - a.x) / d) * L, y: a.y + ((cur.y - a.y) / d) * L }); return true }
      }
      return false
    },
    overlay(): OverlayShape[] {
      const all = cur && !askingPitch ? [...pts, cur] : pts
      if (all.length < 2) return pts.map(p => ({ kind: 'point' as const, p }))
      const out: OverlayShape[] = [{ kind: 'poly', pts: all }]
      if (cur && pts.length && !askingPitch) out.push({ kind: 'line', a: pts[pts.length - 1], b: cur, label: formatLength(dist(pts[pts.length - 1], cur), unit()) })
      return out
    }
  }
}

/** Roof from the building footprint (convex hull) with an overhang. */
export function autoRoof(overhang = 0.5, pitch = 35) {
  const level = activeLevel()
  const fp = levelFootprint(level, lib())
  if (fp.length < 3) { store.log(t('tool.slab.noWalls'), 'warn'); return }
  const outline = offsetConvex(convexHull(fp), overhang)
  const typeId = lib().slabTypes.find(s => s.category === 'roof')?.id ?? lib().slabTypes[0].id
  const roof: Roof = { id: newId('roof'), typeId, outline, slopes: outline.map(() => pitch), eaveHeight: level.height }
  updateLevel(t('cmd.build.roofAuto'), level.id, l => ({ ...l, roofs: [...l.roofs, roof] }))
  store.setUI({ selectedRoofId: roof.id, selectedWallIds: [], selectedOpeningId: null })
  store.log(t('tool.roof.auto', { n: outline.length }))
}
