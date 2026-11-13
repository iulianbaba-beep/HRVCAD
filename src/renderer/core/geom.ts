import type { DisplayUnit, Transform2D, Vec2 } from './types'

export const dist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y)

export function applyTransform(t: Transform2D, p: Vec2): Vec2 {
  const c = Math.cos(t.rotation), s = Math.sin(t.rotation)
  const x = p.x * t.scale, y = p.y * t.scale
  return { x: c * x - s * y + t.offset.x, y: s * x + c * y + t.offset.y }
}

export function invertTransform(t: Transform2D, p: Vec2): Vec2 {
  const c = Math.cos(-t.rotation), s = Math.sin(-t.rotation)
  const x = p.x - t.offset.x, y = p.y - t.offset.y
  return { x: (c * x - s * y) / t.scale, y: (s * x + c * y) / t.scale }
}

/**
 * Rescale an underlay so that the world distance between two picked world points becomes `realLength`,
 * keeping the first picked point fixed in place.
 */
export function calibrateTransform(t: Transform2D, a: Vec2, b: Vec2, realLength: number): Transform2D {
  const measured = dist(a, b)
  if (!(measured > 0) || !(realLength > 0)) throw new Error('invalid calibration input')
  const k = realLength / measured
  // world' = a + k·(world − a)  ⇒ scale·k, offset' = a + k·(offset − a)
  return {
    scale: t.scale * k,
    rotation: t.rotation,
    offset: { x: a.x + k * (t.offset.x - a.x), y: a.y + k * (t.offset.y - a.y) }
  }
}

/** Rotate an underlay about a world pivot by `angle` radians. */
export function rotateTransform(t: Transform2D, pivot: Vec2, angle: number): Transform2D {
  const c = Math.cos(angle), s = Math.sin(angle)
  const dx = t.offset.x - pivot.x, dy = t.offset.y - pivot.y
  return {
    scale: t.scale,
    rotation: t.rotation + angle,
    offset: { x: pivot.x + c * dx - s * dy, y: pivot.y + s * dx + c * dy }
  }
}

const UNIT_TO_M: Record<string, number> = { mm: 0.001, cm: 0.01, dm: 0.1, m: 1 }

/**
 * Parse a user-entered length into metres. Accepts "4.5", "4,5", "4500mm", "450 cm", "4.5m".
 * A bare number uses `defaultUnit`. Returns null if not a positive finite number.
 */
export function parseLength(input: string, defaultUnit: DisplayUnit): number | null {
  const m = input.trim().toLowerCase().replace(',', '.').match(/^([0-9]*\.?[0-9]+)\s*(mm|cm|dm|m)?$/)
  if (!m) return null
  const v = parseFloat(m[1]) * UNIT_TO_M[m[2] ?? defaultUnit]
  return Number.isFinite(v) && v > 0 ? v : null
}

export function formatLength(metres: number, unit: DisplayUnit): string {
  switch (unit) {
    case 'mm': return `${Math.round(metres * 1000)} mm`
    case 'cm': return `${(metres * 100).toFixed(1)} cm`
    default: return `${metres.toFixed(3)} m`
  }
}

/** Metres per drawing unit for DXF/DWG $INSUNITS codes. */
export function insunitsToMetres(code: number | undefined): { factor: number; name: string } {
  switch (code) {
    case 1: return { factor: 0.0254, name: 'in' }
    case 2: return { factor: 0.3048, name: 'ft' }
    case 4: return { factor: 0.001, name: 'mm' }
    case 5: return { factor: 0.01, name: 'cm' }
    case 6: return { factor: 1, name: 'm' }
    case 14: return { factor: 0.1, name: 'dm' }
    default: return { factor: 1, name: 'unitless' }
  }
}

/** A plausible single-family house / apartment footprint, in metres. Outside this, units are likely wrong. */
export function plausibleFootprint(widthM: number, heightM: number): boolean {
  const s = Math.max(widthM, heightM)
  return s >= 3 && s <= 250
}

/** Pick the most plausible unit for a drawing extent when the header is wrong or missing. */
export function guessUnitFactor(extentUnits: number): number {
  for (const f of [0.001, 0.01, 1, 0.1]) {
    const s = extentUnits * f
    if (s >= 4 && s <= 120) return f
  }
  return 1
}
