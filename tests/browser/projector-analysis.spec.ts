import { test, expect, type Page } from '@playwright/test'

const uncovered = [20, 20, 20, 255]
function expectColor(actual: number[], expected: number[]) {
  actual.forEach((value, channel) =>
    expect(Math.abs(value - expected[channel])).toBeLessThanOrEqual(1)
  )
}
function heat(value: number, range: [number, number]) {
  const t = Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])))
  return [3, 2, 1]
    .map((offset) => Math.round(Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - offset))) * 255))
    .concat(255)
}

async function ready(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.projection.projectors.length
  })
  return page.evaluate(async () => {
    const { sampleDocument, replaceDocument, select } = await import('/src/lib/store.ts' as string)
    const doc = sampleDocument()
    doc.nodes = [doc.nodes[0]]
    doc.nodes[0].transform.scale[0] = 16
    const base = doc.projectors[0]
    doc.projectors = [0, 1, 2].map((i) => ({
      ...structuredClone(base),
      id: `analysis-${i}`,
      name: `Projector ${i + 1}`,
      pattern: 'white',
      spec: { ...structuredClone(base.spec), resolution: [960 * 2 ** i, 600 * 2 ** i] },
      transform: { ...structuredClone(base.transform), position: [(i - 1) * 4, 2.2, 6] }
    }))
    doc.settings.analysis = 'density'
    doc.settings.range = [0, 800]
    replaceDocument(doc)
    select(null)
    return doc.projectors.map((p: any) => p.id)
  })
}

async function colors(page: Page) {
  return page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample } = await import('/tests/browser/gpu-fixture.ts' as string)
    e.renderDepth()
    return [-4, 0, 4].map((x) => gpuSample(e, [x, 2.2, 0], [0, 0, 1]))
  })
}

test('density follows empty, multiple and receiver selections, with an explicit projector override', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const ids = await ready(page)
  await page.keyboard.press('Escape')
  const expected = await colors(page)
  expected.forEach((pixel: number[], i: number) => expectColor(pixel, heat(160 * 2 ** i, [0, 800])))
  await expect(page.getByLabel('Analysis scope')).toHaveText(
    'Projector 1, Projector 2, Projector 3'
  )
  const first = page.getByRole('button', { name: 'Projector 1', exact: true })
  const third = page.getByRole('button', { name: 'Projector 3', exact: true })
  await first.click()
  await expect.poll(() => colors(page)).toEqual([expected[0], uncovered, uncovered])
  await third.click({ modifiers: ['Control'] })
  await expect.poll(() => colors(page)).toEqual([expected[0], uncovered, expected[2]])
  await page
    .getByRole('button', { name: 'Main screen', exact: true })
    .click({ modifiers: ['Control'] })
  await expect.poll(() => colors(page)).toEqual([expected[0], uncovered, expected[2]])
  // Removing a non-active projector must update shading even though the active receiver stays put.
  await first.click({ modifiers: ['Control'] })
  await expect.poll(() => colors(page)).toEqual([uncovered, uncovered, expected[2]])
  await page.getByLabel('Analysis projector', { exact: true }).selectOption(ids[1])
  await expect.poll(() => colors(page)).toEqual([uncovered, expected[1], uncovered])
  await expect(page.getByLabel('Analysis scope')).toHaveText('Projector 2')
  await page.getByLabel('Analysis projector', { exact: true }).selectOption('all')
  await page.keyboard.press('Escape')
  await expect.poll(() => colors(page)).toEqual(expected)
  await page.getByRole('button', { name: 'Main screen', exact: true }).click()
  await expect.poll(() => colors(page)).toEqual(expected)

  // Projection, illuminance sums and overlap keep showing all enabled projectors.
  for (const mode of ['Projection', 'Illuminance', 'Overlap']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    const all = await colors(page)
    await first.click()
    expect(await colors(page)).toEqual(all)
    await third.click({ modifiers: ['Control'] })
    expect(await colors(page)).toEqual(all)
    await page.keyboard.press('Escape')
  }
  expect(errors).toEqual([])
})

