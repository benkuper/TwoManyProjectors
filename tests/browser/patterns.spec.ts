import { test, expect } from '@playwright/test'

test('native pixel preview follows resolution, remains independent per projector, and saves', async ({
  page
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
  await page.getByRole('button', { name: 'Color bars', exact: true }).click()
  const width = page.getByLabel('Native width', { exact: true })
  const height = page.getByLabel('Native height', { exact: true })
  await width.fill('32')
  await width.press('Tab')
  await height.fill('20')
  await height.press('Tab')
  const preview = page.getByRole('checkbox', { name: 'Preview native pixels', exact: true })
  const sample = () =>
    page.evaluate(async () => {
      const e = (window as any).__TMP_VIEWPORT__
      const { patternSamples } = await import('/tests/browser/pattern-fixture.ts' as string)
      // Both positions lie inside one 32 px projector pixel, across a color-bar edge.
      return patternSamples(e, [
        [4.1 / 32, 0.3],
        [4.9 / 32, 0.3]
      ])
    })
  expect(await sample()).toEqual([
    [255, 255, 255],
    [255, 255, 0]
  ])
  await preview.check()
  expect(await sample()).toEqual([
    [255, 255, 255],
    [255, 255, 255]
  ])
  await width.fill('320')
  await width.press('Tab')
  await height.fill('200')
  await height.press('Tab')
  expect(await sample()).toEqual([
    [255, 255, 255],
    [255, 255, 0]
  ])
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await page.getByLabel('Grid cell size', { exact: true }).fill('64')
  await page.getByLabel('Grid cell size', { exact: true }).press('Tab')
  await page.getByRole('button', { name: 'Add projector', exact: true }).click()
  await expect(preview).not.toBeChecked()
  await expect(page.getByLabel('Grid cell size', { exact: true })).toHaveValue('120')
  await page.getByRole('button', { name: 'Projector 01', exact: true }).click()
  await expect(preview).toBeChecked()
  await expect(page.getByLabel('Grid cell size', { exact: true })).toHaveValue('64')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const file = info.outputPath('pixel-preview.tmp3d')
  await (await downloaded).saveAs(file)
  await preview.uncheck()
  await page.getByLabel('Grid cell size', { exact: true }).fill('120')
  await page.getByLabel('Grid cell size', { exact: true }).press('Tab')
  await page.getByLabel('Open project file').setInputFiles(file)
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  await expect(preview).toBeChecked()
  await expect(width).toHaveValue('320')
  await expect(height).toHaveValue('200')
  await expect(page.getByLabel('Grid cell size', { exact: true })).toHaveValue('64')
  await page.screenshot({ path: info.outputPath('native-pixel-preview.png') })
  expect(errors).toEqual([])
})

test('grid, checker and numbered patterns keep square pixel cells across landscape and portrait formats', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__TMP_VIEWPORT__?.projection.projectors.length)
  const results = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { patternSamples } = await import('/tests/browser/pattern-fixture.ts' as string)
    const update = (patch: Record<string, unknown>) => {
      const doc = structuredClone(e.state.doc)
      Object.assign(doc.projectors[0], patch)
      e.state = { ...e.state, doc }
      e.sync()
    }
    const results = []
    for (const resolution of [
      [1920, 1200],
      [1920, 1080],
      [1024, 768],
      [768, 1024],
      [3840, 2160]
    ]) {
      for (const pattern of ['grid', 'checker', 'alignment']) {
        const p = e.state.doc.projectors[0]
        const cell = 120
        update({
          spec: { ...p.spec, resolution },
          pattern,
          patternCellSize: cell,
          nativePixelPreview: true
        })
        const [width, height] = resolution
        const points = [
          [120.5, 20.5],
          [126.5, 20.5],
          [20.5, 120.5],
          [20.5, 126.5]
        ]
        const samples = patternSamples(
          e,
          points.map(([x, y]: number[]) => [x / width, 1 - y / height])
        )
        const vertical = []
        const horizontal = []
        for (let x = cell + 0.5; x < width - 2; x += cell)
          vertical.push([x / width, 1 - 20.5 / height])
        for (let y = cell + 0.5; y < height - 2; y += cell)
          horizontal.push([20.5 / width, 1 - y / height])
        results.push({
          resolution,
          pattern,
          samples,
          vertical: patternSamples(e, vertical),
          horizontal: patternSamples(e, horizontal)
        })
      }
    }
    // Changing cell size changes spacing, rather than maintaining a fixed tile count.
    const p = e.state.doc.projectors[0]
    update({ pattern: 'grid', patternCellSize: 64 })
    results.push({
      resolution: p.spec.resolution,
      pattern: '64px grid',
      samples: patternSamples(e, [
        [64.5 / 3840, 1 - 20.5 / 2160],
        [120.5 / 3840, 1 - 20.5 / 2160]
      ]),
      vertical: [],
      horizontal: []
    })
    return results
  })
  for (const result of results) {
    expect(result.samples[0], `${result.resolution} ${result.pattern} vertical`).toEqual([
      230, 237, 223
    ])
    expect(result.samples[1][0]).toBeLessThan(100)
    if (result.samples.length > 2) {
      expect(result.samples[2], `${result.resolution} ${result.pattern} horizontal`).toEqual([
        230, 237, 223
      ])
      expect(result.samples[3][0]).toBeLessThan(100)
    }
    for (const color of [...result.vertical, ...result.horizontal])
      // The highlighted center cross can coincide with a grid line.
      expect([
        [230, 237, 223],
        [181, 243, 108]
      ]).toContainEqual(color)
  }
})
