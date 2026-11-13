import { contextBridge, ipcRenderer } from 'electron'

export interface FileFilter { name: string; extensions: string[] }

contextBridge.exposeInMainWorld('hrvcad', {
  platform: process.platform,
  openFile: (filters: FileFilter[]) => ipcRenderer.invoke('file:open', { filters }),
  saveFile: (suggestedName: string, filters: FileFilter[], data: Uint8Array, path?: string) =>
    ipcRenderer.invoke('file:save', { suggestedName, filters, data, path }),
  printPdf: (html: string, suggestedName: string, landscape: boolean) =>
    ipcRenderer.invoke('print:pdf', { html, suggestedName, landscape })
})
