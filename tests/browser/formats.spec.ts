import { test, expect } from '@playwright/test'
import path from 'node:path'

for (const [label, files, kind] of [
  ['GLB', ['triangle.glb'], 'mesh'],
  ['glTF', ['triangle.gltf', 'triangle.bin'], 'mesh'],
  ['FBX + texture', ['two-tone.fbx', 'white.png'], 'mesh'],
  ['OBJ + MTL + texture', ['triangle.obj', 'triangle.mtl', 'white.png'], 'mesh'],
  ['STL', ['triangle.stl'], 'mesh'],
  ['mesh PLY', ['mesh.ply'], 'mesh'],
  ['cloud PLY', ['cloud.ply'], 'cloud'],
  ['PCD', ['cloud.pcd'], 'cloud'],
  ['XYZ', ['cloud.xyz'], 'cloud'],
  ['Gaussian PLY', ['gaussian.ply'], 'splat'],
  ['SPLAT', ['scan.splat'], 'splat'],
  ['SPZ', ['scan.spz'], 'splat']
] as const)
  test(`imports ${label} with local resources`, async ({ page }, testInfo) => {
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
    await expect(page.locator('.busy-toast')).toHaveCount(0, { timeout: 60000 })
    await expect(page.locator('.error-toast')).toHaveCount(0)
    await expect(page.locator('.asset-list')).toContainText(kind.toUpperCase())
    await expect(page.getByRole('button', { name: 'Two-point scale', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('import.png') })
    expect(errors).toEqual([])
  })

test('invalid files explain the problem and preserve the document', async ({ page }) => {
  await page.goto('/')
  await page
    .getByLabel('Import asset files')
    .setInputFiles(path.resolve('public/samples/malformed.ply'))
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid PLY header')
  await expect(page.getByRole('button', { name: 'Main screen', exact: true })).toBeVisible()
})

test('eight-projector cap retains disabled equipment and supports re-enabling', async ({
  page
}) => {
  await page.goto('/')
  for (let i = 0; i < 8; i++)
    await page.getByRole('button', { name: 'Add projector', exact: true }).click()
  await expect(
    page.locator('.scene-list .tree-row').filter({ has: page.locator('.lucide-sun') })
  ).toHaveCount(9)
  await page.getByLabel('Enable Projector 09', { exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Eight projectors')
  await page.getByLabel('Disable Projector 01', { exact: true }).click()
  await page.getByLabel('Enable Projector 09', { exact: true }).click()
  await expect(page.getByLabel('Disable Projector 09', { exact: true })).toBeVisible()
})
