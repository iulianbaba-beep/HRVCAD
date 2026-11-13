import { useState } from 'react'
import { TbX, TbPlus, TbCopy, TbTrash, TbArrowUp, TbArrowDown, TbAlertTriangle } from 'react-icons/tb'
import { store, useStore } from '../core/store'
import { newId, type Library, type Material, type WallType } from '../core/types'
import { wallSurfaceResistances, wallTypeThickness, wallTypeU } from '../core/thermal'
import { useT } from '../i18n'
import { NumberField, TextField } from './fields'

function updLib(label: string, fn: (l: Library) => Library) {
  store.update(label, p => ({ ...p, library: fn(p.library) }))
}

export function LibraryDialog() {
  const t = useT()
  const [tab, setTab] = useState<'walls' | 'materials'>('walls')
  const close = () => store.setUI({ libraryOpen: false })
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={t('lib.title')}>
        <header className="modal-head">
          <h2>{t('lib.title')}</h2>
          <div className="seg">
            <button className={tab === 'walls' ? 'on' : ''} onClick={() => setTab('walls')}>{t('lib.wallTypes')}</button>
            <button className={tab === 'materials' ? 'on' : ''} onClick={() => setTab('materials')}>{t('lib.materials')}</button>
          </div>
          <button className="icon-btn big" onClick={close} aria-label={t('filemenu.close')}><TbX /></button>
        </header>
        {tab === 'walls' ? <WallTypes /> : <Materials />}
      </div>
    </div>
  )
}

function WallTypes() {
  const t = useT()
  const lib = useStore(s => s.project.library)
  const usedIds = useStore(s => new Set(s.project.levels.flatMap(l => l.walls.map(w => w.typeId))).size)
  const used = new Set(store.get().project.levels.flatMap(l => l.walls.map(w => w.typeId)))
  void usedIds
  const [selId, setSelId] = useState<string | undefined>(lib.wallTypes[0]?.id)
  const sel = lib.wallTypes.find(w => w.id === selId) ?? lib.wallTypes[0]
  const label = t('lib.wallTypes')

  const updType = (fn: (w: WallType) => WallType) =>
    updLib(label, l => ({ ...l, wallTypes: l.wallTypes.map(w => (w.id === sel.id ? fn(w) : w)) }))

  const addType = (base?: WallType) => {
    const nt: WallType = base
      ? { ...structuredClone(base), id: newId('wt'), name: `${base.name} (${t('lib.copy')})` }
      : { id: newId('wt'), name: t('lib.newWallType'), category: 'exterior', layers: [{ materialId: lib.materials[0].id, thickness: 0.25 }] }
    updLib(label, l => ({ ...l, wallTypes: [...l.wallTypes, nt] }))
    setSelId(nt.id)
  }

  return (
    <div className="lib-body">
      <div className="lib-list">
        <div className="lib-list-actions">
          <button onClick={() => addType()}><TbPlus /> {t('lib.new')}</button>
          {sel && <button onClick={() => addType(sel)}><TbCopy /> {t('lib.duplicate')}</button>}
          {sel && <button disabled={used.has(sel.id) || lib.wallTypes.length < 2} title={used.has(sel.id) ? t('lib.inUse') : ''}
            onClick={() => { updLib(label, l => ({ ...l, wallTypes: l.wallTypes.filter(w => w.id !== sel.id) })); setSelId(undefined) }}>
            <TbTrash /> {t('lib.delete')}</button>}
        </div>
        <ul>
          {lib.wallTypes.map(w => {
            const u = wallTypeU(w, lib)
            return (
              <li key={w.id} className={w.id === sel?.id ? 'on' : ''} onClick={() => setSelId(w.id)}>
                <b>{w.name}</b>
                <small>{t(w.category === 'exterior' ? 'lib.exterior' : 'lib.interior')} · {(wallTypeThickness(w) * 1000).toFixed(0)} mm · U {u.U.toFixed(3)}</small>
              </li>
            )
          })}
        </ul>
      </div>
      {sel && <WallTypeEditor w={sel} lib={lib} upd={updType} />}
    </div>
  )
}

