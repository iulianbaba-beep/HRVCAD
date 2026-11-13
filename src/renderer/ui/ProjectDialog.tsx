// Project data: site & climate, energy prices, ventilation standard and its per-room rules.
import { TbX } from 'react-icons/tb'
import { store, useStore } from '../core/store'
import type { NormProfile, RoomRule, RoomType, SiteSettings } from '../core/types'
import { LOCALITIES } from '../library/defaults'
import { ROOM_TYPES } from '../core/rooms'
import { useT } from '../i18n'
import { NumberField } from './fields'

export function ProjectDialog() {
  const t = useT()
  const p = useStore(s => s.project)
  const close = () => store.setUI({ projectDialog: false })
  const site = p.site
  const updSite = (patch: Partial<SiteSettings>) => store.update(t('proj.title'), x => ({ ...x, site: { ...x.site, ...patch } }))
  const norm = p.norms.find(n => n.id === p.settings.ventilationNorm) ?? p.norms[0]
  const updNorm = (fn: (n: NormProfile) => NormProfile) => store.update(t('props.norm'), x => ({ ...x, norms: x.norms.map(n => (n.id === norm.id ? fn(n) : n)) }))
  const updRule = (rt: RoomType, patch: Partial<RoomRule>) => updNorm(n => ({ ...n, rooms: { ...n.rooms, [rt]: { ...n.rooms[rt], ...patch } } }))
  const loc = LOCALITIES.find(l => l.id === site.localityId)
  const opt = (v: number | undefined, on: (x: number | undefined) => void) =>
    <NumberField value={v ?? 0} digits={2} onCommit={x => on(x === 0 ? undefined : x)} />
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={t('proj.title')}>
        <header className="modal-head">
          <h2>{t('proj.title')}</h2>
          <span />
          <button className="icon-btn big" onClick={close} aria-label="close"><TbX /></button>
        </header>
        <div className="res-body">
          <h3>{t('proj.site')}</h3>
          <div className="form-grid">
            <label>{t('res.locality')}
              <select value={site.localityId} onChange={e => updSite({ localityId: e.target.value })}>
                {LOCALITIES.map(l => <option key={l.id} value={l.id}>{l.name} ({l.county}) — zona {['I', 'II', 'III', 'IV', 'V'][l.zone - 1]}, θe {l.thetaE} °C</option>)}
              </select>
            </label>
            <label>{t('proj.thetaE')}<NumberField value={site.thetaEOverride ?? loc?.thetaE ?? -15} digits={1}
              onCommit={v => updSite({ thetaEOverride: v === loc?.thetaE ? null : v })} /></label>
            <label>{t('proj.infiltration')}<NumberField value={site.infiltrationACH} digits={2} onCommit={v => v >= 0 && updSite({ infiltrationACH: v })} /></label>
            <label>ΔU_TB (W/m²K)<NumberField value={site.thermalBridge} digits={3} onCommit={v => v >= 0 && updSite({ thermalBridge: v })} /></label>
            <label>{t('proj.energyPrice')}<NumberField value={site.energyPrice} digits={3} onCommit={v => v >= 0 && updSite({ energyPrice: v })} /></label>
            <label>{t('proj.elecPrice')}<NumberField value={site.electricityPrice} digits={3} onCommit={v => v >= 0 && updSite({ electricityPrice: v })} /></label>
            <label>{t('proj.heatEff')}<NumberField value={site.heatingEfficiency} digits={2} onCommit={v => v > 0 && v <= 1.5 && updSite({ heatingEfficiency: v })} /></label>
            <label>{t('proj.fanHours')}<NumberField value={site.fanHours} digits={0} onCommit={v => v >= 0 && v <= 8760 && updSite({ fanHours: v })} /></label>
            <label>{t('proj.ductBelow')}<NumberField value={p.settings.ductBelowCeiling} digits={2}
              onCommit={v => v >= 0 && store.update(t('proj.ductBelow'), x => ({ ...x, settings: { ...x.settings, ductBelowCeiling: v } }))} /></label>
          </div>
          {loc && !loc.verified && <p className="warn-box small">{t('proj.climateUnverified')}</p>}

          <h3>{t('props.norm')}</h3>
          <div className="form-grid">
            <label>{t('props.norm')}
              <select value={p.settings.ventilationNorm} onChange={e => store.update(t('props.norm'), x => ({ ...x, settings: { ...x.settings, ventilationNorm: e.target.value as any } }))}>
                {p.norms.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </label>
            <label>{t('proj.method')}
              <select value={norm.method} onChange={e => updNorm(n => ({ ...n, method: e.target.value as NormProfile['method'] }))}>
                <option value="din1946">{t('proj.methodDin')}</option><option value="perRoom">{t('proj.methodRoom')}</option>
              </select>
            </label>
            {norm.method === 'din1946' && <label>f_Lst<NumberField value={norm.levelFactor} digits={2} onCommit={v => v > 0 && updNorm(n => ({ ...n, levelFactor: v }))} /></label>}
          </div>
          <p className="muted small">{norm.source}</p>
          <div className="lib-scroll">
            <table className="lib-table">
              <thead><tr>
                <th>{t('res.type')}</th>
                {norm.method === 'din1946' ? <th>f_R,zu</th> : <><th>{t('proj.supFixed')}</th><th>{t('proj.supM2')}</th><th>{t('proj.supPers')}</th></>}
                <th>{t('proj.extract')}</th><th>θi °C</th><th>{t('res.limit')} dB(A)</th><th>{t('lib.verified')}</th>
              </tr></thead>
              <tbody>{ROOM_TYPES.map(rt => {
                const r = norm.rooms[rt]
                return (
                  <tr key={rt} className={r.verified ? '' : 'unverified'}>
                    <td>{t(`room.${rt}` as any)}</td>
                    {norm.method === 'din1946'
                      ? <td className="num">{opt(r.supplyFactor, v => updRule(rt, { supplyFactor: v }))}</td>
                      : <>
                        <td className="num">{opt(r.supplyFixed, v => updRule(rt, { supplyFixed: v }))}</td>
                        <td className="num">{opt(r.supplyPerM2, v => updRule(rt, { supplyPerM2: v }))}</td>
                        <td className="num">{opt(r.supplyPerPerson, v => updRule(rt, { supplyPerPerson: v }))}</td>
                      </>}
                    <td className="num">{opt(r.extract, v => updRule(rt, { extract: v }))}</td>
                    <td className="num"><NumberField value={r.tempInt} digits={1} onCommit={v => updRule(rt, { tempInt: v })} /></td>
                    <td className="num">{opt(r.noiseLimit, v => updRule(rt, { noiseLimit: v }))}</td>
                    <td className="c"><input type="checkbox" checked={r.verified} onChange={e => updRule(rt, { verified: e.target.checked })} /></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
