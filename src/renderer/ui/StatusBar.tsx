import { activeLevel, store, useStore } from '../core/store'
import { runCommand } from '../core/commands'
import { useT } from '../i18n'

export function StatusBar() {
  const t = useT()
  const cursor = useStore(s => s.ui.cursor)
  const snap = useStore(s => s.ui.snap)
  const ortho = useStore(s => s.ui.ortho)
  const grid = useStore(s => s.ui.grid)
  const mode = useStore(s => s.project.settings.checkMode)
  const unit = useStore(s => s.project.settings.displayUnit)
  const viewMode = useStore(s => s.ui.viewMode)
  useStore(s => s.ui.activeLevelId + s.project.levels.length)
  const lvl = activeLevel()
  const k = unit === 'mm' ? 1000 : unit === 'cm' ? 100 : 1
  const d = unit === 'm' ? 3 : unit === 'cm' ? 1 : 0
  return (
    <footer className="statusbar">
      <span className="coords">{cursor ? `X ${(cursor.x * k).toFixed(d)}   Y ${(cursor.y * k).toFixed(d)}  ${unit}` : t('status.ready')}</span>
      <span className="sb-sep" />
      <button className={`sb-toggle${snap ? ' on' : ''}`} onClick={() => runCommand('view.snap')} title="F3">{t('status.snap')}</button>
      <button className={`sb-toggle${ortho ? ' on' : ''}`} onClick={() => runCommand('view.ortho')} title="F8">{t('status.ortho')}</button>
      <button className={`sb-toggle${grid ? ' on' : ''}`} onClick={() => runCommand('view.grid')} title="F7">{t('status.grid')}</button>
      <span className="sb-sep" />
      <span>{t('status.level')}: <b>{lvl.name}</b> ({lvl.elevation >= 0 ? '+' : ''}{lvl.elevation.toFixed(2)} m)</span>
      <span className="grow" />
      <button className="sb-toggle on" onClick={() => runCommand(viewMode === '2d' ? 'view.3d' : 'view.2d')}>{viewMode.toUpperCase()}</button>
      <button className={`sb-mode ${mode}`} onClick={() => runCommand('settings.mode')}>{t(mode === 'strict' ? 'mode.strict' : 'mode.advisory')}</button>
      <select className="sb-unit" value={unit}
        onChange={e => store.update(t('props.displayUnit'), p => ({ ...p, settings: { ...p.settings, displayUnit: e.target.value as any } }))}>
        <option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option>
      </select>
    </footer>
  )
}
