// node scripts/benchmark-scan.mjs <scan.ply> [--starts] [--isolated] [studio URL ...]
// All scan bytes are served locally; results are written to test-results/.
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer as createViteServer } from 'vite'

const starts = process.argv.includes('--starts')
const isolated = process.argv.includes('--isolated')
const [scanPath, ...urls] = process.argv
  .slice(2)
  .filter((arg) => !['--starts', '--isolated'].includes(arg))
if (!scanPath) throw new Error('Provide a local Gaussian PLY file path.')
const scan = path.resolve(scanPath)
const scanInfo = await stat(scan)
if (!scanInfo.isFile()) throw new Error('The scan path must point to a file.')
const server = createServer((req, res) => {
  if (req.url !== '/scan.ply') {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': scanInfo.size,
    'Access-Control-Allow-Origin': '*'
  })
  createReadStream(scan).pipe(res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const scanUrl = `http://127.0.0.1:${server.address().port}/scan.ply`
// Disable hot reload during measurement so concurrent UI edits cannot dispose
// the engine under test and accidentally benchmark an inactive viewport.
const studio =
  isolated && !urls.length
    ? await createViteServer({
        cacheDir: 'node_modules/.vite-scan-benchmark',
        server: { host: '127.0.0.1', port: 5176, hmr: false }
      })
    : undefined
await studio?.listen()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const results = []
await mkdir('test-results', { recursive: true })
try {
  for (const url of urls.length
    ? urls
    : [studio?.resolvedUrls.local[0] ?? 'http://127.0.0.1:5174']) {
    const context = await browser.newContext({
      viewport: { width: 1800, height: 1100 },
      deviceScaleFactor: starts ? 2 : 1
    })
    const page = await context.newPage()
    page.on('pageerror', (err) => console.error('PAGE ERROR', err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error(msg.text())
    })
    console.log('Loading scan at', url)
    await page.goto(url)
    await page.waitForFunction(
      () => window.__TMP_VIEWPORT__ && !window.__TMP_VIEWPORT__.state.recovering
    )
    const setup = await page.evaluate(async (scanUrl) => {
      const { loadBenchmarkScan } = await import('/tests/browser/scan-benchmark-fixture.ts')
      return loadBenchmarkScan(scanUrl, window.__TMP_VIEWPORT__)
    }, scanUrl)
    console.log('Loaded', JSON.stringify(setup))
    const result = await page.evaluate(
      async ({ projectorId, starts }) => {
        const { benchmarkScan, benchmarkInteractionStarts } =
          await import('/tests/browser/scan-benchmark-fixture.ts')
        return (starts ? benchmarkInteractionStarts : benchmarkScan)(
          window.__TMP_VIEWPORT__,
          projectorId
        )
      },
      { projectorId: setup.projectorId, starts }
    )
    results.push({ url, scan: path.basename(scanPath), ...result })
    console.log(
      JSON.stringify(results.at(-1), (key, value) => (key === 'samples' ? undefined : value), 2)
    )
    await page.screenshot({ path: `test-results/scan-${results.length}.png` })
    await context.close()
  }
  await writeFile('test-results/scan-benchmark.json', JSON.stringify(results, null, 2))
} finally {
  await browser.close()
  server.close()
  await studio?.close()
}
