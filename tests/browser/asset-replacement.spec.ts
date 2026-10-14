import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'

const sample = (name: string) => path.resolve('public/samples', name)

async function ready(page: Page) {
  await page.goto('/')
  await page.getByLabel('Import asset files').setInputFiles(sample('mesh.ply'))
  await page.getByLabel('File units', { exact: true }).selectOption('cm')
  await page.getByLabel('Up axis', { exact: true }).selectOption('z')
  await page.getByLabel('Flip X axis', { exact: true }).check()
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Replace mesh.ply', exact: true })).toBeVisible()
}

const snapshot = (page: Page) =>
  page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      node = e.state.doc.nodes.find((n: any) => n.id === e.state.selected),
      runtime = e.nodes.get(node.id)
    let vertices = 0
    runtime.group.traverse((o: any) => {
      if (o.isMesh) vertices += o.geometry.getAttribute('position').count
    })
    return {
      node,
      asset: e.state.doc.assets.find((a: any) => a.id === node.assetId),
      nodes: e.state.doc.nodes.length,
      vertices,
      selected: e.state.selected,
      camera: e.camera.position.toArray(),
      target: e.controls.target.toArray(),
      frame: e.state.frame,
      depth: e.depthKey
    }
  })

async function replace(page: Page, files: string[]) {
  const { asset } = await snapshot(page)
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: `Replace ${asset.name}`, exact: true }).click()
  await (await choosing).setFiles(files.map(sample))
  await expect(page.locator('.busy-toast')).toHaveCount(0)
}

