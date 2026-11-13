import { useState } from 'react'
import { TbX, TbPlus, TbCopy, TbTrash, TbArrowUp, TbArrowDown, TbAlertTriangle } from 'react-icons/tb'
import { store, useStore } from '../core/store'
import { newId, type ConstructionLayer, type DuctMaterial, type HrvUnitType, type Library, type Material, type PlenumType, type SlabType, type TerminalType, type WallType } from '../core/types'
import { layersResistance, RS, wallSurfaceResistances, wallTypeThickness, wallTypeU } from '../core/thermal'
import { useT } from '../i18n'
import { NumberField, TextField } from './fields'

function updLib(label: string, fn: (l: Library) => Library) {
  store.update(label, p => ({ ...p, library: fn(p.library) }))
}

export function LibraryDialog() {
  const t = useT()
  const [tab, setTab] = useState<'walls' | 'slabs' | 'materials' | 'hvac'>(store.get().ui.libraryTab as any ?? 'walls')
  const close = () => store.setUI({ libraryOpen: false })
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={t('lib.title')}>
        <header className="modal-head">
          <h2>{t('lib.title')}</h2>
          <div className="seg">
            <button className={tab === 'walls' ? 'on' : ''} onClick={() => setTab('walls')}>{t('lib.wallTypes')}</button>
            <button className={tab === 'slabs' ? 'on' : ''} onClick={() => setTab('slabs')}>{t('lib.slabTypes')}</button>
            <button className={tab === 'materials' ? 'on' : ''} onClick={() => setTab('materials')}>{t('lib.materials')}</button>
            <button className={tab === 'hvac' ? 'on' : ''} onClick={() => setTab('hvac')}>{t('lib.hvac')}</button>
          </div>
          <button className="icon-btn big" onClick={close} aria-label={t('filemenu.close')}><TbX /></button>
        </header>
        {tab === 'walls' ? <WallTypes /> : tab === 'slabs' ? <SlabTypes /> : tab === 'materials' ? <Materials /> : <HvacCatalogEditor />}
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

// ---------------------------------------------------------------- slabs & roofs
function SlabTypes() {
  const t = useT()
  const lib = useStore(s => s.project.library)
  const [selId, setSelId] = useState<string | undefined>(lib.slabTypes[0]?.id)
  const sel = lib.slabTypes.find(w => w.id === selId) ?? lib.slabTypes[0]
  const label = t('lib.slabTypes')
  const upd = (fn: (w: SlabType) => SlabType) => updLib(label, l => ({ ...l, slabTypes: l.slabTypes.map(w => (w.id === sel.id ? fn(w) : w)) }))
  const rsFor = (c: SlabType['category']) => c === 'ground' ? { si: RS.downward.si, se: 0 } : c === 'intermediate' ? { si: RS.downward.si, se: RS.downward.si } : { si: RS.upward.si, se: RS.upward.se }
  return (
    <div className="lib-body">
      <div className="lib-list">
        <div className="lib-list-actions">
          <button onClick={() => { const n: SlabType = { id: newId('st'), name: t('lib.newSlab'), category: 'roof', layers: [{ materialId: lib.materials[0].id, thickness: 0.2 }] }; updLib(label, l => ({ ...l, slabTypes: [...l.slabTypes, n] })); setSelId(n.id) }}><TbPlus /> {t('lib.new')}</button>
          {sel && <button onClick={() => { const n = { ...structuredClone(sel), id: newId('st'), name: `${sel.name} (${t('lib.copy')})` }; updLib(label, l => ({ ...l, slabTypes: [...l.slabTypes, n] })); setSelId(n.id) }}><TbCopy /> {t('lib.duplicate')}</button>}
        </div>
        <ul>{lib.slabTypes.map(w => {
          const rs = rsFor(w.category)
          const U = 1 / (rs.si + rs.se + layersResistance(w.layers, lib))
          return <li key={w.id} className={w.id === sel?.id ? 'on' : ''} onClick={() => setSelId(w.id)}><b>{w.name}</b><small>{t(`slab.${w.category}` as any)} · U {U.toFixed(3)}</small></li>
        })}</ul>
      </div>
      {sel && (
        <div className="lib-editor">
          <div className="lib-row">
            <label>{t('props.name')}<TextField value={sel.name} onCommit={v => upd(x => ({ ...x, name: v || x.name }))} /></label>
            <label>{t('lib.category')}
              <select value={sel.category} onChange={e => upd(x => ({ ...x, category: e.target.value as SlabType['category'] }))}>
                {(['ground', 'intermediate', 'ceiling-unheated', 'roof'] as const).map(c => <option key={c} value={c}>{t(`slab.${c}` as any)}</option>)}
              </select>
            </label>
          </div>
          <LayersEditor layers={sel.layers} lib={lib} onChange={layers => upd(x => ({ ...x, layers }))} />
          <div className="lib-summary">
            <div className="big"><span>U</span><b>{(1 / (rsFor(sel.category).si + rsFor(sel.category).se + layersResistance(sel.layers, lib))).toFixed(3)} W/m²K</b></div>
          </div>
        </div>
      )}
    </div>
  )
}

function LayersEditor({ layers, lib, onChange }: { layers: ConstructionLayer[]; lib: Library; onChange: (l: ConstructionLayer[]) => void }) {
  const t = useT()
  const set = (i: number, patch: Partial<ConstructionLayer>) => onChange(layers.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  return (
    <>
      <table className="lib-table">
        <thead><tr><th>#</th><th>{t('lib.material')}</th><th>{t('lib.thicknessMm')}</th><th>λ</th><th /></tr></thead>
        <tbody>{layers.map((l, i) => {
          const m = lib.materials.find(x => x.id === l.materialId)
          return (
            <tr key={i}><td>{i + 1}</td>
              <td><select value={l.materialId} onChange={e => set(i, { materialId: e.target.value })}>{lib.materials.map(mm => <option key={mm.id} value={mm.id}>{mm.name}</option>)}</select></td>
              <td className="num"><NumberField value={l.thickness * 1000} digits={1} onCommit={v => v > 0 && set(i, { thickness: v / 1000 })} /></td>
              <td className="num">{m?.lambda.toFixed(3)}</td>
              <td className="acts"><button className="icon-btn" disabled={layers.length < 2} onClick={() => onChange(layers.filter((_, j) => j !== i))}><TbTrash /></button></td>
            </tr>
          )
        })}</tbody>
      </table>
      <button className="lib-add" onClick={() => onChange([...layers, { materialId: lib.materials[0].id, thickness: 0.05 }])}><TbPlus /> {t('lib.addLayer')}</button>
    </>
  )
}

// ---------------------------------------------------------------- HVAC catalog
const curveText = (u: HrvUnitType) => u.curve.map(c => `${c.q}:${c.dp}`).join('; ')
const parseCurve = (s: string) => s.split(';').map(x => x.split(':').map(Number)).filter(a => a.length === 2 && a.every(Number.isFinite)).map(([q, dp]) => ({ q, dp }))
const sizesText = (m: DuctMaterial) => m.sizes.map(z => `${z.label}=${((z.d ?? 0) * 1000).toFixed(0)}@${z.price}`).join('; ')
function parseSizes(s: string, m: DuctMaterial) {
  return s.split(';').map(x => x.trim()).filter(Boolean).map((x, i) => {
    const mm = x.match(/^(.+?)=(\d+(?:\.\d+)?)@(\d+(?:\.\d+)?)$/)
    if (!mm) return null
    return { id: m.sizes[i]?.label === mm[1] ? m.sizes[i].id : newId('sz'), label: mm[1].trim(), d: +mm[2] / 1000, price: +mm[3], code: `${m.name.slice(0, 6)}-${mm[1].trim()}` }
  }).filter(Boolean) as DuctMaterial['sizes']
}

function HvacCatalogEditor() {
  const t = useT()
  const lib = useStore(s => s.project.library)
  const h = lib.hvac
  const label = t('lib.hvac')
  const updH = (fn: (x: Library['hvac']) => Library['hvac']) => updLib(label, l => ({ ...l, hvac: fn(l.hvac) }))
  const updList = <K extends keyof Library['hvac']>(key: K, id: string, patch: Partial<Library['hvac'][K][number]>) =>
    updH(x => ({ ...x, [key]: (x[key] as any[]).map(it => (it.id === id ? { ...it, ...patch } : it)) }))
  const add = <K extends keyof Library['hvac']>(key: K, item: Library['hvac'][K][number]) => updH(x => ({ ...x, [key]: [...(x[key] as any[]), item] }))
  const del = <K extends keyof Library['hvac']>(key: K, id: string) => updH(x => ({ ...x, [key]: (x[key] as any[]).filter(it => it.id !== id) }))
  const Num = ({ v, on, d = 2 }: { v: number; on: (n: number) => void; d?: number }) => <NumberField value={v} digits={d} onCommit={n => n >= 0 && on(n)} />
  const Ver = ({ v, on }: { v: boolean; on: (b: boolean) => void }) => <input type="checkbox" checked={v} onChange={e => on(e.target.checked)} />
  return (
    <div className="lib-scroll hvac-cat">
      <p className="muted small">{t('lib.hvacNote')}</p>
      <h3>{t('lib.units')} <button className="lib-add" onClick={() => add('units', { ...structuredClone(h.units[0]), id: newId('hrv'), name: t('lib.newItem'), verified: false })}><TbPlus /></button></h3>
      <table className="lib-table"><thead><tr><th>{t('props.name')}</th><th>Cod</th><th>Preț</th><th>q max</th><th>η</th><th>SFP</th><th>Lw dB(A)</th><th>{t('lib.curve')}</th><th>✓</th><th /></tr></thead>
        <tbody>{h.units.map(u => (
          <tr key={u.id} className={u.verified ? '' : 'unverified'}>
            <td><TextField value={u.name} onCommit={v => updList('units', u.id, { name: v })} /></td>
            <td><TextField value={u.code} onCommit={v => updList('units', u.id, { code: v })} /></td>
            <td className="num"><Num v={u.price} d={0} on={v => updList('units', u.id, { price: v })} /></td>
            <td className="num"><Num v={u.maxFlow} d={0} on={v => updList('units', u.id, { maxFlow: v })} /></td>
            <td className="num"><Num v={u.efficiency} on={v => v <= 1 && updList('units', u.id, { efficiency: v })} /></td>
            <td className="num"><Num v={u.sfp} on={v => updList('units', u.id, { sfp: v })} /></td>
            <td className="num"><Num v={u.soundPower} d={0} on={v => updList('units', u.id, { soundPower: v })} /></td>
            <td><TextField value={curveText(u)} onCommit={v => { const c = parseCurve(v); if (c.length >= 2) updList('units', u.id, { curve: c }) }} /></td>
            <td className="c"><Ver v={u.verified} on={b => updList('units', u.id, { verified: b })} /></td>
            <td className="acts"><button className="icon-btn" disabled={h.units.length < 2} onClick={() => del('units', u.id)}><TbTrash /></button></td>
          </tr>))}</tbody></table>
      <h3>{t('lib.ducts')} <button className="lib-add" onClick={() => add('ductMaterials', { ...structuredClone(h.ductMaterials[0]), id: newId('dm'), name: t('lib.newItem'), verified: false })}><TbPlus /></button></h3>
      <table className="lib-table"><thead><tr><th>{t('props.name')}</th><th>{t('lib.kind')}</th><th>k mm</th><th>ζ cot</th><th>ζ teu ram.</th><th>ζ teu dr.</th><th>v max</th><th>{t('lib.sizes')}</th><th>✓</th><th /></tr></thead>
        <tbody>{h.ductMaterials.map(m => (
          <tr key={m.id} className={m.verified ? '' : 'unverified'}>
            <td><TextField value={m.name} onCommit={v => updList('ductMaterials', m.id, { name: v })} /></td>
            <td><select value={m.kind} onChange={e => updList('ductMaterials', m.id, { kind: e.target.value as DuctMaterial['kind'] })}>
              {(['rigid', 'semirigid', 'epp', 'flex'] as const).map(k => <option key={k} value={k}>{t(`duct.${k}` as any)}</option>)}</select></td>
            <td className="num"><Num v={m.roughness} on={v => updList('ductMaterials', m.id, { roughness: v })} /></td>
            <td className="num"><Num v={m.zetaBend90} on={v => updList('ductMaterials', m.id, { zetaBend90: v })} /></td>
            <td className="num"><Num v={m.zetaTeeBranch} on={v => updList('ductMaterials', m.id, { zetaTeeBranch: v })} /></td>
            <td className="num"><Num v={m.zetaTeeThrough} on={v => updList('ductMaterials', m.id, { zetaTeeThrough: v })} /></td>
            <td className="num"><Num v={m.vMax} on={v => v > 0 && updList('ductMaterials', m.id, { vMax: v })} /></td>
            <td><TextField value={sizesText(m)} onCommit={v => { const z = parseSizes(v, m); if (z.length) updList('ductMaterials', m.id, { sizes: z }) }} /></td>
            <td className="c"><Ver v={m.verified} on={b => updList('ductMaterials', m.id, { verified: b })} /></td>
            <td className="acts"><button className="icon-btn" disabled={h.ductMaterials.length < 2} onClick={() => del('ductMaterials', m.id)}><TbTrash /></button></td>
          </tr>))}</tbody></table>
      <p className="muted small">{t('lib.sizesHelp')}</p>
      <h3>{t('lib.terminals')} <button className="lib-add" onClick={() => add('terminals', { ...structuredClone(h.terminals[0]), id: newId('tt'), name: t('lib.newItem'), verified: false } as TerminalType)}><TbPlus /></button></h3>
      <table className="lib-table"><thead><tr><th>{t('props.name')}</th><th>{t('lib.use')}</th><th>q ref</th><th>Δp ref</th><th>q max</th><th>Lw ref</th><th>Preț</th><th>✓</th><th /></tr></thead>
        <tbody>{h.terminals.map(x => (
          <tr key={x.id} className={x.verified ? '' : 'unverified'}>
            <td><TextField value={x.name} onCommit={v => updList('terminals', x.id, { name: v })} /></td>
            <td><select value={x.use} onChange={e => updList('terminals', x.id, { use: e.target.value as TerminalType['use'] })}>
              {(['supply', 'extract', 'both', 'outdoor'] as const).map(k => <option key={k} value={k}>{t(`use.${k}` as any)}</option>)}</select></td>
            <td className="num"><Num v={x.qRef} d={0} on={v => v > 0 && updList('terminals', x.id, { qRef: v })} /></td>
            <td className="num"><Num v={x.dpRef} d={1} on={v => updList('terminals', x.id, { dpRef: v })} /></td>
            <td className="num"><Num v={x.maxFlow} d={0} on={v => updList('terminals', x.id, { maxFlow: v })} /></td>
            <td className="num"><Num v={x.lwRef} d={0} on={v => updList('terminals', x.id, { lwRef: v })} /></td>
            <td className="num"><Num v={x.price} d={0} on={v => updList('terminals', x.id, { price: v })} /></td>
            <td className="c"><Ver v={x.verified} on={b => updList('terminals', x.id, { verified: b })} /></td>
            <td className="acts"><button className="icon-btn" disabled={h.terminals.length < 2} onClick={() => del('terminals', x.id)}><TbTrash /></button></td>
          </tr>))}</tbody></table>
      <h3>{t('lib.plenums')} <button className="lib-add" onClick={() => add('plenums', { ...structuredClone(h.plenums[0]), id: newId('pl'), name: t('lib.newItem'), verified: false } as PlenumType)}><TbPlus /></button></h3>
      <table className="lib-table"><thead><tr><th>{t('props.name')}</th><th>{t('lib.outlets')}</th><th>q ref</th><th>Δp ref</th><th>{t('lib.il')}</th><th>Preț</th><th>✓</th><th /></tr></thead>
        <tbody>{h.plenums.map(x => (
          <tr key={x.id} className={x.verified ? '' : 'unverified'}>
            <td><TextField value={x.name} onCommit={v => updList('plenums', x.id, { name: v })} /></td>
            <td className="num"><Num v={x.outlets} d={0} on={v => updList('plenums', x.id, { outlets: v })} /></td>
            <td className="num"><Num v={x.qRef} d={0} on={v => v > 0 && updList('plenums', x.id, { qRef: v })} /></td>
            <td className="num"><Num v={x.dpRef} d={1} on={v => updList('plenums', x.id, { dpRef: v })} /></td>
            <td className="num"><Num v={x.insertionLoss} d={1} on={v => updList('plenums', x.id, { insertionLoss: v })} /></td>
            <td className="num"><Num v={x.price} d={0} on={v => updList('plenums', x.id, { price: v })} /></td>
            <td className="c"><Ver v={x.verified} on={b => updList('plenums', x.id, { verified: b })} /></td>
            <td className="acts"><button className="icon-btn" disabled={h.plenums.length < 2} onClick={() => del('plenums', x.id)}><TbTrash /></button></td>
          </tr>))}</tbody></table>
    </div>
  )
}
