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
  walls: Wall[]
  rooms: Room[]
  /** Floor slab of this level (null = none drawn). */
  slab: Slab | null
  /** Construction above this level when it is not heated space (attic floor / flat roof); null = heated level above. */
  ceilingTypeId: string | null
  roofs: Roof[]
}

// ---- Spaces, slabs, roofs ----------------------------------------------------

export type RoomType =
  | 'living' | 'livingKitchen' | 'bedroom' | 'kids' | 'study' | 'dining' | 'guest'
  | 'kitchen' | 'kitchenette' | 'bath' | 'wc' | 'utility' | 'sauna'
  | 'hall' | 'storage' | 'technical' | 'other'

export interface Room {
  id: string
  name: string
  type: RoomType
  /** Point the room was created from (re-detected when walls change). */
  seed: Vec2
  polygon: Vec2[]
  area: number // m²
  /** Design internal temperature, °C; null = default for the room type. */
  tempInt: number | null
  persons: number | null
  /** Manual design airflows, m³/h (null = from the standard). */
  supplyOverride: number | null
  extractOverride: number | null
}

export interface Slab { typeId: string; polygon: Vec2[] }

export interface Roof {
  id: string
  typeId: string
  /** Convex outline (eave line), counter-clockwise. */
  outline: Vec2[]
  /** Pitch per outline edge i (outline[i]→outline[i+1]) in degrees; 0 = gable end / not sloped. */
  slopes: number[]
  /** Eave height above the level floor, m. */
  eaveHeight: number
}

// ---- Construction library ---------------------------------------------------

export interface Material {
  id: string
  name: string
  /** Design thermal conductivity λ, W/(m·K). */
  lambda: number
  /** Density ρ, kg/m³ (informative). */
  density?: number
  /** Where the λ value comes from (normative table, manufacturer declaration, user). */
  source: string
  /** False until checked against the cited source. */
  verified: boolean
}

export interface ConstructionLayer {
  materialId: string
  thickness: number // m
}

export type WallCategory = 'exterior' | 'interior'

export interface WallType {
  id: string
  name: string
  category: WallCategory
  /** Layers from exterior (or side A) to interior. */
  layers: ConstructionLayer[]
}

export type SlabCategory = 'ground' | 'intermediate' | 'roof' | 'ceiling-unheated'

export interface SlabType {
  id: string
  name: string
  category: SlabCategory
  /** Layers from exterior (bottom for floors, top for roofs) to interior. */
  layers: ConstructionLayer[]
}

// ---- HVAC catalog ---------------------------------------------------------------

export interface FanCurvePoint { q: number; dp: number } // m³/h, Pa (available external pressure)

export interface HrvUnitType {
  id: string
  name: string
  code: string
  price: number
  maxFlow: number // m³/h
  /** Available external static pressure at maximum speed. */
  curve: FanCurvePoint[]
  /** Temperature (heat) recovery efficiency, 0–1. */
  efficiency: number
  /** Specific fan power at nominal flow, W/(m³/h). */
  sfp: number
  /** A-weighted sound power level at the supply port at nominal flow, dB(A). */
  soundPower: number
  portDiameter: number // m
  source: string
  verified: boolean
}

export type DuctKind = 'rigid' | 'flex' | 'semirigid' | 'epp'

export interface DuctSize {
  id: string
  label: string
  /** Internal diameter for round, or width × height for rectangular/oval (m). */
  d?: number
  w?: number
  h?: number
  price: number // per m
  code: string
}

export interface DuctMaterial {
  id: string
  name: string
  kind: DuctKind
  shape: 'round' | 'rect' | 'oval'
  roughness: number // mm, absolute
  sizes: DuctSize[]
  /** Local loss coefficients for fittings made in this system. */
  zetaBend90: number
  zetaTeeBranch: number
  zetaTeeThrough: number
  /** Maximum design velocity, m/s (checked in the network analysis). */
  vMax: number
  source: string
  verified: boolean
}

export interface TerminalType {
  id: string
  name: string
  code: string
  use: 'supply' | 'extract' | 'both' | 'outdoor'
  dn: number // connection diameter, m
  /** Pressure drop at the design point: Δp = dpRef · (q / qRef)². */
  qRef: number
  dpRef: number
  maxFlow: number
  /** Sound power at qRef, dB(A). */
  lwRef: number
  price: number
  source: string
  verified: boolean
}

export interface PlenumType {
  id: string
  name: string
  code: string
  outlets: number
  /** Pressure drop at the design point: Δp = dpRef · (q / qRef)². */
  qRef: number
  dpRef: number
  /** Insertion loss (silencing) of the plenum, dB. */
  insertionLoss: number
  price: number
  source: string
  verified: boolean
}

export interface HvacCatalog {
  units: HrvUnitType[]
  ductMaterials: DuctMaterial[]
  terminals: TerminalType[]
  plenums: PlenumType[]
}

export interface Library {
  materials: Material[]
  wallTypes: WallType[]
  slabTypes: SlabType[]
  hvac: HvacCatalog
}

// ---- HVAC model ------------------------------------------------------------------

export type AirSystem = 'supply' | 'extract' | 'outdoor' | 'exhaust'
export interface Vec3 { x: number; y: number; z: number }

