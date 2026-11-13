import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roofGeometry } from '../src/renderer/core/roof'
import type { Roof } from '../src/renderer/core/types'

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)
const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }]
const R = (slopes: number[], outline = rect): Roof => ({ id: 'r', typeId: 't', outline, slopes, eaveHeight: 3 })

test('hip roof: four faces, ridge at half the short side × tan(pitch)', () => {
  const g = roofGeometry(R([30, 30, 30, 30]), 0)
  assert.equal(g.faces.length, 4)
  close(g.ridgeZ, 3 + 3 * Math.tan(Math.PI / 6))
  assert.equal(g.gables.length, 0)
})

test('gable roof: two faces + two triangular gables; surface area = footprint / cos(pitch)', () => {
  const g = roofGeometry(R([30, 0, 30, 0]), 0)
  assert.equal(g.faces.length, 2)
  assert.equal(g.gables.length, 2)
  close(g.area, 60 / Math.cos(Math.PI / 6), 1e-6)
  close(g.ridgeZ, 3 + 3 * Math.tan(Math.PI / 6))
})

test('mono-pitch, flat, and clockwise outlines keep slopes on their edges', () => {
  const mono = roofGeometry(R([0, 0, 20, 0]), 0)
  close(mono.ridgeZ, 3 + 6 * Math.tan(Math.PI / 9))
  assert.ok(roofGeometry(R([0, 0, 0, 0]), 0).flat)
  const cw = [...rect].reverse() // edges: (0,6)->(10,6) is edge 0 … slopes follow drawn edges
  const g = roofGeometry({ ...R([20, 0, 0, 0], cw) }, 0) // only the top edge (y=6) pitched
  close(g.ridgeZ, 3 + 6 * Math.tan(Math.PI / 9))
})
