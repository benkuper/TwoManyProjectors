import { test, expect } from '@playwright/test'
import path from 'node:path'

test('Gaussian size and opacity visibly fill sparse splats', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__TMP_VIEWPORT__?.state.recovering === false)
  const samples = await page.evaluate(async () => {
    const { splatAmbientSample } = await import('/tests/browser/spark-fixture.ts' as string)
    const engine = (window as any).__TMP_VIEWPORT__
    return {
      original: await splatAmbientSample(engine, { sourceOpacity: 0.3 }),
      boosted: await splatAmbientSample(engine, { sourceOpacity: 0.3, opacity: 2 }),
      small: await splatAmbientSample(engine, { offset: 9 }),
      large: await splatAmbientSample(engine, { offset: 9, size: 2 })
    }
  })
  expect(samples.boosted[0]).toBeGreaterThan(samples.original[0] * 1.5)
  expect(samples.large[0]).toBeGreaterThan(samples.small[0] + 5)
})

test('Gaussian controls persist and undo without recompiling or changing scan geometry', async ({
  page
}) => {
  await page.goto('/')
  await page
    .getByLabel('Import asset files')
    .setInputFiles(path.resolve('public/samples/gaussian.ply'))
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  await expect(page.getByLabel('Splat size', { exact: true })).toHaveValue('1')
  await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      runtime = e.nodes.get(e.state.selected)
    runtime.splat.mesh.userData.beforeGenerator = runtime.splat.mesh.generator
  })
  await page.getByLabel('Splat opacity', { exact: true }).fill('2.5')
  await page.getByLabel('Splat opacity', { exact: true }).press('Tab')
  await page.getByLabel('Splat size', { exact: true }).fill('1.8')
  await page.getByLabel('Splat size', { exact: true }).press('Tab')
  const state = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      runtime = e.nodes.get(e.state.selected),
      node = e.state.doc.nodes.find((n: any) => n.id === e.state.selected)
    return {
      gaussian: node.gaussian,
      scale: node.transform.scale,
      opacity: runtime.splat.mesh.opacity,
      size: runtime.splat.uniforms.tmpSplatSize.value,
      sameGenerator: runtime.splat.mesh.generator === runtime.splat.mesh.userData.beforeGenerator
    }
  })
  expect(state).toEqual({
    gaussian: { opacity: 2.5, size: 1.8 },
    scale: [1, 1, 1],
    opacity: 2.5,
    size: 1.8,
    sameGenerator: true
  })
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.getByLabel('Splat size', { exact: true })).toHaveValue('1')
  await page.getByLabel('Redo', { exact: true }).click()
  await expect(page.getByLabel('Splat size', { exact: true })).toHaveValue('1.8')
  await page.reload()
  await page.getByRole('button', { name: 'gaussian', exact: true }).click()
  await expect(page.getByLabel('Splat opacity', { exact: true })).toHaveValue('2.5')
  await expect(page.getByLabel('Splat size', { exact: true })).toHaveValue('1.8')
})

test('scan interaction caches unrelated depth tiles and refreshes live Gaussian projection', async ({
  page
}) => {
  await page.goto('/')
  await page
    .getByLabel('Import asset files')
    .setInputFiles(path.resolve('public/samples/gaussian.ply'))
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  const result = await page.evaluate(async () => {
    const { scanInteractionSample } = await import('/tests/browser/scan-fixture.ts' as string)
    return scanInteractionSample((window as any).__TMP_VIEWPORT__)
  })
  expect(result).toEqual({
    unchanged: true,
    live: true,
    projectorRenders: 1,
    receiverRenders: 2,
    previewBudget: 0.4,
    restoredBudget: 0.4
  })
})

test('Gaussian splats retain visible ambient light through Spark color conversion', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto('/')
  await page.waitForFunction(
    () => (window as any).__TMP_VIEWPORT__ && !(window as any).__TMP_VIEWPORT__.state.recovering
  )
  const pixel = await page.evaluate(async () => {
    const { splatAmbientSample } = await import('/tests/browser/spark-fixture.ts' as string)
    const e = (window as any).__TMP_VIEWPORT__
    e.projection.uniforms.tmpViewShading.value = 2
    return splatAmbientSample(e)
  })
  // 9% ambient in linear light, rather than 9% sRGB (which becomes almost black).
  for (const channel of pixel.slice(0, 3)) expect(channel).toBeCloseTo(0.09 * 255, 0)
  expect(errors).toEqual([])
})

for (const file of ['mesh.ply', 'gaussian.ply'])
  test(`library can frame, add and drag ${file} into the scene with undo`, async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Import asset files').setInputFiles(path.resolve('public/samples', file))
    await page.getByLabel('File units').selectOption('cm')
    await page.getByLabel('Up axis').selectOption('z')
    await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
    await expect(page.locator('.busy-toast')).toHaveCount(0)
    const name = file.replace('.ply', ''),
      asset = page.getByRole('button', { name: `Find ${file} in scene`, exact: true })
    await page.getByLabel(`Hide ${name}`, { exact: true }).click()
    await asset.click()
    await expect(page.getByLabel(`Hide ${name}`, { exact: true })).toBeVisible()
    // Keep placement predictable: the existing asset is hidden and we aim at the stage floor.
    await page.getByLabel(`Hide ${name}`, { exact: true }).click()
    await page.getByLabel('Home view', { exact: true }).click()
    const viewport = page.getByRole('region', { name: '3D viewport' }),
      bounds = (await viewport.boundingBox())!,
      drop = { x: Math.floor(bounds.width * 0.45), y: Math.floor(bounds.height * 0.65) }
    const expected = await page.evaluate(
      ({ x, y }) => (window as any).__TMP_VIEWPORT__.placementPoint(x, y),
      {
        x: bounds.x + drop.x,
        y: bounds.y + drop.y
      }
    )
    expect(expected).not.toBeNull()
    await asset.dragTo(viewport, { targetPosition: drop })
    await expect(page.locator('.scene-list .receivers small')).toHaveText('5')
    const placed = await page.evaluate(async () => {
      const e = (window as any).__TMP_VIEWPORT__,
        { Box3, Vector3 } = await import('/node_modules/three/build/three.module.js' as string),
        node = e.state.doc.nodes.find((n: any) => n.id === e.state.selected),
        box = new Box3().setFromObject(e.nodes.get(node.id).group)
      return {
        center: box.getCenter(new Vector3()).toArray(),
        bottom: box.min.y,
        scale: node.transform.scale,
        tool: e.state.tool
      }
    })
    expect(placed.center[0]).toBeCloseTo(expected[0], 5)
    expect(placed.center[2]).toBeCloseTo(expected[2], 5)
    expect(placed.bottom).toBeCloseTo(expected[1], 5)
    expect(placed.scale).toEqual([1, 1, 1])
    expect(placed.tool).toBe('translate')
    await page.getByLabel('Undo', { exact: true }).click()
    await expect(page.locator('.scene-list .receivers small')).toHaveText('4')
    await page.getByLabel('Redo', { exact: true }).click()
    await expect(page.locator('.scene-list .receivers small')).toHaveText('5')
    await page.getByRole('button', { name: `Add ${file} to scene`, exact: true }).click()
    await expect(page.locator('.scene-list .receivers small')).toHaveText('6')
    await expect(page.locator('.error-toast')).toHaveCount(0)
  })
