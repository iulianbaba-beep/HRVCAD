// Project data model. All model coordinates are in metres, plan in the XY plane, Z up.

export interface Vec2 { x: number; y: number }

/** Similarity transform applied to underlay-local coordinates: world = R(rotation)·(local·scale) + offset */
export interface Transform2D {
  scale: number
  rotation: number // radians, CCW
  offset: Vec2
}

export interface UnderlayLayer {
  name: string
  color: string // css hex
  visible: boolean
  /** Flat [x1,y1,x2,y2, …] line segments in underlay-local units (tessellated curves). */
  segments: number[]
  /** Flat [x,y, …] snap points (endpoints, vertices, centres, midpoints). */
  snaps: number[]
}

export interface UnderlayText {
  layer: string
  x: number
  y: number
  height: number
  rotation: number
  text: string
}

interface UnderlayBase {
  id: string
  name: string
  transform: Transform2D
  opacity: number // 0..1
  locked: boolean
  visible: boolean
  /** True once the user has calibrated the scale against a known length. */
  calibrated: boolean
}

export interface VectorUnderlay extends UnderlayBase {
  kind: 'vector'
  sourceFormat: 'dwg' | 'dxf'
  /** Drawing units declared in the file header (INSUNITS), informative only. */
  declaredUnits: string
  /** Original drawing coordinates of local (0,0); local coords are rebased to avoid float precision loss. */
  sourceOrigin: Vec2
  bounds: { min: Vec2; max: Vec2 } // local units
  layers: UnderlayLayer[]
  texts: UnderlayText[]
}

export interface RasterUnderlay extends UnderlayBase {
  kind: 'raster'
  sourceFormat: 'image' | 'pdf'
  dataUrl: string
  pxWidth: number
  pxHeight: number
}

export type Underlay = VectorUnderlay | RasterUnderlay

export interface Level {
  id: string
  name: string
  elevation: number // m, finished floor level
  height: number // m, floor-to-floor
  underlays: Underlay[]
}

export type DisplayUnit = 'mm' | 'cm' | 'm'
export type CheckMode = 'strict' | 'advisory'
export type Language = 'ro' | 'en'

export interface ProjectSettings {
  displayUnit: DisplayUnit
  checkMode: CheckMode
  ventilationNorm: 'I5-2022' | 'DIN 1946-6' | 'SR EN 16798-1' | 'custom'
}

export interface Project {
  format: 'hrvcad'
  version: 1
  name: string
  createdAt: string
  modifiedAt: string
  settings: ProjectSettings
  levels: Level[]
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function createProject(name = 'Proiect nou'): Project {
  const now = new Date().toISOString()
  return {
    format: 'hrvcad',
    version: 1,
    name,
    createdAt: now,
    modifiedAt: now,
    settings: { displayUnit: 'm', checkMode: 'advisory', ventilationNorm: 'I5-2022' },
    levels: [{ id: newId('lvl'), name: 'Parter', elevation: 0, height: 2.8, underlays: [] }]
  }
}
