// WALL tool: chained wall drawing over the plan, Revit/AutoCAD style.
import type { Vec2, Wall, WallJustification } from '../core/types'
import { newId } from '../core/types'
import { activeLevel, store, updateLevel } from '../core/store'
import { dist, formatLength, parseLength } from '../core/geom'
import { add, faceOffsets, leftNormal, mulv, norm, sub } from '../core/walls'
import { wallTypeThickness } from '../core/thermal'
import { t } from '../i18n'
import { prompt, tools, type OverlayShape, type Tool } from './tool'

const JUST_KEYS: Record<string, WallJustification> = { S: 'left', L: 'left', A: 'center', C: 'center', D: 'right', R: 'right' }

export function wallTool(): Tool {
  let first: Vec2 | null = null, prev: Vec2 | null = null, cur: Vec2 | null = null
  let count = 0
  const ui = () => store.get().ui
  const lib = () => store.get().project.library
  const type = () => lib().wallTypes.find(w => w.id === ui().wallTypeId) ?? lib().wallTypes[0]
  const unit = () => store.get().project.settings.displayUnit

  const describe = () => {
    const ty = type()
    return t('tool.wall.opts', { type: ty?.name ?? '?', j: t(`wall.just.${ui().wallJustification}` as any) })
  }
  const refresh = () => prompt(prev ? `${t('tool.wall.next')} ${describe()}` : `${t('tool.wall.first')} ${describe()}`)

  const addWall = (a: Vec2, b: Vec2) => {
    if (dist(a, b) < 0.01) return
    const ty = type()
    if (!ty) return
    const wall: Wall = { id: newId('wall'), typeId: ty.id, a, b, justification: ui().wallJustification, height: null }
    updateLevel(t('cmd.build.wall'), activeLevel().id, l => ({ ...l, walls: [...l.walls, wall] }))
    count++
  }

  return {
    id: 'build.wall',
    basePoint: () => prev,
    start: refresh,
    pick(p) {
      if (!prev) { first = p; prev = p; refresh(); return }
      addWall(prev, p)
      prev = p
      refresh()
    },
    move(p) { cur = p },
    input(text) {
      const k = text.trim().toUpperCase()
      if (JUST_KEYS[k]) { store.setUI({ wallJustification: JUST_KEYS[k] }); refresh(); return true }
      if ((k === 'I' || k === 'CLOSE' || k === 'INCHIDE') && prev && first && count >= 2) {
        addWall(prev, first)
        store.log(t('tool.wall.done', { n: count }))
        tools.finish()
        return true
      }
      if (prev && cur) {
        const L = parseLength(text, unit())
        if (L != null) {
          const d = norm(sub(cur, prev))
          tools.pick(add(prev, mulv(d, L))) // goes through ortho constraint like a click
          return true
        }
      }
      return false
    },
    cancel() { if (count) store.log(t('tool.wall.done', { n: count })) },
    overlay(): OverlayShape[] {
      if (!prev || !cur || dist(prev, cur) < 1e-6) return prev ? [{ kind: 'point', p: prev }] : []
      const ty = type()
      const th = ty ? wallTypeThickness(ty) : 0.25
      const d = norm(sub(cur, prev)), n = leftNormal(d)
      const { L, R } = faceOffsets(ui().wallJustification, th)
      return [
        { kind: 'poly', pts: [add(prev, mulv(n, L)), add(cur, mulv(n, L)), add(cur, mulv(n, R)), add(prev, mulv(n, R))] },
        { kind: 'line', a: prev, b: cur, label: formatLength(dist(prev, cur), unit()) }
      ]
    }
  }
}
