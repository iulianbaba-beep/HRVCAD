import { useState } from 'react'
import { TbEye, TbEyeOff, TbLock, TbChevronDown, TbStack2, TbFileImport, TbPhoto, TbFileTypePdf } from 'react-icons/tb'
import { activeLevel, findOpening, findUnderlay, findWall, store, updateLevel, updateUnderlay, useStore } from '../core/store'
import type { Opening, Underlay, Wall, WallJustification } from '../core/types'
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
      {fo ? (() => {
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
