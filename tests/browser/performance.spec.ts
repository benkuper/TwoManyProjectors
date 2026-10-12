import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
test('records navigation performance with two million triangles and eight projectors', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 2474, height: 1224 })
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { benchmark } = await import('/tests/browser/benchmark-fixture.ts' as string)
    return benchmark((window as any).__TMP_VIEWPORT__)
  })
  expect(result.triangles).toBeGreaterThan(2000000)
  expect(result.fps).toBeGreaterThan(0)
  await writeFile(testInfo.outputPath('benchmark.json'), JSON.stringify(result, null, 2))
  console.log('BENCHMARK', JSON.stringify(result))
  await page.screenshot({ path: testInfo.outputPath('benchmark.png') })
})
