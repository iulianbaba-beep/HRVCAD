import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rasterize, enclosedRegions, footprint, polygonArea } from '../src/renderer/core/regions'
import { wallPolygons } from '../src/renderer/core/walls'
import type { Library, Wall } from '../src/renderer/core/types'

const lib: Library = { materials: [{ id: 'm', name: 'M', lambda: 1, source: 's', verified: true }],
  wallTypes: [{ id: 't', name: 'T', category: 'exterior', layers: [{ materialId: 'm', thickness: 0.2 }] }],
  slabTypes: [], hvac: { units: [], ductMaterials: [], terminals: [], plenums: [] } }
const W = (id: string, ax: number, ay: number, bx: number, by: number): Wall =>
  ({ id, typeId: 't', a: { x: ax, y: ay }, b: { x: bx, y: by }, justification: 'left', height: null })

test('two rooms detected inside a 6×4 outline split by a wall', () => {
  // clockwise outline, body inside (0.2 thick)
  const walls = [W('1', 0, 0, 0, 4), W('2', 0, 4, 6, 4), W('3', 6, 4, 6, 0), W('4', 6, 0, 0, 0), { ...W('5', 3, 0, 3, 4), justification: 'center' as const }]
  const r = rasterize([...wallPolygons(walls, lib).values()])!
  const rooms = enclosedRegions(r).sort((a, b) => a.seed.x - b.seed.x)
  assert.equal(rooms.length, 2)
  // each room: x from 0.2 to 2.9 (2.7) × y from 0.2 to 3.8 (3.6) = 9.72 m²
  for (const rm of rooms) assert.ok(Math.abs(rm.area - 9.72) < 0.25, `area ${rm.area}`)
  const fp = footprint(r)
  assert.ok(Math.abs(polygonArea(fp) - 24) < 0.4, `footprint ${polygonArea(fp)}`)
})
