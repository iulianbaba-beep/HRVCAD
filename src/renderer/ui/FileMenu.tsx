import { useEffect } from 'react'
import { TbX } from 'react-icons/tb'
import { commandLabel, commandDesc, getCommand, runCommand } from '../core/commands'
import { store, useStore } from '../core/store'
import { useT, APP_VERSION } from '../i18n'
import { TextField } from './fields'

const ITEMS = ['file.new', 'file.open', 'file.save', 'file.saveAs']

export function FileMenu() {
  const t = useT()
  const lang = useStore(s => s.ui.language)
  const name = useStore(s => s.project.name)
  const close = () => store.setUI({ fileMenuOpen: false })
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <div className="filemenu-backdrop" onClick={close}>
      <div className="filemenu" onClick={e => e.stopPropagation()} role="menu">
        <div className="filemenu-left">
          {ITEMS.map(id => {
            const c = getCommand(id)!
            const Icon = c.icon
            return (
              <button key={id} className="fm-item" role="menuitem" onClick={() => runCommand(id)}>
                <Icon className="fm-icon" aria-hidden />
                <span className="fm-text"><b>{commandLabel(id)}</b><small>{commandDesc(id)}</small></span>
                <kbd>{c.shortcut}</kbd>
              </button>
            )
          })}
        </div>
        <div className="filemenu-right">
          <h3>{t('filemenu.recent')}</h3>
          <label className="fm-field">
            <span>{t('props.name')}</span>
            <TextField value={name} onCommit={v => store.update(t('props.name'), p => ({ ...p, name: v || p.name }))} />
          </label>
          <h3>{t('filemenu.language')}</h3>
          <div className="seg">
            <button className={lang === 'ro' ? 'on' : ''} onClick={() => store.setUI({ language: 'ro' })}>Română</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => store.setUI({ language: 'en' })}>English</button>
          </div>
          <h3>{t('filemenu.about')}</h3>
          <p className="muted">{t('filemenu.aboutText', { v: APP_VERSION })}</p>
        </div>
        <button className="fm-close" onClick={close} aria-label={t('filemenu.close')}><TbX /></button>
      </div>
    </div>
  )
}
