import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wallPolygons, faceOffsets } from '../src/renderer/core/walls'
import { wallTypeU } from '../src/renderer/core/thermal'
import type { Library, Wall } from '../src/renderer/core/types'

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

const lib: Library = {
  materials: [{ id: 'm', name: 'M', lambda: 0.3, source: 'test', verified: true }],
  wallTypes: [{ id: 't', name: 'T', category: 'exterior', layers: [{ materialId: 'm', thickness: 0.3 }] }], slabTypes: [], hvac: { units: [], ductMaterials: [], terminals: [], plenums: [] }
}

test('face offsets follow the location line', () => {
  assert.deepEqual(faceOffsets('center', 0.3), { L: 0.15, R: -0.15 })
  assert.deepEqual(faceOffsets('left', 0.3), { L: 0, R: -0.3 })
  assert.deepEqual(faceOffsets('right', 0.3), { L: 0.3, R: 0 })
})

test('two walls meeting at an L corner get mitred faces', () => {
  const walls: Wall[] = [
    { id: 'w1', typeId: 't', a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, justification: 'center', height: null },
    { id: 'w2', typeId: 't', a: { x: 5, y: 0 }, b: { x: 5, y: 4 }, justification: 'center', height: null }
  ]
  const p = wallPolygons(walls, lib)
  const w1 = p.get('w1')!, w2 = p.get('w2')!
  // w1 end: left (inner) face → (4.85, 0.15); right (outer) face → (5.15, −0.15)
  close(w1[1].x, 4.85); close(w1[1].y, 0.15)
  close(w1[2].x, 5.15); close(w1[2].y, -0.15)
  // w2 start shares the same corner points
  close(w2[0].x, 4.85); close(w2[0].y, 0.15) // w2 start-left (inner)
  close(w2[3].x, 5.15); close(w2[3].y, -0.15) // w2 start-right (outer)
  // free ends stay square
  close(w1[0].x, 0); close(w1[0].y, 0.15)
})

test('exterior outline drawn clockwise with left location line keeps the body inside', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 10, y: 6 }, { x: 10, y: 0 }]
  const walls: Wall[] = pts.map((a, i) => ({ id: `w${i}`, typeId: 't', a, b: pts[(i + 1) % 4], justification: 'left', height: null }))
  const p = wallPolygons(walls, lib)
  for (const poly of p.values()) for (const v of poly) {
    assert.ok(v.x >= -1e-9 && v.x <= 10 + 1e-9 && v.y >= -1e-9 && v.y <= 6 + 1e-9, `vertex outside outline: ${v.x},${v.y}`)
  }
})

test('U value of a single layer wall per ISO 6946', () => {
  const u = wallTypeU(lib.wallTypes[0], lib)
  close(u.R, 1)
  close(u.U, 1 / (0.13 + 1 + 0.04))
})