test('overlapping density and distortion agree with probes and exclude occluded or disabled projectors', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await ready(page)
  const results = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample } = await import('/tests/browser/gpu-fixture.ts' as string)
    const { pixelFootprint } = await import('/src/lib/optics.ts' as string)
    const { makeNode, replaceDocument, setSelection, updateUI, commit } = await import(
      '/src/lib/store.ts' as string
    )
    const doc = structuredClone(e.state.doc)
    doc.projectors.forEach((p: any, i: number) => {
      p.transform.position[0] = [-1, 1, 0][i]
    })
    const blocker = makeNode('box')
    blocker.transform.position = [0, 2.2, 3]
    blocker.dimensions = [0.4, 1, 0.4]
    doc.nodes.push(blocker)
    replaceDocument(doc)
    setSelection([])
    const surface = e.nodes.get(doc.nodes[0].id)
    const point = surface.group.position.clone()
    const normal = point.clone().set(0.8, 0, 1).normalize()
    const localNormal = normal.clone().multiply(surface.group.scale)
    const footprints = doc.projectors.map((p: any) => pixelFootprint(p, point, normal))
    const sample = () => {
      e.renderDepth()
      const probe = e.probe({ point, object: surface.group.children[0], face: { normal: localNormal } })
      return { probe, color: gpuSample(e, point.toArray(), normal.toArray()) }
    }
    const density = sample()
    updateUI({ probe: density.probe })
    commit('Distortion view', (d: any) => {
      d.settings.analysis = 'distortion'
      d.settings.range = [1, 5]
    })
    const distortion = sample()
    setSelection([doc.projectors[0].id, doc.projectors[1].id])
    const selected = sample()
    commit('Disable selected projector', (d: any) => {
      d.projectors[1].enabled = false
    })
    const disabled = sample()
    setSelection([doc.projectors[1].id])
    const onlyDisabled = sample()
    commit('Missing analysis projector', (d: any) => {
      d.settings.analysisProjector = 'deleted-projector'
    })
    const missing = sample()
    commit('Restore analysis scope', (d: any) => {
      d.settings.analysisProjector = 'all'
      d.projectors[1].enabled = true
    })
    setSelection([])
    updateUI({ probe: density.probe })
    return { footprints, density, distortion, selected, disabled, onlyDisabled, missing }
  })
  const visible = results.footprints.slice(0, 2)
  const best = visible.reduce((a: any, b: any) =>
    Math.min(...a.density) > Math.min(...b.density) ? a : b
  )
  expect(results.density.probe.projectors.map((p: any) => p.occluded)).toEqual([false, false, true])
  expect(results.density.probe.density).toEqual(best.density)
  expect(results.density.probe.millimetresPerPixel).toEqual(best.millimetresPerPixel)
  expectColor(results.density.color, heat(Math.min(...best.density), [0, 800]))
  const worst = Math.max(...visible.map((f: any) => f.distortion))
  expect(results.distortion.probe.distortion).toBeCloseTo(worst)
  expectColor(results.distortion.color, heat(worst, [1, 5]))
  expect(results.selected).toEqual(results.distortion)
  expect(results.disabled.probe.distortion).toBeCloseTo(visible[0].distortion)
  expectColor(results.disabled.color, heat(visible[0].distortion, [1, 5]))
  for (const sample of [results.onlyDisabled, results.missing]) {
    expect(sample.probe.density).toBeNull()
    expect(sample.probe.distortion).toBeNull()
    expect(sample.color).toEqual(uncovered)
  }
  await page.getByText('Per-projector density', { exact: true }).click()
  await expect(page.locator('.probe-projectors dt')).toHaveText([
    'Projector 1',
    'Projector 2',
    'Projector 3'
  ])
  await expect(page.locator('.probe-projectors dd').last()).toHaveText('Occluded')
  expect(errors).toEqual([])
})

test('illuminance shows dark gray outside coverage and in full shadow, retaining the heat map for covered pixels', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await ready(page)
  const results = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample, receiverDisplaySample } = await import(
      '/tests/browser/gpu-fixture.ts' as string
    )
    const { splatAmbientSample } = await import('/tests/browser/spark-fixture.ts' as string)
    const { makeNode, replaceDocument, select, commit } = await import(
      '/src/lib/store.ts' as string
    )
    const doc = structuredClone(e.state.doc)
    doc.projectors = [doc.projectors[1]]
    doc.settings.analysis = 'lux'
    doc.settings.range = [0, 500]
    const blocker = makeNode('box')
    blocker.transform.position = [0, 2.2, 3]
    blocker.dimensions = [0.5, 1, 0.5]
    doc.nodes.push(blocker)
    replaceDocument(doc)
    select(null)
    e.renderDepth()
    const shade = (point: [number, number, number]) => gpuSample(e, point, [0, 0, 1])
    const outside = shade([5, 2.2, 0])
    const behind = shade([0, 2.2, 8])
    const blocked = shade([0, 2.2, 0])
    const lit = shade([1.5, 2.2, 0])
    const materials = {
      mesh: receiverDisplaySample(e, [5, 2.2, 0], 'mesh'),
      cloud: receiverDisplaySample(e, [5, 2.2, 0], 'cloud'),
      splat: (await splatAmbientSample(e, { projected: true, point: [5, 2.2, 0] })).slice(0, 3)
    }
    commit('Zero output', (d: any) => {
      d.projectors[0].spec.lumens = 0
    })
    const zeroOutput = shade([1.5, 2.2, 0])
    commit('Highlight shadows', (d: any) => {
      d.settings.shadowHighlight = true
    })
    const highlighted = shade([0, 2.2, 0])
    commit('Disable projector', (d: any) => {
      d.projectors[0].enabled = false
    })
    e.renderDepth()
    const disabled = shade([1.5, 2.2, 0])
    return { outside, behind, blocked, lit, materials, zeroOutput, highlighted, disabled }
  })
  for (const pixel of [results.outside, results.behind, results.blocked, results.disabled])
    expect(pixel).toEqual(uncovered)
  expectColor(results.lit, heat(6000 / (6 * 3.75), [0, 500]))
  expect(results.zeroOutput).toEqual(heat(0, [0, 500]))
  expect(results.highlighted).toEqual([255, 255, 0, 255])
  for (const pixel of Object.values(results.materials)) {
    expect(Math.max(...pixel) - Math.min(...pixel)).toBeLessThanOrEqual(1)
    expect(pixel[0]).toBeGreaterThan(10)
    expect(pixel[0]).toBeLessThan(120)
  }
  expect(errors).toEqual([])
})
