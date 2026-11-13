// File access abstraction: Electron (native dialogs via preload bridge) or plain browser fallback.
export interface FileFilter { name: string; extensions: string[] }
export interface OpenedFile { name: string; path?: string; data: Uint8Array }
export interface SavedFile { name: string; path?: string }

interface Bridge {
  platform: string
  openFile(filters: FileFilter[]): Promise<OpenedFile | null>
  saveFile(name: string, filters: FileFilter[], data: Uint8Array, path?: string): Promise<SavedFile | null>
}

const bridge: Bridge | undefined = (globalThis as any).hrvcad

export const isElectron = !!bridge
export const isMac = bridge ? bridge.platform === 'darwin' : /Mac/i.test(navigator.platform)

export async function openFile(filters: FileFilter[]): Promise<OpenedFile | null> {
  if (bridge) return bridge.openFile(filters)
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = filters.flatMap(f => f.extensions.map(e => '.' + e)).join(',')
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      resolve({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export async function saveFile(suggestedName: string, filters: FileFilter[], data: Uint8Array, path?: string): Promise<SavedFile | null> {
  if (bridge) return bridge.saveFile(suggestedName, filters, data, path)
  const url = URL.createObjectURL(new Blob([data as BlobPart]))
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return { name: suggestedName }
}
