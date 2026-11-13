import { useState } from 'react'
import { TbChevronDown, TbTerminal2 } from 'react-icons/tb'
import { ribbon, quickAccess, type RibbonButton } from './ribbonConfig'
import { commandDesc, commandLabel, getCommand, runCommand } from '../core/commands'
import { store, useStore } from '../core/store'
import { useT, APP_VERSION } from '../i18n'
import { FileMenu } from './FileMenu'

function Tooltip({ cmd }: { cmd: string }) {
  const t = useT()
  const c = getCommand(cmd)!
  return (
    <div className="tip" role="tooltip">
      <div className="tip-title">{commandLabel(cmd)}{c.shortcut && <span className="tip-key">{c.shortcut}</span>}</div>
      <div className="tip-desc">{commandDesc(cmd)}</div>
      {c.aliases?.length ? <div className="tip-alias"><TbTerminal2 aria-hidden /> {c.aliases.join(', ')}</div> : null}
      {c.stage ? <div className="tip-stage">{t('stage.soon', { n: c.stage })}</div> : null}
    </div>
  )
}

export function RibbonBtn({ b }: { b: RibbonButton }) {
  useT()
  // Re-render toggles when relevant state changes.
  useStore(s => [s.ui.snap, s.ui.ortho, s.ui.grid, s.ui.viewMode, s.ui.showProjectPanel, s.ui.showPropertiesPanel,
    s.ui.selectedUnderlayId, s.project, s.ui.activeTool].join('|'))
  const c = getCommand(b.cmd)
  if (!c) return null
  const Icon = c.icon
  const checked = c.checked?.() ?? false
  const active = store.get().ui.activeTool === c.id
  const cls = ['rb', b.size === 'small' ? 'rb-small' : 'rb-large', c.stage ? 'rb-soon' : '', checked || active ? 'rb-on' : ''].join(' ')
  return (
    <div className="rb-wrap">
      <button className={cls} onClick={() => runCommand(c.id)} aria-pressed={c.checked ? checked : undefined} data-cmd={c.id}>
        <Icon className="rb-icon" aria-hidden />
        <span className="rb-label">{commandLabel(c.id)}</span>
        {c.stage ? <span className="rb-badge">E{c.stage}</span> : null}
      </button>
      <Tooltip cmd={c.id} />
    </div>
  )
}

export function Ribbon() {
  const t = useT()
  const [tab, setTab] = useState('plan')
  const [collapsed, setCollapsed] = useState(false)
  const fileMenuOpen = useStore(s => s.ui.fileMenuOpen)
  const projectName = useStore(s => s.project.name)
  const dirty = useStore(s => s.ui.dirty)
  const busy = useStore(s => s.ui.busy)
  useStore(s => s.project) // undo/redo enabled state
  const current = ribbon.find(r => r.id === tab)!

  return (
    <header className="ribbon-host">
      <div className="titlebar">
        <div className="brand"><span className="brand-mark">HRV</span><span className="brand-cad">CAD</span></div>
        <div className="qat">
          {quickAccess.map(id => {
            const c = getCommand(id)!
            const Icon = c.icon
            const disabled = (id === 'edit.undo' && !store.canUndo()) || (id === 'edit.redo' && !store.canRedo())
            return (
              <button key={id} className="qat-btn" disabled={disabled} title={`${commandLabel(id)}${c.shortcut ? ` (${c.shortcut})` : ''}`}
                onClick={() => runCommand(id)} data-cmd={id}>
                <Icon aria-hidden />
              </button>
            )
          })}
        </div>
        <div className="doc-title">{projectName}{dirty ? ' •' : ''} — HRVCAD {APP_VERSION}</div>
        <div className="titlebar-right">{busy && <span className="busy">{busy}</span>}</div>
      </div>
      <nav className="tabs" role="tablist">
        <button className={`tab tab-file${fileMenuOpen ? ' on' : ''}`} onClick={() => store.setUI({ fileMenuOpen: !fileMenuOpen })}>
          {t('tab.file')}
        </button>
        {ribbon.map(r => (
          <button key={r.id} role="tab" aria-selected={tab === r.id} className={`tab${tab === r.id ? ' on' : ''}`}
            onClick={() => { setTab(r.id); setCollapsed(false) }} onDoubleClick={() => setCollapsed(c => !c)}>
            {t(r.title)}
          </button>
        ))}
        <button className="tab-collapse" title="Ribbon" onClick={() => setCollapsed(c => !c)}>
          <TbChevronDown style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)' }} />
        </button>
      </nav>
      {!collapsed && (
        <div className="panels" role="tabpanel">
          {current.panels.map((p, i) => (
            <section key={i} className="rpanel">
              <div className="rpanel-body">
                {groupButtons(p.buttons).map((g, j) =>
                  g.size === 'large'
                    ? <RibbonBtn key={j} b={g.items[0]} />
                    : <div key={j} className="rb-col">{g.items.map(b => <RibbonBtn key={b.cmd} b={b} />)}</div>
                )}
              </div>
              <div className="rpanel-title">{t(p.title)}</div>
            </section>
          ))}
        </div>
      )}
      {fileMenuOpen && <FileMenu />}
    </header>
  )
}

/** Small buttons stack in columns of three, like Office. */
function groupButtons(buttons: RibbonButton[]) {
  const out: { size: 'large' | 'small'; items: RibbonButton[] }[] = []
  for (const b of buttons) {
    if (b.size !== 'small') { out.push({ size: 'large', items: [b] }); continue }
    const last = out[out.length - 1]
    if (last && last.size === 'small' && last.items.length < 3) last.items.push(b)
    else out.push({ size: 'small', items: [b] })
  }
  return out
}
