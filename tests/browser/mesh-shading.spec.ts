import { test, expect } from '@playwright/test'
import path from 'node:path'
import type { importedMeshSample } from './mesh-material-fixture'

for (const [format, files] of [
  ['GLB', ['two-tone.glb']],
  ['FBX', ['two-tone.fbx', 'white.png']]
] as const)
  test(`${format} retains material colors and slots through edits, undo, archive and recovery`, async ({
    page
  }, info) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto('/')
    await page
      .getByLabel('Import asset files')
      .setInputFiles(files.map((f) => path.resolve('public/samples', f)))
    await page
      .getByRole('button', {
        name: `Import ${files.length} ${files.length === 1 ? 'file' : 'files'}`,
        exact: true
      })
      .click()
    await expect(page.locator('.busy-toast')).toHaveCount(0)
    await expect(page.locator('.error-toast')).toHaveCount(0)
    await page.locator('.viewport-shading summary').click()
    await page.getByLabel('View shading', { exact: true }).selectOption('none')
    // Disable projectors to isolate source appearance from projected light.
    await page.getByLabel('Disable Projector 01', { exact: true }).click()
    const read = (): Promise<ReturnType<typeof importedMeshSample>> =>
      page.evaluate(async () => {
        const { importedMeshSample } = await import(
          '/tests/browser/mesh-material-fixture.ts' as string
        )
        return importedMeshSample((window as any).__TMP_VIEWPORT__)
      })
    const original = await read()
    expect(original.slots).toHaveLength(2)
    for (const slot of original.slots) {
      expect(slot.color).toEqual(slot.sourceColor)
      expect(slot.normals).toBe(true)
    }
    if (format === 'FBX') expect(original.slots[0].textured).toBe(true)
    const [red, green] = original.pixels
    expect(red[0]).toBeGreaterThan(red[1] * 4)
    expect(green[1]).toBeGreaterThan(green[0] * 4)
    // These pixel reads also verify automatic FBX centimetre conversion.
    expect(red[0]).toBeGreaterThan(100)
    expect(green[1]).toBeGreaterThan(100)
    await page.getByLabel('Surface color', { exact: true }).fill('#808080')
    const tinted = await read()
    expect(tinted.pixels[0][0]).toBeLessThan(red[0] * 0.3)
    expect(tinted.slots.map((s) => s.sourceColor)).toEqual(original.slots.map((s) => s.sourceColor))
    await page.getByLabel('Undo', { exact: true }).click()
    expect(await read()).toEqual(original)
    // Switching presets rebuilds every slot and restores the originals when undone.
    await page.getByLabel('Surface material', { exact: true }).selectOption('concrete')
    await expect(page.locator('.error-toast')).toHaveCount(0)
    await page.getByLabel('Undo', { exact: true }).click()
    expect(await read()).toEqual(original)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save project', exact: true }).click()
    const archive = info.outputPath('materials.tmp3d')
    await (await download).saveAs(archive)
    await page.getByLabel('Open project file').setInputFiles(archive)
    await expect(page.locator('.busy-toast')).toHaveCount(0)
    await page.getByRole('button', { name: 'two-tone', exact: true }).click()
    expect(await read()).toEqual(original)
    await page.reload()
    await page.getByRole('button', { name: 'two-tone', exact: true }).click()
    expect(await read()).toEqual(original)
    expect(errors).toEqual([])
  })

test('directional mesh shading changes with world direction without changing projector analysis or depth', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__TMP_VIEWPORT__?.state.recovering === false)
  await page.locator('.viewport-shading summary').click()
  const mode = page.getByLabel('View shading', { exact: true })
  await expect(mode).toHaveValue('directional')
  const setAngle = async (label: string, value: string) => {
    const field = page.getByLabel(label, { exact: true })
    await field.fill(value)
    await field.press('Tab')
  }
  await setAngle('Light elevation', '0')
  await setAngle('Light azimuth', '0')
  const sample = () =>
    page.evaluate(async () => {
      const e = (window as any).__TMP_VIEWPORT__,
        { receiverDisplaySample } = await import('/tests/browser/gpu-fixture.ts' as string)
      const pixel = receiverDisplaySample(e, [100, 2, 0], 'mesh')
      const doc = structuredClone(e.state.doc)
      doc.settings.analysis = 'lux'
      e.projection.update(doc, e.state.selectedIds, () => {})
      const analysis = receiverDisplaySample(e, [0, 2.2, 0], 'mesh')
      e.projection.update(e.state.doc, e.state.selectedIds, () => {})
      return {
        // Far outside projector footprints, facing +Z.
        pixel,
        analysis,
        depth: e.depthKey
      }
    })
  const lit = await sample()
  await setAngle('Light azimuth', '180')
  const unlit = await sample()
  expect(lit.pixel[0]).toBeGreaterThan(unlit.pixel[0] * 1.5)
  expect(unlit.analysis).toEqual(lit.analysis)
  expect(unlit.depth).toBe(lit.depth)
  await mode.selectOption('none')
  expect((await sample()).pixel).toEqual(lit.pixel)
  await mode.selectOption('projectors')
  expect((await sample()).pixel[0]).toBeLessThan(unlit.pixel[0])
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(mode).toHaveValue('none')
  await page.getByLabel('Redo', { exact: true }).click()
  await expect(mode).toHaveValue('projectors')
  await page.reload()
  await page.locator('.viewport-shading summary').click()
  await expect(mode).toHaveValue('projectors')
  await mode.selectOption('directional')
  await expect(page.getByLabel('Light azimuth', { exact: true })).toHaveValue('180')
  await expect(page.getByLabel('Light elevation', { exact: true })).toHaveValue('0')
})

test('FBX missing companion texture explains the problem without adding a receiver', async ({
  page
}) => {
  await page.goto('/')
  await page
    .getByLabel('Import asset files')
    .setInputFiles(path.resolve('public/samples/two-tone.fbx'))
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Missing companion file')
  await expect(page.locator('.scene-list .receivers small')).toHaveText('3')
})
