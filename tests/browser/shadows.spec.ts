import { test, expect } from '@playwright/test'
import path from 'node:path'

test('global shadow boost updates live, undoes as one drag, and survives save and recovery', async ({
  page
}, info) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
  const field = page.getByLabel('Shadow boost', { exact: true })
  const slider = page.getByLabel('Shadow boost slider', { exact: true })
  await expect(field).toHaveValue('1')
  const before = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return { depth: e.depthKey, shading: e.projection.shadingKey }
  })
  const box = (await slider.boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 7, y)
  await page.mouse.down()
  for (const fraction of [0.2, 0.8, 0.4]) {
    await page.mouse.move(box.x + 7 + (box.width - 14) * fraction, y - 20, { steps: 4 })
    const expected = Number((1 + Math.round(fraction * 90) / 10).toFixed(1))
    await expect(field).toHaveValue(String(expected))
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__TMP_VIEWPORT__.projection.uniforms.tmpShadowBoost.value
        )
      )
      .toBe(expected)
  }
  await page.mouse.up()
  const changed = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return { depth: e.depthKey, shading: e.projection.shadingKey }
  })
  expect(changed.depth).toBe(before.depth)
  expect(changed.shading).not.toBe(before.shading)
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(field).toHaveValue('1')
  await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
  await page.getByLabel('Redo', { exact: true }).click()
  await expect(field).toHaveValue('4.6')
  const highlight = page.getByLabel('Highlight projected shadows', { exact: true })
  await highlight.click()
  await expect(highlight).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(highlight).toHaveAttribute('aria-pressed', 'false')
  await page.getByLabel('Redo', { exact: true }).click()
  await expect(highlight).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Overlap', exact: true }).click()
  await expect(
    page.getByRole('list', { name: 'Projector overlap legend' }).getByRole('listitem')
  ).toHaveCount(9)
  await expect(page.getByLabel('Analysis projector', { exact: true })).toHaveCount(0)

  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const file = info.outputPath('shadow-boost.tmp3d')
  await (await downloaded).saveAs(file)
  await field.fill('1')
  await field.press('Tab')
  await page.getByLabel('Open project file').setInputFiles(file)
  await expect(field).toHaveValue('4.6')
  await expect(highlight).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Overlap', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await page.reload()
  await expect(field).toHaveValue('4.6')
  await expect(highlight).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Overlap', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  for (const width of [1250, 1500]) {
    await page.setViewportSize({ width, height: 950 })
    for (const control of [
      field,
      highlight,
      page.getByRole('button', { name: 'Overlap', exact: true })
    ]) {
      await expect(control).toBeInViewport()
    }
  }
  await page.screenshot({ path: info.outputPath('shadow-controls.png') })
})

