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
  await expect(page.getByRole('button', { name: 'Replace mesh', exact: true })).toBeVisible()
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
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replace mesh', exact: true }).click()
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
  await expect(page.getByText('Replaced mesh · Undo to restore', { exact: true })).toBeVisible()
  const after = await snapshot(page)
  expect(after.node.assetId).not.toBe(before.node.assetId)
  expect(after.node).toEqual({ ...before.node, assetId: after.node.assetId })
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

test('replacing one instance leaves its copies unchanged and can load companion files', async ({
  page
}) => {
  await ready(page)
  const original = await snapshot(page)
  await page.keyboard.press('Control+d')
  const copy = await snapshot(page)
  await replace(page, ['triangle.obj', 'triangle.mtl', 'white.png'])
  const replaced = await snapshot(page)
  expect(replaced.node).toEqual({ ...copy.node, assetId: replaced.node.assetId })
  expect(replaced.asset.files).toHaveLength(3)
  expect(replaced.asset.name).toBe('triangle.obj')
  await page.getByRole('button', { name: 'mesh', exact: true }).click()
  const unchanged = await snapshot(page)
  expect(unchanged.node).toEqual(original.node)
  expect(unchanged.vertices).toBe(original.vertices)
  await page.getByLabel('Undo', { exact: true }).click()
  await page.getByRole('button', { name: 'mesh copy', exact: true }).click()
  expect((await snapshot(page)).node).toEqual(copy.node)
})

test('failed and non-mesh replacements preserve the model and undo history', async ({ page }) => {
  await ready(page)
  const before = await snapshot(page),
    revision = await page.evaluate(() => (window as any).__TMP_VIEWPORT__.state.revision)
  for (const [files, error] of [
    [['malformed.ply'], 'Invalid PLY header'],
    [['two-tone.fbx'], 'Missing companion file'],
    [['gaussian.ply'], 'Replacement must be a mesh'],
    [['triangle.glb', 'two-tone.glb'], 'Choose one replacement mesh']
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
