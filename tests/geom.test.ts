import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTransform, calibrateTransform, dist, guessUnitFactor, invertTransform, parseLength, rotateTransform } from '../src/renderer/core/geom'

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('parseLength accepts RO decimal comma and unit suffixes', () => {
  assert.equal(parseLength('3,6', 'm'), 3.6)
  assert.equal(parseLength('3600mm', 'm'), 3.6)
  close(parseLength('360 cm', 'm')!, 3.6)
  close(parseLength('3600', 'mm')!, 3.6)
  assert.equal(parseLength('-2', 'm'), null)
  assert.equal(parseLength('abc', 'm'), null)
  assert.equal(parseLength('0', 'm'), null)
})

test('calibration makes the picked distance equal the real length and keeps the first point fixed', () => {
  const t0 = { scale: 0.001, rotation: 0.3, offset: { x: 5, y: -2 } }
  const la = { x: 120, y: 40 }, lb = { x: 3720, y: 40 } // local points 3600 units apart
  const a = applyTransform(t0, la), b = applyTransform(t0, lb)
  const t1 = calibrateTransform(t0, a, b, 7.2)
  const a1 = applyTransform(t1, la), b1 = applyTransform(t1, lb)
  close(dist(a1, b1), 7.2)
  close(a1.x, a.x); close(a1.y, a.y)
  close(t1.rotation, t0.rotation)
})

test('rotation about a pivot keeps the pivot fixed and preserves distances', () => {
  const t0 = { scale: 2, rotation: 0, offset: { x: 1, y: 1 } }
  const pivot = applyTransform(t0, { x: 3, y: 4 })
  const t1 = rotateTransform(t0, pivot, Math.PI / 2)
  const p = applyTransform(t1, { x: 3, y: 4 })
  close(p.x, pivot.x); close(p.y, pivot.y)
  const q0 = applyTransform(t0, { x: 0, y: 0 }), q1 = applyTransform(t1, { x: 0, y: 0 })
  close(dist(q0, pivot), dist(q1, pivot))
})

test('invertTransform is the inverse of applyTransform', () => {
  const t = { scale: 0.0254, rotation: -1.1, offset: { x: 12.5, y: 3 } }
  const p = { x: 431, y: -77 }
  const r = invertTransform(t, applyTransform(t, p))
  close(r.x, p.x, 1e-7); close(r.y, p.y, 1e-7)
})

test('guessUnitFactor picks a plausible unit for house-sized drawings', () => {
  assert.equal(guessUnitFactor(9800), 0.001) // mm drawing
  assert.equal(guessUnitFactor(980), 0.01) // cm drawing
  assert.equal(guessUnitFactor(9.8), 1) // metre drawing with wrong header
})
