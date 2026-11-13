// Raster underlays: images directly, PDFs rendered page-by-page through pdf.js.
import type { RasterUnderlay } from '../core/types'
import { newId } from '../core/types'

/** Default before calibration: 1 px = 1 cm, which puts a typical scan in the right order of magnitude. */
const DEFAULT_M_PER_PX = 0.01
const PDF_RENDER_DPI = 200

function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(new Blob([bytes as BlobPart], { type: mime }))
  })
}

function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('raster.decodeFailed'))
    img.src = url
  })
}

function makeUnderlay(name: string, fmt: 'image' | 'pdf', dataUrl: string, w: number, h: number): RasterUnderlay {
  return {
    id: newId('ul'),
    kind: 'raster',
    sourceFormat: fmt,
    name,
    dataUrl,
    pxWidth: w,
    pxHeight: h,
    transform: { scale: DEFAULT_M_PER_PX, rotation: 0, offset: { x: 0, y: 0 } },
    opacity: 0.85,
    locked: false,
    visible: true,
    calibrated: false
  }
}

export async function importImage(name: string, bytes: Uint8Array): Promise<RasterUnderlay> {
  const ext = name.split('.').pop()?.toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'bmp' ? 'image/bmp' : 'image/png'
  const url = await bytesToDataUrl(bytes, mime)
  const { w, h } = await imageSize(url)
  return makeUnderlay(name, 'image', url, w, h)
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const task = await loadPdf(bytes)
  try { return (await task.promise).numPages } finally { await task.destroy() }
}

async function loadPdf(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', document.baseURI).href
  return pdfjs.getDocument({ data: bytes.slice() })
}

export async function importPdfPage(name: string, bytes: Uint8Array, pageNo = 1): Promise<RasterUnderlay> {
  const task = await loadPdf(bytes)
  try {
    const pdf = await task.promise
    const page = await pdf.getPage(pageNo)
    const viewport = page.getViewport({ scale: PDF_RENDER_DPI / 72 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport } as any).promise
    const ul = makeUnderlay(`${name} (p. ${pageNo})`, 'pdf', canvas.toDataURL('image/png'), canvas.width, canvas.height)
    return ul
  } finally {
    await task.destroy()
  }
}
