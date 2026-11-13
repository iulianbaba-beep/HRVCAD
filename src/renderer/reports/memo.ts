// Calculation report (memoriu de calcul) and drawing sheets as printable HTML → PDF.
import { store } from '../core/store'
import { analyse } from '../calc'
import { planSvg } from './planSvg'
import { checkText } from '../ui/ResultsDialog'
import { printHtmlToPdf } from '../core/platform'
import { t, APP_VERSION } from '../i18n'
import type { Project } from '../core/types'

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const n0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('ro-RO') : '—')
const n1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—')
const n2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—')

const CSS = `
  @page { size: A4; margin: 16mm 14mm; }
  body { font: 10pt/1.4 "RNS Sanz", "Segoe UI", Arial, sans-serif; color: #111; }
  h1 { font-size: 18pt; color: #0e2841; margin: 0 0 2mm; }
  h2 { font-size: 12.5pt; color: #0e2841; border-bottom: 1.5pt solid #209ed9; padding-bottom: 1mm; margin: 7mm 0 3mm; }
  h3 { font-size: 10.5pt; margin: 4mm 0 2mm; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0; font-size: 8.8pt; page-break-inside: auto; }
  th { background: #0e2841; color: #fff; text-align: left; padding: 1.2mm 1.5mm; font-weight: 600; }
  td { border-bottom: 0.5pt solid #d6dde4; padding: 1mm 1.5mm; }
  td.n, th.n { text-align: right; }
  tr.bad td { color: #b91c1c; }
  .kv { display: grid; grid-template-columns: 55mm 1fr; gap: 1mm 4mm; }
  .kv b { color: #0e2841; }
  .note { font-size: 8pt; color: #555; }
  .warn { background: #fdf3e2; border-left: 3pt solid #b7791f; padding: 2mm 3mm; font-size: 8.5pt; }
  .ok { background: #e6f4ec; border-left: 3pt solid #2f855a; padding: 2mm 3mm; font-size: 8.5pt; }
  .sheet { page-break-before: always; }
  .brand { color: #209ed9; font-weight: 900; }
  .footer { margin-top: 8mm; font-size: 7.5pt; color: #777; }
`

function unverifiedList(p: Project): string[] {
  const out: string[] = []
  const mats = new Set(p.library.wallTypes.flatMap(w => w.layers.map(l => l.materialId)).concat(p.library.slabTypes.flatMap(s => s.layers.map(l => l.materialId))))
  for (const m of p.library.materials) if (mats.has(m.id) && !m.verified) out.push(`${t('lib.material')}: ${m.name} (λ ${m.lambda})`)
  const a = analyse(p)
  const used = new Set(a.air.rooms.map(r => r.type))
  for (const rt of used) if (!a.air.profile.rooms[rt].verified) out.push(`${t('props.norm')}: ${t(`room.${rt}` as any)}`)
  const u = a.net.unitType
  if (u && !u.verified) out.push(`${t('res.unit')}: ${u.name}`)
  for (const d of p.hvac.ducts) {
    const m = p.library.hvac.ductMaterials.find(x => x.id === d.materialId)
    if (m && !m.verified && !out.includes(`${t('lib.ducts')}: ${m.name}`)) out.push(`${t('lib.ducts')}: ${m.name}`)
  }
  return out
}