function WallTypeEditor({ w, lib, upd }: { w: WallType; lib: Library; upd: (fn: (w: WallType) => WallType) => void }) {
  const t = useT()
  const u = wallTypeU(w, lib)
  const rs = wallSurfaceResistances(w.category)
  const setLayer = (i: number, patch: Partial<WallType['layers'][number]>) =>
    upd(x => ({ ...x, layers: x.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) }))
  const move = (i: number, d: number) => upd(x => {
    const layers = [...x.layers]; const j = i + d
    if (j < 0 || j >= layers.length) return x
    ;[layers[i], layers[j]] = [layers[j], layers[i]]
    return { ...x, layers }
  })
  return (
    <div className="lib-editor">
      <div className="lib-row">
        <label>{t('props.name')}<TextField value={w.name} onCommit={v => upd(x => ({ ...x, name: v || x.name }))} /></label>
        <label>{t('lib.category')}
          <select value={w.category} onChange={e => upd(x => ({ ...x, category: e.target.value as WallType['category'] }))}>
            <option value="exterior">{t('lib.exterior')}</option><option value="interior">{t('lib.interior')}</option>
          </select>
        </label>
      </div>
      <p className="muted small">{t('lib.layerOrder')}</p>
      <table className="lib-table">
        <thead><tr><th>#</th><th>{t('lib.material')}</th><th>{t('lib.thicknessMm')}</th><th>λ</th><th>R</th><th /></tr></thead>
        <tbody>
          {w.layers.map((l, i) => {
            const m = lib.materials.find(x => x.id === l.materialId)
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <select value={l.materialId} onChange={e => setLayer(i, { materialId: e.target.value })}>
                    {lib.materials.map(mm => <option key={mm.id} value={mm.id}>{mm.name}</option>)}
                  </select>
                </td>
                <td className="num"><NumberField value={l.thickness * 1000} digits={1} onCommit={v => v > 0 && setLayer(i, { thickness: v / 1000 })} /></td>
                <td className="num">{m ? m.lambda.toFixed(3) : '—'}{m && !m.verified && <TbAlertTriangle className="warn-ic" title={t('lib.unverified')} />}</td>
                <td className="num">{m ? (l.thickness / m.lambda).toFixed(3) : '—'}</td>
                <td className="acts">
                  <button className="icon-btn" onClick={() => move(i, -1)} aria-label="up"><TbArrowUp /></button>
                  <button className="icon-btn" onClick={() => move(i, 1)} aria-label="down"><TbArrowDown /></button>
                  <button className="icon-btn" disabled={w.layers.length < 2}
                    onClick={() => upd(x => ({ ...x, layers: x.layers.filter((_, j) => j !== i) }))} aria-label={t('lib.delete')}><TbTrash /></button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button className="lib-add" onClick={() => upd(x => ({ ...x, layers: [...x.layers, { materialId: lib.materials[0].id, thickness: 0.05 }] }))}>
        <TbPlus /> {t('lib.addLayer')}
      </button>
      <div className="lib-summary">
        <div><span>{t('props.thickness')}</span><b>{(wallTypeThickness(w) * 1000).toFixed(0)} mm</b></div>
        <div><span>Rsi + Rse</span><b>{rs.si.toFixed(2)} + {rs.se.toFixed(2)} m²K/W</b></div>
        <div><span>R {t('lib.layers')}</span><b>{u.R.toFixed(3)} m²K/W</b></div>
        <div className="big"><span>U</span><b>{u.U.toFixed(3)} W/m²K</b></div>
      </div>
      <p className="muted small">{t('lib.uNote')}</p>
      {u.unverified && <p className="warn-box"><TbAlertTriangle /> {t('lib.unverifiedNote')}</p>}
    </div>
  )
}

function Materials() {
  const t = useT()
  const lib = useStore(s => s.project.library)
  const used = new Set(lib.wallTypes.flatMap(w => w.layers.map(l => l.materialId)))
  const label = t('lib.materials')
  const upd = (id: string, patch: Partial<Material>) =>
    updLib(label, l => ({ ...l, materials: l.materials.map(m => (m.id === id ? { ...m, ...patch } : m)) }))
  return (
    <div className="lib-materials">
      <div className="lib-list-actions">
        <button onClick={() => updLib(label, l => ({
          ...l, materials: [...l.materials, { id: newId('mat'), name: t('lib.newMaterial'), lambda: 0.1, source: t('lib.userSource'), verified: false }]
        }))}><TbPlus /> {t('lib.new')}</button>
        <span className="muted small">{t('lib.materialsNote')}</span>
      </div>
      <div className="lib-scroll">
        <table className="lib-table">
          <thead><tr><th>{t('props.name')}</th><th>ρ kg/m³</th><th>λ W/mK</th><th>{t('props.source')}</th><th>{t('lib.verified')}</th><th /></tr></thead>
          <tbody>
            {lib.materials.map(m => (
              <tr key={m.id} className={m.verified ? '' : 'unverified'}>
                <td><TextField value={m.name} onCommit={v => upd(m.id, { name: v || m.name })} /></td>
                <td className="num"><NumberField value={m.density ?? 0} digits={0} onCommit={v => upd(m.id, { density: v || undefined })} /></td>
                <td className="num"><NumberField value={m.lambda} digits={4} onCommit={v => v > 0 && upd(m.id, { lambda: v })} /></td>
                <td><TextField value={m.source} onCommit={v => upd(m.id, { source: v })} /></td>
                <td className="c"><input type="checkbox" checked={m.verified} onChange={e => upd(m.id, { verified: e.target.checked })} /></td>
                <td className="acts">
                  <button className="icon-btn" disabled={used.has(m.id)} title={used.has(m.id) ? t('lib.inUse') : t('lib.delete')}
                    onClick={() => updLib(label, l => ({ ...l, materials: l.materials.filter(x => x.id !== m.id) }))}><TbTrash /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
