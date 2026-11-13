import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dinNominal } from '../src/renderer/calc/airflow'
import { frictionGradient, curvePressure, pickSize } from '../src/renderer/calc/network'
import { DEFAULT_HVAC } from '../src/renderer/library/defaults'

const close = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('DIN 1946-6 nominal flow formula', () => {
  // A = 100 m²: −0,002·10000 + 115 + 11 = 106 m³/h
  close(dinNominal(100), 106, 1e-9)
  close(dinNominal(100, 0.7), 74.2, 1e-9)
})

test('friction gradient matches the Darcy–Weisbach/Colebrook reference for a Ø160 spiro duct', () => {
  // 200 m³/h in Ø160: v = 2.763 m/s, Re ≈ 29470, k = 0.15 mm → f ≈ 0.0262 (Colebrook), R ≈ 0.75 Pa/m
  const s = { id: 'x', label: 'Ø160', d: 0.16, price: 0, code: '' }
  const r = frictionGradient(200, s, 0.15)
  close(r.v, 2.763, 0.01)
  close(r.R, 0.75, 0.06)
})

test('fan curve interpolation and duct sizing', () => {
  const u = DEFAULT_HVAC.units[0]
  close(curvePressure(u, 150)!, 190, 1e-9)
  assert.equal(curvePressure(u, 400), null)
  const spiro = DEFAULT_HVAC.ductMaterials[0]
  // 150 m³/h, vMax 4 m/s·0.95 → needs A ≥ 0.01096 m² → Ø125 (0.01227)
  assert.equal(pickSize(spiro, 150).label, 'Ø125')
})
