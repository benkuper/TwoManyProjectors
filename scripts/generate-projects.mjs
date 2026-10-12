import { chromium } from '@playwright/test'
import { zipSync, strToU8 } from 'fflate'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  await page.goto('http://127.0.0.1:5174')
  await page.getByLabel('Project name', { exact: true }).fill('Sample studio')
  await page.getByLabel('Project name', { exact: true }).press('Tab')
  const doc = await page.evaluate(() => window.__TMP_VIEWPORT__.state.doc)
  await writeFile('public/samples/studio.tmp3d', zipSync({ 'scene.json': strToU8(JSON.stringify(doc, null, 2)) }))
  await page.getByLabel('Import asset files').setInputFiles(resolve('public/samples/scan.spz'))
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await page.locator('.busy-toast').waitFor({ state: 'hidden' })
  await page.getByLabel('Hide Main screen', { exact: true }).click()
  await page.getByLabel('Project name', { exact: true }).fill('Scan study')
  await page.getByLabel('Project name', { exact: true }).press('Tab')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  await (await pending).saveAs('public/samples/scan-study.tmp3d')
  console.log('Generated studio.tmp3d and scan-study.tmp3d')
} finally { await browser.close() }
