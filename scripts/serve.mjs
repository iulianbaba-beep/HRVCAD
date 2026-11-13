// Minimal static server for running the renderer in a browser (web mode / tests).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/renderer')
const port = Number(process.env.PORT || 5173)
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.map': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
}
http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const file = fs.existsSync(p) && fs.statSync(p).isFile() ? p : path.join(root, 'index.html')
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(port, () => console.log(`HRVCAD web: http://localhost:${port}`))
