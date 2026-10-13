import { test, expect, type Page } from '@playwright/test'
import { Color } from 'three'
import { luxBandColors, luxTargetColors } from '../../src/lib/types'

const linearColor = (hex: string) => new Color(hex).toArray().map((v) => Math.round(v * 255))
function expectColor(actual: number[], expected: number[], tolerance = 1) {
  expected.forEach((value, i) => expect(Math.abs(actual[i] - value)).toBeLessThanOrEqual(tolerance))
}

async function ready(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.projection.projectors.length
  })
  await page.evaluate(async () => {
    const { sampleDocument, replaceDocument, select } = await import('/src/lib/store.ts' as string)
    const doc = sampleDocument()
    doc.nodes = [doc.nodes[0]]
    doc.nodes[0].dimensions[0] = 12
    doc.settings.analysis = 'lux'
    doc.settings.range = [0, 160]
    doc.projectors[0].spec.lumens = 2250 // 100 lux on the 6 x 3.75 m image.
    doc.projectors[0].pattern = 'white'
    replaceDocument(doc)
    select(null)
  })
}

test('target limits and bands update live, undo, and survive save and recovery', async ({
  page
}, info) => {
  await ready(page)
  const display = page.getByLabel('Lux display', { exact: true })
  await expect(display).toHaveValue('smooth')
  await display.selectOption('bands')
  await expect(
    page.getByRole('list', { name: 'Lux bands', exact: true }).getByRole('listitem')
  ).toHaveCount(8)
  await display.selectOption('target')
  await expect(
    page.getByRole('list', { name: 'Target lux legend' }).getByRole('listitem')
  ).toHaveText(['Below minimum', 'In range', 'Above maximum'])
  const minimum = page.getByLabel('Minimum lux', { exact: true })
  const maximum = page.getByLabel('Maximum lux', { exact: true })
  await expect(minimum).toHaveValue('80')
  await maximum.fill('150')
  await maximum.press('Tab')
  const before = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return { shading: e.projection.shadingKey, depth: e.depthKey }
  })
  await minimum.fill('110')
  await minimum.press('Tab')
  const after = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return {
      shading: e.projection.shadingKey,
      depth: e.depthKey,
      target: e.projection.uniforms.tmpLuxTarget.value.toArray()
    }
  })
  expect(after.target).toEqual([110, 150])
  expect(after.shading).not.toBe(before.shading)
  expect(after.depth).toBe(before.depth)
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(minimum).toHaveValue('80')
  await page.getByLabel('Redo', { exact: true }).click()
  await expect(minimum).toHaveValue('110')
  // Limits retain their meaning when another analysis mode changes its color range.
  await page.getByRole('button', { name: 'Distortion', exact: true }).click()
  await expect(display).toHaveCount(0)
  await page.getByRole('button', { name: 'Illuminance', exact: true }).click()
  await expect(display).toHaveValue('target')
  await expect(minimum).toHaveValue('110')
  await expect(maximum).toHaveValue('150')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const file = info.outputPath('lux-target.tmp3d')
  await (await download).saveAs(file)
  await display.selectOption('smooth')
  await page.getByLabel('Open project file').setInputFiles(file)
  await expect(display).toHaveValue('target')
  await expect(minimum).toHaveValue('110')
  await page.reload()
  await expect(display).toHaveValue('target')
  await expect(maximum).toHaveValue('150')
  await page.screenshot({ path: info.outputPath('lux-target.png') })
})

