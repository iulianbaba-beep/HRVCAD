import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refSegs, trimWall, extendWall, splitWall, transformWall, mirrorAcross, moveJoinedEndpoints, flipWall, placeOpening } from '../src/renderer/core/wallOps'
import { wallPolygons } from '../src/renderer/core/walls'
import { footprintSegs } from '../src/renderer/core/wallOps'
import type { Library, Wall } from '../src/renderer/core/types'

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)
const W = (id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<Wall> = {}): Wall =>
  ({ id, typeId: 't', a: { x: ax, y: ay }, b: { x: bx, y: by }, justification: 'center', height: null, ...extra })
const lib: Library = { materials: [{ id: 'm', name: 'M', lambda: 1, source: 's', verified: true }], wallTypes: [{ id: 't', name: 'T', category: 'interior', layers: [{ materialId: 'm', thickness: 0.2 }] }], slabTypes: [], hvac: { units: [], ductMaterials: [], terminals: [], plenums: [] } }

test('trim removes the picked middle portion between two crossings', () => {
  const w = W('w', 0, 0, 10, 0)
  const others = [W('c1', 3, -2, 3, 2), W('c2', 7, -2, 7, 2)]
  const r = trimWall(w, refSegs(others), { x: 5, y: 0.1 })!
  assert.equal(r.length, 2)
  close(r[0].b.x, 3); close(r[1].a.x, 7); close(r[1].b.x, 10)
  assert.equal(r[0].id, 'w')
})

test('trim of an end portion keeps the rest; no crossing → null', () => {
  const w = W('w', 0, 0, 10, 0)
  const r = trimWall(w, refSegs([W('c', 3, -2, 3, 2)]), { x: 1, y: 0 })!
  assert.equal(r.length, 1); close(r[0].a.x, 3); close(r[0].b.x, 10)
  assert.equal(trimWall(w, refSegs([W('c', 3, 1, 3, 2)]), { x: 1, y: 0 }), null)
})

test('extend reaches the next wall reference line on the picked side', () => {
  const w = W('w', 0, 0, 4, 0)
  const r = extendWall(w, refSegs([W('b', 6, -3, 6, 3), W('far', 9, -3, 9, 3)]), { x: 3.9, y: 0 })!
  close(r.b.x, 6); close(r.a.x, 0)
  assert.equal(extendWall(w, refSegs([W('b', 6, 1, 6, 3)]), { x: 3.9, y: 0 }), null)
})

test('extending the start keeps openings fixed in the world', () => {
  const w = W('w', 2, 0, 6, 0, { openings: [{ id: 'o', kind: 'door', offset: 1, width: 0.9, height: 2.1, sill: 0, hinge: 'start', swing: 'left', U: 1.5 }] })
  const r = extendWall(w, refSegs([W('b', 0, -3, 0, 3)]), { x: 2.1, y: 0 })!
  close(r.a.x, 0); close(r.openings![0].offset, 3)
})

test('split re-hosts openings on the piece that contains them', () => {
  const w = W('w', 0, 0, 10, 0, { openings: [{ id: 'o', kind: 'window', offset: 8, width: 1.2, height: 1.4, sill: 0.9, hinge: 'start', swing: 'left', U: 1.1 }] })
  const [p1, p2] = splitWall(w, { x: 4, y: 0 })!
  assert.equal(p1.openings!.length, 0)
  assert.equal(p2.openings!.length, 1); close(p2.openings![0].offset, 4)
})

test('mirror keeps the footprint mirrored (left-justified body stays inside)', () => {
  const w = W('w', 0, 0, 4, 0, { justification: 'left' }) // body on the right (y < 0)
  const m = transformWall(w, mirrorAcross({ x: 0, y: 5 }, { x: 1, y: 5 }), true, true)
  const poly = wallPolygons([m], lib).get(m.id)!
  for (const v of poly) assert.ok(v.y >= 10 - 1e-9 && v.y <= 10.2 + 1e-9, `y=${v.y}`)
})

test('stretching a shared corner moves both walls', () => {
  const ws = [W('a', 0, 0, 5, 0), W('b', 5, 0, 5, 4)]
  const r = moveJoinedEndpoints(ws, { x: 5, y: 0 }, { x: 6, y: 0 })
  close(r[0].b.x, 6); close(r[1].a.x, 6); close(r[1].b.x, 5)
})

test('flip swaps the body side; opening placement clamps inside the wall', () => {
  assert.equal(flipWall(W('w', 0, 0, 1, 0, { justification: 'left' })).justification, 'right')
  const o = placeOpening(W('w', 0, 0, 3, 0), { x: 2.9, y: 0 }, { kind: 'door', width: 0.9, height: 2.1, sill: 0, hinge: 'start', swing: 'left', U: 1.5 })!
  close(o.offset, 3 - 0.45 - 0.01)
})

test('extend stops at the near face of a thick boundary wall (T-junction)', () => {
  const ext = W('e', 0, -3, 0, 3, { justification: 'left' }) // body to the right: x ∈ [0, 0.2]
  const polys = wallPolygons([ext], lib)
  const r = extendWall(W('w', 3, 0, 1, 0), footprintSegs(polys.values()), { x: 1.1, y: 0 })!
  close(r.b.x, 0.2)
})
