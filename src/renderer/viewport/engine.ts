// Three.js viewport: 2D plan (orthographic, top view of the active level) and 3D model (perspective, all levels).
// World units are metres; plan in the XY plane, Z up.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Level, Library, RasterUnderlay, Underlay, Vec2, VectorUnderlay } from '../core/types'
import { activeLevel, bus, store, type AppState } from '../core/store'
import { applyTransform } from '../core/geom'
import { clipBand, faceOffsets, norm as vnorm, pointInPolygon, sub as vsub, wallPieces, wallPolygons, wallThickness } from '../core/walls'
import { gripTool } from '../tools/modifyTools'
import { tools, type OverlayShape } from '../tools/tool'
import { computeSnap, type SnapResult, type SnapSource } from './snap'

const SNAP_PX = 12
const BG = 0xfbfcfd

interface UnderlayEntry { ref: Underlay; elevation: number; obj: THREE.Object3D; snap: SnapSource }
interface WallEntry {
  walls: Level['walls']; lib: Library; elevation: number; height: number; selected: string
  obj: THREE.Group; g3: THREE.Group; g2: THREE.Group; polys: Map<string, Vec2[]>; snap: SnapSource
  openings: Map<string, Vec2[]>
}

export class Viewport {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
  private persp = new THREE.PerspectiveCamera(45, 1, 0.05, 2000)
  private controls: OrbitControls
  private grid = new THREE.Group()
  private underlayRoot = new THREE.Group()
  private entries = new Map<string, UnderlayEntry>()
  private wallEntries = new Map<string, WallEntry>()
  private wallRoot = new THREE.Group()
  private acquired: Vec2[] = []
  private textures = new Map<string, THREE.Texture>()
  private w = 1
  private h = 1
  private center: Vec2 = { x: 5, y: 4 }
  private pxPerM = 50
  private raf = 0
  private lastState: AppState | null = null
  private panning: { x: number; y: number } | null = null
  private downAt: { x: number; y: number; t: number } | null = null
  private lastMiddleDown = 0
  private spaceDown = false
  private hover: SnapResult | null = null
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null
  private screen: { x: number; y: number } | null = null
  private unsub: () => void
  private ro: ResizeObserver

