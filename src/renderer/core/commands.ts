// Command registry: every ribbon button, shortcut and command-line alias resolves to one of these.
import type { IconType } from 'react-icons'
import {
  TbFilePlus, TbFolderOpen, TbDeviceFloppy, TbFileDownload, TbArrowBackUp, TbArrowForwardUp,
  TbFileImport, TbPhoto, TbFileTypePdf, TbRulerMeasure, TbScale, TbArrowsMove, TbRotate, TbLock, TbTrash,
  TbStack2, TbWall, TbLayoutBoard, TbBuildingCottage, TbDoor, TbWindow, TbBorderOuter, TbAirConditioning,
  TbCircleDot, TbRouteSquare, TbArrowsJoin, TbBook, TbFlame, TbWind, TbTopologyStar, TbVolume, TbCoin,
  TbSparkles, TbFileText, TbVector, TbFileSpreadsheet, TbSquare, TbCube, TbZoomScan, TbLayoutGrid, TbMagnet,
  TbAngle, TbBooks, TbHomeEco, TbScan, TbAlertTriangle, TbMapPin, TbFileExport, TbCopy, TbFlipVertical, TbLayersLinked, TbCut, TbArrowBarToRight, TbSwitchHorizontal, TbSelectAll, TbSeparatorVertical, TbLayoutSidebar, TbLayoutSidebarRight, TbLanguage, TbShieldCheck
} from 'react-icons/tb'
import type { I18nKey } from '../i18n'
import { t, APP_VERSION } from '../i18n'
import { activeLevel, emitBus, findOpening, findUnderlay, store, updateLevel } from './store'
import { createProject, newLevel, type Level, type Underlay } from './types'
import { DEFAULT_LIBRARY, PROJECT_DEFAULTS } from '../library/defaults'
import { openFile, saveFile } from './platform'
import { deserializeProject, serializeProject } from './projectFile'
import { formatLength } from './geom'
import { tools } from '../tools/tool'
import { calibrateTool, measureTool, moveTool, rotateTool } from '../tools/underlayTools'
import { wallTool } from '../tools/wallTool'
import { autoRoof, autoSlab, detectRooms, roofTool, roomTool } from '../tools/buildTools'
import { applyAutoSize, deleteHvac, ductTool, plenumTool, terminalTool, unitTool } from '../tools/hvacTools'
import {
  extendTool, flipSelected, mirrorWallsTool, moveWallsTool, offsetTool, openingTool, rotateWallsTool, selectAllWalls, splitTool, trimTool
} from '../tools/modifyTools'

export interface Command {
  id: string
  icon: IconType
  /** Command-line aliases (case-insensitive), AutoCAD-style. */
  aliases?: string[]
  shortcut?: string
  /** Roadmap stage in which this command becomes available; undefined = available now. */
  stage?: number
  run?: () => void | Promise<void>
  /** For toggle buttons: current state. */
  checked?: () => boolean
}

const label = (id: string) => t(`cmd.${id}` as I18nKey)

const PROJECT_FILTER = () => [{ name: t('file.filterProject'), extensions: ['hrv'] }]

function confirmDiscard(): boolean {
  return !store.get().ui.dirty || window.confirm(t('file.confirmDiscard'))
}

async function saveProject(forceDialog: boolean) {
  const s = store.get()
  const data = await serializeProject(s.project)
  const res = await saveFile(`${s.project.name}.hrv`, PROJECT_FILTER(), data, forceDialog ? undefined : s.ui.filePath ?? undefined)
  if (!res) return
  store.setUI({ filePath: res.path ?? null, dirty: false })
  store.log(t('file.saved', { name: res.name }))
}

function addUnderlay(u: Underlay) {
  const levelId = activeLevel().id
  store.update(t('panel.import'), p => ({
    ...p,
    levels: p.levels.map(l => (l.id === levelId ? { ...l, underlays: [...l.underlays, u] } : l))
  }))
  store.setUI({ selectedUnderlayId: u.id, selectedWallIds: [], selectedOpeningId: null })
  emitBus('zoomExtents')
}

