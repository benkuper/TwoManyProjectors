import { test, expect } from '@playwright/test'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'

for (const file of ['mesh.ply', 'gaussian.ply'])
  test(`removes ${file} and all its copies with undo, save and recovery`, async ({
    page
  }, info) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__TMP_VIEWPORT__?.state.recovering === false)
    await page
      .getByLabel('Import asset files')
      .setInputFiles([file, 'triangle.glb'].map((name) => path.resolve('public/samples', name)))
    await page.getByRole('button', { name: 'Import 2 files', exact: true }).click()
    await expect(page.locator('.busy-toast')).toHaveCount(0)
    await page.getByLabel(`Add ${file} to scene`, { exact: true }).click()
    await expect(page.locator('.scene-list .receivers small')).toHaveText('6')
    await page.screenshot({ path: info.outputPath('asset-removal-button.png') })

    const remove = page.getByLabel(`Remove ${file} from library`, { exact: true })
    await remove.click()
    await expect(remove).toHaveCount(0)
    await expect(page.locator('.scene-list .receivers small')).toHaveText('4')
    await expect(page.getByLabel('Find triangle.glb in scene', { exact: true })).toBeVisible()
    await page.getByLabel('Undo', { exact: true }).click()
    await expect(remove).toBeVisible()
    await expect(page.locator('.scene-list .receivers small')).toHaveText('6')
    await page.getByLabel(`Find ${file} in scene`, { exact: true }).click()
    const restored = await page.evaluate(() => {
      const e = (window as any).__TMP_VIEWPORT__
      const node = e.state.doc.nodes.find((n: any) => n.id === e.state.selected)
      const runtime = e.nodes.get(node.id)
      let vertices = 0
      runtime.group.traverse((o: any) => {
        if (o.isMesh) vertices += o.geometry.getAttribute('position').count
      })
      return { splat: Boolean(runtime.splat), vertices }
    })
    if (file === 'gaussian.ply') expect(restored.splat).toBe(true)
    else expect(restored).toEqual({ splat: false, vertices: 3 })
    await page.getByLabel('Redo', { exact: true }).click()
    await expect(remove).toHaveCount(0)

    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save project', exact: true }).click()
    const saved = info.outputPath('removed-assets.tmp3d')
    await (await downloading).saveAs(saved)
    const entries = unzipSync(new Uint8Array(await readFile(saved)))
    const doc = JSON.parse(strFromU8(entries['scene.json']))
    expect(doc.assets.map((a: any) => a.name)).toEqual(['triangle.glb'])
    expect(Object.keys(entries).sort()).toEqual(['scene.json', ...doc.assets[0].files].sort())
    await page.evaluate(async () => {
      const { autosave } = await import('/src/lib/persistence.ts' as string)
      await autosave()
    })
    await page.reload()
    await page.waitForFunction(() => (window as any).__TMP_VIEWPORT__?.state.recovering === false)
    await expect(remove).toHaveCount(0)
    await expect(page.locator('.scene-list .receivers small')).toHaveText('4')
    await expect(page.getByLabel('Find triangle.glb in scene', { exact: true })).toBeVisible()
    await expect(page.locator('.error-toast')).toHaveCount(0)
    expect(errors).toEqual([])
  })

test('removes projection images from active and inactive versions with undo', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__TMP_VIEWPORT__?.state.recovering === false)
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import image', exact: true }).click()
  await (await choosing).setFiles(path.resolve('public/samples/white.png'))
  await expect(page.getByLabel('Image fit', { exact: true })).toBeVisible()
  await page.getByLabel('Duplicate version', { exact: true }).click()
  const remove = page.getByLabel('Remove white.png from library', { exact: true })
  await remove.click()
  await expect(remove).toHaveCount(0)
  await expect(page.getByLabel('Image fit', { exact: true })).toHaveCount(0)
  expect(
    await page.evaluate(() => {
      const { doc } = (window as any).__TMP_VIEWPORT__.state
      return [
        ...doc.projectors,
        ...doc.projectorVersions.items.flatMap((v: any) => v.projectors ?? [])
      ].every((p: any) => !p.imageId && p.pattern === 'grid')
    })
  ).toBe(true)
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(remove).toBeVisible()
  await expect(page.getByLabel('Image fit', { exact: true })).toBeVisible()
  await page.getByLabel('Redo', { exact: true }).click()
  await expect(remove).toHaveCount(0)
  await page.getByLabel('Projector version', { exact: true }).selectOption({ label: 'Version 01' })
  await expect(page.getByRole('button', { name: 'Use white.png', exact: true })).toHaveCount(0)
  await expect(page.locator('.error-toast')).toHaveCount(0)
})
