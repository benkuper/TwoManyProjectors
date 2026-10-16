import { test, expect } from '@playwright/test'
import path from 'node:path'

test('Gaussian view shading follows world light direction on both sides of a scan', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__TMP_VIEWPORT__?.state.recovering === false)
  await page.locator('.viewport-shading summary').click()
  const mode = page.getByLabel('View shading', { exact: true })
  const sample = (rotation = 0): Promise<number[]> =>
    page.evaluate(async (rotation) => {
      const { splatAmbientSample } = await import('/tests/browser/spark-fixture.ts' as string)
      return splatAmbientSample((window as any).__TMP_VIEWPORT__, { rotation })
    }, rotation)
  const angle = async (label: string, value: string) => {
    await page.getByLabel(label, { exact: true }).fill(value)
    await page.getByLabel(label, { exact: true }).press('Tab')
  }
  await mode.selectOption('none')
  const original = await sample()
  expect(original[0]).toBeGreaterThan(250)
  await mode.selectOption('directional')
  await angle('Light elevation', '0')
  await angle('Light azimuth', '0')
  const lit = await sample()
  expect(lit).toEqual(original)
  await angle('Light azimuth', '90')
  const side = await sample()
  // Spark quantizes packed colors and covariance rotations.
  expect(Math.abs(side[0] - 255 * 0.25)).toBeLessThan(3)
  // The modifier receives world-space covariance axes, including object rotation.
  expect((await sample(Math.PI / 2))[0]).toBeGreaterThan(side[0] * 3)
  await angle('Light azimuth', '180')
  expect(await sample()).toEqual(lit)
  await mode.selectOption('projectors')
  expect((await sample())[0]).toBeCloseTo(255 * 0.09, 0)
  expect(errors).toEqual([])
})

test('Gaussian color, brightness and contrast alter pixels without changing analysis colors', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__TMP_VIEWPORT__?.state.recovering === false)
  await page.locator('.viewport-shading summary').click()
  await page.getByLabel('View shading', { exact: true }).selectOption('none')
  const pixels = await page.evaluate(async () => {
    const { splatAmbientSample } = await import('/tests/browser/spark-fixture.ts' as string),
      { materials } = await import('/src/lib/types.ts' as string),
      e = (window as any).__TMP_VIEWPORT__,
      options = { sourceColor: [0.25, 0.5, 0.75] as [number, number, number] },
      tinted = { ...materials.captured, color: '#ff0000' },
      original = await splatAmbientSample(e, options),
      bright = await splatAmbientSample(e, { ...options, brightness: 1.5 }),
      contrast = await splatAmbientSample(e, { ...options, contrast: 2 }),
      flat = await splatAmbientSample(e, { ...options, contrast: 0 }),
      tint = await splatAmbientSample(e, { ...options, surface: tinted }),
      uniform = await splatAmbientSample(e, {
        ...options,
        surface: { ...tinted, forceUniformColor: true }
      }),
      black = await splatAmbientSample(e, { ...options, brightness: 0 })
    const previousMode = e.projection.uniforms.tmpMode.value,
      previousShading = e.projection.uniforms.tmpViewShading.value
    try {
      const analysis: number[][][] = []
      for (const mode of [1, 2, 3, 4]) {
        e.projection.uniforms.tmpMode.value = mode
        const options = { projected: true, point: [0, 2.2, 0] as [number, number, number] }
        e.projection.uniforms.tmpViewShading.value = 0
        const original = await splatAmbientSample(e, options)
        e.projection.uniforms.tmpViewShading.value = 2
        analysis.push([
          original,
          await splatAmbientSample(e, {
            ...options,
            brightness: 3,
            contrast: 2,
            surface: tinted
          })
        ])
      }
      return { original, bright, contrast, flat, tint, uniform, black, analysis }
    } finally {
      e.projection.uniforms.tmpMode.value = previousMode
      e.projection.uniforms.tmpViewShading.value = previousShading
    }
  })
  expect(pixels.bright[0]).toBeGreaterThan(pixels.original[0] * 1.3)
  expect(pixels.bright[1]).toBeCloseTo(pixels.original[1] * 1.5, -1)
  expect(pixels.contrast[0]).toBe(0)
  expect(pixels.contrast[2]).toBeGreaterThan(pixels.original[2] * 1.8)
  expect(
    Math.max(...pixels.flat.slice(0, 3)) - Math.min(...pixels.flat.slice(0, 3))
  ).toBeLessThanOrEqual(1)
  expect(pixels.tint.slice(1, 3)).toEqual([0, 0])
  expect(pixels.tint[0]).toBe(pixels.original[0])
  expect(pixels.uniform.slice(0, 3)).toEqual([255, 0, 0])
  expect(pixels.black.slice(0, 3)).toEqual([0, 0, 0])
  for (const [original, adjusted] of pixels.analysis) expect(adjusted).toEqual(original)
})