test('shadow controls work in every view without dimming lit surfaces or changing measurements', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.projection.projectors.length
  })
  const samples = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample, receiverDisplaySample } = await import(
      '/tests/browser/gpu-fixture.ts' as string
    )
    const { splatAmbientSample } = await import('/tests/browser/spark-fixture.ts' as string)
    const doc = structuredClone(e.state.doc)
    const weak = doc.projectors[0]
    weak.pattern = 'white'
    weak.transform.position[0] = -1
    weak.spec.lumens = 600
    const fill = structuredClone(weak)
    fill.id = 'fill-projector'
    fill.transform.position[0] = 1
    fill.spec.lumens = 6000
    doc.projectors.push(fill)
    const blocker = doc.nodes[2]
    blocker.transform.position = [-0.5, 2.2, 3]
    blocker.dimensions = [0.5, 1, 0.5]
    doc.nodes = [doc.nodes[0], blocker]
    const update = () => {
      e.state = { ...e.state, doc }
      e.sync()
      e.renderDepth()
    }
    const shade = (point: [number, number, number] = [0, 2.2, 0]) =>
      gpuSample(e, point, [0, 0, 1]).slice(0, 3)
    const probe = () => {
      const surface = e.nodes.get(doc.nodes[0].id)
      return e.probe({
        point: surface.group.position.clone(),
        object: surface.group.children[0],
        face: { normal: surface.group.position.clone().set(0, 0, 1) }
      })
    }
    update()
    const original = { shadow: shade(), lit: shade([1.5, 2.2, 0]), outside: shade([-5, 2.2, 0]) }
    const originalProbe = probe()
    doc.settings.shadowBoost = 5
    update()
    const boosted = { shadow: shade(), lit: shade([1.5, 2.2, 0]), outside: shade([-5, 2.2, 0]) }
    const boostedProbe = probe()
    doc.settings.shadowBoost = 1
    doc.settings.shadowHighlight = true
    update()
    const highlighted = { shadow: shade(), lit: shade([1.5, 2.2, 0]), outside: shade([-5, 2.2, 0]) }
    const displayYellow = async () => ({
      mesh: receiverDisplaySample(e, [0, 2.2, 0], 'mesh'),
      cloud: receiverDisplaySample(e, [0, 2.2, 0], 'cloud'),
      splat: (await splatAmbientSample(e, { projected: true, point: [0, 2.2, 0] })).slice(0, 3)
    })
    const yellowMaterials = [await displayYellow()]
    const analysis = []
    for (const mode of ['lux', 'density', 'distortion', 'overlap']) {
      doc.settings.analysis = mode
      doc.settings.analysisProjector = fill.id
      doc.settings.shadowBoost = 1
      doc.settings.shadowHighlight = false
      update()
      const original = shade()
      const lit = shade([1.5, 2.2, 0])
      doc.settings.shadowBoost = 5
      update()
      const boosted = shade()
      doc.settings.shadowBoost = 1
      doc.settings.shadowHighlight = true
      update()
      yellowMaterials.push(await displayYellow())
      analysis.push({
        mode,
        original,
        boosted,
        highlighted: shade(),
        lit,
        litHighlighted: shade([1.5, 2.2, 0]),
        probe: probe()
      })
    }
    doc.settings.analysis = 'preview'
    doc.settings.shadowHighlight = false
    const noMaterials = []
    doc.settings.materialResponse = false
    for (const boost of [1, 5]) {
      doc.settings.shadowBoost = boost
      update()
      noMaterials.push(shade())
    }
    doc.settings.materialResponse = true
    doc.settings.shadowHighlight = false
    weak.spec.lumens = 0
    update()
    const zeroOutput = shade()
    doc.settings.shadowHighlight = true
    update()
    const zeroOutputHighlight = shade()
    doc.settings.shadowHighlight = false
    weak.spec.lumens = 600
    weak.pattern = 'image'
    update()
    await e.projection.paint(doc, () => {})
    const blackMedia = shade()
    doc.settings.shadowHighlight = true
    update()
    const blackMediaHighlight = shade()
    doc.settings.shadowHighlight = false
    weak.pattern = 'white'
    doc.projectors = [weak]
    const fullyBlocked = []
    for (const boost of [1, 5]) {
      doc.settings.shadowBoost = boost
      update()
      fullyBlocked.push(shade())
    }
    doc.projectors = []
    update()
    const noProjectors = shade()
    return {
      original,
      boosted,
      highlighted,
      yellowMaterials,
      originalProbe,
      boostedProbe,
      analysis,
      noMaterials,
      zeroOutput,
      zeroOutputHighlight,
      blackMedia,
      blackMediaHighlight,
      fullyBlocked,
      noProjectors
    }
  })
  expect(samples.originalProbe.projectors.map((p: any) => p.occluded)).toEqual([true, false])
  expect(samples.original.shadow[0]).toBeGreaterThan(230)
  expect(samples.boosted.shadow[0]).toBeLessThan(samples.original.shadow[0] * 0.75)
  expect(samples.boosted.lit).toEqual(samples.original.lit)
  expect(samples.boosted.outside).toEqual(samples.original.outside)
  expect(samples.boostedProbe).toEqual(samples.originalProbe)
  expect(samples.highlighted.shadow).toEqual([255, 255, 0])
  expect(samples.highlighted.lit).toEqual(samples.original.lit)
  expect(samples.highlighted.outside).toEqual(samples.original.outside)
  for (const sample of samples.yellowMaterials) {
    expect(sample.mesh).toEqual([255, 255, 0])
    expect(sample.cloud).toEqual([255, 255, 0])
    expect(sample.splat).toEqual([255, 255, 0])
  }
  for (const sample of samples.analysis) {
    expect(sample.boosted.reduce((sum: number, v: number) => sum + v, 0)).toBeLessThan(
      sample.original.reduce((sum: number, v: number) => sum + v, 0)
    )
    expect(sample.highlighted).toEqual([255, 255, 0])
    expect(sample.litHighlighted).toEqual(sample.lit)
    expect(sample.probe.overlap).toBe(samples.originalProbe.overlap)
    expect(sample.probe.lux).toBe(samples.originalProbe.lux)
  }
  expect(samples.noMaterials[1][0]).toBeLessThan(samples.noMaterials[0][0] * 0.75)
  expect(samples.zeroOutput).toEqual(samples.original.shadow)
  expect(samples.zeroOutputHighlight).toEqual([255, 255, 0])
  expect(samples.blackMedia).toEqual(samples.original.shadow)
  expect(samples.blackMediaHighlight).toEqual([255, 255, 0])
  expect(samples.fullyBlocked[0]).toEqual([23, 23, 23])
  expect(samples.fullyBlocked[1][0]).toBeLessThan(2)
  expect(samples.noProjectors).toEqual([23, 23, 23])
  expect(errors).toEqual([])
})

