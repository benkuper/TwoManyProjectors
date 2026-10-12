import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' })
try {
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:5174')
  const bytes = await page.evaluate(async () => {
    const { spzFixture } = await import('/tests/browser/spark-fixture.ts')
    return spzFixture()
  })
  await writeFile('public/samples/scan.spz', new Uint8Array(bytes))
  console.log('Generated SPZ sample')
} finally {
  await browser.close()
}