test('Gaussian appearance edits preserve each other, undo, save and recover without shader rebuilds', async ({
  page
}, info) => {
  await page.goto('/')
  await page
    .getByLabel('Import asset files')
    .setInputFiles(path.resolve('public/samples/gaussian.ply'))
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      runtime = e.nodes.get(e.state.selected)
    runtime.splat.mesh.userData.beforeGenerator = runtime.splat.mesh.generator
    runtime.splat.mesh.userData.beforeDepth = e.depthKey
  })
  const setNumber = async (label: string, value: string) => {
    await page.getByLabel(label, { exact: true }).fill(value)
    await page.getByLabel(label, { exact: true }).press('Tab')
  }
  await page.getByLabel('Splat color', { exact: true }).fill('#aa66ff')
  await setNumber('Splat brightness', '2.2')
  await setNumber('Splat contrast', '1.7')
  await setNumber('Splat opacity', '2.5')
  await setNumber('Splat size', '1.8')
  const state = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      runtime = e.nodes.get(e.state.selected),
      node = e.state.doc.nodes.find((n: any) => n.id === e.state.selected)
    return {
      gaussian: node.gaussian,
      color: node.material.color,
      scale: node.transform.scale,
      brightness: runtime.splat.uniforms.tmpSplatBrightness.value,
      contrast: runtime.splat.uniforms.tmpSplatContrast.value,
      sameGenerator: runtime.splat.mesh.generator === runtime.splat.mesh.userData.beforeGenerator,
      sameDepth: e.depthKey === runtime.splat.mesh.userData.beforeDepth
    }
  })
  expect(state).toEqual({
    gaussian: { opacity: 2.5, size: 1.8, brightness: 2.2, contrast: 1.7 },
    color: '#aa66ff',
    scale: [1, 1, 1],
    brightness: 2.2,
    contrast: 1.7,
    sameGenerator: true,
    sameDepth: true
  })
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.getByLabel('Splat size', { exact: true })).toHaveValue('1')
  await expect(page.getByLabel('Splat brightness', { exact: true })).toHaveValue('2.2')
  await page.getByLabel('Redo', { exact: true }).click()
  await page.getByLabel('Uniform splat color', { exact: true }).check()
  await expect(page.getByLabel('Splat contrast', { exact: true })).toBeDisabled()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const archive = info.outputPath('splat-appearance.tmp3d')
  await (await download).saveAs(archive)
  await page.getByLabel('Open project file').setInputFiles(archive)
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  await page.getByRole('button', { name: 'gaussian', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'gaussian', exact: true }).click()
  await expect(page.getByLabel('Splat color', { exact: true })).toHaveValue('#aa66ff')
  await expect(page.getByLabel('Splat brightness', { exact: true })).toHaveValue('2.2')
  await expect(page.getByLabel('Splat contrast', { exact: true })).toHaveValue('1.7')
  await expect(page.getByLabel('Splat opacity', { exact: true })).toHaveValue('2.5')
  await expect(page.getByLabel('Splat size', { exact: true })).toHaveValue('1.8')
  await expect(page.getByLabel('Uniform splat color', { exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Reset splat colors', exact: true }).click()
  await expect(page.getByLabel('Splat color', { exact: true })).toHaveValue('#ffffff')
  await expect(page.getByLabel('Splat brightness', { exact: true })).toHaveValue('1')
  await expect(page.getByLabel('Splat contrast', { exact: true })).toHaveValue('1')
  await expect(page.getByLabel('Uniform splat color', { exact: true })).not.toBeChecked()
  await expect(page.getByLabel('Splat opacity', { exact: true })).toHaveValue('2.5')
  await expect(page.getByLabel('Splat size', { exact: true })).toHaveValue('1.8')
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.getByLabel('Splat brightness', { exact: true })).toHaveValue('2.2')
  await page.screenshot({ path: info.outputPath('splat-controls.png') })
})
