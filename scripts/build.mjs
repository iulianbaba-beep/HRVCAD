// Build HRVCAD: Electron main + preload (CJS, node) and renderer (ESM, browser).
// Usage: node scripts/build.mjs [--watch] [--tests]
import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist')
const watch = process.argv.includes('--watch')
const tests = process.argv.includes('--tests')
const require = createRequire(path.join(root, 'package.json'))

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'renderer', 'wasm'), { recursive: true })

// Static assets
fs.copyFileSync(path.join(root, 'src/renderer/index.html'), path.join(out, 'renderer/index.html'))
fs.copyFileSync(path.join(root, 'src/renderer/styles.css'), path.join(out, 'renderer/styles.css'))
const pkgDir = (name) => path.dirname(require.resolve(name + '/package.json'))
const tryPkgDir = (name) => {
  try { return pkgDir(name) } catch { return path.join(root, 'node_modules', name) }
}
fs.copyFileSync(
  path.join(tryPkgDir('@mlightcad/libredwg-web'), 'wasm/libredwg-web.wasm'),
  path.join(out, 'renderer/wasm/libredwg-web.wasm')
)
fs.copyFileSync(
  path.join(tryPkgDir('pdfjs-dist'), 'build/pdf.worker.min.mjs'),
  path.join(out, 'renderer/pdf.worker.min.mjs')
)

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022' }

const configs = [
  {
    ...common,
    entryPoints: [path.join(root, 'src/main/main.ts')],
    outfile: path.join(out, 'main/main.cjs'),
    platform: 'node', format: 'cjs', external: ['electron']
  },
  {
    ...common,
    entryPoints: [path.join(root, 'src/main/preload.ts')],
    outfile: path.join(out, 'main/preload.cjs'),
    platform: 'node', format: 'cjs', external: ['electron']
  },
  {
    ...common,
    entryPoints: [path.join(root, 'src/renderer/main.tsx')],
    outdir: path.join(out, 'renderer'),
    platform: 'browser', format: 'esm', splitting: true,
    jsx: 'automatic',
    // Emscripten glue has guarded Node-only branches; never taken in the renderer.
    external: ['fs', 'path', 'module', 'url', 'crypto', 'node:*'],
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.wasm': 'file' }
  }
]

if (tests) {
  const testDir = path.join(root, 'tests')
  const entries = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts')).map(f => path.join(testDir, f))
  configs.push({
    ...common, entryPoints: entries, outdir: path.join(out, 'tests'),
    platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, logLevel: 'warning'
  })
}

if (watch) {
  for (const c of configs) (await esbuild.context(c)).watch()
  console.log('watching…')
} else {
  await Promise.all(configs.map(c => esbuild.build(c)))
}
