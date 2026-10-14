import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import type { importedMeshSample } from './mesh-material-fixture'

async function importMesh(page: Page, files: string[]) {
  await page
    .getByLabel('Import asset files')
    .setInputFiles(files.map((file) => path.resolve('public/samples', file)))
}

const readMaterial = (page: Page): Promise<ReturnType<typeof importedMeshSample>> =>
  page.evaluate(async () => {
    const { importedMeshSample } = await import('/tests/browser/mesh-material-fixture.ts' as string)
    return importedMeshSample((window as any).__TMP_VIEWPORT__)
  })

for (const [format, files] of [
  ['GLB', ['two-tone.glb']],
  ['FBX', ['two-tone.fbx', 'white.png']]
] as const) {
  test(`${format} color boost and uniform color affect every slot and preserve original appearance`, async ({
    page
  }, info) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await importMesh(page, [...files])
    await page
      .getByRole('button', {
        name: `Import ${files.length} ${files.length === 1 ? 'file' : 'files'}`,
        exact: true
      })
      .click()
    await expect(page.getByLabel('Color boost', { exact: true })).toBeVisible()
    await page.locator('.viewport-shading summary').click()
    await page.getByLabel('View shading', { exact: true }).selectOption('none')
    await page.getByLabel('Disable Projector 01', { exact: true }).click()
    await page.getByLabel('Surface color', { exact: true }).fill('#808080')
    const original = await readMaterial(page),
      depth = await page.evaluate(() => (window as any).__TMP_VIEWPORT__.depthKey)
    await page.getByLabel('Color boost', { exact: true }).fill('2')
    await page.getByLabel('Color boost', { exact: true }).press('Tab')
    const boosted = await readMaterial(page)
    boosted.slots.forEach((slot, i) => {
      slot.color.forEach((value, axis) =>
        expect(value).toBeCloseTo(original.slots[i].color[axis] * 2, 8)
      )
      expect(slot.sourceColor).toEqual(original.slots[i].sourceColor)
    })
    expect(boosted.pixels[0][0]).toBeGreaterThan(original.pixels[0][0] * 1.8)
    await page.getByLabel('Force uniform color', { exact: true }).check()
    const uniform = await readMaterial(page)
    expect(uniform.slots[0].color).toEqual(uniform.slots[1].color)
    expect(uniform.pixels[0]).toEqual(uniform.pixels[1])
    expect(uniform.slots.every((slot) => !slot.textured)).toBe(true)
    expect(uniform.slots.map((slot) => slot.sourceColor)).toEqual(
      original.slots.map((slot) => slot.sourceColor)
    )
    await expect(page.getByLabel('Surface texture', { exact: true })).toBeDisabled()
    await page.screenshot({ path: info.outputPath('mesh-material-options.png') })
    expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.depthKey)).toBe(depth)
    await page.getByLabel('Undo', { exact: true }).click()
    expect(await readMaterial(page)).toEqual(boosted)
    await page.getByLabel('Undo', { exact: true }).click()
    expect(await readMaterial(page)).toEqual(original)
    await page.getByLabel('Redo', { exact: true }).click()
    await page.getByLabel('Redo', { exact: true }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save project', exact: true }).click()
    const archive = info.outputPath('mesh-options.tmp3d')
    await (await download).saveAs(archive)
    await page.getByLabel('Force uniform color', { exact: true }).uncheck()
    await page.getByLabel('Open project file').setInputFiles(archive)
    await expect(page.getByText('Project opened', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'two-tone', exact: true }).click()
    expect(await readMaterial(page)).toEqual(uniform)
    await page.reload()
    await page.getByRole('button', { name: 'two-tone', exact: true }).click()
    await expect(page.getByLabel('Color boost', { exact: true })).toHaveValue('2')
    await expect(page.getByLabel('Force uniform color', { exact: true })).toBeChecked()
    expect(await readMaterial(page)).toEqual(uniform)
    expect(errors).toEqual([])
  })
}

test('uniform color overrides mesh vertex colors and restores them when disabled', async ({
  page
}) => {
  await page.goto('/')
  await page.getByLabel('Import asset files').setInputFiles({
    name: 'colored.ply',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(`ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 1
property list uchar int vertex_indices
end_header
-1 1 0 255 0 0
1 1 0 0 255 0
0 3 0 0 0 255
3 0 1 2
`)
  })
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.getByLabel('Force uniform color', { exact: true })).toBeVisible()
  const vertexColors = () =>
    page.evaluate(() => {
      const e = (window as any).__TMP_VIEWPORT__
      const values: boolean[] = []
      e.nodes.get(e.state.selected).group.traverse((o: any) => {
        if (o.isMesh) values.push(o.material.vertexColors)
      })
      return values
    })
  expect(await vertexColors()).toEqual([true])
  await page.getByLabel('Force uniform color', { exact: true }).check()
  expect(await vertexColors()).toEqual([false])
  await page.getByLabel('Force uniform color', { exact: true }).uncheck()
  expect(await vertexColors()).toEqual([true])
})

for (const flip of ['X', 'Y', 'Z', 'XZ']) {
  test(`import flips ${flip} source axes before Z-up conversion, and survives recovery`, async ({
    page
  }, info) => {
    await page.goto('/')
    await importMesh(page, ['triangle.glb'])
    await page.getByLabel('Up axis', { exact: true }).selectOption('z')
    await page.getByLabel('File units', { exact: true }).selectOption('cm')
    for (const axis of flip) await page.getByLabel(`Flip ${axis} axis`, { exact: true }).check()
    await page.screenshot({ path: info.outputPath('mesh-import-options.png') })
    await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
    await expect(page.getByRole('button', { name: 'triangle', exact: true })).toBeVisible()
    const read = () =>
      page.evaluate(async () => {
        const { runtimeAssets } = await import('/src/lib/assets.ts' as string),
          e = (window as any).__TMP_VIEWPORT__,
          node = e.state.doc.nodes.find((n: any) => n.id === e.state.selected),
          asset = runtimeAssets.get(node.assetId)
        asset.root.updateMatrixWorld(true)
        return {
          flips: asset.record.flipAxes,
          scale: node.transform.scale,
          point: asset.root.localToWorld(asset.root.position.clone().set(1, 2, 3)).toArray(),
          depthScale: e.nodes.get(node.id).depth.children[0].scale.toArray()
        }
      })
    const result = await read(),
      sign = (axis: string) => (flip.includes(axis) ? -1 : 1)
    expect(result.flips).toEqual(['X', 'Y', 'Z'].map((axis) => flip.includes(axis)))
    expect(result.scale).toEqual([1, 1, 1])
    const expectedPoint = [sign('X') * 0.01, sign('Z') * 0.03, -sign('Y') * 0.02]
    result.point.forEach((value: number, i: number) => expect(value).toBeCloseTo(expectedPoint[i], 8))
    expect(result.depthScale).toEqual(['X', 'Y', 'Z'].map((axis) => sign(axis) * 0.01))
    await page.reload()
    await page.getByRole('button', { name: 'triangle', exact: true }).click()
    expect(await read()).toEqual(result)
  })
}
