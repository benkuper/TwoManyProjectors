import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const port = Number(process.env.PORT || 4173)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm', '.tmp3d': 'application/zip' }
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const file = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(directory + sep)) { response.writeHead(403); response.end(); return }
    const bytes = await readFile(file)
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    response.end(bytes)
  } catch { response.writeHead(404); response.end('File not found') }
})
server.on('error', error => { console.error(error.message); process.exitCode = 1 })
server.listen(port, '127.0.0.1', () => console.log(`TwoManyProjectors: http://127.0.0.1:${port}/\nPress Ctrl+C to stop.`))
