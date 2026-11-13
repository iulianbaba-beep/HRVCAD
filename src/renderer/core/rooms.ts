// Room geometry (recomputed from walls), room-type guessing from plan texts, footprint for slabs.
import type { Level, Library, Room, RoomType, Vec2 } from './types'
import { newId } from './types'
import { wallPolygons } from './walls'
import { cellOf, contour, enclosedRegions, flood, footprint, polygonArea, rasterize, type Raster } from './regions'
import { applyTransform } from './geom'

export interface RoomGeom { polygon: Vec2[]; area: number; ok: boolean }

const cache = new WeakMap<object, { lib: Library; raster: Raster | null; rooms: Map<string, RoomGeom>; roomsRef: Room[] }>()

function rasterFor(level: Level, lib: Library): Raster | null {
  const polys = [...wallPolygons(level.walls, lib).values()]
  return polys.length ? rasterize(polys) : null
}

/** Current geometry of every room on a level (memoised on the walls/rooms arrays). */
export function roomGeometry(level: Level, lib: Library): Map<string, RoomGeom> {
  const c = cache.get(level.walls)
  if (c && c.lib === lib && c.roomsRef === level.rooms) return c.rooms
  const raster = c && c.lib === lib ? c.raster : rasterFor(level, lib)
  const rooms = new Map<string, RoomGeom>()
  for (const r of level.rooms) {
    const reg = raster ? flood(raster, cellOf(raster, r.seed)) : null
    if (!raster || !reg || reg.touchesBorder) { rooms.set(r.id, { polygon: r.polygon, area: r.area, ok: false }); continue }
    const polygon = contour(raster, reg.mask)
    rooms.set(r.id, { polygon, area: polygonArea(polygon), ok: true })
  }
  cache.set(level.walls, { lib, raster, rooms, roomsRef: level.rooms })
  return rooms
}

export function regionAt(level: Level, lib: Library, p: Vec2): { polygon: Vec2[]; area: number } | null {
  const raster = rasterFor(level, lib)
  if (!raster) return null
  const reg = flood(raster, cellOf(raster, p))
  if (!reg || reg.touchesBorder) return null
  const polygon = contour(raster, reg.mask)
  return { polygon, area: polygonArea(polygon) }
}

export function detectRegions(level: Level, lib: Library) {
  const raster = rasterFor(level, lib)
  return raster ? enclosedRegions(raster) : []
}

export function levelFootprint(level: Level, lib: Library): Vec2[] {
  const raster = rasterFor(level, lib)
  return raster ? footprint(raster) : []
}

// ---- Guess room types from texts on the imported plan (RO / EN) ----------------------
const KEYWORDS: [RegExp, RoomType][] = [
  [/\b(living|camera de zi|cam\.? de zi|zi)\b/i, 'living'],
  [/\b(dormitor|bed ?room|bedroom|master)\b/i, 'bedroom'],
  [/\b(copii|copil|kids|child)\b/i, 'kids'],
  [/\b(birou|office|study)\b/i, 'study'],
  [/\b(dining|sufragerie|loc de luat masa)\b/i, 'dining'],
  [/\b(oaspeti|oaspeți|guest)\b/i, 'guest'],
  [/\b(bucatarie|bucătărie|kitchen)\b/i, 'kitchen'],
  [/\b(chicineta|chicinetă|kitchenette)\b/i, 'kitchenette'],
  [/\b(baie|bath ?room|bathroom|bath|dus|duș)\b/i, 'bath'],
  [/\b(wc|toaleta|toaletă|grup sanitar)\b/i, 'wc'],
  [/\b(spalatorie|spălătorie|laundry|utility)\b/i, 'utility'],
  [/\b(sauna)\b/i, 'sauna'],
  [/\b(hol|hall|holl|coridor|corridor|vestibul|antreu|entry)\b/i, 'hall'],
  [/\b(camara|cămară|debara|depozitare|storage|pantry)\b/i, 'storage'],
  [/\b(tehnic|centrala|centrală|technical|boiler)\b/i, 'technical']
]

export function guessRoomType(text: string): RoomType | null {
  for (const [re, t] of KEYWORDS) if (re.test(text)) return t
  return null
}

function inPoly(p: Vec2, poly: Vec2[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Text labels of the visible vector underlays that fall inside a polygon, joined in reading order. */
export function underlayTextIn(level: Level, polygon: Vec2[]): string {
  const items: { p: Vec2; text: string }[] = []
  for (const u of level.underlays) {
    if (u.kind !== 'vector' || !u.visible) continue
    for (const t of u.texts) {
      if (!u.layers.find(l => l.name === t.layer)?.visible) continue
      const p = applyTransform(u.transform, { x: t.x, y: t.y })
      if (inPoly(p, polygon)) items.push({ p, text: t.text.trim() })
    }
  }
  items.sort((a, b) => b.p.y - a.p.y || a.p.x - b.p.x)
  return items.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim()
}

export function makeRoom(seed: Vec2, polygon: Vec2[], area: number, name: string, type: RoomType): Room {
  return { id: newId('room'), name, type, seed, polygon, area, tempInt: null, persons: null, supplyOverride: null, extractOverride: null }
}

export const SUPPLY_ROOMS: RoomType[] = ['living', 'bedroom', 'kids', 'study', 'dining', 'guest']
export const EXTRACT_ROOMS: RoomType[] = ['kitchen', 'kitchenette', 'bath', 'wc', 'utility', 'sauna', 'storage']
export const ROOM_TYPES: RoomType[] = ['living', 'bedroom', 'kids', 'study', 'dining', 'guest', 'kitchen', 'kitchenette', 'bath', 'wc', 'utility', 'sauna', 'hall', 'storage', 'technical', 'other']
