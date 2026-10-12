import { test, expect } from '@playwright/test'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'

test('calibration previews, cancels, applies around its anchor, and undoes', async ({ page }) => {
  await page.goto('/')
  await page
    .getByLabel('Import asset files')
    .setInputFiles(path.resolve('public/samples/triangle.glb'))
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  await page.getByLabel('Hide Main screen', { exact: true }).click()
  await page.getByLabel('X rotation', { exact: true }).fill('20')
  await page.getByLabel('X rotation', { exact: true }).press('Tab')
  await page.getByLabel('X scale', { exact: true }).fill('2')
  await page.getByLabel('X scale', { exact: true }).press('Tab')
  await page.getByLabel('Frame selection', { exact: true }).click()
  await page.getByRole('button', { name: 'Two-point scale', exact: true }).click()
  const points = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      r = e.nodes.get(e.state.selected),
      rect = e.renderer.domElement.getBoundingClientRect()
    return [
      [-0.4, 1.5, 0],
      [0.4, 1.5, 0]
    ].map((a) => {
      const p = r.group.position.clone().fromArray(a)
      r.group.localToWorld(p)
      p.project(e.camera)
      return {
        x: rect.left + ((p.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - p.y) / 2) * rect.height
      }
    })
  })
  for (const point of points) await page.mouse.click(point.x, point.y)
  await expect(page.getByLabel('Real distance', { exact: true })).toBeVisible()
  const before = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      g = e.nodes.get(e.state.selected).group,
      anchor = g.position.clone().fromArray(e.state.calibration[0]),
      local = g.worldToLocal(anchor.clone())
    return {
      anchor: anchor.toArray(),
      local: local.toArray(),
      position: g.position.toArray(),
      scale: g.scale.toArray(),
      rotation: g.quaternion.toArray()
    }
  })
  await page.getByLabel('Real distance', { exact: true }).fill('4')
  await page.getByLabel('Real distance', { exact: true }).press('Tab')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  const preview = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e.nodes.get(e.state.selected).group.scale.toArray()
  })
  expect(preview).not.toEqual(before.scale)
  await page.getByLabel('Cancel calibration', { exact: true }).click()
  const cancelled = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e.nodes.get(e.state.selected).group.scale.toArray()
  })
  expect(cancelled).toEqual(before.scale)
  await page.getByRole('button', { name: 'Two-point scale', exact: true }).click()
  for (const point of points) await page.mouse.click(point.x, point.y)
  await page.getByRole('button', { name: 'Apply scale', exact: true }).click()
  const after = await page.evaluate((before) => {
    const e = (window as any).__TMP_VIEWPORT__,
      g = e.nodes.get(e.state.selected).group,
      p = g.position.clone().fromArray(before.local)
    g.localToWorld(p)
    return { anchor: p.toArray(), rotation: g.quaternion.toArray(), scale: g.scale.toArray() }
  }, before)
  after.anchor.forEach((v: number, i: number) => expect(v).toBeCloseTo(before.anchor[i], 6))
  expect(after.rotation).toEqual(before.rotation)
  expect(after.scale).toEqual(preview)
  await page.getByLabel('Undo', { exact: true }).click()
  expect(
    await page.evaluate(() => {
      const e = (window as any).__TMP_VIEWPORT__
      return e.nodes.get(e.state.selected).group.scale.toArray()
    })
  ).toEqual(before.scale)
})

test('one completed transform is one undo command and pauses navigation', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  const isolation = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      t = e.transform
    t.dispatchEvent({ type: 'dragging-changed', value: true })
    const paused = !e.controls.enabled
    t.object.position.x = 1
    t.dispatchEvent({ type: 'objectChange' })
    t.object.position.x = 2
    t.dispatchEvent({ type: 'objectChange' })
    t.dispatchEvent({ type: 'dragging-changed', value: false })
    return { paused, resumed: e.controls.enabled, x: t.object.position.x }
  })
  expect(isolation).toEqual({ paused: true, resumed: true, x: 2 })
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('0')
  await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
})

test('ZIP round trip embeds original OBJ resources and projection image', async ({
  page
}, testInfo) => {
  await page.goto('/')
  await page
    .getByLabel('Import asset files')
    .setInputFiles(
      ['triangle.obj', 'triangle.mtl', 'white.png'].map((f) => path.resolve('public/samples', f))
    )
  await page.getByRole('button', { name: 'Import 3 files', exact: true }).click()
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  await page.getByRole('button', { name: 'Projector 01', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import image', exact: true }).click()
  await (await chooser).setFiles(path.resolve('public/samples/white.png'))
  await expect(page.getByLabel('Image fit', { exact: true })).toBeVisible()
  const promise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const download = await promise,
    file = testInfo.outputPath('assets.tmp3d')
  await download.saveAs(file)
  const entries = unzipSync(new Uint8Array(await readFile(file))),
    doc = JSON.parse(strFromU8(entries['scene.json']))
  expect(doc.assets).toHaveLength(2)
  for (const asset of doc.assets)
    for (const resource of asset.files) expect(entries[resource].length).toBeGreaterThan(0)
  await page.getByLabel('Open project file').setInputFiles(file)
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  await expect(page.locator('.error-toast')).toHaveCount(0)
  await expect(page.locator('.asset-list')).toContainText('triangle.obj')
  await expect(page.getByLabel('Image fit', { exact: true })).toBeVisible()
})

test('recovery restores after reload and malformed projects preserve current work', async ({
  page
}) => {
  await page.goto('/')
  await page.getByLabel('Project name', { exact: true }).fill('Recovery fixture')
  await page.getByLabel('Project name', { exact: true }).press('Tab')
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            new Promise((resolve) => {
              const r = indexedDB.open('twomanyprojectors', 1)
              r.onsuccess = () => {
                if (!r.result.objectStoreNames.contains('recovery')) {
                  r.result.close()
                  resolve(null)
                  return
                }
                const req = r.result.transaction('recovery').objectStore('recovery').get('latest')
                req.onsuccess = () => {
                  r.result.close()
                  resolve(req.result?.doc.name)
                }
              }
            })
        ),
      { timeout: 10000 }
    )
    .toBe('Recovery fixture')
  await page.reload()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Recovery fixture')
  await page.getByLabel('Output', { exact: true }).fill('6200')
  await page.getByLabel('Output', { exact: true }).press('Tab')
  await expect(page.getByLabel('Output', { exact: true })).toHaveValue('6200')
  await page.getByLabel('Open project file').setInputFiles({
    name: 'broken.tmp3d',
    mimeType: 'application/zip',
    buffer: Buffer.from('bad archive')
  })
  await expect(page.locator('.error-toast')).toBeVisible()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Recovery fixture')
})
