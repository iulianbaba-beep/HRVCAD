// .hrv project file: gzip-compressed JSON of the Project model.
import type { Project } from './types'

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function serializeProject(p: Project): Promise<Uint8Array> {
  const json = JSON.stringify({ ...p, modifiedAt: new Date().toISOString() })
  return pipe(new TextEncoder().encode(json), new CompressionStream('gzip'))
}

export async function deserializeProject(bytes: Uint8Array): Promise<Project> {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b
  const raw = isGzip ? await pipe(bytes, new DecompressionStream('gzip')) : bytes
  const p = JSON.parse(new TextDecoder().decode(raw))
  if (p?.format !== 'hrvcad') throw new Error('project.invalidFormat')
  if (p.version > 1) throw new Error('project.newerVersion')
  return p as Project
}
