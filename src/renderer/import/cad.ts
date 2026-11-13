// DWG / DXF import via LibreDWG (WebAssembly). Normalises model-space entities into
// per-layer line segments, snap points and texts, rebased so coordinates stay small.
import type { UnderlayLayer, UnderlayText, VectorUnderlay, Vec2 } from '../core/types'
import { newId } from '../core/types'
import { guessUnitFactor, insunitsToMetres, plausibleFootprint } from '../core/geom'
import { aciToHex } from './aci'

type Any = any // LibreDWG's converted database is loosely typed across entity kinds

let libPromise: Promise<Any> | null = null
async function getLib(): Promise<Any> {
  if (!libPromise) {
    libPromise = (async () => {
      const mod: Any = await import('@mlightcad/libredwg-web')
      const base = new URL('./wasm', document.baseURI).href
      return mod.LibreDwg.create(base)
    })()
  }
  return libPromise
}

/** 2D affine matrix [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f */
type M = [number, number, number, number, number, number]
const I: M = [1, 0, 0, 1, 0, 0]
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
]
const ap = (m: M, x: number, y: number): Vec2 => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
const mScale = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
const mRot = (m: M) => Math.atan2(m[1], m[0])

const ARC_SEG_RAD = Math.PI / 24 // 7.5° per chord

export interface CadParseResult {
  underlay: VectorUnderlay
  needsCalibration: boolean
  rawExtent: { width: number; height: number }
  entityCount: number
  skipped: Record<string, number>
}

export async function importCad(name: string, bytes: Uint8Array): Promise<CadParseResult> {
  const lib = await getLib()
  const isDxf = /\.dxf$/i.test(name)
  const mod: Any = await import('@mlightcad/libredwg-web')
  const fileType = isDxf ? mod.Dwg_File_Type.DXF : mod.Dwg_File_Type.DWG
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const ptr = lib.dwg_read_data(isDxf ? new TextDecoder().decode(bytes) : buf, fileType)
  if (ptr == null) throw new Error('cad.readFailed')
  let db: Any
  try {
    db = lib.convert(ptr)
  } finally {
    try { lib.dwg_free(ptr) } catch { /* already freed */ }
  }
  return normaliseDatabase(name, isDxf ? 'dxf' : 'dwg', db)
}

