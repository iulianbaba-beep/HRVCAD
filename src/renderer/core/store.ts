// Minimal app store: project model with undo/redo + transient UI state.
import { useSyncExternalStore } from 'react'
import type { Language, Level, Project, Underlay, Vec2, Wall } from './types'
import { createProject } from './types'
import { DEFAULT_LIBRARY } from '../library/defaults'

export type ViewMode = '2d' | '3d'
export interface LogLine { text: string; kind: 'info' | 'cmd' | 'warn' | 'error' }

export interface UIState {
  language: Language
  viewMode: ViewMode
  activeLevelId: string
  selectedUnderlayId: string | null
  selectedWallIds: string[]
  selectedOpeningId: string | null
  /** Defaults for the door/window tools. */
  doorDefaults: { width: number; height: number; U: number }
  windowDefaults: { width: number; height: number; sill: number; U: number }
  /** Wall tool defaults. */
  wallTypeId: string
  wallJustification: 'center' | 'left' | 'right'
  libraryOpen: boolean
  activeTool: string | null
  prompt: string | null
  /** When set, the command line input is collecting a value for the active tool. */
  awaitingInput: boolean
  snap: boolean
  ortho: boolean
  grid: boolean
  cursor: Vec2 | null
  log: LogLine[]
  showProjectPanel: boolean
  showPropertiesPanel: boolean
  fileMenuOpen: boolean
  filePath: string | null
  dirty: boolean
  busy: string | null
}

export interface AppState { project: Project; ui: UIState }

function loadLanguage(): Language {
  try { return localStorage.getItem('hrvcad.lang') === 'en' ? 'en' : 'ro' } catch { return 'ro' }
}

const initialProject = createProject('Proiect nou', DEFAULT_LIBRARY)
let state: AppState = {
  project: initialProject,
  ui: {
    language: loadLanguage(),
    viewMode: '2d',
    activeLevelId: initialProject.levels[0].id,
    selectedUnderlayId: null,
    selectedWallIds: [],
    selectedOpeningId: null,
    doorDefaults: { width: 0.9, height: 2.1, U: 1.5 },
    windowDefaults: { width: 1.2, height: 1.4, sill: 0.9, U: 1.1 },
    wallTypeId: DEFAULT_LIBRARY.wallTypes[0].id,
    wallJustification: 'left',
    libraryOpen: false,
    activeTool: null,
    prompt: null,
    awaitingInput: false,
    snap: true,
    ortho: false,
    grid: true,
    cursor: null,
    log: [],
    showProjectPanel: true,
    showPropertiesPanel: true,
    fileMenuOpen: false,
    filePath: null,
    dirty: false,
    busy: null
  }
}

const listeners = new Set<() => void>()
const undoStack: { project: Project; label: string }[] = []
const redoStack: { project: Project; label: string }[] = []
const MAX_UNDO = 100

function emit() { for (const l of listeners) l() }

export const store = {
  get: () => state,
  subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l) },

  setUI(patch: Partial<UIState>) {
    state = { ...state, ui: { ...state.ui, ...patch } }
    if (patch.language) { try { localStorage.setItem('hrvcad.lang', patch.language) } catch { /* ignore */ } }
    emit()
  },

  /** Apply an undoable change to the project. `fn` must return a new object (no mutation). */
  update(label: string, fn: (p: Project) => Project) {
    const next = fn(state.project)
    if (next === state.project) return
    undoStack.push({ project: state.project, label })
    if (undoStack.length > MAX_UNDO) undoStack.shift()
    redoStack.length = 0
    state = { ...state, project: next, ui: { ...state.ui, dirty: true } }
    emit()
  },

  /** Replace the whole project (new/open). Clears history. */
  replaceProject(p: Project, filePath: string | null) {
    undoStack.length = 0
    redoStack.length = 0
    state = {
      project: p,
      ui: { ...state.ui, activeLevelId: p.levels[0]?.id, selectedUnderlayId: null, selectedWallIds: [], selectedOpeningId: null, activeTool: null, prompt: null, awaitingInput: false, filePath, dirty: false }
    }
    emit()
  },

  undo(): string | null {
    const e = undoStack.pop()
    if (!e) return null
    redoStack.push({ project: state.project, label: e.label })
    state = { ...state, project: e.project, ui: { ...state.ui, dirty: true } }
    emit()
    return e.label
  },

  redo(): string | null {
    const e = redoStack.pop()
    if (!e) return null
    undoStack.push({ project: state.project, label: e.label })
    state = { ...state, project: e.project, ui: { ...state.ui, dirty: true } }
    emit()
    return e.label
  },

  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,

  log(text: string, kind: LogLine['kind'] = 'info') {
    const log = [...state.ui.log, { text, kind }].slice(-200)
    store.setUI({ log })
  }
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state), () => selector(state))
}

// ---- Model helpers -------------------------------------------------------

export function activeLevel(s: AppState = state): Level {
  return s.project.levels.find(l => l.id === s.ui.activeLevelId) ?? s.project.levels[0]
}

export function findUnderlay(id: string | null, s: AppState = state): { level: Level; underlay: Underlay } | null {
  if (!id) return null
  for (const level of s.project.levels) {
    const underlay = level.underlays.find(u => u.id === id)
    if (underlay) return { level, underlay }
  }
  return null
}

export function updateUnderlay(label: string, id: string, fn: (u: Underlay) => Underlay) {
  store.update(label, p => ({
    ...p,
    levels: p.levels.map(l => l.underlays.some(u => u.id === id)
      ? { ...l, underlays: l.underlays.map(u => (u.id === id ? fn(u) : u)) }
      : l)
  }))
}

export function updateLevel(label: string, levelId: string, fn: (l: Level) => Level) {
  store.update(label, p => ({ ...p, levels: p.levels.map(l => (l.id === levelId ? fn(l) : l)) }))
}

/** Clear every selection (walls, openings, underlays). */
export const NO_SELECTION = { selectedWallIds: [] as string[], selectedOpeningId: null, selectedUnderlayId: null }

export function selectedWalls(s: AppState = state): { level: Level; wall: Wall }[] {
  const out: { level: Level; wall: Wall }[] = []
  for (const id of s.ui.selectedWallIds) { const f = findWall(id, s); if (f) out.push(f) }
  return out
}

export function findOpening(id: string | null, s: AppState = state) {
  if (!id) return null
  for (const level of s.project.levels) for (const wall of level.walls) {
    const opening = wall.openings?.find(o => o.id === id)
    if (opening) return { level, wall, opening }
  }
  return null
}

export function findWall(id: string | null, s: AppState = state) {
  if (!id) return null
  for (const level of s.project.levels) {
    const wall = level.walls.find(w => w.id === id)
    if (wall) return { level, wall }
  }
  return null
}

// ---- Simple event bus for viewport actions --------------------------------
export const bus = new EventTarget()
export function emitBus(type: string, detail?: unknown) { bus.dispatchEvent(new CustomEvent(type, { detail })) }
