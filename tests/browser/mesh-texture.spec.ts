import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import type { importedMeshSample } from './mesh-material-fixture'

async function textureFile(page: Page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 16
    const context = canvas.getContext('2d')!
    context.fillStyle = '#8080ff'
    context.fillRect(0, 0, 16, 16)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return {
    name: 'custom-texture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(encoded, 'base64')
  }
}

for (const [format, files] of [
  ['GLB', ['two-tone.glb']],
  ['FBX', ['two-tone.fbx', 'white.png']]
] as const)
  test(`${format} custom textures render on every slot, restore originals, and survive archive and recovery`, async ({
    page
  }, info) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await page
      .getByLabel('Import asset files')
      .setInputFiles(files.map((file) => path.resolve('public/samples', file)))
    await page
      .getByRole('button', {
        name: `Import ${files.length} ${files.length === 1 ? 'file' : 'files'}`,
        exact: true
      })
      .click()
    await expect(page.getByLabel('Surface texture', { exact: true })).toBeVisible()
    await page.locator('.viewport-shading summary').click()
    await page.getByLabel('View shading', { exact: true }).selectOption('none')
    await page.getByLabel('Disable Projector 01', { exact: true }).click()
    const read = (): Promise<ReturnType<typeof importedMeshSample>> =>
      page.evaluate(async () => {
        const { importedMeshSample } = await import(
          '/tests/browser/mesh-material-fixture.ts' as string
        )
        return importedMeshSample((window as any).__TMP_VIEWPORT__)
      })
    const original = await read(),
      image = await textureFile(page),
      picker = page.getByLabel('Surface texture', { exact: true })
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import texture', exact: true }).click()
    await (await chooser).setFiles(image)
    await expect(picker).not.toHaveValue('')
    const textureId = await picker.inputValue(),
      textured = await read()
    expect(textured.slots).toHaveLength(2)
    for (const [i, slot] of textured.slots.entries()) {
      expect(slot.textured).toBe(true)
      expect(slot.color).toEqual([1, 1, 1])
      expect(slot.sourceColor).toEqual(original.slots[i].sourceColor)
    }
    for (const pixel of textured.pixels) {
      expect(pixel[0]).toBeGreaterThanOrEqual(54)
      expect(pixel[0]).toBeLessThanOrEqual(56)
      expect(pixel[2]).toBe(255)
    }
    await picker.selectOption('')
    expect(await read()).toEqual(original)
    await page.getByLabel('Undo', { exact: true }).click()
    await expect(picker).toHaveValue(textureId)
    expect(await read()).toEqual(textured)

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save project', exact: true }).click()
    const archive = info.outputPath('textured.tmp3d')
    await (await download).saveAs(archive)
    const entries = unzipSync(new Uint8Array(await readFile(archive))),
      document = JSON.parse(strFromU8(entries['scene.json'])),
      asset = document.assets.find((asset: any) => asset.id === textureId)
    expect(document.nodes.find((node: any) => node.name === 'two-tone').textureId).toBe(textureId)
    expect(Buffer.from(entries[asset.primary])).toEqual(image.buffer)
    await picker.selectOption('')
    await page.getByLabel('Open project file').setInputFiles(archive)
    await expect(page.getByText('Project opened', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'two-tone', exact: true }).click()
    await expect(picker).toHaveValue(textureId)
    expect(await read()).toEqual(textured)
    await page.reload()
    await page.getByRole('button', { name: 'two-tone', exact: true }).click()
    await expect(picker).toHaveValue(textureId)
    expect(await read()).toEqual(textured)
    await expect(page.locator('.error-toast')).toHaveCount(0)
    expect(errors).toEqual([])
  })

test('primitives reuse textures, preserve projection depth, and undo library removal', async ({
  page
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Main screen', exact: true }).click()
  const before = await page.evaluate(() => (window as any).__TMP_VIEWPORT__.depthKey)
  await page.getByLabel('Import surface texture').setInputFiles(await textureFile(page))
  const picker = page.getByLabel('Surface texture', { exact: true })
  await expect(picker).not.toHaveValue('')
  const textureId = await picker.inputValue()
  expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.depthKey)).toBe(before)
  for (const kind of ['Plane', 'Box', 'Cylinder']) {
    await page.getByLabel('Add receiver', { exact: true }).click()
    await page.getByRole('button', { name: kind, exact: true }).click()
    await picker.selectOption(textureId)
    expect(
      await page.evaluate(() => {
        const engine = (window as any).__TMP_VIEWPORT__
        const root = engine.nodes.get(engine.state.selected).group
        return root.children[0].material.map?.colorSpace
      })
    ).toBe('srgb')
  }
  await page.getByLabel('Remove custom-texture.png from library', { exact: true }).click()
  await expect(picker).toHaveValue('')
  const texturedCount = () =>
    page.evaluate(
      () =>
        (window as any).__TMP_VIEWPORT__.state.doc.nodes.filter((node: any) => node.textureId)
          .length
    )
  expect(await texturedCount()).toBe(0)
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(picker).toHaveValue(textureId)
  expect(await texturedCount()).toBe(4)
})

test('invalid image imports preserve the current texture and document', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Main screen', exact: true }).click()
  await page.getByLabel('Import surface texture').setInputFiles(await textureFile(page))
  const picker = page.getByLabel('Surface texture', { exact: true })
  await expect(picker).not.toHaveValue('')
  const textureId = await picker.inputValue()
  await page.getByLabel('Import surface texture').setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('invalid image')
  })
  await expect(page.locator('.error-toast')).toContainText('Could not decode broken.png')
  await expect(picker).toHaveValue(textureId)
  await expect(page.locator('.asset-row')).toHaveCount(1)
})