export function normaliseDatabase(name: string, fmt: 'dwg' | 'dxf', db: Any): CadParseResult {
  const layerColor = new Map<string, string>()
  const layerOff = new Set<string>()
  for (const l of db.tables?.LAYER?.entries ?? []) {
    layerColor.set(l.name, aciToHex(Math.abs(l.colorIndex ?? 7)))
    if (l.off || l.frozen || l.colorIndex < 0) layerOff.add(l.name)
  }
  const blocks = new Map<string, Any>()
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) blocks.set(b.name, b)

  const segs = new Map<string, number[]>()
  const snaps = new Map<string, number[]>()
  const texts: UnderlayText[] = []
  const skipped: Record<string, number> = {}
  let count = 0
  const segOf = (l: string) => { let s = segs.get(l); if (!s) segs.set(l, (s = [])); return s }
  const snapOf = (l: string) => { let s = snaps.get(l); if (!s) snaps.set(l, (s = [])); return s }

  const addPolyline = (layer: string, pts: Vec2[], closed: boolean) => {
    const s = segOf(layer)
    for (let i = 0; i + 1 < pts.length; i++) s.push(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y)
    if (closed && pts.length > 2) s.push(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y)
  }
  const addSnap = (layer: string, p: Vec2) => snapOf(layer).push(p.x, p.y)

  const arcPoints = (m: M, cx: number, cy: number, r: number, a0: number, a1: number): Vec2[] => {
    let sweep = a1 - a0
    while (sweep <= 0) sweep += Math.PI * 2
    const n = Math.max(2, Math.ceil(sweep / ARC_SEG_RAD))
    const pts: Vec2[] = []
    for (let i = 0; i <= n; i++) {
      const a = a0 + (sweep * i) / n
      pts.push(ap(m, cx + r * Math.cos(a), cy + r * Math.sin(a)))
    }
    return pts
  }

  // Bulge segment between p and q (DXF bulge = tan(θ/4)).
  const bulgePoints = (p: Vec2, q: Vec2, bulge: number): Vec2[] => {
    if (Math.abs(bulge) < 1e-9) return [p, q]
    const theta = 4 * Math.atan(bulge)
    const chord = Math.hypot(q.x - p.x, q.y - p.y)
    const r = chord / (2 * Math.sin(theta / 2))
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
    const h = r * Math.cos(theta / 2)
    const nx = -(q.y - p.y) / chord, ny = (q.x - p.x) / chord
    const cx = mx + nx * h, cy = my + ny * h
    const a0 = Math.atan2(p.y - cy, p.x - cx)
    const n = Math.max(2, Math.ceil(Math.abs(theta) / ARC_SEG_RAD))
    const out: Vec2[] = []
    for (let i = 0; i <= n; i++) {
      const a = a0 + (theta * i) / n
      out.push({ x: cx + Math.abs(r) * Math.cos(a), y: cy + Math.abs(r) * Math.sin(a) })
    }
    return out
  }

  const cleanMText = (s: string) =>
    s.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').replace(/\\~/g, ' ').trim()

  const walk = (entities: Any[], m: M, parentLayer: string | null, depth: number) => {
    if (depth > 12) return
    for (const e of entities) {
      if (e.isInPaperSpace || e.isVisible === false) continue
      // Entities on layer "0" inside a block inherit the INSERT's layer.
      const layer: string = e.layer === '0' && parentLayer ? parentLayer : e.layer ?? '0'
      count++
      switch (e.type) {
        case 'LINE': {
          const a = ap(m, e.startPoint.x, e.startPoint.y), b = ap(m, e.endPoint.x, e.endPoint.y)
          segOf(layer).push(a.x, a.y, b.x, b.y)
          addSnap(layer, a); addSnap(layer, b)
          addSnap(layer, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
          break
        }
        case 'LWPOLYLINE':
        case 'POLYLINE2D': {
          const v: Any[] = e.vertices ?? []
          const closed = (e.flag & 1) === 1
          const pts: Vec2[] = []
          for (let i = 0; i < v.length; i++) {
            const p = { x: v[i].x ?? v[i].point?.x, y: v[i].y ?? v[i].point?.y }
            const nxt = v[(i + 1) % v.length]
            const isLast = i === v.length - 1
            if (isLast && !closed) { pts.push(p); break }
            const q = { x: nxt.x ?? nxt.point?.x, y: nxt.y ?? nxt.point?.y }
            const arc = bulgePoints(p, q, v[i].bulge ?? 0)
            pts.push(...arc.slice(0, -1))
            if (isLast) pts.push(arc[arc.length - 1])
          }
          const wp = pts.map(p => ap(m, p.x, p.y))
          addPolyline(layer, wp, false)
          for (const vv of v) addSnap(layer, ap(m, vv.x ?? vv.point?.x, vv.y ?? vv.point?.y))
          break
        }
        case 'POLYLINE3D': {
          const pts = (e.vertices ?? []).map((v: Any) => ap(m, v.point?.x ?? v.x, v.point?.y ?? v.y))
          addPolyline(layer, pts, (e.flag & 1) === 1)
          pts.forEach((p: Vec2) => addSnap(layer, p))
          break
        }
        case 'ARC': {
          const pts = arcPoints(m, e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle)
          addPolyline(layer, pts, false)
          addSnap(layer, pts[0]); addSnap(layer, pts[pts.length - 1])
          addSnap(layer, ap(m, e.center.x, e.center.y))
          break
        }
        case 'CIRCLE': {
          const pts = arcPoints(m, e.center.x, e.center.y, e.radius, 0, Math.PI * 2)
          addPolyline(layer, pts, false)
          addSnap(layer, ap(m, e.center.x, e.center.y))
          break
        }
        case 'ELLIPSE': {
          const c = e.center, ax = e.majorAxisEndPoint
          const R = Math.hypot(ax.x, ax.y), rot = Math.atan2(ax.y, ax.x), r2 = R * e.axisRatio
          let a0 = e.startAngle ?? 0, a1 = e.endAngle ?? Math.PI * 2
          let sweep = a1 - a0; while (sweep <= 0) sweep += Math.PI * 2
          const n = Math.max(8, Math.ceil(sweep / ARC_SEG_RAD))
          const pts: Vec2[] = []
          for (let i = 0; i <= n; i++) {
            const t = a0 + (sweep * i) / n
            const x = R * Math.cos(t), y = r2 * Math.sin(t)
            pts.push(ap(m, c.x + x * Math.cos(rot) - y * Math.sin(rot), c.y + x * Math.sin(rot) + y * Math.cos(rot)))
          }
          addPolyline(layer, pts, false)
          addSnap(layer, ap(m, c.x, c.y))
          break
        }
        case 'SPLINE': {
          const src: Any[] = e.fitPoints?.length ? e.fitPoints : e.controlPoints ?? []
          addPolyline(layer, src.map((p: Any) => ap(m, p.x, p.y)), (e.flag & 1) === 1)
          break
        }
        case 'TEXT':
        case 'MTEXT': {
          const p = e.type === 'TEXT' ? e.startPoint : e.insertionPoint
          if (!p || !e.text) break
          const wp = ap(m, p.x, p.y)
          texts.push({
            layer, x: wp.x, y: wp.y,
            height: (e.textHeight ?? 1) * mScale(m),
            rotation: (e.rotation ?? 0) + mRot(m),
            text: e.type === 'MTEXT' ? cleanMText(e.text) : e.text
          })
          break
        }
        case 'INSERT': {
          const b = blocks.get(e.name)
          if (!b?.entities) { skipped.INSERT = (skipped.INSERT ?? 0) + 1; break }
          const bp = b.basePoint ?? { x: 0, y: 0 }
          const sx = e.xScale ?? 1, sy = e.yScale ?? 1, r = e.rotation ?? 0
          const cols = Math.max(1, e.columnCount ?? 1), rows = Math.max(1, e.rowCount ?? 1)
          for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
            const ix = e.insertionPoint.x + ci * (e.columnSpacing ?? 0)
            const iy = e.insertionPoint.y + ri * (e.rowSpacing ?? 0)
            const local: M = mul(
              [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), ix, iy],
              [sx, 0, 0, sy, -bp.x * sx, -bp.y * sy]
            )
            walk(b.entities, mul(m, local), layer, depth + 1)
          }
          addSnap(layer, ap(m, e.insertionPoint.x, e.insertionPoint.y))
          break
        }
        default:
          skipped[e.type] = (skipped[e.type] ?? 0) + 1
      }
    }
  }
  walk(db.entities ?? [], I, null, 0)

  // Bounds over all geometry, then rebase to (0,0).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const grow = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y
  }
  // Bounds use only layers shown by default: Defpoints/off layers often hold far-away viewport frames.
  const hiddenByDefault = (n: string) => layerOff.has(n) || n.toLowerCase() === 'defpoints'
  for (const [n, s] of segs) if (!hiddenByDefault(n)) for (let i = 0; i < s.length; i += 2) grow(s[i], s[i + 1])
  if (!Number.isFinite(minX)) for (const s of segs.values()) for (let i = 0; i < s.length; i += 2) grow(s[i], s[i + 1])
  if (!Number.isFinite(minX)) throw new Error('cad.empty')
  const ox = minX, oy = minY
  const rebase = (arr: number[]) => { for (let i = 0; i < arr.length; i += 2) { arr[i] -= ox; arr[i + 1] -= oy } }
  for (const s of segs.values()) rebase(s)
  for (const s of snaps.values()) rebase(s)
  for (const t of texts) { t.x -= ox; t.y -= oy }

  const layerNames = new Set<string>([...segs.keys(), ...texts.map(t => t.layer)])
  const layers: UnderlayLayer[] = [...layerNames].sort().map(n => ({
    name: n,
    color: layerColor.get(n) ?? '#555555',
    visible: !hiddenByDefault(n),
    segments: segs.get(n) ?? [],
    snaps: snaps.get(n) ?? []
  }))

  const width = maxX - minX, height = maxY - minY
  const declared = insunitsToMetres(db.header?.INSUNITS)
  let factor = declared.factor
  const plausible = plausibleFootprint(width * factor, height * factor)
  if (!plausible) factor = guessUnitFactor(Math.max(width, height))

  const underlay: VectorUnderlay = {
    id: newId('ul'),
    kind: 'vector',
    sourceFormat: fmt,
    name,
    declaredUnits: declared.name,
    sourceOrigin: { x: ox, y: oy },
    bounds: { min: { x: 0, y: 0 }, max: { x: width, y: height } },
    layers,
    texts,
    transform: { scale: factor, rotation: 0, offset: { x: 0, y: 0 } },
    opacity: 1,
    locked: false,
    visible: true,
    calibrated: false
  }
  return { underlay, needsCalibration: !plausible, rawExtent: { width, height }, entityCount: count, skipped }
}
