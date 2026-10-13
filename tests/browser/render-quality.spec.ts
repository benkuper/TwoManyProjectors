import { test, expect, type Page } from '@playwright/test'

test.use({ deviceScaleFactor: 2 })

async function ready(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
}

async function quality(page: Page, slowFrames = false) {
  return page.evaluate((slowFrames) => {
    const e = (window as any).__TMP_VIEWPORT__
    if (slowFrames) for (let i = 0; i < 12; i++) e.tick(1 / 30)
    return {
      ratio: e.renderer.getPixelRatio(),
      budget: e.spark.lodSplatScale,
      pixelSize: e.spark.lodRenderScale / e.renderer.getPixelRatio()
    }
  }, slowFrames)
}

for (const interaction of ['camera', 'gizmo', 'numeric'] as const) {
  test(`${interaction} movement keeps full quality unless dynamic rendering is enabled`, async ({
    page
  }) => {
    await ready(page)
    const toggle = page.getByRole('button', { name: 'Dynamic rendering quality', exact: true })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    const full = await quality(page)
    expect(full.ratio).toBe(1.75)

    for (const dynamic of [false, true]) {
      if (dynamic) await toggle.click()
      let point: { x: number; y: number }
      if (interaction === 'numeric') {
        const input = page.getByLabel('X', { exact: true })
        await input.click()
        const box = (await input.boundingBox())!
        point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      } else if (interaction === 'camera') {
        await page.keyboard.press('v')
        const box = (await page.locator('.viewport canvas').boundingBox())!
        point = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.5 }
      } else {
        await page.keyboard.press('w')
        point = await page.evaluate(() => {
          const e = (window as any).__TMP_VIEWPORT__
          const rect = e.renderer.domElement.getBoundingClientRect()
          const p = e.transform.object.position.clone().project(e.camera)
          return {
            x: rect.left + ((p.x + 1) * rect.width) / 2,
            y: rect.top + ((1 - p.y) * rect.height) / 2
          }
        })
      }
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.move(point.x + 20, point.y - 8, { steps: 6 })
      await expect
        .poll(() => page.evaluate(() => (window as any).__TMP_VIEWPORT__.manipulating))
        .toBe(true)
      const during = await quality(page, true)
      if (dynamic) {
        expect(during.ratio).toBeLessThan(full.ratio)
        expect(during.budget).toBeLessThan(full.budget)
        expect(during.pixelSize).toBeGreaterThan(full.pixelSize)
      } else expect(during).toEqual(full)
      await page.mouse.up()
      await expect
        .poll(() => page.evaluate(() => (window as any).__TMP_VIEWPORT__.manipulating))
        .toBe(false)
      expect((await quality(page)).ratio).toBe(full.ratio)
    }

    await toggle.click()
    expect(await quality(page)).toEqual(full)
  })
}

test('the quality preference supports undo, recovery and disabling during interaction', async ({
  page
}) => {
  await ready(page)
  const toggle = page.getByRole('button', { name: 'Dynamic rendering quality', exact: true })
  const full = await quality(page)
  await toggle.click()
  await page.reload()
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering
  })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => (window as any).__TMP_VIEWPORT__.lowQuality())
  expect((await quality(page, true)).budget).toBeLessThan(full.budget)
  await toggle.click()
  expect(await quality(page, true)).toEqual(full)
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => (window as any).__TMP_VIEWPORT__.lowQuality())
  expect((await quality(page)).ratio).toBeLessThan(full.ratio)
  await page.evaluate(() => (window as any).__TMP_VIEWPORT__.fullQuality())
})
