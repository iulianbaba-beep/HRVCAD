import { TbX, TbAlertTriangle, TbCircleCheck } from 'react-icons/tb'
import { store, useStore } from '../core/store'
import { analyse } from '../calc'
import { useT } from '../i18n'
import { runCommand } from '../core/commands'

const f0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('ro-RO') : '—')
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—')
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—')

export function ResultsDialog() {
  const t = useT()
  const tab = useStore(s => s.ui.resultsOpen) ?? 'air'
  const p = useStore(s => s.project)
  const a = analyse(p)
  const close = () => store.setUI({ resultsOpen: null })
  const tabs: [string, string][] = [['air', t('res.tab.air')], ['heat', t('res.tab.heat')], ['net', t('res.tab.net')], ['energy', t('res.tab.energy')], ['issues', t('res.tab.issues', { n: a.net.issues.length })]]
  const roomName = (id: string | null) => p.levels.flatMap(l => l.rooms).find(r => r.id === id)?.name ?? '—'
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={t('res.title')}>
        <header className="modal-head">
          <h2>{t('res.title')}</h2>
          <div className="seg">
            {tabs.map(([id, label]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => store.setUI({ resultsOpen: id })}>{label}</button>)}
          </div>
          <button className="icon-btn big" onClick={close} aria-label="close"><TbX /></button>
        </header>
        <div className="res-body">
          {tab === 'air' && <>
            <div className="kpis">
              <Kpi label={t('res.norm')} value={a.air.profile.name} small />
              <Kpi label={t('res.area')} value={`${f1(a.air.area)} m²`} />
              {a.air.qNominal != null && <Kpi label={t('res.qNominal')} value={`${f0(a.air.qNominal)} m³/h`} />}
              <Kpi label={t('res.qSupply')} value={`${f0(a.air.supplyTotal)} m³/h`} />
              <Kpi label={t('res.qExtract')} value={`${f0(a.air.extractTotal)} m³/h`} />
            </div>
            <table className="res-table">
              <thead><tr><th>{t('res.room')}</th><th>{t('res.type')}</th><th className="num">A m²</th><th className="num">{t('res.supply')} m³/h</th><th className="num">{t('res.extract')} m³/h</th><th>{t('res.rule')}</th></tr></thead>
              <tbody>{a.air.rooms.map(r => (
                <tr key={r.roomId}>
                  <td>{r.name}</td><td>{t(`room.${r.type}` as any)}</td><td className="num">{f2(r.area)}</td>
                  <td className="num">{r.supply ? f0(r.supply) : ''}</td><td className="num">{r.extract ? f0(r.extract) : ''}</td>
                  <td>{r.overridden ? t('res.manual') : r.rule.verified ? <span className="pill ok">{t('res.verified')}</span> : <span className="pill warn">{t('props.unverified')}</span>}</td>
                </tr>))}
              </tbody>
            </table>
            <p className="muted small">{a.air.profile.source}</p>
            {a.air.notes.includes('imbalance') && <p className="warn-box"><TbAlertTriangle /> {t('res.imbalance')}</p>}
          </>}
          {tab === 'heat' && <>
            <div className="kpis">
              <Kpi label={t('res.locality')} value={`${a.heat.locality.name} (${['I', 'II', 'III', 'IV', 'V'][a.heat.locality.zone - 1]})`} small />
              <Kpi label="θe" value={`${a.heat.thetaE} °C`} />
              <Kpi label={t('res.heatTotal')} value={`${f0(a.heat.total)} W`} />
              <Kpi label={t('res.heatNoHRV')} value={`${f0(a.heat.totalNoHRV)} W`} />
              <Kpi label="η" value={`${Math.round(a.heat.efficiency * 100)} %`} />
            </div>
            <table className="res-table">
              <thead><tr><th>{t('res.room')}</th><th className="num">θi °C</th><th className="num">A m²</th><th className="num">Φ_T W</th><th className="num">Φ_V W</th><th className="num">Φ_inf W</th><th className="num">Φ W</th><th className="num">W/m²</th></tr></thead>
              <tbody>{a.heat.rooms.map(r => (
                <tr key={r.roomId}><td>{r.name}</td><td className="num">{r.tempInt}</td><td className="num">{f2(r.area)}</td><td className="num">{f0(r.phiT)}</td>
                  <td className="num">{f0(r.phiV)}</td><td className="num">{f0(r.phiInf)}</td><td className="num"><b>{f0(r.phi)}</b></td><td className="num">{f0(r.phi / Math.max(r.area, 0.1))}</td></tr>))}
              </tbody>
            </table>
            <p className="muted small">{t('res.heatNote')}</p>
          </>}
          {tab === 'net' && <>
            <div className="kpis">
              <Kpi label={t('res.unit')} value={a.net.unitType?.name ?? '—'} small />
              <Kpi label={t('res.supplySide')} value={`${f0(a.net.requiredSupplySide)} / ${a.net.availableSupplySide == null ? '—' : f0(a.net.availableSupplySide)} Pa`} bad={a.net.availableSupplySide != null && a.net.availableSupplySide < a.net.requiredSupplySide} />
              <Kpi label={t('res.extractSide')} value={`${f0(a.net.requiredExtractSide)} / ${a.net.availableExtractSide == null ? '—' : f0(a.net.availableExtractSide)} Pa`} bad={a.net.availableExtractSide != null && a.net.availableExtractSide < a.net.requiredExtractSide} />
              <Kpi label={t('res.status')} value={a.net.ok ? t('res.ok') : t('res.notOk')} bad={!a.net.ok} />
            </div>
            <p className="muted small">{t('res.pressureNote')}</p>
            <table className="res-table">
              <thead><tr><th>{t('res.system')}</th><th>{t('res.size')}</th><th className="num">L m</th><th className="num">q m³/h</th><th className="num">v m/s</th><th className="num">R Pa/m</th><th className="num">Δp fr. Pa</th><th className="num">Δp loc. Pa</th></tr></thead>
              <tbody>{a.net.segments.map((sg, i) => (
                <tr key={i} className={sg.overVelocity ? 'bad' : ''}><td>{t(`system.${sg.system}` as any)}</td><td>{sg.sizeLabel}</td><td className="num">{f2(sg.length)}</td><td className="num">{f0(sg.q)}</td>
                  <td className="num">{f2(sg.v)}{sg.overVelocity ? ` > ${sg.vMax}` : ''}</td><td className="num">{f2(sg.R)}</td><td className="num">{f1(sg.dpFriction)}</td><td className="num">{f1(sg.dpLocal)}</td></tr>))}
              </tbody>
            </table>
            <h3>{t('res.terminals')}</h3>
            <table className="res-table">
              <thead><tr><th>{t('res.system')}</th><th>{t('res.room')}</th><th className="num">q m³/h</th><th className="num">Δp gură Pa</th><th className="num">Δp traseu Pa</th><th className="num">{t('res.throttle')} Pa</th></tr></thead>
              <tbody>{a.net.terminals.map(tr => (
                <tr key={tr.terminalId} className={!tr.connected || tr.overFlow ? 'bad' : ''}><td>{t(`system.${tr.system}` as any)}</td><td>{roomName(tr.roomId)}</td><td className="num">{f0(tr.q)}</td>
                  <td className="num">{f1(tr.dpTerminal)}</td><td className="num">{tr.connected ? f1(tr.pathDp) : t('res.notConnected')}</td><td className="num">{tr.connected ? f1(tr.throttle) : ''}</td></tr>))}
              </tbody>
            </table>
            <div className="pad"><button className="btn" onClick={() => runCommand('calc.autosize')}>{t('cmd.calc.autosize')}</button></div>
          </>}
          {tab === 'energy' && <>
            <div className="kpis">
              <Kpi label={t('res.supplyTemp')} value={`${f1(a.energy.supplyTemp)} °C`} />
              <Kpi label={t('res.exhaustTemp')} value={`${f1(a.energy.exhaustTemp)} °C`} bad={a.energy.frostRisk} />
              <Kpi label={t('res.recovered')} value={`${f0(a.energy.recovered)} kWh/an`} />
              <Kpi label={t('res.savings')} value={`${f0(a.energy.savings)} lei/an`} />
              <Kpi label={t('res.fan')} value={`${f0(a.energy.fanPowerW)} W · ${f0(a.energy.fanKWh)} kWh/an`} />
            </div>
            {a.energy.frostRisk && <p className="warn-box"><TbAlertTriangle /> {t('res.frost')}</p>}
            <table className="res-table">
              <thead><tr><th /><th className="num">{t('res.noHRV')}</th><th className="num">{t('res.withHRV')}</th></tr></thead>
              <tbody>
                <tr><td>{t('res.ventHeat')}</td><td className="num">{f0(a.energy.qWithout)} kWh</td><td className="num">{f0(a.energy.qWith)} kWh</td></tr>
                <tr><td>{t('res.cost')}</td><td className="num">{f0(a.energy.costWithout)} lei</td><td className="num">{f0(a.energy.costWith)} lei</td></tr>
              </tbody>
            </table>
            <h3>{t('res.insulation')}</h3>
            <ul className="small">
              <li>{t('res.ins.cold')}</li>
              <li>{t('res.ins.warm')}</li>
              <li>{t('res.ins.condensate')}</li>
            </ul>
            <h3>{t('res.noise')}</h3>
            <table className="res-table">
              <thead><tr><th>{t('res.room')}</th><th className="num">Lp dB(A)</th><th className="num">{t('res.limit')}</th><th /></tr></thead>
              <tbody>{a.noise.map(n => (
                <tr key={n.roomId} className={n.ok ? '' : 'bad'}><td>{n.name}</td><td className="num">{f1(n.lp)}</td><td className="num">{n.limit ?? '—'}</td><td>{n.ok ? <TbCircleCheck className="ok-ic" /> : <TbAlertTriangle className="warn-ic" />}</td></tr>))}
              </tbody>
            </table>
            <p className="muted small">{t('res.energyNote')}</p>
          </>}
          {tab === 'issues' && <>
            {a.net.issues.length === 0 ? <p className="ok-box"><TbCircleCheck /> {t('res.noIssues')}</p> :
              <ul className="issues">{a.net.issues.map((i, k) => <li key={k}><TbAlertTriangle className="warn-ic" /> {t(`issue.${i.kind}` as any, { d: i.detail ? t(`system.${i.detail}` as any) : '' })}</li>)}</ul>}
          </>}
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, bad, small }: { label: string; value: string; bad?: boolean; small?: boolean }) {
  return <div className={`kpi${bad ? ' bad' : ''}`}><span>{label}</span><b className={small ? 'small' : ''}>{value}</b></div>
}
