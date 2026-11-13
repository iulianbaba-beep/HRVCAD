// Bill of materials (Excel .xlsx) generated with JSZip — minimal SpreadsheetML.
import JSZip from 'jszip'
import { store } from '../core/store'
import { saveFile } from '../core/platform'
import { t } from '../i18n'
import type { Project } from '../core/types'
import { analyse } from '../calc'

export interface BomRow { group: string; code: string; name: string; unit: string; qty: number; price: number }

const WASTE = 1.05 // 5 % allowance on duct lengths

export function buildBom(p: Project): BomRow[] {
  const rows: BomRow[] = []
  const h = p.hvac, lib = p.library.hvac
  const add = (r: BomRow) => {
    const e = rows.find(x => x.code === r.code && x.name === r.name)
    if (e) e.qty += r.qty; else rows.push(r)
  }
  for (const u of h.units) { const tp = lib.units.find(x => x.id === u.typeId); if (tp) add({ group: t('bom.equipment'), code: tp.code, name: tp.name, unit: 'buc', qty: 1, price: tp.price }) }
  for (const pl of h.plenums) { const tp = lib.plenums.find(x => x.id === pl.typeId); if (tp) add({ group: t('bom.equipment'), code: tp.code, name: tp.name, unit: 'buc', qty: 1, price: tp.price }) }
  for (const tr of h.terminals) { const tp = lib.terminals.find(x => x.id === tr.typeId); if (tp) add({ group: t('bom.terminals'), code: tp.code, name: tp.name, unit: 'buc', qty: 1, price: tp.price }) }
  let bends = 0
  for (const d of h.ducts) {
    const m = lib.ductMaterials.find(x => x.id === d.materialId)
    const s = m?.sizes.find(x => x.id === d.sizeId)
    if (!m || !s) continue
    let L = 0
    for (let i = 1; i < d.pts.length; i++) L += Math.hypot(d.pts[i].x - d.pts[i - 1].x, d.pts[i].y - d.pts[i - 1].y, d.pts[i].z - d.pts[i - 1].z)
    add({ group: t('bom.ducts'), code: s.code, name: `${m.name} ${s.label}`, unit: 'm', qty: L * WASTE, price: s.price })
    bends += Math.max(0, d.pts.length - 2)
    if (m.kind === 'rigid' || m.kind === 'epp') add({ group: t('bom.fittings'), code: `${s.code}-BEND`, name: `${t('bom.bend')} ${m.name} ${s.label}`, unit: 'buc', qty: Math.max(0, d.pts.length - 2), price: Math.round(s.price * 1.5) })
  }
  // Tees: junctions where a duct ends on another duct's vertex
  const a = analyse(p)
  const tees = new Map<string, number>()
  for (const d of h.ducts) for (const end of [d.pts[0], d.pts[d.pts.length - 1]]) {
    const host = h.ducts.find(o => o.id !== d.id && o.system === d.system && o.pts.slice(1, -1).some(q => Math.hypot(q.x - end.x, q.y - end.y) < 0.06))
    if (host) { const m = lib.ductMaterials.find(x => x.id === host.materialId); const s = m?.sizes.find(x => x.id === host.sizeId); if (s) tees.set(`${m!.name} ${s.label}|${s.code}|${s.price}`, (tees.get(`${m!.name} ${s.label}|${s.code}|${s.price}`) ?? 0) + 1) }
  }
  for (const [k, n] of tees) { const [name, code, price] = k.split('|'); add({ group: t('bom.fittings'), code: `${code}-TEE`, name: `${t('bom.tee')} ${name}`, unit: 'buc', qty: n, price: Math.round(+price * 2) }) }
  void bends; void a
  return rows.filter(r => r.qty > 0)
}

const xml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const col = (i: number) => String.fromCharCode(65 + i)

export async function bomXlsx(p: Project): Promise<Uint8Array> {
  const rows = buildBom(p)
  const header = [t('bom.group'), t('bom.code'), t('bom.name'), t('bom.unit'), t('bom.qty'), t('bom.price'), t('bom.value')]
  const sheetRows: string[] = []
  const cellStr = (r: number, c: number, v: string, s = 0) => `<c r="${col(c)}${r}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t>${xml(v)}</t></is></c>`
  const cellNum = (r: number, c: number, v: number, s = 0) => `<c r="${col(c)}${r}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`
  sheetRows.push(`<row r="1">${cellStr(1, 0, `${p.name} — ${t('cmd.report.bom')}`, 1)}</row>`)
  sheetRows.push(`<row r="3">${header.map((h, i) => cellStr(3, i, h, 1)).join('')}</row>`)
  rows.forEach((r, i) => {
    const n = i + 4
    sheetRows.push(`<row r="${n}">${cellStr(n, 0, r.group)}${cellStr(n, 1, r.code)}${cellStr(n, 2, r.name)}${cellStr(n, 3, r.unit)}${cellNum(n, 4, +r.qty.toFixed(2), 2)}${cellNum(n, 5, r.price, 2)}<c r="G${n}" s="2"><f>E${n}*F${n}</f><v>${+(r.qty * r.price).toFixed(2)}</v></c></row>`)
  })
  const last = rows.length + 3, tot = last + 2
  sheetRows.push(`<row r="${tot}">${cellStr(tot, 5, t('bom.total'), 1)}<c r="G${tot}" s="3"><f>SUM(G4:G${last})</f><v>${rows.reduce((s, r) => s + r.qty * r.price, 0).toFixed(2)}</v></c></row>`)
  sheetRows.push(`<row r="${tot + 2}">${cellStr(tot + 2, 0, t('bom.note'))}</row>`)
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="46" customWidth="1"/><col min="4" max="4" width="7" customWidth="1"/><col min="5" max="7" width="13" customWidth="1"/></cols><sheetData>${sheetRows.join('')}</sheetData></worksheet>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>`
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(t('cmd.report.bom')).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', sheet)
  zip.file('xl/styles.xml', styles)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export async function exportBom() {
  const p = store.get().project
  const data = await bomXlsx(p)
  const r = await saveFile(`${p.name} - lista materiale.xlsx`, [{ name: 'Excel', extensions: ['xlsx'] }], data)
  if (r) store.log(t('rep.saved', { name: r.name }))
}
