// Vector plan drawing of a level as standalone SVG (used in the PDF report and drawing sheets).
import type { AirSystem, Level, Project, Vec2 } from '../core/types'
import { roomGeometry } from '../core/rooms'
import { clipBand, faceOffsets, norm, sub, wallPieces, wallPolygons, wallThickness } from '../core/walls'
import { analyse } from '../calc'
import { hydraulicDiameter, unitPorts } from '../calc/network'
import { roofGeometry } from '../core/roof'

const SYS: Record<AirSystem, string> = { supply: '#1e88e5', extract: '#e08e0b', outdoor: '#16a34a', exhaust: '#8d6e63' }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export function planSvg(p: Project, level: Level, opts: { width: number; height: number; showHvac?: boolean; title?: string }): string {
  const lib = p.library
  const polys = wallPolygons(level.walls, lib)
  const pts: Vec2[] = []
  for (const poly of polys.values()) pts.push(...poly)
  for (const r of level.roofs) pts.push(...r.outline)
  for (const d of p.hvac.ducts.filter(d => d.levelId === level.id)) pts.push(...d.pts)
  if (!pts.length) pts.push({ x: 0, y: 0 }, { x: 10, y: 8 })
  const minX = Math.min(...pts.map(q => q.x)) - 1, maxX = Math.max(...pts.map(q => q.x)) + 1
  const minY = Math.min(...pts.map(q => q.y)) - 1, maxY = Math.max(...pts.map(q => q.y)) + 1
  const k = Math.min(opts.width / (maxX - minX), opts.height / (maxY - minY))
  const X = (x: number) => ((x - minX) * k).toFixed(2)
  const Y = (y: number) => ((maxY - y) * k).toFixed(2)
  const P = (q: Vec2) => `${X(q.x)},${Y(q.y)}`
  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}" font-family="Segoe UI, Arial, sans-serif">`)
  out.push(`<rect width="100%" height="100%" fill="#fff"/>`)
  // Rooms
  const geo = roomGeometry(level, lib)
  for (const r of level.rooms) {
    const g = geo.get(r.id)
    if (g) out.push(`<polygon points="${g.polygon.map(P).join(' ')}" fill="#f4f8fc" stroke="none"/>`)
  }
  // Walls cut at 1.2 m
  for (const w of level.walls) {
    const poly = polys.get(w.id)
    if (!poly) continue
    const ext = lib.wallTypes.find(t => t.id === w.typeId)?.category !== 'interior'
    for (const pc of wallPieces(w, poly, w.height ?? level.height)) {
      if (pc.z0 <= 1.2 && pc.z1 > 1.2) out.push(`<polygon points="${pc.poly.map(P).join(' ')}" fill="${ext ? '#4b5563' : '#9ca3af'}" stroke="#111827" stroke-width="0.6"/>`)
    }
    const d = norm(sub(w.b, w.a)), n = { x: -d.y, y: d.x }
    const { L, R } = faceOffsets(w.justification, wallThickness(w, lib))
    const Q = (s: number, o: number) => ({ x: w.a.x + d.x * s + n.x * o, y: w.a.y + d.y * s + n.y * o })
    for (const o of w.openings ?? []) {
      const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2
      if (!clipBand(poly, w.a, d, s0, s1).length) continue
      if (o.kind === 'window') {
        const m = (L + R) / 2
        out.push(`<polyline points="${[Q(s0, L), Q(s1, L)].map(P).join(' ')}" stroke="#111" stroke-width="0.8" fill="none"/>`)
        out.push(`<polyline points="${[Q(s0, R), Q(s1, R)].map(P).join(' ')}" stroke="#111" stroke-width="0.8" fill="none"/>`)
        out.push(`<polyline points="${[Q(s0, m), Q(s1, m)].map(P).join(' ')}" stroke="#2563eb" stroke-width="1.2" fill="none"/>`)
      } else {
        const face = o.swing === 'left' ? L : R, sign = o.swing === 'left' ? 1 : -1
        const hs = o.hinge === 'start' ? s0 : s1, fs = o.hinge === 'start' ? s1 : s0
        const h = Q(hs, face), tip = { x: h.x + n.x * sign * o.width, y: h.y + n.y * sign * o.width }, cl = Q(fs, face)
        const sweep = ((tip.x - h.x) * (cl.y - h.y) - (tip.y - h.y) * (cl.x - h.x)) > 0 ? 0 : 1
        out.push(`<line x1="${X(h.x)}" y1="${Y(h.y)}" x2="${X(tip.x)}" y2="${Y(tip.y)}" stroke="#111" stroke-width="0.8"/>`)
        out.push(`<path d="M${X(tip.x)} ${Y(tip.y)} A${(o.width * k).toFixed(2)} ${(o.width * k).toFixed(2)} 0 0 ${sweep} ${X(cl.x)} ${Y(cl.y)}" stroke="#111" stroke-width="0.5" fill="none" stroke-dasharray="3 2"/>`)
      }
    }
  }
  // Roofs (dashed outline + hips/ridge)
  for (const roof of level.roofs) {
    const rg = roofGeometry(roof, level.elevation)
    for (const f of [...rg.faces, ...(rg.flat ? [rg.flat] : [])]) out.push(`<polygon points="${f.map(P).join(' ')}" fill="none" stroke="#b5523b" stroke-width="0.6" stroke-dasharray="6 3"/>`)
  }
  // HVAC
  if (opts.showHvac !== false) {
    const a = analyse(p)
    for (const d of p.hvac.ducts.filter(x => x.levelId === level.id)) {
      const mat = lib.hvac.ductMaterials.find(m => m.id === d.materialId)
      const size = mat?.sizes.find(z => z.id === d.sizeId) ?? mat?.sizes[0]
      const wpx = Math.max(1.2, (size ? hydraulicDiameter(size) : 0.1) * k)
      out.push(`<polyline points="${d.pts.map(P).join(' ')}" stroke="${SYS[d.system]}" stroke-width="${wpx.toFixed(2)}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`)
      const sg = a.net.segments.find(x => x.ductId === d.id)
      if (sg && d.pts.length >= 2) {
        const A = d.pts[0], B = d.pts[1]
        out.push(`<text x="${X((A.x + B.x) / 2)}" y="${(+Y((A.y + B.y) / 2) - 4).toFixed(1)}" font-size="7" fill="${SYS[d.system]}" text-anchor="middle">${esc(sg.sizeLabel)} · ${Math.round(sg.q)}</text>`)
      }
    }
    for (const tr of p.hvac.terminals.filter(x => x.levelId === level.id)) {
      const r = a.net.terminals.find(x => x.terminalId === tr.id)
      out.push(`<circle cx="${X(tr.pos.x)}" cy="${Y(tr.pos.y)}" r="${Math.max(3, 0.1 * k).toFixed(1)}" fill="#fff" stroke="${SYS[tr.system]}" stroke-width="1.5"/>`)
      if (r) out.push(`<text x="${(+X(tr.pos.x) + 6).toFixed(1)}" y="${(+Y(tr.pos.y) + 3).toFixed(1)}" font-size="7" fill="${SYS[tr.system]}">${Math.round(r.q)}</text>`)
    }
    for (const pl of p.hvac.plenums.filter(x => x.levelId === level.id)) {
      out.push(`<rect x="${(+X(pl.pos.x) - 0.25 * k).toFixed(1)}" y="${(+Y(pl.pos.y) - 0.15 * k).toFixed(1)}" width="${(0.5 * k).toFixed(1)}" height="${(0.3 * k).toFixed(1)}" fill="#fff" stroke="${SYS[pl.system]}" stroke-width="1.5"/>`)
    }
    for (const u of p.hvac.units.filter(x => x.levelId === level.id)) {
      const c = Math.cos(u.rotation), s = Math.sin(u.rotation)
      const R = (x: number, y: number) => ({ x: u.pos.x + c * x - s * y, y: u.pos.y + s * x + c * y })
      out.push(`<polygon points="${[R(-0.35, -0.3), R(0.35, -0.3), R(0.35, 0.3), R(-0.35, 0.3)].map(P).join(' ')}" fill="#e2e8f0" stroke="#0e2841" stroke-width="1.2"/>`)
      const ports = unitPorts(u)
      for (const sys of Object.keys(ports) as AirSystem[]) out.push(`<circle cx="${X(ports[sys].x)}" cy="${Y(ports[sys].y)}" r="3" fill="${SYS[sys]}"/>`)
      out.push(`<text x="${X(u.pos.x)}" y="${(+Y(u.pos.y) + 3).toFixed(1)}" font-size="8" font-weight="700" text-anchor="middle" fill="#0e2841">HRV</text>`)
    }
  }
  // Room tags
  const a = analyse(p)
  for (const r of level.rooms) {
    const g = geo.get(r.id)
    if (!g) continue
    const rf = a.air.rooms.find(x => x.roomId === r.id)
    const flows = rf ? [rf.supply > 0.5 ? `↓${Math.round(rf.supply)}` : '', rf.extract > 0.5 ? `↑${Math.round(rf.extract)}` : ''].filter(Boolean).join(' ') : ''
    out.push(`<text x="${X(r.seed.x)}" y="${Y(r.seed.y)}" font-size="9" font-weight="700" text-anchor="middle" fill="#0e2841">${esc(r.name)}</text>`)
    out.push(`<text x="${X(r.seed.x)}" y="${(+Y(r.seed.y) + 10).toFixed(1)}" font-size="7.5" text-anchor="middle" fill="#334155">${g.area.toFixed(2)} m²${flows ? ' · ' + flows + ' m³/h' : ''}</text>`)
  }
  // Scale bar (1 m / 5 m) and title
  const bar = (k >= 60 ? 1 : 5)
  out.push(`<g transform="translate(12,${opts.height - 14})"><rect width="${(bar * k).toFixed(1)}" height="4" fill="#0e2841"/><text y="-3" font-size="8" fill="#0e2841">${bar} m</text></g>`)
  if (opts.title) out.push(`<text x="12" y="16" font-size="11" font-weight="700" fill="#0e2841">${esc(opts.title)}</text>`)
  out.push('</svg>')
  return out.join('')
}
