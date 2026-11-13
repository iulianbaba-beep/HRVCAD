// Thermal transmittance of layered constructions (SR EN ISO 6946, plane layers, no thermal bridges).
import type { ConstructionLayer, Library, WallCategory, WallType } from './types'

/** Surface resistances, m²K/W — SR EN ISO 6946, conventional values. */
export const RS = {
  horizontal: { si: 0.13, se: 0.04 }, // walls
  upward: { si: 0.10, se: 0.04 }, // roofs / ceilings
  downward: { si: 0.17, se: 0.04 }, // floors above outside air
  interiorWall: { si: 0.13, se: 0.13 } // both faces interior
} as const

export function layersResistance(layers: ConstructionLayer[], lib: Library): number {
  let r = 0
  for (const l of layers) {
    const mat = lib.materials.find(m => m.id === l.materialId)
    if (!mat || !(mat.lambda > 0)) continue
    r += l.thickness / mat.lambda
  }
  return r
}

export function wallSurfaceResistances(category: WallCategory) {
  return category === 'exterior' ? RS.horizontal : RS.interiorWall
}

export function wallTypeThickness(t: WallType): number {
  return t.layers.reduce((s, l) => s + l.thickness, 0)
}

export interface UResult { R: number; Rtot: number; U: number; unverified: boolean }

export function wallTypeU(t: WallType, lib: Library): UResult {
  const { si, se } = wallSurfaceResistances(t.category)
  const R = layersResistance(t.layers, lib)
  const Rtot = si + R + se
  const unverified = t.layers.some(l => !lib.materials.find(m => m.id === l.materialId)?.verified)
  return { R, Rtot, U: 1 / Rtot, unverified }
}
