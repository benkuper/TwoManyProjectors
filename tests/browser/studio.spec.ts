import { test, expect } from '@playwright/test'
test('studio renders, edits, analyses, and saves a complete project', async ({
  page
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto('/')
  await expect(page.locator('.viewport canvas')).toBeVisible()
  await expect(page.getByText('Viewport unavailable')).toHaveCount(0)
  await page.waitForFunction(() => document.querySelector('canvas')?.width! > 0)
  await page.getByLabel('Output', { exact: true }).fill('8000')
  await page.getByLabel('Output', { exact: true }).press('Tab')
  await expect(page.getByLabel('Output', { exact: true })).toHaveValue('8000')
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.getByLabel('Output', { exact: true })).toHaveValue('6000')
  await page.getByLabel('Redo', { exact: true }).click()
  await expect(page.getByLabel('Output', { exact: true })).toHaveValue('8000')
  await page.getByRole('button', { name: 'Add projector', exact: true }).click()
  await expect(
    page.locator('.scene-list .tree-row').filter({ has: page.locator('.lucide-sun') })
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Illuminance', exact: true }).click()
  await expect(page.getByLabel('Analysis projector', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Perspective', exact: false }).click()
  await expect(page.getByRole('button', { name: 'Orthographic', exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Projection', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('studio.png'), fullPage: true })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const download = await downloadPromise
  await download.saveAs(testInfo.outputPath('roundtrip.tmp3d'))
  await page.getByLabel('Open project file').setInputFiles(testInfo.outputPath('roundtrip.tmp3d'))
  await expect(page.getByText('Project opened', { exact: true })).toBeVisible()
  await expect(
    page.locator('.scene-list .tree-row').filter({ has: page.locator('.lucide-sun') })
  ).toHaveCount(2)
  expect(errors).toEqual([])
})
