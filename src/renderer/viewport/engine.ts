// Three.js viewport: 2D plan (orthographic, top view of the active level) and 3D model (perspective, all levels).
// World units are metres; plan in the XY plane, Z up.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Level, RasterUnderlay, Underlay, Vec2, VectorUnderlay } from '../core/types'
import { activeLevel, bus, store, type AppState } from '../core/store'
import { applyTransform } from '../core/geom'
import { tools, type OverlayShape } from '../tools/tool'

const SNAP_PX = 12
const BG = 0xfbfcfd

interface UnderlayEntry { ref: Underlay; elevation: number; obj: THREE.Object3D; worldSnaps: Float64Array }

export class Viewport {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
  private persp = new THREE.PerspectiveCamera(45, 1, 0.05, 2000)
  private controls: OrbitControls
  private grid = new THREE.Group()
  private underlayRoot = new THREE.Group()
  private entries = new Map<string, UnderlayEntry>()
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
  private hover: { world: Vec2; snapped: boolean } | null = null
  private screen: { x: number; y: number } | null = null
  private unsub: () => void
  private ro: ResizeObserver

  constructor(private host: HTMLDivElement, private overlay: SVGSVGElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(BG)
    host.prepend(this.renderer.domElement)
    this.scene.add(this.grid, this.underlayRoot)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9))
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
    let worldSnaps = new Float64Array(0)
    if (u.kind === 'vector') {
      this.buildVector(g, u)
      const pts: number[] = []
      for (const l of u.layers) {
        if (!l.visible) continue
        for (let i = 0; i < l.snaps.length; i += 2) {
          const p = applyTransform(u.transform, { x: l.snaps[i], y: l.snaps[i + 1] })
          pts.push(p.x, p.y)
        }
      }
      worldSnaps = new Float64Array(pts)
    } else {
      this.buildRaster(g, u)
      const c = [[0, 0], [u.pxWidth, 0], [u.pxWidth, u.pxHeight], [0, u.pxHeight]]
      worldSnaps = new Float64Array(c.flatMap(([x, y]) => { const p = applyTransform(u.transform, { x, y }); return [p.x, p.y] }))
    }
    this.underlayRoot.add(g)
    return { ref: u, elevation: level.elevation, obj: g, worldSnaps }
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

  private findSnap(px: number, py: number, world: Vec2): { world: Vec2; snapped: boolean } {
    const s = store.get()
    if (!s.ui.snap) return { world, snapped: false }
    const lvl = activeLevel(s)
    let best = SNAP_PX * SNAP_PX, bp: Vec2 | null = null
    for (const u of lvl.underlays) {
      if (!u.visible) continue
      const e = this.entries.get(u.id)
      if (!e) continue
      const a = e.worldSnaps
      for (let i = 0; i < a.length; i += 2) {
        const sp = this.worldToScreen({ x: a[i], y: a[i + 1] })
        const d = (sp.x - px) ** 2 + (sp.y - py) ** 2
        if (d < best) { best = d; bp = { x: a[i], y: a[i + 1] } }
      }
    }
    return bp ? { world: bp, snapped: true } : { world, snapped: false }
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
    if (!this.is3D() && (e.button === 1 || (e.button === 0 && (this.spaceDown || !tools.active)))) {
      this.panning = p
      this.renderer.domElement.setPointerCapture(e.pointerId)
      e.preventDefault()
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
    if (!click) return
    if (e.button === 2) { if (tools.active) tools.cancel(); return }
    if (e.button !== 0 || this.spaceDown) return
    const w = this.screenToWorld(p.x, p.y)
    if (!w) return
    const target = this.findSnap(p.x, p.y, w).world
    if (tools.active) { tools.pick(target); return }
    store.setUI({ selectedUnderlayId: this.hitUnderlay(w) })
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

    // Tool rubber-band shapes
    for (const sh of tools.active?.overlay() ?? []) parts.push(this.shapeSvg(sh))

    // Snap marker + crosshair
    if (this.hover && this.screen) {
      const c = P(this.hover.world)
      if (this.hover.snapped) parts.push(`<rect class="ov-snap" x="${c.x - 6}" y="${c.y - 6}" width="12" height="12"/>`)
      if (!this.is3D() || tools.active) {
        const x = this.hover.snapped ? c.x : this.screen.x, y = this.hover.snapped ? c.y : this.screen.y
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
    return ''
  }
}