test('GPU target colors classify summed lux, missing coverage and shadows without changing probes', async ({
  page
}) => {
  await ready(page)
  await page.getByLabel('Lux display', { exact: true }).selectOption('target')
  const result = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample } = await import('/tests/browser/gpu-fixture.ts' as string)
    const { commit } = await import('/src/lib/store.ts' as string)
    const { pixelFootprint } = await import('/src/lib/optics.ts' as string)
    const surface = [...e.nodes.values()][0] as any
    const point = surface.group.position.clone(),
      normal = point.clone().set(0, 0, 1)
    e.renderDepth()
    const samples = [60, 79, 80, 81, 100, 119, 120, 121, 140].map((lux) => {
      e.projection.uniforms.tmpOutput.value[0].x = lux * 22.5
      return gpuSample(e, point.toArray(), normal.toArray()).slice(0, 3)
    })
    const uncovered = gpuSample(e, [4, 2.2, 0], normal.toArray()).slice(0, 3)
    const unknown = gpuSample(e, point.toArray(), normal.toArray(), 0).slice(0, 3)
    const before = pixelFootprint(e.state.doc.projectors[0], point, normal).lux
    commit('Overlap fixture', (doc: any) => {
      doc.projectors[0].spec.lumens = 1350 // Each projector contributes 60 lux.
      doc.projectors.push({ ...structuredClone(doc.projectors[0]), id: 'second-projector' })
    })
    e.renderDepth()
    const overlap = gpuSample(e, point.toArray(), normal.toArray()).slice(0, 3)
    const probe = e.probe({ point, object: surface.group.children[0], face: { normal } })
    commit('Shadow fixture', (doc: any) => {
      doc.nodes.push({
        ...structuredClone(doc.nodes[0]),
        id: 'blocker',
        dimensions: [3, 2, 0.1],
        transform: { ...structuredClone(doc.nodes[0].transform), position: [0, 2.2, 3] }
      })
    })
    e.renderDepth()
    const blocked = gpuSample(e, point.toArray(), normal.toArray()).slice(0, 3)
    const blockedProbe = e.probe({ point, object: surface.group.children[0], face: { normal } })
    return {
      samples,
      uncovered,
      unknown,
      before,
      overlap,
      lux: probe.lux,
      blocked,
      blockedLux: blockedProbe.lux
    }
  })
  const [under, good, over] = luxTargetColors.map(linearColor)
  result.samples.forEach((sample: number[], i: number) =>
    expectColor(sample, i < 2 ? under : i < 7 ? good : over)
  )
  expectColor(result.uncovered, under)
  expectColor(result.unknown, [46, 46, 54])
  expectColor(result.overlap, good)
  expect(result.before).toBeCloseTo(100)
  expect(result.lux).toBeCloseTo(120)
  expectColor(result.blocked, under)
  expect(result.blockedLux).toBe(0)
})

test('stepped bands change at lux intervals and preserve the smooth view', async ({ page }) => {
  await ready(page)
  await page.getByLabel('Lux display', { exact: true }).selectOption('bands')
  const result = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample } = await import('/tests/browser/gpu-fixture.ts' as string)
    e.renderDepth()
    const sample = (lux: number) => {
      e.projection.uniforms.tmpOutput.value[0].x = lux * 22.5
      return gpuSample(e, [0, 2.2, 0], [0, 0, 1]).slice(0, 3)
    }
    const bands = [0, 1, 19, 21, 39, 41, 1000].map(sample)
    const uncovered = gpuSample(e, [4, 2.2, 0], [0, 0, 1]).slice(0, 3)
    return { bands, uncovered }
  })
  ;[0, 0, 0, 1, 1, 2, 7].forEach((band, i) =>
    expectColor(result.bands[i], linearColor(luxBandColors[band]))
  )
  expectColor(result.uncovered, [20, 20, 20])
  await page.getByLabel('Lux display', { exact: true }).selectOption('smooth')
  await expect(page.locator('.heat-gradient')).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Lux bands', exact: true })).toHaveCount(0)
})

test('discrete lux colors match the legend on screen and in Gaussian rendering', async ({
  page
}) => {
  await ready(page)
  await page.getByLabel('Lux display', { exact: true }).selectOption('target')
  const sample = () =>
    page.evaluate(async () => {
      const e = (window as any).__TMP_VIEWPORT__
      const { receiverDisplaySample } = await import('/tests/browser/gpu-fixture.ts' as string)
      const { splatAmbientSample } = await import('/tests/browser/spark-fixture.ts' as string)
      e.renderDepth()
      return {
        mesh: receiverDisplaySample(e, [0, 2.2, 0], 'mesh', true),
        cloud: receiverDisplaySample(e, [0, 2.2, 0], 'cloud', true),
        splat: (await splatAmbientSample(e, { projected: true, point: [0, 2.2, 0] })).slice(0, 3)
      }
    })
  const good = await sample()
  const encoded = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  expectColor(good.mesh, encoded(luxTargetColors[1]))
  expectColor(good.cloud, encoded(luxTargetColors[1]))
  // Gaussian opacity falloff and packed colors add a small quantization difference.
  expectColor(good.splat, linearColor(luxTargetColors[1]), 3)
  await page.getByLabel('Minimum lux', { exact: true }).fill('110')
  await page.getByLabel('Minimum lux', { exact: true }).press('Tab')
  const under = await sample()
  expectColor(under.mesh, encoded(luxTargetColors[0]))
  expectColor(under.cloud, encoded(luxTargetColors[0]))
  expectColor(under.splat, linearColor(luxTargetColors[0]), 3)
})
