import { useEffect, useRef, useState } from 'react'
import { TbTerminal2 } from 'react-icons/tb'
import { commandLabel, lastCommand, resolveCommand, runCommand, suggestCommands } from '../core/commands'
import { store, useStore } from '../core/store'
import { tools } from '../tools/tool'
import { useT } from '../i18n'

export const focusCommandLine = { fn: (_ch?: string) => {} }

export function CommandLine() {
  const t = useT()
  const log = useStore(s => s.ui.log)
  const promptText = useStore(s => s.ui.prompt)
  const awaiting = useStore(s => s.ui.awaitingInput)
  const [value, setValue] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const histRef = useRef<HTMLDivElement>(null)
  const suggestions = !promptText ? suggestCommands(value) : []

  useEffect(() => { histRef.current?.scrollTo(0, histRef.current.scrollHeight) }, [log])
  useEffect(() => { if (awaiting) inputRef.current?.focus() }, [awaiting, promptText])
  useEffect(() => {
    focusCommandLine.fn = (ch?: string) => {
      inputRef.current?.focus()
      if (ch) setValue(v => v + ch)
    }
  }, [])

  const submit = (text: string) => {
    const v = text.trim()
    setValue('')
    setSel(0)
    if (tools.active) {
      if (!v) { tools.cancel(false); tools.finish(); return } // Enter on empty ends the command
      store.log(`> ${v}`, 'cmd')
      if (!tools.input(v)) store.log(t('cmdline.unknown', { c: v }), 'warn')
      return
    }
    if (!v) { const last = lastCommand(); if (last) runCommand(last); return }
    const c = resolveCommand(v)
    if (c) runCommand(c.id)
    else store.log(t('cmdline.unknown', { c: v }), 'warn')
  }

  return (
    <div className="cmdline">
      <div className="cmd-history" ref={histRef}>
        {log.slice(-60).map((l, i) => <div key={i} className={`cmd-log ${l.kind}`}>{l.text}</div>)}
      </div>
      {suggestions.length > 0 && (
        <ul className="cmd-suggest" role="listbox">
          {suggestions.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''}
              onMouseDown={e => { e.preventDefault(); setValue(''); runCommand(c.id) }}>
              <c.icon aria-hidden /> <b>{c.aliases?.[0] ?? c.id}</b> <span>{commandLabel(c.id)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={`cmd-input-row${awaiting ? ' awaiting' : ''}`}>
        <TbTerminal2 className="cmd-icon" aria-hidden />
        {promptText && <span className="cmd-prompt">{promptText}</span>}
        <input
          ref={inputRef}
          className="cmd-input"
          value={value}
          spellCheck={false}
          placeholder={promptText ? '' : t('cmdline.placeholder')}
          onChange={e => { setValue(e.target.value); setSel(0) }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(suggestions.length && value.trim() && !resolveCommand(value) ? suggestions[sel].aliases?.[0] ?? suggestions[sel].id : value) }
            else if (e.key === 'Escape') { setValue(''); if (tools.active) tools.cancel(); (e.target as HTMLInputElement).blur() }
            else if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setSel(s => (s + 1) % suggestions.length) }
            else if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setSel(s => (s - 1 + suggestions.length) % suggestions.length) }
            else if (e.key === ' ' && !promptText && value.trim()) { e.preventDefault(); submit(value) } // Space = Enter, like AutoCAD
          }}
        />
      </div>
    </div>
  )
}