export interface HvacUnit { id: string; typeId: string; levelId: string; pos: Vec2; z: number; rotation: number }
export interface Plenum { id: string; typeId: string; levelId: string; pos: Vec2; z: number; system: 'supply' | 'extract' }
export interface Terminal {
  id: string; typeId: string; levelId: string; pos: Vec2; z: number
  system: AirSystem
  /** Design flow, m³/h; null = share of the room flow. */
  flowOverride: number | null
}
export interface Duct {
  id: string
  levelId: string
  system: AirSystem
  materialId: string
  sizeId: string
  /** Polyline; z absolute (m). */
  pts: Vec3[]
  /** Pinned size: auto-sizing will not change it. */
  locked: boolean
}

export interface HvacModel {
  units: HvacUnit[]
  plenums: Plenum[]
  terminals: Terminal[]
  ducts: Duct[]
}

// ---- Site, standards, energy -------------------------------------------------

export interface Locality {
  id: string
  name: string
  county: string
  /** Climatic zone I–V (SR 1907-1). */
  zone: 1 | 2 | 3 | 4 | 5
  /** Conventional outdoor design temperature, °C. */
  thetaE: number
  /** Heating degree-days (base 20/12 °C), K·day. */
  hdd: number
  verified: boolean
}

export interface RoomRule {
  /** DIN 1946-6: supply distribution factor f_R,zu. */
  supplyFactor?: number
  /** Fixed supply flow per room, m³/h. */
  supplyFixed?: number
  /** Supply per m² floor area, m³/(h·m²). */
  supplyPerM2?: number
  /** Supply per person, m³/(h·pers). */
  supplyPerPerson?: number
  /** Minimum extract, m³/h. */
  extract?: number
  /** Design internal temperature, °C. */
  tempInt: number
  /** Noise limit LAeq,nT, dB(A). */
  noiseLimit?: number
  verified: boolean
}

export interface NormProfile {
  id: string
  name: string
  method: 'din1946' | 'perRoom'
  /** DIN 1946-6 ventilation level factor f_Lst (nominal = 1). */
  levelFactor: number
  rooms: Record<RoomType, RoomRule>
  source: string
}

export interface SiteSettings {
  localityId: string
  /** Manual override of θe, °C. */
  thetaEOverride: number | null
  /** Infiltration air change rate, 1/h. */
  infiltrationACH: number
  /** Thermal bridge allowance ΔU_TB, W/(m²K). */
  thermalBridge: number
  energyPrice: number // lei/kWh heat
  electricityPrice: number // lei/kWh
  heatingEfficiency: number // 0–1 seasonal
  fanHours: number // h/year
}

/**
 * Which face of the wall lies on the drawn reference line, relative to the drawing direction a→b.
 * 'left'  = the reference line is the left face, the wall body extends to the right.
 */
export type WallJustification = 'center' | 'left' | 'right'

export type OpeningKind = 'door' | 'window'

/** A door or window hosted in a wall; positioned along the wall's reference line from `a`. */
export interface Opening {
  id: string
  kind: OpeningKind
  /** Distance from wall.a to the opening centre, along a→b, m. */
  offset: number
  width: number // m
  height: number // m
  sill: number // m above floor level (0 for doors)
  /** Door hinge at the end nearer to a ('start') or b ('end'). */
  hinge: 'start' | 'end'
  /** Door leaf opens towards the wall's left or right side (relative to a→b). */
  swing: 'left' | 'right'
  /** Thermal transmittance Uw / Ud, W/m²K (used by heat-load calculation). */
  U: number
}

export interface Wall {
  id: string
  typeId: string
  a: Vec2
  b: Vec2
  justification: WallJustification
  /** Unconnected height in m; null = level height. */
  height: number | null
  openings?: Opening[]
}

export type DisplayUnit = 'mm' | 'cm' | 'm'
export type CheckMode = 'strict' | 'advisory'
export type Language = 'ro' | 'en'

export interface ProjectSettings {
  displayUnit: DisplayUnit
  checkMode: CheckMode
  ventilationNorm: 'I5-2022' | 'DIN 1946-6' | 'SR EN 16798-1' | 'custom'
  /** Duct elevation default: distance below the ceiling, m. */
  ductBelowCeiling: number
}

export interface Project {
  format: 'hrvcad'
  version: 1
  name: string
  createdAt: string
  modifiedAt: string
  settings: ProjectSettings
  library: Library
  levels: Level[]
  hvac: HvacModel
  site: SiteSettings
  norms: NormProfile[]
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function newLevel(name: string, elevation: number, height: number): Level {
  return { id: newId('lvl'), name, elevation, height, underlays: [], walls: [], rooms: [], slab: null, ceilingTypeId: 'st_attic_vata25', roofs: [] }
}

export interface ProjectDefaults { library: Library; site: SiteSettings; norms: NormProfile[] }

export function createProject(name: string, defaults: ProjectDefaults): Project {
  const now = new Date().toISOString()
  return {
    format: 'hrvcad',
    version: 1,
    name,
    createdAt: now,
    modifiedAt: now,
    settings: { displayUnit: 'm', checkMode: 'advisory', ventilationNorm: 'DIN 1946-6', ductBelowCeiling: 0.25 },
    library: structuredClone(defaults.library),
    site: structuredClone(defaults.site),
    norms: structuredClone(defaults.norms),
    levels: [newLevel('Parter', 0, 2.8)],
    hvac: { units: [], plenums: [], terminals: [], ducts: [] }
  }
}