test('replacement preserves identity, placement, appearance and import axes with undo, archive and recovery', async ({
  page
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await ready(page)
  await page.getByLabel('Object name', { exact: true }).fill('Backdrop')
  await page.getByLabel('Object name', { exact: true }).press('Tab')
  for (const [field, value] of [
    ['X', '4'],
    ['Y', '2'],
    ['Z', '-3'],
    ['Y rotation', '35'],
    ['X scale', '2'],
    ['Y scale', '3'],
    ['Z scale', '4'],
    ['Color boost', '1.7']
  ]) {
    await page.getByLabel(field, { exact: true }).fill(value)
    await page.getByLabel(field, { exact: true }).press('Tab')
  }
  await page.getByLabel('Surface color', { exact: true }).fill('#8080ff')
  await page.getByLabel('Import surface texture').setInputFiles(sample('white.png'))
  await expect(page.getByLabel('Surface texture', { exact: true })).not.toHaveValue('')
  const before = await snapshot(page)
  await replace(page, ['two-tone.glb'])
  await expect(page.getByText('Replaced asset · Undo to restore', { exact: true })).toBeVisible()
  const after = await snapshot(page)
  expect(after.node).toEqual(before.node)
  expect(after.asset.id).toBe(before.asset.id)
  expect(after.asset.primary).not.toBe(before.asset.primary)
  expect(after.asset).toMatchObject({
    name: 'two-tone.glb',
    units: 'cm',
    upAxis: 'z',
    flipAxes: [true, false, false]
  })
  expect(after.vertices).toBe(6)
  expect(before.vertices).toBe(3)
  expect(after.nodes).toBe(before.nodes)
  expect(after.selected).toBe(before.selected)
  expect(after.camera).toEqual(before.camera)
  expect(after.target).toEqual(before.target)
  expect(after.frame).toBe(before.frame)
  expect(after.depth).not.toBe(before.depth)
  await expect(page.getByLabel('Find mesh.ply in scene', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('replace-mesh.png') })
  await page.getByLabel('Undo', { exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await page.getByLabel('Redo', { exact: true }).click()
  expect(await snapshot(page)).toEqual(after)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const archive = info.outputPath('replaced.tmp3d')
  await (await downloading).saveAs(archive)
  const entries = unzipSync(new Uint8Array(await readFile(archive))),
    doc = JSON.parse(strFromU8(entries['scene.json']))
  expect(doc.assets.map((a: any) => a.name).sort()).toEqual(['two-tone.glb', 'white.png'])
  expect(Object.keys(entries)).not.toContain(before.asset.primary)
  expect(Buffer.from(entries[after.asset.primary])).toEqual(await readFile(sample('two-tone.glb')))
  await page.getByLabel('Open project file').setInputFiles(archive)
  await expect(page.getByText('Project opened', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Backdrop', exact: true }).click()
  let restored = await snapshot(page)
  expect(restored.node).toEqual(JSON.parse(JSON.stringify(after.node)))
  expect(restored.asset).toEqual(after.asset)
  expect(restored.vertices).toBe(6)
  await page.reload()
  await page.getByRole('button', { name: 'Backdrop', exact: true }).click()
  restored = await snapshot(page)
  expect(restored.node).toEqual(JSON.parse(JSON.stringify(after.node)))
  expect(restored.vertices).toBe(6)
  await expect(page.locator('.error-toast')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('replacing a library asset updates all instances and can load companion files', async ({
  page
}) => {
  await ready(page)
  const original = await snapshot(page)
  await page.keyboard.press('Control+d')
  const copy = await snapshot(page)
  await replace(page, ['triangle.obj', 'triangle.mtl', 'white.png'])
  const replaced = await snapshot(page)
  expect(replaced.node).toEqual(copy.node)
  expect(replaced.asset.files).toHaveLength(3)
  expect(replaced.asset.name).toBe('triangle.obj')
  await page.getByRole('button', { name: 'mesh', exact: true }).click()
  const unchanged = await snapshot(page)
  expect(unchanged.node).toEqual(original.node)
  expect(unchanged.asset).toEqual(replaced.asset)
  expect(unchanged.vertices).toBe(original.vertices)
  await page.getByLabel('Undo', { exact: true }).click()
  await page.getByRole('button', { name: 'mesh copy', exact: true }).click()
  expect((await snapshot(page)).node).toEqual(copy.node)
  expect((await snapshot(page)).asset).toEqual(original.asset)
})

test('failed and incompatible replacements preserve the asset and undo history', async ({
  page
}) => {
  await ready(page)
  const before = await snapshot(page),
    revision = await page.evaluate(() => (window as any).__TMP_VIEWPORT__.state.revision)
  for (const [files, error] of [
    [['malformed.ply'], 'Invalid PLY header'],
    [['two-tone.fbx'], 'Missing companion file'],
    [['gaussian.ply'], 'Replacement must be a mesh'],
    [['triangle.glb', 'two-tone.glb'], 'Choose one replacement asset']
  ] as const) {
    await replace(page, [...files])
    await expect(page.locator('.error-toast')).toContainText(error)
    expect(await snapshot(page)).toEqual(before)
    expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.state.revision)).toBe(
      revision
    )
  }
  await replace(page, ['two-tone.glb'])
  await expect(page.locator('.error-toast')).toHaveCount(0)
  expect((await snapshot(page)).vertices).toBe(6)
})

for (const name of ['gaussian.ply', 'cloud.ply']) {
  test(`library replaces ${name} with a new version of the same filename for every instance`, async ({
    page
  }, info) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await page.getByLabel('Import asset files').setInputFiles(sample(name))
    await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
    await expect(page.getByLabel(`Replace ${name}`, { exact: true })).toBeVisible()
    await page.getByLabel('X', { exact: true }).fill('3')
    await page.getByLabel('X', { exact: true }).press('Tab')
    if (name === 'gaussian.ply') {
      await page.getByLabel('Splat size', { exact: true }).fill('1.8')
      await page.getByLabel('Splat size', { exact: true }).press('Tab')
    }
    await page.getByRole('button', { name: name.replace('.ply', ''), exact: true }).click()
    await page.keyboard.press('Control+d')
    await page.getByLabel('X', { exact: true }).fill('8')
    await page.getByLabel('X', { exact: true }).press('Tab')
    const read = () =>
      page.evaluate(async () => {
        const { runtimeAssets } = await import('/src/lib/assets.ts' as string),
          e = (window as any).__TMP_VIEWPORT__,
          record = e.state.doc.assets[0],
          asset = runtimeAssets.get(record.id),
          nodes = e.state.doc.nodes.filter((n: any) => n.assetId === record.id),
          geometry = asset.proxy?.geometry ?? asset.root.children[0].geometry
        return {
          record,
          nodes,
          root: asset.root.uuid,
          minX: geometry.boundingBox.min.x,
          sourcesMatch: nodes.every((n: any) => {
            const runtime = e.nodes.get(n.id)
            return (
              runtime.key.includes(asset.root.uuid) &&
              (!runtime.splat ||
                runtime.splat.mesh.packedSplats === asset.root.children[0].packedSplats)
            )
          })
        }
      })
    const before = await read(),
      text = await readFile(sample(name), 'utf8'),
      updated = Buffer.from(text.replace('-1.0 1.0 0', '-2.0 1.0 0'))
    expect(before.nodes).toHaveLength(2)
    await page.screenshot({ path: info.outputPath('asset-library-replace.png') })
    const chooser = page.waitForEvent('filechooser')
    await page.getByLabel(`Replace ${name}`, { exact: true }).click()
    await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer: updated })
    await expect(page.getByText('Replaced asset · Undo to restore', { exact: true })).toBeVisible()
    const after = await read()
    expect(after.nodes).toEqual(before.nodes)
    expect(after.record.id).toBe(before.record.id)
    expect(after.record.name).toBe(name)
    expect(after.record.primary).not.toBe(before.record.primary)
    expect(after.root).not.toBe(before.root)
    expect(after.sourcesMatch).toBe(true)
    expect(after.minX).toBe(-2)
    await expect(page.locator('.asset-row')).toHaveCount(1)
    await page.getByLabel('Undo', { exact: true }).click()
    expect(await read()).toEqual(before)
    await page.getByLabel('Redo', { exact: true }).click()
    expect(await read()).toEqual(after)
    await page.evaluate(async () => {
      const { autosave } = await import('/src/lib/persistence.ts' as string)
      await autosave()
    })
    await page.reload()
    await expect(page.getByLabel(`Replace ${name}`, { exact: true })).toBeVisible()
    const restored = await read()
    expect(restored.record).toEqual(after.record)
    expect(restored.nodes).toEqual(after.nodes)
    expect(restored.minX).toBe(-2)
    expect(restored.sourcesMatch).toBe(true)
    expect(errors).toEqual([])
  })
}

test('library replacement works without scene instances and blocks locked instances', async ({
  page
}) => {
  await ready(page)
  await page.getByLabel('Lock mesh', { exact: true }).click()
  await expect(page.getByLabel('Replace mesh.ply', { exact: true })).toBeDisabled()
  await page.getByLabel('Unlock mesh', { exact: true }).click()
  await page.getByRole('button', { name: 'mesh', exact: true }).click()
  await page.keyboard.press('Delete')
  await expect(page.getByLabel('Replace mesh.ply', { exact: true })).toBeEnabled()
  const chooser = page.waitForEvent('filechooser')
  await page.getByLabel('Replace mesh.ply', { exact: true }).click()
  await (await chooser).setFiles(sample('two-tone.glb'))
  await expect(page.getByLabel('Replace two-tone.glb', { exact: true })).toBeVisible()
  await expect(page.locator('.scene-list .receivers small')).toHaveText('3')
  await page.getByLabel('Add two-tone.glb to scene', { exact: true }).click()
  expect((await snapshot(page)).vertices).toBe(6)
})
