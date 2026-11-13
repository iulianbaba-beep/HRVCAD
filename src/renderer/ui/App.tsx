import { useEffect, useRef } from 'react'
import { Ribbon } from './Ribbon'
import { ProjectPanel, PropertiesPanel } from './Panels'
import { CommandLine, focusCommandLine } from './CommandLine'
import { StatusBar } from './StatusBar'
import { LibraryDialog } from './LibraryDialog'
import { ResultsDialog } from './ResultsDialog'
import { ProjectDialog } from './ProjectDialog'
import { Viewport } from '../viewport/engine'
import { store, useStore } from '../core/store'
import { lastCommand, runCommand } from '../core/commands'
import { tools } from '../tools/tool'
import { t, APP_VERSION } from '../i18n'
import { isMac } from '../core/platform'

const SHORTCUTS: Record<string, string> = {
  'mod+n': 'file.new', 'mod+o': 'file.open', 'mod+s': 'file.save', 'mod+shift+s': 'file.saveAs',
  'mod+z': 'edit.undo', 'mod+y': 'edit.redo', 'mod+shift+z': 'edit.redo',
  'mod+a': 'select.all', f3: 'view.snap', f7: 'view.grid', f8: 'view.ortho', delete: 'edit.delete'
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
      const mod = isMac ? e.metaKey : e.ctrlKey
      const combo = [mod ? 'mod' : '', e.shiftKey ? 'shift' : '', e.key.toLowerCase()].filter(Boolean).join('+')
      const id = SHORTCUTS[combo]
      if (id && (!inField || mod || e.key.startsWith('F'))) {
        if (id === 'edit.delete' && inField) return
        e.preventDefault()
        runCommand(id)
        return
      }
      if (inField) return
      if (e.key === 'Escape') { tools.cancel(); store.setUI({ fileMenuOpen: false }); return }
      // AutoCAD habit: start typing anywhere and it goes to the command line.
      if (!mod && !e.altKey && e.key.length === 1 && e.key !== ' ') { e.preventDefault(); focusCommandLine.fn(e.key) }
      // Enter in the drawing ends the active command (AutoCAD); when idle it repeats the last one.
      if (e.key === 'Enter') {
        e.preventDefault()
        if (tools.active) { tools.cancel(false); tools.finish() }
        else { const last = lastCommand(); if (last) runCommand(last) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function ViewportView() {
  const host = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const v = new Viewport(host.current!, svg.current!)
    ;(window as any).__viewport = v
    return () => v.dispose()
  }, [])
  const tool = useStore(s => s.ui.activeTool)
  return (
    <div className={`viewport${tool ? ' tool-active' : ''}`} ref={host}>
      <svg className="overlay" ref={svg} />
    </div>
  )
}

export function App() {
  useShortcuts()
  const showLeft = useStore(s => s.ui.showProjectPanel)
  const showRight = useStore(s => s.ui.showPropertiesPanel)
  const libraryOpen = useStore(s => s.ui.libraryOpen)
  const resultsOpen = useStore(s => s.ui.resultsOpen)
  const projectDialog = useStore(s => s.ui.projectDialog)
  useStore(s => s.ui.language)
  useEffect(() => { store.log(t('welcome', { v: APP_VERSION })) }, [])
  return (
    <div className="app">
      <Ribbon />
      <main className="workspace">
        {showLeft && <ProjectPanel />}
        <ViewportView />
        {showRight && <PropertiesPanel />}
      </main>
      <CommandLine />
      <StatusBar />
      {libraryOpen && <LibraryDialog />}
      {resultsOpen && <ResultsDialog />}
      {projectDialog && <ProjectDialog />}
    </div>
  )
}