  constructor(private host: HTMLDivElement, private overlay: SVGSVGElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(BG)
    host.prepend(this.renderer.domElement)
    this.scene.add(this.grid, this.underlayRoot, this.wallRoot)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d3dc, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(-30, -50, 80)
    this.scene.add(sun)
    this.ortho.position.set(0, 0, 500)
    this.ortho.up.set(0, 1, 0)
    this.persp.up.set(0, 0, 1)
    this.persp.position.set(-12, -16, 14)
    this.controls = new OrbitControls(this.persp, this.renderer.domElement)
    this.controls.enableDamping = false
    this.controls.screenSpacePanning = true
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
    this.controls.addEventListener('change', () => this.requestRender())
    this.buildGrid()

    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointerleave', () => { this.hover = null; this.screen = null; this.drawOverlay() })
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('contextmenu', e => e.preventDefault())
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKeyUp)
    bus.addEventListener('zoomExtents', this.zoomExtents)
    bus.addEventListener('overlay', this.onOverlayEvent)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.unsub = store.subscribe(() => this.sync(store.get()))
    this.resize()
    this.sync(store.get())
    this.zoomExtents()
  }

  dispose() {
    this.unsub()
    this.ro.disconnect()
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKeyUp)
    bus.removeEventListener('zoomExtents', this.zoomExtents)
    bus.removeEventListener('overlay', this.onOverlayEvent)
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ---------------------------------------------------------------- state sync
  private is3D() { return store.get().ui.viewMode === '3d' }

  private sync(s: AppState) {
    const prev = this.lastState
    this.lastState = s
    const modeChanged = !prev || prev.ui.viewMode !== s.ui.viewMode
    if (prev && prev.project === s.project && !modeChanged && prev.ui.activeLevelId === s.ui.activeLevelId &&
        prev.ui.grid === s.ui.grid && prev.ui.selectedUnderlayId === s.ui.selectedUnderlayId &&
        prev.ui.selectedWallIds === s.ui.selectedWallIds && prev.ui.selectedOpeningId === s.ui.selectedOpeningId &&
        prev.ui.activeTool === s.ui.activeTool) return

    this.grid.visible = s.ui.grid
    const active = activeLevel(s)
    const seen = new Set<string>()
    for (const level of s.project.levels) {
      for (const u of level.underlays) {
        seen.add(u.id)
        const e = this.entries.get(u.id)
        if (!e || e.ref !== u || e.elevation !== level.elevation) {
          if (e) this.disposeObj(e.obj)
          this.entries.set(u.id, this.buildUnderlay(u, level))
        }
        const entry = this.entries.get(u.id)!
        const onActive = level.id === active.id
        entry.obj.visible = u.visible && (this.is3D() || onActive)
        this.setOpacity(entry.obj, u.opacity * (this.is3D() && !onActive ? 0.35 : 1))
      }
    }
    for (const [id, e] of this.entries) if (!seen.has(id)) { this.disposeObj(e.obj); this.entries.delete(id) }

    const seenLevels = new Set<string>()
    for (const level of s.project.levels) {
      seenLevels.add(level.id)
      const e = this.wallEntries.get(level.id)
      const sel = s.ui.selectedWallIds.join(',') + '|' + (s.ui.selectedOpeningId ?? '')
      if (!e || e.walls !== level.walls || e.lib !== s.project.library || e.elevation !== level.elevation ||
          e.height !== level.height || e.selected !== sel) {
        if (e) this.disposeObj(e.obj)
        this.wallEntries.set(level.id, this.buildWalls(level, s.project.library, s.ui.selectedWallIds, s.ui.selectedOpeningId, sel))
      }
      const we = this.wallEntries.get(level.id)!
      const onActive = level.id === active.id
      we.obj.visible = this.is3D() || onActive
      we.g3.visible = this.is3D()
      we.g2.visible = !this.is3D()
    }
    for (const [id, e] of this.wallEntries) if (!seenLevels.has(id)) { this.disposeObj(e.obj); this.wallEntries.delete(id) }

    // Tools pick in 3D too; free the left button from orbiting while a tool is active.
    this.controls.mouseButtons.LEFT = s.ui.activeTool ? (null as any) : THREE.MOUSE.ROTATE
    this.controls.enabled = this.is3D()
    this.grid.position.z = this.is3D() ? 0 : active.elevation - 0.01
    if (modeChanged) this.resize()
    this.requestRender()
    this.drawOverlay()
  }

  private buildUnderlay(u: Underlay, level: Level): UnderlayEntry {
    const g = new THREE.Group()
    g.position.set(u.transform.offset.x, u.transform.offset.y, level.elevation + 0.002)
    g.rotation.z = u.transform.rotation
    g.scale.set(u.transform.scale, u.transform.scale, 1)
    const snap: SnapSource = { points: new Float64Array(0), segs: new Float64Array(0) }
    if (u.kind === 'vector') {
      this.buildVector(g, u)
      const pts: number[] = [], segs: number[] = []
      for (const l of u.layers) {
        if (!l.visible) continue
        for (let i = 0; i < l.snaps.length; i += 2) {
          const p = applyTransform(u.transform, { x: l.snaps[i], y: l.snaps[i + 1] })
          pts.push(p.x, p.y)
        }
        for (let i = 0; i < l.segments.length; i += 4) {
          const a = applyTransform(u.transform, { x: l.segments[i], y: l.segments[i + 1] })
          const b = applyTransform(u.transform, { x: l.segments[i + 2], y: l.segments[i + 3] })
          segs.push(a.x, a.y, b.x, b.y)
        }
      }
      snap.points = new Float64Array(pts)
      snap.segs = new Float64Array(segs)
    } else {
      this.buildRaster(g, u)
      const c = [[0, 0], [u.pxWidth, 0], [u.pxWidth, u.pxHeight], [0, u.pxHeight]]
      snap.points = new Float64Array(c.flatMap(([x, y]) => { const p = applyTransform(u.transform, { x, y }); return [p.x, p.y] }))
    }
    this.underlayRoot.add(g)
    return { ref: u, elevation: level.elevation, obj: g, snap }
  }

  private buildVector(g: THREE.Group, u: VectorUnderlay) {
    for (const l of u.layers) {
      if (!l.visible) continue
      if (l.segments.length) {
        const geo = new THREE.BufferGeometry()
        const pos = new Float32Array((l.segments.length / 2) * 3)
        for (let i = 0, j = 0; i < l.segments.length; i += 2, j += 3) { pos[j] = l.segments[i]; pos[j + 1] = l.segments[i + 1] }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(l.color), transparent: true })
        g.add(new THREE.LineSegments(geo, mat))
      }
    }
    const visibleLayers = new Set(u.layers.filter(l => l.visible).map(l => l.name))
    for (const tx of u.texts) {
      if (!visibleLayers.has(tx.layer)) continue
      const m = this.textMesh(tx.text, tx.height, u.layers.find(l => l.name === tx.layer)?.color ?? '#333')
      m.position.set(tx.x, tx.y, 0.001)
      m.rotation.z = tx.rotation
      g.add(m)
    }
  }

  private buildWalls(level: Level, lib: Library, selIds: string[], selOpening: string | null, selKey: string): WallEntry {
    const CUT_Z = 1.2 // plan cut height, m
    const g = new THREE.Group(), g3 = new THREE.Group(), g2 = new THREE.Group()
    g.add(g3, g2)
    const polys = wallPolygons(level.walls, lib)
    const openings = new Map<string, Vec2[]>()
    const pts: number[] = [], segs: number[] = []
    const sel = new Set(selIds)
    const isInterior = (typeId: string) => lib.wallTypes.find(t => t.id === typeId)?.category === 'interior'
    const sym: number[] = [], symSel: number[] = []
    const glass: THREE.BufferGeometry[] = []
    const z0 = level.elevation
    for (const w of level.walls) {
      const poly = polys.get(w.id)
      if (!poly) continue
      const h = w.height ?? level.height
      const isSel = sel.has(w.id)
      const color = isSel ? 0x209ed9 : isInterior(w.typeId) ? 0xb8c2cc : 0x8796a5
      const mat3 = new THREE.MeshLambertMaterial({ color })
      const edgeMat = new THREE.LineBasicMaterial({ color: isSel ? 0x0e6e9c : 0x2d3a46, transparent: true, opacity: 0.85 })
      const mat2 = new THREE.MeshBasicMaterial({ color: isSel ? 0x209ed9 : isInterior(w.typeId) ? 0x9aa6b2 : 0x5f6e7d, transparent: true, opacity: 0.78, depthWrite: false })
      for (const pc of wallPieces(w, poly, h)) {
        const shape = new THREE.Shape(pc.poly.map(p => new THREE.Vector2(p.x, p.y)))
        const geo = new THREE.ExtrudeGeometry(shape, { depth: pc.z1 - pc.z0, bevelEnabled: false })
        const mesh = new THREE.Mesh(geo, mat3)
        mesh.position.z = z0 + pc.z0
        g3.add(mesh)
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat)
        edges.position.z = z0 + pc.z0
        g3.add(edges)
        if (pc.z0 <= CUT_Z && pc.z1 > CUT_Z) {
          const flat = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat2)
          flat.position.z = z0 + 0.05
          g2.add(flat)
          const outline: number[] = []
          for (let i = 0; i < pc.poly.length; i++) {
            const a = pc.poly[i], b = pc.poly[(i + 1) % pc.poly.length]
            outline.push(a.x, a.y, 0, b.x, b.y, 0)
          }
          const og = new THREE.BufferGeometry()
          og.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3))
          const ol = new THREE.LineSegments(og, edgeMat)
          ol.position.z = z0 + 0.06
          g2.add(ol)
        }
      }
      // Openings: plan symbols, glass panes, hit areas
      const d = vnorm(vsub(w.b, w.a)), n = { x: -d.y, y: d.x }
      const { L: fL, R: fR } = faceOffsets(w.justification, wallThickness(w, lib))
      const P = (s: number, o: number) => ({ x: w.a.x + d.x * s + n.x * o, y: w.a.y + d.y * s + n.y * o })
      for (const o of w.openings ?? []) {
        const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2
        const band = clipBand(poly, w.a, d, s0, s1)
        if (band.length) openings.set(o.id, band)
        const out = o.id === selOpening || isSel ? symSel : sym
        const line = (a: Vec2, b: Vec2) => out.push(a.x, a.y, 0, b.x, b.y, 0)
        line(P(s0, fL), P(s0, fR)); line(P(s1, fL), P(s1, fR))
        if (o.kind === 'window') {
          line(P(s0, fL), P(s1, fL)); line(P(s0, fR), P(s1, fR))
          const m = (fL + fR) / 2
          line(P(s0, m + 0.02), P(s1, m + 0.02)); line(P(s0, m - 0.02), P(s1, m - 0.02))
          const pg = new THREE.PlaneGeometry(o.width, o.height)
          pg.rotateX(Math.PI / 2)
          pg.rotateZ(Math.atan2(d.y, d.x))
          const c = P(o.offset, m)
          pg.translate(c.x, c.y, z0 + o.sill + o.height / 2)
          glass.push(pg)
        } else {
          const face = o.swing === 'left' ? fL : fR
          const sign = o.swing === 'left' ? 1 : -1
          const hs = o.hinge === 'start' ? s0 : s1, fs = o.hinge === 'start' ? s1 : s0
          const hinge = P(hs, face)
          const tip = { x: hinge.x + n.x * sign * o.width, y: hinge.y + n.y * sign * o.width }
          line(hinge, tip)
          // quarter arc from the leaf tip back to the closed position
          const a0 = Math.atan2(tip.y - hinge.y, tip.x - hinge.x)
          const closed = P(fs, face)
          let a1 = Math.atan2(closed.y - hinge.y, closed.x - hinge.x)
          let da = a1 - a0
          while (da > Math.PI) da -= 2 * Math.PI
          while (da < -Math.PI) da += 2 * Math.PI
          const N = 16
          for (let i = 0; i < N; i++) {
            const t0 = a0 + (da * i) / N, t1 = a0 + (da * (i + 1)) / N
            line({ x: hinge.x + Math.cos(t0) * o.width, y: hinge.y + Math.sin(t0) * o.width },
                 { x: hinge.x + Math.cos(t1) * o.width, y: hinge.y + Math.sin(t1) * o.width })
          }
        }
        pts.push(P(o.offset, fL).x, P(o.offset, fL).y, P(o.offset, fR).x, P(o.offset, fR).y)
      }
      for (let i = 0; i < 4; i++) {
        const a = poly[i], b = poly[(i + 1) % 4]
        pts.push(a.x, a.y)
        segs.push(a.x, a.y, b.x, b.y)
      }
      pts.push(w.a.x, w.a.y, w.b.x, w.b.y, (w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2)
    }
    const addLines = (arr: number[], color: number) => {
      if (!arr.length) return
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }))
      l.position.z = z0 + 0.08
      g2.add(l)
    }
    addLines(sym, 0x1d2731)
    addLines(symSel, 0x0e6e9c)
    if (glass.length) {
      const gm = new THREE.MeshLambertMaterial({ color: 0x9fd3ef, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
      for (const pg of glass) g3.add(new THREE.Mesh(pg, gm))
    }
    this.wallRoot.add(g)
    return {
      walls: level.walls, lib, elevation: level.elevation, height: level.height, selected: selKey, obj: g, g3, g2, polys, openings,
      snap: { points: new Float64Array(pts), segs: new Float64Array(segs) }
    }
  }

  private textMesh(text: string, height: number, color: string): THREE.Mesh {
    const px = 64
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')!
    ctx.font = `${px}px Arial, sans-serif`
    const w = Math.max(1, Math.ceil(ctx.measureText(text).width))
    c.width = w + 4
    c.height = Math.ceil(px * 1.25)
    ctx.font = `${px}px Arial, sans-serif`
    ctx.fillStyle = color
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(text, 2, px)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const k = height / px
    const geo = new THREE.PlaneGeometry(c.width * k, c.height * k)
    // Anchor at baseline-left like DXF TEXT insertion points.
    geo.translate((c.width * k) / 2, (c.height * k) / 2 - (c.height - px) * k, 0)
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
  }

  private buildRaster(g: THREE.Group, u: RasterUnderlay) {
    let tex = this.textures.get(u.dataUrl)
    if (!tex) {
      tex = new THREE.TextureLoader().load(u.dataUrl, () => this.requestRender())
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 8
      this.textures.set(u.dataUrl, tex)
    }
    const geo = new THREE.PlaneGeometry(u.pxWidth, u.pxHeight)
    geo.translate(u.pxWidth / 2, u.pxHeight / 2, 0)
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }))
    g.add(mesh)
  }

  private setOpacity(obj: THREE.Object3D, opacity: number) {
    obj.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (m && 'opacity' in m) m.opacity = opacity
    })
  }

  private disposeObj(obj: THREE.Object3D) {
    obj.traverse(o => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose()
      const m = mesh.material as THREE.MeshBasicMaterial | undefined
      if (m) {
        if (m.map && m.map instanceof THREE.CanvasTexture) m.map.dispose()
        m.dispose()
      }
    })
    obj.removeFromParent()
  }

  private buildGrid() {
    const minor: number[] = [], major: number[] = []
    const N = 100
    for (let i = -N; i <= N; i++) {
      const arr = i % 5 === 0 ? major : minor
      arr.push(i, -N, 0, i, N, 0, -N, i, 0, N, i, 0)
    }
    const mk = (arr: number[], color: number) => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }))
    }
    this.grid.add(mk(minor, 0xeef1f4), mk(major, 0xdce2e8))
    const axes = new THREE.BufferGeometry()
    axes.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0], 3))
    axes.setAttribute('color', new THREE.Float32BufferAttribute([0.85, 0.2, 0.2, 0.85, 0.2, 0.2, 0.2, 0.65, 0.2, 0.2, 0.65, 0.2], 3))
    this.grid.add(new THREE.LineSegments(axes, new THREE.LineBasicMaterial({ vertexColors: true })))
    this.grid.renderOrder = -1
  }

  // ---------------------------------------------------------------- camera
  private resize() {
    const r = this.host.getBoundingClientRect()
    this.w = Math.max(1, Math.floor(r.width))
    this.h = Math.max(1, Math.floor(r.height))
    this.renderer.setSize(this.w, this.h)
    this.overlay.setAttribute('viewBox', `0 0 ${this.w} ${this.h}`)
    this.persp.aspect = this.w / this.h
    this.persp.updateProjectionMatrix()
    this.updateOrtho()
    this.requestRender()
    this.drawOverlay()
  }

  private updateOrtho() {
    const hw = this.w / 2 / this.pxPerM, hh = this.h / 2 / this.pxPerM
    const z = activeLevel().elevation
    this.ortho.left = -hw; this.ortho.right = hw; this.ortho.top = hh; this.ortho.bottom = -hh
    this.ortho.position.set(this.center.x, this.center.y, z + 500)
    this.ortho.lookAt(this.center.x, this.center.y, z)
    this.ortho.updateProjectionMatrix()
  }

  private camera(): THREE.Camera { return this.is3D() ? this.persp : this.ortho }

  zoomExtents = () => {
    const s = store.get()
    const levels = this.is3D() ? s.project.levels : [activeLevel(s)]
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let maxZ = 0
    for (const l of levels) for (const u of l.underlays) {
      if (!u.visible) continue
      const [w, h] = u.kind === 'vector' ? [u.bounds.max.x, u.bounds.max.y] : [u.pxWidth, u.pxHeight]
      for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]]) {
        const p = applyTransform(u.transform, { x, y })
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
      }
      maxZ = Math.max(maxZ, l.elevation + l.height)
    }
    for (const l of levels) for (const w of l.walls) for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p.x - 0.5); minY = Math.min(minY, p.y - 0.5); maxX = Math.max(maxX, p.x + 0.5); maxY = Math.max(maxY, p.y + 0.5)
      maxZ = Math.max(maxZ, l.elevation + l.height)
    }
    if (!Number.isFinite(minX)) { minX = -2; minY = -2; maxX = 12; maxY = 10 }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY)
    this.center = { x: cx, y: cy }
    this.pxPerM = Math.min(this.w / bw, this.h / bh) * 0.88
    this.updateOrtho()
    const size = Math.max(bw, bh, maxZ)
    const d = (size / (2 * Math.tan((this.persp.fov * Math.PI) / 360))) * 1.25
    const z0 = activeLevel(s).elevation
    this.controls.target.set(cx, cy, z0)
    const dir = new THREE.Vector3(-0.55, -0.75, 0.62).normalize()
    this.persp.position.set(cx + dir.x * d, cy + dir.y * d, z0 + dir.z * d)
    this.controls.update()
    this.requestRender()
    this.drawOverlay()
  }

  // ---------------------------------------------------------------- picking
  screenToWorld(px: number, py: number): Vec2 | null {
    if (!this.is3D()) {
      return { x: this.center.x + (px - this.w / 2) / this.pxPerM, y: this.center.y - (py - this.h / 2) / this.pxPerM }
    }
    const ndc = new THREE.Vector2((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.persp)
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -activeLevel().elevation)
    const hit = new THREE.Vector3()
    return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.y } : null
  }

  worldToScreen(p: Vec2, z = activeLevel().elevation): { x: number; y: number } {
    if (!this.is3D()) return { x: (p.x - this.center.x) * this.pxPerM + this.w / 2, y: -(p.y - this.center.y) * this.pxPerM + this.h / 2 }
    const v = new THREE.Vector3(p.x, p.y, z).project(this.persp)
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h }
  }

  /** World size of one screen pixel at the given screen position. */
  private worldPerPx(px: number, py: number): number {
    if (!this.is3D()) return 1 / this.pxPerM
    const a = this.screenToWorld(px, py), b = this.screenToWorld(px + 1, py)
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0.01
  }

  private findSnap(px: number, py: number, world: Vec2): SnapResult {
    const s = store.get()
    if (!s.ui.snap) return { world, kind: 'none' }
    const lvl = activeLevel(s)
    const sources: SnapSource[] = []
    for (const u of lvl.underlays) {
      if (!u.visible) continue
      const e = this.entries.get(u.id)
      if (e) sources.push(e.snap)
    }
    const we = this.wallEntries.get(lvl.id)
    if (we) sources.push(we.snap)
    const res = computeSnap({
      cursor: world, tol: SNAP_PX * this.worldPerPx(px, py), base: tools.active?.basePoint() ?? null,
      acquired: this.acquired, sources
    })
    if (res.kind === 'end' && !this.acquired.some(p => p.x === res.world.x && p.y === res.world.y)) {
      this.acquired = [res.world, ...this.acquired].slice(0, 6)
    }
    return res
  }

  private hitOpening(p: Vec2): string | null {
    const we = this.wallEntries.get(activeLevel().id)
    if (!we) return null
    for (const [id, poly] of we.openings) if (pointInPolygon(p, poly)) return id
    return null
  }

  /** Wall endpoint grip under the cursor (screen distance), for selected walls. */
  private hitGrip(px: number, py: number): { wallId: string; end: 'a' | 'b' } | null {
    const s = store.get()
    for (const id of s.ui.selectedWallIds) {
      const w = activeLevel(s).walls.find(x => x.id === id)
      if (!w) continue
      for (const end of ['a', 'b'] as const) {
        const q = this.worldToScreen(w[end])
        if (Math.hypot(q.x - px, q.y - py) < 8) return { wallId: id, end }
      }
    }
    return null
  }

  /** Walls inside (window) or touching (crossing) a screen rectangle. */
  private wallsInBox(b: { x0: number; y0: number; x1: number; y1: number }, crossing: boolean): string[] {
    const we = this.wallEntries.get(activeLevel().id)
    if (!we) return []
    const xmin = Math.min(b.x0, b.x1), xmax = Math.max(b.x0, b.x1), ymin = Math.min(b.y0, b.y1), ymax = Math.max(b.y0, b.y1)
    const inside = (q: { x: number; y: number }) => q.x >= xmin && q.x <= xmax && q.y >= ymin && q.y <= ymax
    const segHits = (p: { x: number; y: number }, q: { x: number; y: number }) => {
      // Liang–Barsky clip of segment against the rectangle
      let t0 = 0, t1 = 1
      const dx = q.x - p.x, dy = q.y - p.y
      for (const [pp, qq] of [[-dx, p.x - xmin], [dx, xmax - p.x], [-dy, p.y - ymin], [dy, ymax - p.y]]) {
        if (pp === 0) { if (qq < 0) return false; continue }
        const r = qq / pp
        if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r } else { if (r < t0) return false; if (r < t1) t1 = r }
      }
      return true
    }
    const out: string[] = []
    for (const [id, poly] of we.polys) {
      const sp = poly.map(p => this.worldToScreen(p))
      const all = sp.every(inside)
      const any = crossing && (sp.some(inside) || sp.some((p, i) => segHits(p, sp[(i + 1) % sp.length])))
      if (all || any) out.push(id)
    }
    return out
  }

  /** Topmost wall under a world point on the active level. */
  private hitWall(p: Vec2): string | null {
    const we = this.wallEntries.get(activeLevel().id)
    if (!we) return null
    for (const [id, poly] of we.polys) if (pointInPolygon(p, poly)) return id
    return null
  }

  private hitUnderlay(p: Vec2): string | null {
    const lvl = activeLevel()
    for (let i = lvl.underlays.length - 1; i >= 0; i--) {
      const u = lvl.underlays[i]
      if (!u.visible) continue
      const [w, h] = u.kind === 'vector' ? [u.bounds.max.x, u.bounds.max.y] : [u.pxWidth, u.pxHeight]
      const c = Math.cos(-u.transform.rotation), sn = Math.sin(-u.transform.rotation)
      const dx = p.x - u.transform.offset.x, dy = p.y - u.transform.offset.y
      const lx = (c * dx - sn * dy) / u.transform.scale, ly = (sn * dx + c * dy) / u.transform.scale
      if (lx >= 0 && ly >= 0 && lx <= w && ly <= h) return u.id
    }
    return null
  }

  // ---------------------------------------------------------------- input
  private local(e: PointerEvent | WheelEvent) {
    const r = this.renderer.domElement.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private onDown = (e: PointerEvent) => {
    const p = this.local(e)
    this.downAt = { ...p, t: performance.now() }
    if (e.button === 1) {
      const now = performance.now()
      if (now - this.lastMiddleDown < 350) { this.zoomExtents(); e.preventDefault(); return }
      this.lastMiddleDown = now
    }
    if (this.is3D()) return
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.panning = p
      this.renderer.domElement.setPointerCapture(e.pointerId)
      e.preventDefault()
      return
    }
    // Left-drag on empty space (no tool) starts a selection window, like AutoCAD.
    if (e.button === 0 && !tools.active && !this.hitGrip(p.x, p.y)) {
      this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      this.renderer.domElement.setPointerCapture(e.pointerId)
    }
  }

  private onMove = (e: PointerEvent) => {
    const p = this.local(e)
    this.screen = p
    if (this.panning && !this.is3D()) {
      this.center.x -= (p.x - this.panning.x) / this.pxPerM
      this.center.y += (p.y - this.panning.y) / this.pxPerM
      this.panning = p
      this.updateOrtho()
      this.requestRender()
    }
    if (this.box) { this.box.x1 = p.x; this.box.y1 = p.y }
    const w = this.screenToWorld(p.x, p.y)
    if (w) {
      this.hover = this.findSnap(p.x, p.y, w)
      if (tools.active) tools.move(this.hover.world)
      this.throttledCursor(this.hover.world)
    } else this.hover = null
    this.drawOverlay()
  }

  private onUp = (e: PointerEvent) => {
    const p = this.local(e)
    const click = this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) < 4
    this.panning = null
    this.downAt = null
    const box = this.box
    this.box = null
    if (box && !click) {
      const crossing = box.x1 < box.x0 // right-to-left = crossing window
      const ids = this.wallsInBox(box, crossing)
      const cur = e.shiftKey ? store.get().ui.selectedWallIds : []
      store.setUI({ selectedWallIds: [...new Set([...cur, ...ids])], selectedOpeningId: null, selectedUnderlayId: null })
      this.drawOverlay()
      return
    }
    if (!click) return
    if (e.button === 2) { if (tools.active) tools.cancel(); return }
    if (e.button !== 0 || this.spaceDown) return
    const w = this.screenToWorld(p.x, p.y)
    if (!w) return
    const target = this.findSnap(p.x, p.y, w).world
    if (tools.active) { tools.pick(target); return }
    const grip = this.hitGrip(p.x, p.y)
    if (grip) { const tl = gripTool(grip.wallId, grip.end); if (tl) tools.start(tl); return }
    const op = this.hitOpening(w)
    if (op) { store.setUI({ selectedOpeningId: op, selectedWallIds: [], selectedUnderlayId: null }); return }
    const wall = this.hitWall(w)
    if (wall) {
      const cur = store.get().ui.selectedWallIds
      const ids = e.shiftKey ? (cur.includes(wall) ? cur.filter(x => x !== wall) : [...cur, wall]) : [wall]
      store.setUI({ selectedWallIds: ids, selectedOpeningId: null, selectedUnderlayId: null })
      return
    }
    if (e.shiftKey) return
    store.setUI({ selectedWallIds: [], selectedOpeningId: null, selectedUnderlayId: this.hitUnderlay(w) })
  }

  private onWheel = (e: WheelEvent) => {
    if (this.is3D()) return
    e.preventDefault()
    const p = this.local(e)
    const before = this.screenToWorld(p.x, p.y)!
    const k = Math.pow(1.0015, -e.deltaY)
    this.pxPerM = Math.min(5000, Math.max(0.5, this.pxPerM * k))
    const after = this.screenToWorld(p.x, p.y)!
    this.center.x += before.x - after.x
    this.center.y += before.y - after.y
    this.updateOrtho()
    this.requestRender()
    this.drawOverlay()
  }

  private onKey = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) this.spaceDown = true }
  private onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') this.spaceDown = false }

  private cursorPending: Vec2 | null = null
  private throttledCursor(p: Vec2) {
    const first = !this.cursorPending
    this.cursorPending = p
    if (first) requestAnimationFrame(() => { store.setUI({ cursor: this.cursorPending }); this.cursorPending = null })
  }

  private onOverlayEvent = () => this.drawOverlay()

  // ---------------------------------------------------------------- render
  requestRender() {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.renderer.render(this.scene, this.camera())
      this.drawOverlay()
    })
  }

  private drawOverlay() {
    const s = store.get()
    const parts: string[] = []
    const P = (p: Vec2) => this.worldToScreen(p)

    // Selected underlay frame
    const sel = s.ui.selectedUnderlayId
    if (sel) {
      for (const u of activeLevel(s).underlays) {
        if (u.id !== sel || !u.visible) continue
        const [w, h] = u.kind === 'vector' ? [u.bounds.max.x, u.bounds.max.y] : [u.pxWidth, u.pxHeight]
        const pts = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => P(applyTransform(u.transform, { x, y })))
        parts.push(`<polygon class="ov-sel" points="${pts.map(p => `${p.x},${p.y}`).join(' ')}"/>`)
      }
    }

    // Grips on selected walls (active level)
    if (!this.is3D() && !tools.active) {
      for (const id of s.ui.selectedWallIds) {
        const w = activeLevel(s).walls.find(x => x.id === id)
        if (!w) continue
        for (const q of [P(w.a), P(w.b)]) parts.push(`<rect class="ov-grip" x="${q.x - 5}" y="${q.y - 5}" width="10" height="10"/>`)
      }
    }
    if (this.box) {
      const b = this.box
      const cls = b.x1 < b.x0 ? 'ov-box crossing' : 'ov-box'
      parts.push(`<rect class="${cls}" x="${Math.min(b.x0, b.x1)}" y="${Math.min(b.y0, b.y1)}" width="${Math.abs(b.x1 - b.x0)}" height="${Math.abs(b.y1 - b.y0)}"/>`)
    }

    // Tool rubber-band shapes
    for (const sh of tools.active?.overlay() ?? []) parts.push(this.shapeSvg(sh))

    // Snap marker + crosshair
    if (this.hover && this.screen) {
      const h = this.hover
      const c = P(h.world)
      const snapped = h.kind !== 'none'
      if (h.seg) {
        const a = P(h.seg[0]), b = P(h.seg[1])
        parts.push(`<line class="ov-refline" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`)
      }
      for (const [g0, g1] of h.guides ?? []) {
        const a = P(g0), b = P(g1)
        parts.push(`<line class="ov-guide" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><path class="ov-acq" d="M${a.x - 4} ${a.y}H${a.x + 4}M${a.x} ${a.y - 4}V${a.y + 4}"/>`)
      }
      if (h.kind === 'end') parts.push(`<rect class="ov-snap" x="${c.x - 6}" y="${c.y - 6}" width="12" height="12"/>`)
      if (h.kind === 'near') parts.push(`<path class="ov-snap" d="M${c.x - 6} ${c.y - 6}H${c.x + 6}L${c.x - 6} ${c.y + 6}H${c.x + 6}Z"/>`)
      if (h.kind === 'perp') parts.push(`<path class="ov-snap" d="M${c.x - 6} ${c.y + 6}H${c.x + 6}M${c.x - 6} ${c.y + 6}V${c.y - 6}M${c.x - 6} ${c.y}H${c.x}V${c.y + 6}"/>`)
      if (h.kind === 'track') parts.push(`<path class="ov-snap track" d="M${c.x - 5} ${c.y - 5}L${c.x + 5} ${c.y + 5}M${c.x + 5} ${c.y - 5}L${c.x - 5} ${c.y + 5}"/>`)
      if (!this.is3D() || tools.active) {
        const x = snapped ? c.x : this.screen.x, y = snapped ? c.y : this.screen.y
        const L = tools.active ? 9999 : 18
        parts.push(`<path class="ov-cross" d="M${x - L} ${y}H${x + L}M${x} ${y - L}V${y + L}"/>`)
        if (!tools.active) parts.push(`<rect class="ov-pickbox" x="${x - 4}" y="${y - 4}" width="8" height="8"/>`)
      }
    }
    this.overlay.innerHTML = parts.join('')
  }

  private shapeSvg(sh: OverlayShape): string {
    if (sh.kind === 'point') {
      const p = this.worldToScreen(sh.p)
      return `<circle class="ov-pt" cx="${p.x}" cy="${p.y}" r="4"/>`
    }
    if (sh.kind === 'line') {
      const a = this.worldToScreen(sh.a), b = this.worldToScreen(sh.b)
      let s = `<line class="ov-line${sh.dashed ? ' dashed' : ''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`
      if (sh.label) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        const esc = sh.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        s += `<g transform="translate(${mx},${my - 10})"><rect class="ov-label-bg" x="${-esc.length * 3.6 - 6}" y="-11" width="${esc.length * 7.2 + 12}" height="18" rx="3"/><text class="ov-label" text-anchor="middle" y="2">${esc}</text></g>`
      }
      return s
    }
    if (sh.kind === 'poly') {
      const pts = sh.pts.map(p => this.worldToScreen(p)).map(p => `${p.x},${p.y}`).join(' ')
      return `<polygon class="ov-poly" points="${pts}"/>`
    }
    return ''
  }
}
