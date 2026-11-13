import { ro, type I18nKey } from './ro'
import { en } from './en'
import { store, useStore } from '../core/store'

export type { I18nKey }
const dicts = { ro, en } as const

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const lang = store.get().ui.language
  let s: string = (dicts[lang] as Record<string, string>)[key] ?? ro[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
  return s
}

/** Hook: re-renders the component when the language changes. */
export function useT() {
  useStore(s => s.ui.language)
  return t
}

export const APP_VERSION = '0.1.0'