async function withBusy<T>(msg: string, fn: () => Promise<T>): Promise<T | undefined> {
  store.setUI({ busy: msg })
  store.log(msg)
  try {
    return await fn()
  } catch (e: any) {
    const key = e?.message as I18nKey | undefined
    const msgText = key && key.includes('.') && t(key) !== key ? t(key) : String(e?.message ?? e)
    store.log(t('import.failed', { msg: msgText }), 'error')
    return undefined
  } finally {
    store.setUI({ busy: null })
  }
}

function startCalibration() {
  store.log(t('import.autoCalibrate'))
  const tool = calibrateTool()
  if (tool) tools.start(tool)
}

const commands: Command[] = [
  // File & edit
  { id: 'file.new', icon: TbFilePlus, aliases: ['NEW', 'NOU'], shortcut: 'Ctrl+N',
    run: () => { if (confirmDiscard()) { store.replaceProject(createProject(t('app.untitled'), PROJECT_DEFAULTS), null); emitBus('zoomExtents') } } },
  { id: 'file.open', icon: TbFolderOpen, aliases: ['OPEN', 'DESCHIDE'], shortcut: 'Ctrl+O',
    run: async () => {
      if (!confirmDiscard()) return
      const f = await openFile(PROJECT_FILTER())
      if (!f) return
      try {
        const p = await deserializeProject(f.data)
        store.replaceProject(p, f.path ?? null)
        store.log(t('file.opened', { name: f.name }))
        emitBus('zoomExtents')
      } catch (e: any) {
        store.log(t('file.openFailed', { msg: e?.message ?? String(e) }), 'error')
      }
    } },
  { id: 'file.save', icon: TbDeviceFloppy, aliases: ['SAVE', 'SALVEAZA', 'QSAVE'], shortcut: 'Ctrl+S', run: () => saveProject(false) },
  { id: 'file.saveAs', icon: TbFileDownload, aliases: ['SAVEAS'], shortcut: 'Ctrl+Shift+S', run: () => saveProject(true) },
  { id: 'edit.undo', icon: TbArrowBackUp, aliases: ['U', 'UNDO'], shortcut: 'Ctrl+Z',
    run: () => { const l = store.undo(); store.log(l ? t('undo.done', { label: l }) : t('undo.empty')) } },
  { id: 'edit.redo', icon: TbArrowForwardUp, aliases: ['REDO'], shortcut: 'Ctrl+Y',
    run: () => { const l = store.redo(); store.log(l ? t('redo.done', { label: l }) : t('redo.empty')) } },

  // Plan: import & underlay
  { id: 'import.cad', icon: TbFileImport, aliases: ['IMPORT', 'IMP', 'DWG', 'DXF'],
    run: async () => {
      const f = await openFile([{ name: t('file.filterCad'), extensions: ['dwg', 'dxf'] }])
      if (!f) return
      const res = await withBusy(t('import.loading', { name: f.name }), async () => {
        const { importCad } = await import('../import/cad')
        return importCad(f.name, f.data)
      })
      if (!res) return
      const u = res.underlay
      store.log(t('import.cadDone', {
        name: f.name, n: res.entityCount, l: u.layers.length,
        w: res.rawExtent.width.toFixed(2), h: res.rawExtent.height.toFixed(2)
      }))
      const skipped = Object.entries(res.skipped).map(([k, v]) => `${k} ×${v}`).join(', ')
      if (skipped) store.log(t('import.cadSkipped', { list: skipped }), 'warn')
      addUnderlay(u)
      if (res.needsCalibration) { store.log(t('import.unitsSuspicious', { u: u.declaredUnits }), 'warn'); startCalibration() }
    } },
  { id: 'import.image', icon: TbPhoto, aliases: ['IMAGE', 'IMG', 'IMAGINE'],
    run: async () => {
      const f = await openFile([{ name: t('file.filterImage'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }])
      if (!f) return
      const u = await withBusy(t('import.loading', { name: f.name }), async () => (await import('../import/raster')).importImage(f.name, f.data))
      if (!u) return
      store.log(t('import.rasterDone', { name: f.name, w: u.pxWidth, h: u.pxHeight }))
      addUnderlay(u)
      startCalibration()
    } },
  { id: 'import.pdf', icon: TbFileTypePdf, aliases: ['PDF'],
    run: async () => {
      const f = await openFile([{ name: t('file.filterPdf'), extensions: ['pdf'] }])
      if (!f) return
      const u = await withBusy(t('import.loading', { name: f.name }), async () => {
        const r = await import('../import/raster')
        const n = await r.pdfPageCount(f.data)
        if (n > 1) store.log(t('import.pdfPages', { n }), 'warn')
        return r.importPdfPage(f.name, f.data, 1)
      })
      if (!u) return
      store.log(t('import.rasterDone', { name: u.name, w: u.pxWidth, h: u.pxHeight }))
      addUnderlay(u)
      startCalibration()
    } },
  { id: 'underlay.calibrate', icon: TbScale, aliases: ['CAL', 'CALIBRARE', 'SCALE', 'SCALA'],
    run: () => { const tl = calibrateTool(); if (tl) tools.start(tl) } },
  { id: 'underlay.move', icon: TbArrowsMove, aliases: ['MPLAN', 'MUTAPLAN'],
    run: () => { const tl = moveTool(); if (tl) tools.start(tl) } },
  { id: 'underlay.rotate', icon: TbRotate, aliases: ['ROPLAN'],
    run: () => { const tl = rotateTool(); if (tl) tools.start(tl) } },
  { id: 'underlay.lock', icon: TbLock, aliases: ['LOCK', 'BLOCHEAZA'],
    checked: () => !!findUnderlay(store.get().ui.selectedUnderlayId)?.underlay.locked,
    run: () => {
      const f = findUnderlay(store.get().ui.selectedUnderlayId)
      if (!f) { store.log(t('tool.needUnderlay'), 'warn'); return }
      const locked = !f.underlay.locked
      store.update(label('underlay.lock'), p => ({
        ...p, levels: p.levels.map(l => ({ ...l, underlays: l.underlays.map(u => (u.id === f.underlay.id ? { ...u, locked } : u)) }))
      }))
      store.log(t('underlay.lockToggled', { name: f.underlay.name, state: t(locked ? 'underlay.lockedState' : 'underlay.unlockedState') }))
    } },
  { id: 'edit.delete', icon: TbTrash, aliases: ['ERASE', 'E', 'STERGE', 'DEL'], shortcut: 'Delete',
    run: () => {
      const s = store.get()
      const op = findOpening(s.ui.selectedOpeningId)
      if (op) {
        updateLevel(label('edit.delete'), op.level.id, l => ({
          ...l, walls: l.walls.map(w => (w.id === op.wall.id ? { ...w, openings: (w.openings ?? []).filter(o => o.id !== op.opening.id) } : w))
        }))
        store.setUI({ selectedOpeningId: null })
        return
      }
      const ids = new Set(s.ui.selectedWallIds)
      if (ids.size) {
        store.update(label('edit.delete'), p => ({ ...p, levels: p.levels.map(l => ({ ...l, walls: l.walls.filter(w => !ids.has(w.id)) })) }))
        store.setUI({ selectedWallIds: [] })
        return
      }
      if (s.ui.selectedHvacId) { deleteHvac(s.ui.selectedHvacId); store.setUI({ selectedHvacId: null }); return }
      if (s.ui.selectedRoomId) {
        const rid = s.ui.selectedRoomId
        store.update(label('edit.delete'), p => ({ ...p, levels: p.levels.map(l => ({ ...l, rooms: l.rooms.filter(r => r.id !== rid) })) }))
        store.setUI({ selectedRoomId: null }); return
      }
      if (s.ui.selectedRoofId) {
        const rid = s.ui.selectedRoofId
        store.update(label('edit.delete'), p => ({ ...p, levels: p.levels.map(l => ({ ...l, roofs: l.roofs.filter(r => r.id !== rid) })) }))
        store.setUI({ selectedRoofId: null }); return
      }
      if (s.ui.selectedUnderlayId) return runCommand('underlay.delete')
    } },
  { id: 'select.all', icon: TbSelectAll, aliases: ['ALL', 'SELECTALL', 'TOT'], shortcut: 'Ctrl+A', run: selectAllWalls },
  { id: 'modify.move', icon: TbArrowsMove, aliases: ['M', 'MOVE', 'MUTA'],
    run: () => {
      if (store.get().ui.selectedWallIds.length) { const tl = moveWallsTool(false); if (tl) tools.start(tl) }
      else { const tl = moveTool(); if (tl) tools.start(tl) }
    } },
  { id: 'modify.copy', icon: TbCopy, aliases: ['CO', 'CP', 'COPY', 'COPIAZA'], run: () => { const tl = moveWallsTool(true); if (tl) tools.start(tl) } },
  { id: 'modify.rotate', icon: TbRotate, aliases: ['RO', 'ROTATE', 'ROTESTE'],
    run: () => {
      if (store.get().ui.selectedWallIds.length) { const tl = rotateWallsTool(); if (tl) tools.start(tl) }
      else { const tl = rotateTool(); if (tl) tools.start(tl) }
    } },
  { id: 'modify.mirror', icon: TbFlipVertical, aliases: ['MI', 'MIRROR', 'OGLINDESTE'], run: () => { const tl = mirrorWallsTool(); if (tl) tools.start(tl) } },
  { id: 'modify.offset', icon: TbLayersLinked, aliases: ['O', 'OFFSET', 'DECALAJ'], run: () => tools.start(offsetTool()) },
  { id: 'modify.split', icon: TbSeparatorVertical, aliases: ['BR', 'SPLIT', 'DIVIZEAZA'], run: () => tools.start(splitTool()) },
  { id: 'modify.trim', icon: TbCut, aliases: ['TR', 'TRIM', 'TAIE'], run: () => tools.start(trimTool()) },
  { id: 'modify.extend', icon: TbArrowBarToRight, aliases: ['EX', 'EXTEND', 'PRELUNGESTE'], run: () => tools.start(extendTool()) },
  { id: 'modify.flip', icon: TbSwitchHorizontal, aliases: ['FLIP', 'INVERSEAZA'], run: flipSelected },
  { id: 'underlay.delete', icon: TbTrash, aliases: ['DELPLAN'],
    run: () => {
      const f = findUnderlay(store.get().ui.selectedUnderlayId)
      if (!f) return
      store.update(label('underlay.delete'), p => ({
        ...p, levels: p.levels.map(l => ({ ...l, underlays: l.underlays.filter(u => u.id !== f.underlay.id) }))
      }))
      store.setUI({ selectedUnderlayId: null })
      store.log(t('underlay.deleted', { name: f.underlay.name }))
    } },
  { id: 'tool.measure', icon: TbRulerMeasure, aliases: ['DI', 'DIST', 'DISTANTA', 'MEASURE'], run: () => tools.start(measureTool()) },

  // Building
  { id: 'level.add', icon: TbStack2, aliases: ['LEVEL', 'NIVEL'],
    run: () => {
      const levels = store.get().project.levels
      const top = levels.reduce((a, b) => (b.elevation > a.elevation ? b : a))
      const lvl: Level = newLevel(t('level.defaultName', { n: levels.length }), +(top.elevation + top.height).toFixed(3), top.height)
      store.update(label('level.add'), p => ({ ...p, levels: [...p.levels.map(l => (l.id === top.id ? { ...l, ceilingTypeId: null } : l)), lvl] }))
      store.setUI({ activeLevelId: lvl.id, selectedUnderlayId: null })
      store.log(t('level.added', { name: lvl.name, e: formatLength(lvl.elevation, 'm') }))
    } },
  { id: 'build.wall', icon: TbWall, aliases: ['W', 'WALL', 'PERETE', 'PE'], run: () => tools.start(wallTool()) },
  { id: 'library.open', icon: TbBooks, aliases: ['LIB', 'BIBLIOTECA', 'MATERIALE', 'TIPURI'],
    run: () => store.setUI({ libraryOpen: true, libraryTab: 'walls' }) },
  { id: 'build.slab', icon: TbLayoutBoard, aliases: ['SLAB', 'PLANSEU'], run: autoSlab },
  { id: 'build.roof', icon: TbBuildingCottage, aliases: ['ROOF', 'ACOPERIS'], run: () => tools.start(roofTool()) },
  { id: 'build.roofAuto', icon: TbHomeEco, aliases: ['ROOFAUTO', 'ACOPERISAUTO'], run: () => autoRoof() },
  { id: 'build.door', icon: TbDoor, aliases: ['DOOR', 'USA', 'DR'], run: () => tools.start(openingTool('door')) },
  { id: 'build.window', icon: TbWindow, aliases: ['WINDOW', 'FEREASTRA', 'WIN'], run: () => tools.start(openingTool('window')) },
  { id: 'build.room', icon: TbBorderOuter, aliases: ['ROOM', 'CAMERA', 'RM'], run: () => tools.start(roomTool()) },
  { id: 'build.roomDetect', icon: TbScan, aliases: ['DETECT', 'DETECTEAZA', 'ROOMS'], run: detectRooms },

  // HVAC
  { id: 'hvac.unit', icon: TbAirConditioning, aliases: ['HRV', 'RECUPERATOR'], run: () => tools.start(unitTool()) },
  { id: 'hvac.plenum', icon: TbArrowsJoin, aliases: ['PLENUM', 'DISTRIBUITOR'], run: () => tools.start(plenumTool()) },
  { id: 'hvac.terminal', icon: TbCircleDot, aliases: ['VALVE', 'GURA'], run: () => tools.start(terminalTool()) },
  { id: 'hvac.duct', icon: TbRouteSquare, aliases: ['DUCT', 'TUB'], run: () => tools.start(ductTool()) },
  { id: 'hvac.fitting', icon: TbVector, aliases: ['FITTING', 'FITING'], stage: 6 },
  { id: 'catalog.editor', icon: TbBook, aliases: ['CATALOG'], run: () => store.setUI({ libraryOpen: true, libraryTab: 'hvac' }) },

  // Calculations
  { id: 'calc.heatload', icon: TbFlame, aliases: ['HEATLOAD', 'NECESAR'], run: () => store.setUI({ resultsOpen: 'heat' }) },
  { id: 'calc.airflow', icon: TbWind, aliases: ['AIRFLOW', 'DEBITE'], run: () => store.setUI({ resultsOpen: 'air' }) },
  { id: 'calc.network', icon: TbTopologyStar, aliases: ['NETWORK', 'RETEA'], run: () => store.setUI({ resultsOpen: 'net' }) },
  { id: 'calc.autosize', icon: TbRulerMeasure, aliases: ['AUTOSIZE', 'DIMENSIONARE'], run: () => applyAutoSize(true) },
  { id: 'calc.issues', icon: TbAlertTriangle, aliases: ['CHECK', 'VERIFICA'], run: () => store.setUI({ resultsOpen: 'issues' }) },
  { id: 'settings.project', icon: TbMapPin, aliases: ['PROJECT', 'DATE', 'SITE'], run: () => store.setUI({ projectDialog: true }) },
  { id: 'calc.acoustic', icon: TbVolume, aliases: ['ACOUSTIC', 'ZGOMOT'], run: () => store.setUI({ resultsOpen: 'energy' }) },
  { id: 'calc.savings', icon: TbCoin, aliases: ['SAVINGS', 'ECONOMII'], run: () => store.setUI({ resultsOpen: 'energy' }) },
  { id: 'ai.assist', icon: TbSparkles, aliases: ['AI'], stage: 9 },

  // Reports
  { id: 'report.memo', icon: TbFileText, aliases: ['MEMORIU', 'REPORT'], run: async () => (await import('../reports/memo')).exportMemo() },
  { id: 'report.drawings', icon: TbVector, aliases: ['PLANSE', 'PLOT'], run: async () => (await import('../reports/memo')).exportDrawingsPdf() },
  { id: 'report.dxf', icon: TbFileExport, aliases: ['DXFOUT', 'EXPORTDXF'], run: async () => (await import('../reports/dxf')).exportDxf() },
  { id: 'report.bom', icon: TbFileSpreadsheet, aliases: ['BOM', 'MATERIALE'], run: async () => (await import('../reports/bom')).exportBom() },

  // View
  { id: 'view.2d', icon: TbSquare, aliases: ['2D', 'PLAN'], checked: () => store.get().ui.viewMode === '2d',
    run: () => { store.setUI({ viewMode: '2d' }); emitBus('zoomExtents') } },
  { id: 'view.3d', icon: TbCube, aliases: ['3D', '3DORBIT'], checked: () => store.get().ui.viewMode === '3d',
    run: () => { store.setUI({ viewMode: '3d' }); emitBus('zoomExtents') } },
  { id: 'view.zoomExtents', icon: TbZoomScan, aliases: ['ZE', 'ZOOM', 'Z'], shortcut: 'Dbl-click ⊙',
    run: () => emitBus('zoomExtents') },
  { id: 'view.grid', icon: TbLayoutGrid, aliases: ['GRID', 'GRILA'], shortcut: 'F7',
    checked: () => store.get().ui.grid, run: () => store.setUI({ grid: !store.get().ui.grid }) },
  { id: 'view.snap', icon: TbMagnet, aliases: ['SNAP', 'OSNAP'], shortcut: 'F3',
    checked: () => store.get().ui.snap, run: () => store.setUI({ snap: !store.get().ui.snap }) },
  { id: 'view.ortho', icon: TbAngle, aliases: ['ORTHO', 'ORTO'], shortcut: 'F8',
    checked: () => store.get().ui.ortho, run: () => store.setUI({ ortho: !store.get().ui.ortho }) },
  { id: 'view.projectPanel', icon: TbLayoutSidebar, checked: () => store.get().ui.showProjectPanel,
    run: () => store.setUI({ showProjectPanel: !store.get().ui.showProjectPanel }) },
  { id: 'view.propertiesPanel', icon: TbLayoutSidebarRight, aliases: ['PROPERTIES', 'PR'], checked: () => store.get().ui.showPropertiesPanel,
    run: () => store.setUI({ showPropertiesPanel: !store.get().ui.showPropertiesPanel }) },
  { id: 'settings.language', icon: TbLanguage, aliases: ['LANG', 'LIMBA'],
    run: () => store.setUI({ language: store.get().ui.language === 'ro' ? 'en' : 'ro' }) },
  { id: 'settings.mode', icon: TbShieldCheck, aliases: ['MODE', 'MOD'],
    checked: () => store.get().project.settings.checkMode === 'strict',
    run: () => store.update(label('settings.mode'), p => ({
      ...p, settings: { ...p.settings, checkMode: p.settings.checkMode === 'strict' ? 'advisory' : 'strict' }
    })) }
]

const byId = new Map(commands.map(c => [c.id, c]))
const byAlias = new Map<string, Command>()
for (const c of commands) for (const a of c.aliases ?? []) byAlias.set(a.toUpperCase(), c)

export const getCommand = (id: string) => byId.get(id)
export const allCommands = () => commands
export const commandLabel = label
export const commandDesc = (id: string) => t(`cmd.${id}.desc` as I18nKey)

let lastCommandId: string | null = null
export const lastCommand = () => lastCommandId

export async function runCommand(id: string) {
  const c = byId.get(id)
  if (!c) return
  if (c.stage) {
    store.log(t('cmdline.notAvailable', { c: label(id), reason: t('stage.soon', { n: c.stage }) }), 'warn')
    return
  }
  store.setUI({ fileMenuOpen: false })
  // Starting a new command cancels the active tool (except pure view toggles).
  if (tools.active && !id.startsWith('view.') && id !== 'tool.measure') tools.cancel(false)
  if (!id.startsWith('view.') && !id.startsWith('settings.')) lastCommandId = id
  store.log(`${label(id)}`, 'cmd')
  await c.run?.()
}

/** Resolve a command-line token: alias, id, or localized label (case/diacritics-insensitive). */
export function resolveCommand(token: string): Command | null {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
  const k = norm(token)
  if (!k) return null
  return byAlias.get(k) ?? byId.get(token) ?? commands.find(c => norm(label(c.id)) === k) ?? null
}

export function suggestCommands(prefix: string, limit = 8): Command[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  const k = norm(prefix.trim())
  if (!k) return []
  return commands
    .filter(c => (c.aliases ?? []).some(a => a.startsWith(k)) || norm(label(c.id)).includes(k))
    .slice(0, limit)
}

export const APP_INFO = { version: APP_VERSION }
