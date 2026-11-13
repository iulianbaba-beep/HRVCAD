import { useState } from 'react'
import { TbEye, TbEyeOff, TbLock, TbChevronDown, TbStack2, TbFileImport, TbPhoto, TbFileTypePdf } from 'react-icons/tb'
import { activeLevel, findOpening, findUnderlay, findWall, store, updateLevel, updateUnderlay, useStore } from '../core/store'
import type { AirSystem, Opening, Roof, Room, Underlay, Wall, WallJustification } from '../core/types'
import { roomGeometry, ROOM_TYPES } from '../core/rooms'
import { roofGeometry } from '../core/roof'
import { updateHvac } from '../core/store'
import { analyse } from '../calc'
import { dist, formatLength } from '../core/geom'
import { wallTypeThickness, wallTypeU } from '../core/thermal'
import { runCommand } from '../core/commands'
import { useT } from '../i18n'
import { NumberField, TextField } from './fields'
import { underlayWorldWidth } from '../tools/underlayTools'

const ulIcon = (u: Underlay) => (u.kind === 'vector' ? TbFileImport : u.sourceFormat === 'pdf' ? TbFileTypePdf : TbPhoto)

export function ProjectPanel() {
  const t = useT()
  const project = useStore(s => s.project)
  const activeId = useStore(s => s.ui.activeLevelId)
  const selected = useStore(s => s.ui.selectedUnderlayId)
  const [openLayers, setOpenLayers] = useState<Record<string, boolean>>({})
  const level = activeLevel()

  const toggleLayer = (u: Underlay, name: string) => {
    if (u.kind !== 'vector') return
    updateUnderlay(t('project.layers'), u.id, x => x.kind === 'vector'
      ? { ...x, layers: x.layers.map(l => (l.name === name ? { ...l, visible: !l.visible } : l)) } : x)
  }

  return (
    <aside className="side side-left">
      <div className="side-title">{t('project.title')}</div>
      <div className="side-section">{t('project.levels')}</div>
      <ul className="tree">
        {[...project.levels].sort((a, b) => b.elevation - a.elevation).map(l => (
          <li key={l.id}>
            <button className={`tree-row${l.id === activeId ? ' on' : ''}`}
              onClick={() => store.setUI({ activeLevelId: l.id, selectedUnderlayId: null })}>
              <TbStack2 aria-hidden /> <span className="grow">{l.name}</span>
              <span className="muted">{l.elevation >= 0 ? '+' : ''}{l.elevation.toFixed(2)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="side-section">{t('project.underlays')} — {level.name}</div>
      {level.underlays.length === 0 && <p className="muted pad">{t('project.noUnderlays')}</p>}
      <ul className="tree">
        {level.underlays.map(u => {
          const Icon = ulIcon(u)
          const open = openLayers[u.id] ?? true
          return (
            <li key={u.id}>
              <div className={`tree-row${u.id === selected ? ' on' : ''}`} onClick={() => store.setUI({ selectedUnderlayId: u.id, selectedWallIds: [], selectedOpeningId: null })}>
                {u.kind === 'vector' && (
                  <button className="icon-btn" onClick={e => { e.stopPropagation(); setOpenLayers(o => ({ ...o, [u.id]: !open })) }}>
                    <TbChevronDown style={{ transform: open ? '' : 'rotate(-90deg)' }} />
                  </button>
                )}
                <Icon aria-hidden />
                <span className="grow ellipsis" title={u.name}>{u.name}</span>
                {u.locked && <TbLock className="muted" aria-label={t('props.locked')} />}
                <span className={`pill ${u.calibrated ? 'ok' : 'warn'}`}>{u.calibrated ? t('project.calibrated') : t('project.notCalibrated')}</span>
                <button className="icon-btn" title={t('props.visible')}
                  onClick={e => { e.stopPropagation(); updateUnderlay(t('props.visible'), u.id, x => ({ ...x, visible: !x.visible })) }}>
                  {u.visible ? <TbEye /> : <TbEyeOff className="muted" />}
                </button>
              </div>
              {u.kind === 'vector' && open && (
                <ul className="tree sub">
                  {u.layers.map(l => (
                    <li key={l.name}>
                      <div className="tree-row small">
                        <span className="swatch" style={{ background: l.color }} />
                        <span className="grow ellipsis" title={l.name}>{l.name}</span>
                        <span className="muted">{l.segments.length / 4 | 0}</span>
                        <button className="icon-btn" onClick={() => toggleLayer(u, l.name)} title={t('props.visible')}>
                          {l.visible ? <TbEye /> : <TbEyeOff className="muted" />}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="prop"><span>{label}</span>{children}</label>
}

export function PropertiesPanel() {
  const t = useT()
  const selectedId = useStore(s => s.ui.selectedUnderlayId)
  const project = useStore(s => s.project)
  const levelId = useStore(s => s.ui.activeLevelId)
  const f = findUnderlay(selectedId)
  const unit = project.settings.displayUnit
  const level = project.levels.find(l => l.id === levelId) ?? project.levels[0]

  const updLevel = (patch: Partial<typeof level>) =>
    store.update(t('props.level'), p => ({ ...p, levels: p.levels.map(l => (l.id === level.id ? { ...l, ...patch } : l)) }))

  const selWallIds = useStore(s => s.ui.selectedWallIds)
  const selRoomId = useStore(s => s.ui.selectedRoomId)
  const selRoofId = useStore(s => s.ui.selectedRoofId)
  const selHvacId = useStore(s => s.ui.selectedHvacId)
  const roomTypeUi = useStore(s => s.ui.roomType)
  const ui = useStore(s => s.ui)
  const selOpeningId = useStore(s => s.ui.selectedOpeningId)
  const doorDef = useStore(s => s.ui.doorDefaults)
  const winDef = useStore(s => s.ui.windowDefaults)
  const fo = findOpening(selOpeningId)
  const tool = useStore(s => s.ui.activeTool)
  const wallTypeId = useStore(s => s.ui.wallTypeId)
  const just = useStore(s => s.ui.wallJustification)
  const fw = selWallIds.length === 1 ? findWall(selWallIds[0]) : null
  const lib = project.library

  const typeSelect = (value: string, onChange: (id: string) => void) => (
    <select value={value} onChange={e => onChange(e.target.value)}>
      <optgroup label={t('lib.exterior')}>
        {lib.wallTypes.filter(w => w.category === 'exterior').map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </optgroup>
      <optgroup label={t('lib.interior')}>
        {lib.wallTypes.filter(w => w.category === 'interior').map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </optgroup>
    </select>
  )
  const justSeg = (value: WallJustification, onChange: (j: WallJustification) => void) => (
    <div className="seg small">
      {(['left', 'center', 'right'] as const).map(j => (
        <button key={j} className={value === j ? 'on' : ''} onClick={() => onChange(j)}>{t(`wall.just.${j}`)}</button>
      ))}
    </div>
  )
  const typeInfo = (typeId: string) => {
    const wt = lib.wallTypes.find(w => w.id === typeId)
    if (!wt) return null
    const u = wallTypeU(wt, lib)
    return <>
      <Row label={t('props.thickness')}><span className="ro">{(wallTypeThickness(wt) * 1000).toFixed(0)} mm</span></Row>
      <Row label={t('props.uValue')}><span className="ro">{u.U.toFixed(3)} W/m²K {u.unverified && <span className="pill warn">{t('props.unverified')}</span>}</span></Row>
    </>
  }

  return (
    <aside className="side side-right">
      <div className="side-title">{t('props.title')}</div>
      {selRoomId ? (() => {
        const lv = project.levels.find(l => l.rooms.some(r => r.id === selRoomId))
        const r = lv?.rooms.find(x => x.id === selRoomId)
        if (!lv || !r) return null
        const g = roomGeometry(lv, lib).get(r.id)
        const rf = analyse(project).air.rooms.find(x => x.roomId === r.id)
        const hr = analyse(project).heat.rooms.find(x => x.roomId === r.id)
        const updR = (label: string, patch: Partial<Room>) => updateLevel(label, lv.id, l => ({ ...l, rooms: l.rooms.map(x => (x.id === r.id ? { ...x, ...patch } : x)) }))
        const opt = (v: number | null, on: (n: number | null) => void, ph: string) =>
          <input placeholder={ph} defaultValue={v ?? ''} key={`${r.id}${v}`} onBlur={e => { const n = parseFloat(e.target.value.replace(',', '.')); on(Number.isFinite(n) ? n : null) }} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        return (
          <div className="props">
            <div className="side-section">{t('props.room')}</div>
            <Row label={t('props.name')}><TextField value={r.name} onCommit={v => updR(t('props.name'), { name: v || r.name })} /></Row>
            <Row label={t('res.type')}>
              <select value={r.type} onChange={e => updR(t('res.type'), { type: e.target.value as Room['type'] })}>
                {ROOM_TYPES.map(x => <option key={x} value={x}>{t(`room.${x}` as any)}</option>)}
              </select>
            </Row>
            <Row label={t('props.area')}><span className="ro">{g ? `${g.area.toFixed(2)} m²` : '—'} {g && !g.ok && <span className="pill warn">{t('props.roomOpen')}</span>}</span></Row>
            <Row label={t('props.tempInt')}>{opt(r.tempInt, v => updR(t('props.tempInt'), { tempInt: v }), String(analyse(project).air.profile.rooms[r.type]?.tempInt ?? 20))}</Row>
            <Row label={t('props.persons')}>{opt(r.persons, v => updR(t('props.persons'), { persons: v }), '—')}</Row>
            <Row label={t('props.supplyQ')}>{opt(r.supplyOverride, v => updR(t('props.supplyQ'), { supplyOverride: v }), rf ? Math.round(rf.supply).toString() : '0')}</Row>
            <Row label={t('props.extractQ')}>{opt(r.extractOverride, v => updR(t('props.extractQ'), { extractOverride: v }), rf ? Math.round(rf.extract).toString() : '0')}</Row>
            {hr && <Row label={t('props.heatLoad')}><span className="ro"><b>{Math.round(hr.phi)} W</b> ({Math.round(hr.phi / Math.max(hr.area, 0.1))} W/m²)</span></Row>}
            <p className="muted pad small">{t('props.roomHelp')}</p>
            <div className="pad"><button className="btn danger" onClick={() => runCommand('edit.delete')}>{t('cmd.edit.delete')}</button></div>
          </div>
        )
      })() : selRoofId ? (() => {
        const lv = project.levels.find(l => l.roofs.some(r => r.id === selRoofId))
        const rf = lv?.roofs.find(x => x.id === selRoofId)
        if (!lv || !rf) return null
        const geo = roofGeometry(rf, lv.elevation)
        const updRf = (label: string, patch: Partial<Roof>) => updateLevel(label, lv.id, l => ({ ...l, roofs: l.roofs.map(x => (x.id === rf.id ? { ...x, ...patch } : x)) }))
        const preset = (kind: 'hip' | 'gable' | 'mono' | 'flat') => {
          const n = rf.outline.length
          const pitch = Math.max(...rf.slopes, 0) || 35
          // gable: pitch the two longest opposite edges; mono: only the longest edge
          const lens = rf.outline.map((a, i) => Math.hypot(rf.outline[(i + 1) % n].x - a.x, rf.outline[(i + 1) % n].y - a.y))
          const longest = lens.indexOf(Math.max(...lens))
          const slopes = rf.outline.map((_, i) => kind === 'hip' ? pitch : kind === 'flat' ? 0
            : kind === 'mono' ? (i === longest ? pitch : 0)
            : (n === 4 ? (i % 2 === longest % 2 ? pitch : 0) : (i === longest || i === (longest + Math.floor(n / 2)) % n ? pitch : 0)))
          updRf(t('props.roof'), { slopes })
        }
        return (
          <div className="props">
            <div className="side-section">{t('props.roof')}</div>
            <Row label={t('lib.category')}>
              <select value={rf.typeId} onChange={e => updRf(t('props.roof'), { typeId: e.target.value })}>
                {lib.slabTypes.filter(x => x.category === 'roof').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Row>
            <Row label={t('props.eave')}><NumberField value={rf.eaveHeight} onCommit={v => v >= 0 && updRf(t('props.eave'), { eaveHeight: v })} /></Row>
            <Row label={t('props.form')}>
              <div className="seg small">
                {(['hip', 'gable', 'mono', 'flat'] as const).map(k => <button key={k} onClick={() => preset(k)}>{t(`roof.${k}` as any)}</button>)}
              </div>
            </Row>
            <div className="side-section">{t('props.edgePitch')}</div>
            {rf.outline.map((a, i) => {
              const b = rf.outline[(i + 1) % rf.outline.length]
              return <Row key={i} label={`${t('props.edge')} ${i + 1} (${Math.hypot(b.x - a.x, b.y - a.y).toFixed(2)} m)`}>
                <NumberField value={rf.slopes[i] ?? 0} digits={1} onCommit={v => v >= 0 && v <= 75 && updRf(t('props.edgePitch'), { slopes: rf.slopes.map((s0, j) => (j === i ? v : s0)) })} />
              </Row>
            })}
            <Row label={t('props.ridge')}><span className="ro">{(geo.ridgeZ - lv.elevation).toFixed(2)} m · {geo.area.toFixed(1)} m²</span></Row>
            <p className="muted pad small">{t('props.roofHelp')}</p>
            <div className="pad"><button className="btn danger" onClick={() => runCommand('edit.delete')}>{t('cmd.edit.delete')}</button></div>
          </div>
        )
      })() : selHvacId ? (() => {
        const h = project.hvac
        const a = analyse(project)
        const term = h.terminals.find(x => x.id === selHvacId), duct = h.ducts.find(x => x.id === selHvacId)
        const pl = h.plenums.find(x => x.id === selHvacId), un = h.units.find(x => x.id === selHvacId)
        const sysSel = (v: AirSystem, on: (s: AirSystem) => void) => (
          <select value={v} onChange={e => on(e.target.value as AirSystem)}>{(['supply', 'extract', 'outdoor', 'exhaust'] as const).map(s => <option key={s} value={s}>{t(`system.${s}` as any)}</option>)}</select>)
        return (
          <div className="props">
            {un && <>
              <div className="side-section">{t('cmd.hvac.unit')}</div>
              <Row label={t('res.type')}><select value={un.typeId} onChange={e => updateHvac(t('cmd.hvac.unit'), x => ({ ...x, units: x.units.map(u => (u.id === un.id ? { ...u, typeId: e.target.value } : u)) }))}>
                {lib.hvac.units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Row>
              <Row label={t('props.rotation')}><NumberField value={(un.rotation * 180) / Math.PI} digits={1} onCommit={v => updateHvac(t('props.rotation'), x => ({ ...x, units: x.units.map(u => (u.id === un.id ? { ...u, rotation: (v * Math.PI) / 180 } : u)) }))} /></Row>
              <Row label={t('res.supplySide')}><span className="ro">{Math.round(a.net.requiredSupplySide)} / {a.net.availableSupplySide == null ? '—' : Math.round(a.net.availableSupplySide)} Pa</span></Row>
              <Row label={t('res.extractSide')}><span className="ro">{Math.round(a.net.requiredExtractSide)} / {a.net.availableExtractSide == null ? '—' : Math.round(a.net.availableExtractSide)} Pa</span></Row>
              <p className="muted pad small">{t('props.unitHelp')}</p>
            </>}
            {pl && <>
              <div className="side-section">{t('cmd.hvac.plenum')}</div>
              <Row label={t('res.type')}><select value={pl.typeId} onChange={e => updateHvac(t('cmd.hvac.plenum'), x => ({ ...x, plenums: x.plenums.map(u => (u.id === pl.id ? { ...u, typeId: e.target.value } : u)) }))}>
                {lib.hvac.plenums.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Row>
              <Row label={t('res.system')}>{sysSel(pl.system, s => (s === 'supply' || s === 'extract') && updateHvac(t('res.system'), x => ({ ...x, plenums: x.plenums.map(u => (u.id === pl.id ? { ...u, system: s } : u)) })))}</Row>
            </>}
            {term && (() => {
              const tr = a.net.terminals.find(x => x.terminalId === term.id)
              return <>
                <div className="side-section">{t('cmd.hvac.terminal')}</div>
                <Row label={t('res.type')}><select value={term.typeId} onChange={e => updateHvac(t('cmd.hvac.terminal'), x => ({ ...x, terminals: x.terminals.map(u => (u.id === term.id ? { ...u, typeId: e.target.value } : u)) }))}>
                  {lib.hvac.terminals.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Row>
                <Row label={t('res.system')}>{sysSel(term.system, s => updateHvac(t('res.system'), x => ({ ...x, terminals: x.terminals.map(u => (u.id === term.id ? { ...u, system: s } : u)) })))}</Row>
                <Row label={t('props.flowQ')}><input placeholder={tr ? Math.round(tr.q).toString() : ''} defaultValue={term.flowOverride ?? ''} key={term.id + term.flowOverride}
                  onBlur={e => { const n = parseFloat(e.target.value.replace(',', '.')); updateHvac(t('props.flowQ'), x => ({ ...x, terminals: x.terminals.map(u => (u.id === term.id ? { ...u, flowOverride: Number.isFinite(n) ? n : null } : u)) })) }} /></Row>
                {tr && <Row label={t('res.throttle')}><span className="ro">{tr.connected ? `${tr.throttle.toFixed(1)} Pa` : t('res.notConnected')}</span></Row>}
              </>
            })()}
            {duct && (() => {
              const mat = lib.hvac.ductMaterials.find(m => m.id === duct.materialId)
              const segs = a.net.segments.filter(x => x.ductId === duct.id)
              const L = duct.pts.slice(1).reduce((s0, q, i) => s0 + Math.hypot(q.x - duct.pts[i].x, q.y - duct.pts[i].y), 0)
              const updD = (patch: Partial<typeof duct>) => updateHvac(t('cmd.hvac.duct'), x => ({ ...x, ducts: x.ducts.map(u => (u.id === duct.id ? { ...u, ...patch } : u)) }))
              return <>
                <div className="side-section">{t('cmd.hvac.duct')}</div>
                <Row label={t('res.system')}>{sysSel(duct.system, s => updD({ system: s }))}</Row>
                <Row label={t('lib.material')}><select value={duct.materialId} onChange={e => { const m = lib.hvac.ductMaterials.find(x => x.id === e.target.value)!; updD({ materialId: m.id, sizeId: m.sizes[0].id, locked: false }) }}>
                  {lib.hvac.ductMaterials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Row>
                <Row label={t('res.size')}><select value={duct.sizeId} onChange={e => updD({ sizeId: e.target.value, locked: true })}>
                  {mat?.sizes.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}</select></Row>
                <Row label={t('props.locked')}><input type="checkbox" checked={duct.locked} onChange={e => updD({ locked: e.target.checked })} /></Row>
                <Row label={t('props.length')}><span className="ro">{L.toFixed(2)} m</span></Row>
                {segs.map((sg, i) => <Row key={i} label={`q · v`}><span className={`ro${sg.overVelocity ? ' bad-text' : ''}`}>{Math.round(sg.q)} m³/h · {sg.v.toFixed(2)} m/s · {(sg.dpFriction + sg.dpLocal).toFixed(1)} Pa</span></Row>)}
              </>
            })()}
            <div className="pad"><button className="btn danger" onClick={() => runCommand('edit.delete')}>{t('cmd.edit.delete')}</button></div>
          </div>
        )
      })() : (tool === 'build.room') ? (
        <div className="props">
          <div className="side-section">{t('cmd.build.room')}</div>
          <Row label={t('res.type')}><select value={roomTypeUi} onChange={e => store.setUI({ roomType: e.target.value as Room['type'] })}>
            {ROOM_TYPES.map(x => <option key={x} value={x}>{t(`room.${x}` as any)}</option>)}</select></Row>
          <p className="muted pad small">{t('props.roomToolHelp')}</p>
        </div>
      ) : (tool === 'hvac.duct' || tool === 'hvac.unit' || tool === 'hvac.plenum' || tool === 'hvac.terminal') ? (
        <div className="props">
          <div className="side-section">{t(`cmd.${tool}` as any)}</div>
          {tool === 'hvac.unit' && <Row label={t('res.type')}><select value={ui.unitTypeId} onChange={e => store.setUI({ unitTypeId: e.target.value })}>
            {lib.hvac.units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Row>}
          {tool === 'hvac.plenum' && <>
            <Row label={t('res.type')}><select value={ui.plenumTypeId} onChange={e => store.setUI({ plenumTypeId: e.target.value })}>
              {lib.hvac.plenums.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Row>
            <Row label={t('res.system')}><div className="seg small">
              {(['supply', 'extract'] as const).map(s => <button key={s} className={ui.plenumSystem === s ? 'on' : ''} onClick={() => store.setUI({ plenumSystem: s })}>{t(`system.${s}` as any)}</button>)}</div></Row>
          </>}
          {tool === 'hvac.terminal' && <Row label={t('res.system')}><select value={ui.terminalSystem} onChange={e => store.setUI({ terminalSystem: e.target.value as any })}>
            <option value="auto">{t('system.auto')}</option>
            {(['supply', 'extract', 'outdoor', 'exhaust'] as const).map(s => <option key={s} value={s}>{t(`system.${s}` as any)}</option>)}</select></Row>}
          {tool === 'hvac.duct' && <>
            <Row label={t('res.system')}><select value={ui.ductSystem} onChange={e => store.setUI({ ductSystem: e.target.value as AirSystem })}>
              {(['supply', 'extract', 'outdoor', 'exhaust'] as const).map(s => <option key={s} value={s}>{t(`system.${s}` as any)}</option>)}</select></Row>
            <Row label={t('lib.material')}><select value={ui.ductMaterialId} onChange={e => store.setUI({ ductMaterialId: e.target.value, ductSizeId: 'auto' })}>
              {lib.hvac.ductMaterials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Row>
            <Row label={t('res.size')}><select value={ui.ductSizeId} onChange={e => store.setUI({ ductSizeId: e.target.value })}>
              <option value="auto">{t('props.autoSize')}</option>
              {lib.hvac.ductMaterials.find(m => m.id === ui.ductMaterialId)?.sizes.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}</select></Row>
          </>}
          <p className="muted pad small">{t(`help.${tool}` as any)}</p>
        </div>
      ) : fo ? (() => {
        const { wall: w, opening: o, level: lv } = fo
        const updO = (label: string, patch: Partial<Opening>) =>
          updateLevel(label, lv.id, l => ({
            ...l, walls: l.walls.map(x => (x.id === w.id ? { ...x, openings: (x.openings ?? []).map(y => (y.id === o.id ? { ...y, ...patch } : y)) } : x))
          }))
        const L = dist(w.a, w.b)
        return (
          <div className="props">
            <div className="side-section">{t(o.kind === 'door' ? 'props.door' : 'props.window')}</div>
            <Row label={t('props.widthM')}><NumberField value={o.width} onCommit={v => v > 0.2 && v < L && updO(t('props.widthM'), { width: v })} /></Row>
            <Row label={t('props.heightM')}><NumberField value={o.height} onCommit={v => v > 0.2 && updO(t('props.heightM'), { height: v })} /></Row>
            {o.kind === 'window' && <Row label={t('props.sillM')}><NumberField value={o.sill} onCommit={v => v >= 0 && updO(t('props.sillM'), { sill: v })} /></Row>}
            <Row label={t('props.fromStartM')}><NumberField value={o.offset - o.width / 2}
              onCommit={v => v >= 0 && v + o.width <= L && updO(t('props.fromStartM'), { offset: v + o.width / 2 })} /></Row>
            <Row label={t('props.Uopening')}><NumberField value={o.U} digits={2} onCommit={v => v > 0 && updO(t('props.Uopening'), { U: v })} /></Row>
            {o.kind === 'door' && <>
              <Row label={t('props.hinge')}>
                <div className="seg small">
                  <button className={o.hinge === 'start' ? 'on' : ''} onClick={() => updO(t('props.hinge'), { hinge: 'start' })}>A</button>
                  <button className={o.hinge === 'end' ? 'on' : ''} onClick={() => updO(t('props.hinge'), { hinge: 'end' })}>B</button>
                </div>
              </Row>
              <Row label={t('props.swing')}>
                <div className="seg small">
                  <button className={o.swing === 'left' ? 'on' : ''} onClick={() => updO(t('props.swing'), { swing: 'left' })}>{t('wall.just.left')}</button>
                  <button className={o.swing === 'right' ? 'on' : ''} onClick={() => updO(t('props.swing'), { swing: 'right' })}>{t('wall.just.right')}</button>
                </div>
              </Row>
            </>}
            <div className="pad"><button className="btn danger" onClick={() => runCommand('edit.delete')}>{t('cmd.edit.delete')}</button></div>
          </div>
        )
      })() : selWallIds.length > 1 ? (() => {
        const ids = new Set(selWallIds)
        const ws = project.levels.flatMap(l => l.walls.filter(w => ids.has(w.id)))
        const types = new Set(ws.map(w => w.typeId))
        const total = ws.reduce((a, w) => a + dist(w.a, w.b), 0)
        return (
          <div className="props">
            <div className="side-section">{t('props.multiWalls', { n: ws.length })}</div>
            <Row label={t('props.wallType')}>{typeSelect(types.size === 1 ? [...types][0] : '',
              id => store.update(t('props.wallType'), p => ({ ...p, levels: p.levels.map(l => ({ ...l, walls: l.walls.map(w => (ids.has(w.id) ? { ...w, typeId: id } : w)) })) })))}</Row>
            <Row label={t('props.totalLength')}><span className="ro">{formatLength(total, unit)}</span></Row>
            <p className="muted pad small">{t('props.multiHelp')}</p>
            <div className="pad"><button className="btn danger" onClick={() => runCommand('edit.delete')}>{t('cmd.edit.delete')}</button></div>
          </div>
        )
      })() : (tool === 'build.door' || tool === 'build.window') ? (
        <div className="props">
          <div className="side-section">{t(tool === 'build.door' ? 'props.doorDefaults' : 'props.windowDefaults')}</div>
          {tool === 'build.door' ? <>
            <Row label={t('props.widthM')}><NumberField value={doorDef.width} onCommit={v => v > 0.2 && store.setUI({ doorDefaults: { ...doorDef, width: v } })} /></Row>
            <Row label={t('props.heightM')}><NumberField value={doorDef.height} onCommit={v => v > 0.2 && store.setUI({ doorDefaults: { ...doorDef, height: v } })} /></Row>
            <Row label={t('props.Uopening')}><NumberField value={doorDef.U} digits={2} onCommit={v => v > 0 && store.setUI({ doorDefaults: { ...doorDef, U: v } })} /></Row>
          </> : <>
            <Row label={t('props.widthM')}><NumberField value={winDef.width} onCommit={v => v > 0.2 && store.setUI({ windowDefaults: { ...winDef, width: v } })} /></Row>
            <Row label={t('props.heightM')}><NumberField value={winDef.height} onCommit={v => v > 0.2 && store.setUI({ windowDefaults: { ...winDef, height: v } })} /></Row>
            <Row label={t('props.sillM')}><NumberField value={winDef.sill} onCommit={v => v >= 0 && store.setUI({ windowDefaults: { ...winDef, sill: v } })} /></Row>
            <Row label={t('props.Uopening')}><NumberField value={winDef.U} digits={2} onCommit={v => v > 0 && store.setUI({ windowDefaults: { ...winDef, U: v } })} /></Row>
          </>}
          <p className="muted pad small">{t('props.openingHelp')}</p>
        </div>
      ) : fw ? (() => {
        const w = fw.wall
        const updW = (label: string, patch: Partial<Wall>) =>
          updateLevel(label, fw.level.id, l => ({ ...l, walls: l.walls.map(x => (x.id === w.id ? { ...x, ...patch } : x)) }))
        return (
          <div className="props">
            <div className="side-section">{t('props.wall')}</div>
            <Row label={t('props.wallType')}>{typeSelect(w.typeId, id => updW(t('props.wallType'), { typeId: id }))}</Row>
            {typeInfo(w.typeId)}
            <Row label={t('props.justification')}>{justSeg(w.justification, j => updW(t('props.justification'), { justification: j }))}</Row>
            <Row label={t('props.length')}><span className="ro">{formatLength(dist(w.a, w.b), unit)}</span></Row>
            <Row label={t('props.wallHeight')}>
              <NumberField value={w.height ?? fw.level.height} onCommit={v => v > 0 && updW(t('props.wallHeight'), { height: Math.abs(v - fw.level.height) < 1e-6 ? null : v })} />
            </Row>
            <div className="pad"><button className="btn danger" onClick={() => runCommand('edit.delete')}>{t('cmd.edit.delete')}</button></div>
          </div>
        )
      })() : tool === 'build.wall' ? (
        <div className="props">
          <div className="side-section">{t('props.wallOptions')}</div>
          <Row label={t('props.wallType')}>{typeSelect(wallTypeId, id => store.setUI({ wallTypeId: id }))}</Row>
          {typeInfo(wallTypeId)}
          <Row label={t('props.justification')}>{justSeg(just, j => store.setUI({ wallJustification: j }))}</Row>
          <p className="muted pad small">{t('props.wallHelp')}</p>
          <div className="pad"><button className="btn" onClick={() => runCommand('library.open')}>{t('cmd.library.open')}…</button></div>
        </div>
      ) : f ? (() => {
        const u = f.underlay
        const tr = u.transform
        const upd = (label: string, fn: (x: Underlay) => Underlay) => updateUnderlay(label, u.id, fn)
        const h = (u.kind === 'vector' ? u.bounds.max.y : u.pxHeight) * tr.scale
        return (
          <div className="props">
            <Row label={t('props.name')}><TextField value={u.name} onCommit={v => upd(t('props.name'), x => ({ ...x, name: v || x.name }))} /></Row>
            <Row label={t('props.source')}><span className="ro">{u.sourceFormat.toUpperCase()}{u.kind === 'raster' ? ` · ${u.pxWidth}×${u.pxHeight}px` : ''}</span></Row>
            {u.kind === 'vector' && <Row label={t('props.declaredUnits')}><span className="ro">{u.declaredUnits}</span></Row>}
            <Row label={t('props.size')}><span className="ro">{formatLength(underlayWorldWidth(u), unit)} × {formatLength(h, unit)}</span></Row>
            <Row label={t('props.calibration')}>
              <span className={`pill ${u.calibrated ? 'ok' : 'warn'}`}>{u.calibrated ? t('project.calibrated') : t('project.notCalibrated')}</span>
            </Row>
            <Row label={t('props.scale')}>
              <NumberField value={tr.scale} digits={8} onCommit={v => v > 0 && upd(t('props.scale'), x => ({ ...x, transform: { ...x.transform, scale: v } }))} />
            </Row>
            <Row label={t('props.rotation')}>
              <NumberField value={(tr.rotation * 180) / Math.PI} digits={3}
                onCommit={v => upd(t('props.rotation'), x => ({ ...x, transform: { ...x.transform, rotation: (v * Math.PI) / 180 } }))} />
            </Row>
            <Row label={t('props.offsetX')}>
              <NumberField value={tr.offset.x} onCommit={v => upd(t('props.offsetX'), x => ({ ...x, transform: { ...x.transform, offset: { ...x.transform.offset, x: v } } }))} />
            </Row>
            <Row label={t('props.offsetY')}>
              <NumberField value={tr.offset.y} onCommit={v => upd(t('props.offsetY'), x => ({ ...x, transform: { ...x.transform, offset: { ...x.transform.offset, y: v } } }))} />
            </Row>
            <Row label={`${t('props.opacity')} ${Math.round(u.opacity * 100)}%`}>
              <input type="range" min={10} max={100} defaultValue={Math.round(u.opacity * 100)} key={u.id + u.opacity}
                onPointerUp={e => upd(t('props.opacity'), x => ({ ...x, opacity: +(e.target as HTMLInputElement).value / 100 }))}
                onKeyUp={e => upd(t('props.opacity'), x => ({ ...x, opacity: +(e.target as HTMLInputElement).value / 100 }))} />
            </Row>
            <Row label={t('props.locked')}>
              <input type="checkbox" checked={u.locked} onChange={e => upd(t('props.locked'), x => ({ ...x, locked: e.target.checked }))} />
            </Row>
          </div>
        )
      })() : (
        <div className="props">
          <div className="side-section">{t('props.level')}</div>
          <Row label={t('props.name')}><TextField value={level.name} onCommit={v => updLevel({ name: v || level.name })} /></Row>
          <Row label={t('props.elevation')}><NumberField value={level.elevation} onCommit={v => updLevel({ elevation: v })} /></Row>
          <Row label={t('props.height')}><NumberField value={level.height} onCommit={v => v > 0 && updLevel({ height: v })} /></Row>
          <Row label={t('props.slab')}>
            <select value={level.slab?.typeId ?? ''} onChange={e => e.target.value ? (level.slab ? updLevel({ slab: { ...level.slab, typeId: e.target.value } }) : runCommand('build.slab')) : updLevel({ slab: null })}>
              <option value="">—</option>
              {project.library.slabTypes.filter(x => x.category === 'ground' || x.category === 'intermediate').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Row>
          <Row label={t('props.ceiling')}>
            <select value={level.ceilingTypeId ?? ''} onChange={e => updLevel({ ceilingTypeId: e.target.value || null })}>
              <option value="">{t('props.heatedAbove')}</option>
              {project.library.slabTypes.filter(x => x.category === 'ceiling-unheated' || x.category === 'roof').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Row>
          <div className="side-section">{t('props.project')}</div>
          <Row label={t('props.displayUnit')}>
            <select value={unit} onChange={e => store.update(t('props.displayUnit'), p => ({ ...p, settings: { ...p.settings, displayUnit: e.target.value as any } }))}>
              <option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option>
            </select>
          </Row>
          <Row label={t('props.checkMode')}>
            <select value={project.settings.checkMode}
              onChange={e => store.update(t('props.checkMode'), p => ({ ...p, settings: { ...p.settings, checkMode: e.target.value as any } }))}>
              <option value="advisory">{t('mode.advisory')}</option><option value="strict">{t('mode.strict')}</option>
            </select>
          </Row>
          <Row label={t('props.norm')}>
            <select value={project.settings.ventilationNorm}
              onChange={e => store.update(t('props.norm'), p => ({ ...p, settings: { ...p.settings, ventilationNorm: e.target.value as any } }))}>
              <option>I5-2022</option><option>DIN 1946-6</option><option>SR EN 16798-1</option><option value="custom">Custom</option>
            </select>
          </Row>
          <p className="muted pad">{t('props.none')}</p>
        </div>
      )}
    </aside>
  )
}