export function memoHtml(p: Project): string {
  const a = analyse(p)
  const roomName = (id: string | null) => p.levels.flatMap(l => l.rooms).find(r => r.id === id)?.name ?? '—'
  const date = new Date().toLocaleDateString('ro-RO')
  const levelsSvg = p.levels.map(l => `<div class="sheet"><h2>${esc(t('rep.plan'))}: ${esc(l.name)}</h2>${planSvg(p, l, { width: 680, height: 880, title: `${p.name} — ${l.name}` })}</div>`).join('')
  const issues = a.net.issues
  const unv = unverifiedList(p)
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${esc(p.name)} — ${esc(t('rep.memo'))}</title><style>${CSS}</style></head><body>
  <div class="brand">ACADEMIA ROMSTAL · HRVCAD ${APP_VERSION}</div>
  <h1>${esc(t('rep.memo'))}</h1>
  <div class="kv">
    <span>${esc(t('props.project'))}</span><b>${esc(p.name)}</b>
    <span>${esc(t('rep.date'))}</span><b>${date}</b>
    <span>${esc(t('res.locality'))}</span><b>${esc(a.heat.locality.name)} — zona ${['I', 'II', 'III', 'IV', 'V'][a.heat.locality.zone - 1]}, θe = ${a.heat.thetaE} °C</b>
    <span>${esc(t('props.norm'))}</span><b>${esc(a.air.profile.name)}</b>
    <span>${esc(t('res.unit'))}</span><b>${esc(a.net.unitType?.name ?? '—')}${a.net.unitType ? ` (η = ${Math.round(a.net.unitType.efficiency * 100)} %)` : ''}</b>
  </div>

  <h2>1. ${esc(t('res.tab.air'))}</h2>
  <p>${esc(t('res.area'))}: <b>${n1(a.air.area)} m²</b>${a.air.qNominal != null ? ` · ${esc(t('res.qNominal'))}: <b>${n0(a.air.qNominal)} m³/h</b>` : ''} · ${esc(t('res.qSupply'))}: <b>${n0(a.air.supplyTotal)} m³/h</b> · ${esc(t('res.qExtract'))}: <b>${n0(a.air.extractTotal)} m³/h</b></p>
  <table><tr><th>${esc(t('res.room'))}</th><th>${esc(t('res.type'))}</th><th class="n">A m²</th><th class="n">${esc(t('res.supply'))} m³/h</th><th class="n">${esc(t('res.extract'))} m³/h</th></tr>
  ${a.air.rooms.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(t(`room.${r.type}` as any))}</td><td class="n">${n2(r.area)}</td><td class="n">${r.supply ? n0(r.supply) : ''}</td><td class="n">${r.extract ? n0(r.extract) : ''}</td></tr>`).join('')}
  </table>
  <p class="note">${esc(a.air.profile.source)}</p>

  <h2>2. ${esc(t('res.tab.heat'))}</h2>
  <table><tr><th>${esc(t('res.room'))}</th><th class="n">θi °C</th><th class="n">A m²</th><th class="n">Φ_T W</th><th class="n">Φ_V W</th><th class="n">Φ_inf W</th><th class="n">Φ W</th></tr>
  ${a.heat.rooms.map(r => `<tr><td>${esc(r.name)}</td><td class="n">${r.tempInt}</td><td class="n">${n2(r.area)}</td><td class="n">${n0(r.phiT)}</td><td class="n">${n0(r.phiV)}</td><td class="n">${n0(r.phiInf)}</td><td class="n"><b>${n0(r.phi)}</b></td></tr>`).join('')}
  <tr><td><b>Total</b></td><td/><td/><td/><td/><td/><td class="n"><b>${n0(a.heat.total)} W</b></td></tr></table>
  <p class="note">${esc(t('res.heatNote'))} ${esc(t('rep.heatNoHRV', { v: n0(a.heat.totalNoHRV) }))}</p>

  <h2>3. ${esc(t('res.tab.net'))}</h2>
  <div class="kv">
    <span>${esc(t('res.supplySide'))}</span><b>${n0(a.net.requiredSupplySide)} Pa ${esc(t('rep.required'))} / ${a.net.availableSupplySide == null ? '—' : n0(a.net.availableSupplySide)} Pa ${esc(t('rep.available'))} @ ${n0(a.net.qSupply)} m³/h</b>
    <span>${esc(t('res.extractSide'))}</span><b>${n0(a.net.requiredExtractSide)} Pa ${esc(t('rep.required'))} / ${a.net.availableExtractSide == null ? '—' : n0(a.net.availableExtractSide)} Pa ${esc(t('rep.available'))} @ ${n0(a.net.qExtract)} m³/h</b>
  </div>
  <div class="${a.net.ok ? 'ok' : 'warn'}">${esc(a.net.ok ? t('rep.netOk') : t('rep.netNotOk'))}</div>
  <table><tr><th>${esc(t('res.system'))}</th><th>${esc(t('res.size'))}</th><th class="n">L m</th><th class="n">q m³/h</th><th class="n">v m/s</th><th class="n">R Pa/m</th><th class="n">Δp Pa</th></tr>
  ${a.net.segments.map(s => `<tr class="${s.overVelocity ? 'bad' : ''}"><td>${esc(t(`system.${s.system}` as any))}</td><td>${esc(s.sizeLabel)}</td><td class="n">${n2(s.length)}</td><td class="n">${n0(s.q)}</td><td class="n">${n2(s.v)}</td><td class="n">${n2(s.R)}</td><td class="n">${n1(s.dpFriction + s.dpLocal)}</td></tr>`).join('')}
  </table>
  <h3>${esc(t('res.terminals'))}</h3>
  <table><tr><th>${esc(t('res.system'))}</th><th>${esc(t('res.room'))}</th><th class="n">q m³/h</th><th class="n">Δp traseu Pa</th><th class="n">${esc(t('res.throttle'))} Pa</th></tr>
  ${a.net.terminals.map(r => `<tr class="${r.connected ? '' : 'bad'}"><td>${esc(t(`system.${r.system}` as any))}</td><td>${esc(roomName(r.roomId))}</td><td class="n">${n0(r.q)}</td><td class="n">${r.connected ? n1(r.pathDp) : '—'}</td><td class="n">${r.connected ? n1(r.throttle) : ''}</td></tr>`).join('')}
  </table>

  <h2>4. ${esc(t('res.tab.energy'))}</h2>
  <div class="kv">
    <span>${esc(t('res.supplyTemp'))}</span><b>${n1(a.energy.supplyTemp)} °C</b>
    <span>${esc(t('res.exhaustTemp'))}</span><b>${n1(a.energy.exhaustTemp)} °C${a.energy.frostRisk ? ' — ' + esc(t('res.frost')) : ''}</b>
    <span>${esc(t('res.ventHeat'))}</span><b>${n0(a.energy.qWithout)} → ${n0(a.energy.qWith)} kWh/an</b>
    <span>${esc(t('res.fan'))}</span><b>${n0(a.energy.fanPowerW)} W · ${n0(a.energy.fanKWh)} kWh/an</b>
    <span>${esc(t('res.savings'))}</span><b>${n0(a.energy.savings)} lei/an</b>
  </div>
  <h3>${esc(t('res.insulation'))}</h3>
  <ul><li>${esc(t('res.ins.cold'))}</li><li>${esc(t('res.ins.warm'))}</li><li>${esc(t('res.ins.condensate'))}</li></ul>
  <h3>${esc(t('res.noise'))}</h3>
  <table><tr><th>${esc(t('res.room'))}</th><th class="n">Lp dB(A)</th><th class="n">${esc(t('res.limit'))}</th></tr>
  ${a.noise.map(r => `<tr class="${r.ok ? '' : 'bad'}"><td>${esc(r.name)}</td><td class="n">${n1(r.lp)}</td><td class="n">${r.limit ?? '—'}</td></tr>`).join('')}</table>
  <p class="note">${esc(t('res.energyNote'))}</p>

  <h2>5. ${esc(t('rep.checks'))}</h2>
  ${issues.length + a.checks.length ? `<ul>${a.checks.map(c => `<li>${esc(checkText(c))}</li>`).join('')}${issues.map(i => `<li>${esc(t(`issue.${i.kind}` as any, { d: i.detail ? t(`system.${i.detail}` as any) : '' }))}</li>`).join('')}</ul>` : `<div class="ok">${esc(t('res.noIssues'))}</div>`}
  ${unv.length ? `<h3>${esc(t('rep.unverified'))}</h3><div class="warn"><ul>${unv.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  <p class="footer">${esc(t('rep.disclaimer'))}</p>
  ${levelsSvg}
  </body></html>`
}

export async function exportMemo() {
  const p = store.get().project
  const r = await printHtmlToPdf(memoHtml(p), `${p.name} - memoriu.pdf`)
  if (r) store.log(t('rep.saved', { name: r.name }))
}

export async function exportDrawingsPdf() {
  const p = store.get().project
  const sheets = p.levels.map((l, i) => `<div class="${i ? 'sheet' : ''}">${planSvg(p, l, { width: 1050, height: 700, title: `${p.name} — ${l.name}` })}</div>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.name)}</title><style>@page{size:A4 landscape;margin:10mm}body{margin:0}.sheet{page-break-before:always}</style></head><body>${sheets}</body></html>`
  const r = await printHtmlToPdf(html, `${p.name} - planse.pdf`, true)
  if (r) store.log(t('rep.saved', { name: r.name }))
}
