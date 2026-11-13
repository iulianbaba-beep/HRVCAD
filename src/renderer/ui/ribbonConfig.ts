// Ribbon layout (Office / AutoCAD style): tabs → panels → buttons referencing command ids.
import type { I18nKey } from '../i18n'

export type ButtonSize = 'large' | 'small'
export interface RibbonButton { cmd: string; size?: ButtonSize }
export interface RibbonPanel { title: I18nKey; buttons: RibbonButton[] }
export interface RibbonTab { id: string; title: I18nKey; panels: RibbonPanel[] }

const L = (cmd: string): RibbonButton => ({ cmd, size: 'large' })
const S = (cmd: string): RibbonButton => ({ cmd, size: 'small' })

export const ribbon: RibbonTab[] = [
  {
    id: 'plan', title: 'tab.plan',
    panels: [
      { title: 'panel.import', buttons: [L('import.cad'), L('import.image'), L('import.pdf')] },
      { title: 'panel.underlay', buttons: [L('underlay.calibrate'), S('underlay.move'), S('underlay.rotate'), S('underlay.lock'), S('underlay.delete')] },
      { title: 'panel.measure', buttons: [L('tool.measure')] },
      { title: 'panel.drafting', buttons: [S('view.snap'), S('view.ortho'), S('view.grid')] }
    ]
  },
  {
    id: 'building', title: 'tab.building',
    panels: [
      { title: 'panel.levels', buttons: [L('level.add')] },
      { title: 'panel.elements', buttons: [L('build.wall'), L('build.door'), L('build.window'), L('build.roof')] },
      { title: 'panel.modify', buttons: [L('modify.trim'), L('modify.extend'), S('modify.split'), S('modify.offset'), S('modify.mirror'), S('modify.move'), S('modify.copy'), S('modify.rotate'), S('edit.delete')] },
      { title: 'panel.spaces', buttons: [L('build.roomDetect'), L('build.room'), S('build.slab'), S('build.roofAuto')] },
      { title: 'panel.library', buttons: [L('library.open')] }
    ]
  },
  {
    id: 'hvac', title: 'tab.hvac',
    panels: [
      { title: 'panel.equipment', buttons: [L('hvac.unit'), L('hvac.plenum')] },
      { title: 'panel.distribution', buttons: [L('hvac.terminal'), L('hvac.duct'), L('calc.autosize'), S('hvac.fix'), S('tool.measure')] },
      { title: 'panel.catalog', buttons: [L('catalog.editor')] }
    ]
  },
  {
    id: 'calc', title: 'tab.calc',
    panels: [
      { title: 'panel.project', buttons: [L('settings.project')] },
      { title: 'panel.loads', buttons: [L('calc.airflow'), L('calc.heatload')] },
      { title: 'panel.network', buttons: [L('calc.network'), L('calc.issues')] },
      { title: 'panel.comfort', buttons: [L('calc.acoustic'), L('calc.savings')] },
      { title: 'panel.assist', buttons: [L('ai.assist')] },
      { title: 'panel.settings', buttons: [L('settings.mode')] }
    ]
  },
  {
    id: 'reports', title: 'tab.reports',
    panels: [{ title: 'panel.documents', buttons: [L('report.memo'), L('report.drawings'), L('report.bom'), L('report.dxf')] }]
  },
  {
    id: 'view', title: 'tab.view',
    panels: [
      { title: 'panel.views', buttons: [L('view.2d'), L('view.3d')] },
      { title: 'panel.navigate', buttons: [L('view.zoomExtents')] },
      { title: 'panel.drafting', buttons: [S('view.grid'), S('view.snap'), S('view.ortho')] },
      { title: 'panel.window', buttons: [S('view.projectPanel'), S('view.propertiesPanel'), S('settings.language')] }
    ]
  }
]

/** Contextual tab shown while walls are selected (Revit "Modify | Walls"). */
export const wallContextTab: RibbonTab = {
  id: 'ctx-walls', title: 'tab.modifyWalls',
  panels: [
    { title: 'panel.transform', buttons: [L('modify.move'), L('modify.copy'), L('modify.rotate'), L('modify.mirror')] },
    { title: 'panel.geometry', buttons: [L('modify.trim'), L('modify.extend'), S('modify.split'), S('modify.offset'), S('modify.flip')] },
    { title: 'panel.openings', buttons: [L('build.door'), L('build.window')] },
    { title: 'panel.selection', buttons: [S('select.all'), S('edit.delete')] }
  ]
}

/** Quick Access Toolbar (above the ribbon). */
export const quickAccess = ['file.new', 'file.open', 'file.save', 'edit.undo', 'edit.redo']