test('overlap colors and CPU counts agree from zero to eight projectors and respect occlusion', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__TMP_VIEWPORT__?.projection.projectors.length)
  const results = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample, overlapPalette: palette } = await import(
      '/tests/browser/gpu-fixture.ts' as string
    )
    const doc = structuredClone(e.state.doc)
    const p = doc.projectors[0]
    doc.nodes = [doc.nodes[0]]
    doc.settings.analysis = 'overlap'
    doc.settings.shadowHighlight = false
    doc.settings.shadowBoost = 1
    const update = () => {
      e.state = { ...e.state, doc }
      e.sync()
      e.renderDepth()
    }
    const sample = (point: [number, number, number] = [0, 2.2, 0]) => {
      const surface = e.nodes.get(doc.nodes[0].id)
      const result = e.probe({
        point: surface.group.position.clone().fromArray(point),
        object: surface.group.children[0],
        face: { normal: surface.group.position.clone().set(0, 0, 1) }
      })
      return { count: result.overlap, color: gpuSample(e, point, [0, 0, 1]).slice(0, 3) }
    }
    const counts = []
    for (let count = 0; count <= 8; count++) {
      doc.projectors = Array.from({ length: count }, (_, index) => ({
        ...structuredClone(p),
        id: `overlap-${index}`
      }))
      update()
      counts.push(sample())
    }
    doc.projectors = doc.projectors.slice(0, 2)
    doc.projectors[0].transform.position[0] = -1
    doc.projectors[1].transform.position[0] = 1
    // Coverage counts all enabled footprints, regardless of selected projector, media or lumens.
    doc.settings.analysisProjector = doc.projectors[1].id
    doc.projectors[0].spec.lumens = 0
    doc.projectors[1].pattern = 'image'
    update()
    const geometric = sample()
    const outside = sample([5, 2.2, 0])
    const edge = sample([3.5, 2.2, 0])
    doc.projectors[0].enabled = false
    update()
    const disabled = sample()
    doc.projectors[0].enabled = true
    doc.projectors[0].extent = 3
    update()
    const beyondExtent = sample()
    doc.projectors[0].extent = 12
    doc.projectors[0].shift = [0.8, 0]
    update()
    const shiftedOut = sample()
    doc.projectors[0].shift = [0, 0]
    const { makeNode } = await import('/src/lib/store.ts' as string)
    const blocker = makeNode('box')
    blocker.transform.position = [-0.5, 2.2, 3]
    blocker.dimensions = [0.5, 1, 0.5]
    doc.nodes.push(blocker)
    update()
    const blocked = sample()
    const lit = sample([1.5, 2.2, 0])
    doc.projectors[1].transform.position[0] = -1
    update()
    const fullyBlocked = sample()
    const unreliable = gpuSample(e, [0, 2.2, 0], [0, 0, 1], 0).slice(0, 3)
    return {
      counts,
      palette,
      geometric,
      outside,
      edge,
      disabled,
      beyondExtent,
      shiftedOut,
      blocked,
      lit,
      fullyBlocked,
      unreliable
    }
  })
  const countSample = (count: number) => ({ count, color: results.palette[count] })
  expect(results.counts).toEqual(Array.from({ length: 9 }, (_, count) => countSample(count)))
  expect(results.geometric).toEqual(countSample(2))
  expect(results.outside).toEqual(countSample(0))
  for (const sample of [
    results.edge,
    results.disabled,
    results.beyondExtent,
    results.shiftedOut,
    results.blocked
  ])
    expect(sample).toEqual(countSample(1))
  expect(results.lit).toEqual(countSample(2))
  expect(results.fullyBlocked).toEqual(countSample(0))
  expect(results.unreliable).toEqual([46, 46, 54])
})

for (const [file, kind] of [
  ['cloud.ply', 'cloud'],
  ['gaussian.ply', 'splat']
] as const) {
  test(`shadow and overlap controls update ${kind} rendering`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto('/')
    await page.getByLabel('Import asset files').setInputFiles(path.resolve('public/samples', file))
    await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
    await expect(page.locator('.busy-toast')).toHaveCount(0)
    await expect(page.locator('.error-toast')).toHaveCount(0)
    const version = () =>
      page.evaluate(() => {
        const e = (window as any).__TMP_VIEWPORT__
        return [...e.nodes.values()].find((n: any) => n.splat)?.splat.mesh.version ?? 0
      })
    const before = await version()
    await page.getByLabel('Shadow boost', { exact: true }).fill('3')
    await page.getByLabel('Shadow boost', { exact: true }).press('Tab')
    if (kind === 'splat') await expect.poll(version).toBeGreaterThan(before)
    const boosted = await version()
    await page.getByLabel('Highlight projected shadows', { exact: true }).click()
    if (kind === 'splat') await expect.poll(version).toBeGreaterThan(boosted)
    const highlighted = await version()
    await page.getByRole('button', { name: 'Overlap', exact: true }).click()
    if (kind === 'splat') await expect.poll(version).toBeGreaterThan(highlighted)
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__TMP_VIEWPORT__.projection.uniforms.tmpMode.value)
      )
      .toBe(4)
    await page.locator('.viewport').screenshot()
    expect(errors).toEqual([])
  })
}
