import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

async function ready(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__TMP_VIEWPORT__?.state.recovering === false)
}
async function create(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('New project name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(name)
}
async function browse(page: Page) {
  await page.getByRole('button', { name: 'Local projects', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Saved local projects' })).toBeVisible()
}

test('creates empty projects, searches and switches with edits and original assets intact', async ({
  page
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await ready(page)
  await page.getByLabel('Project name', { exact: true }).fill('Gallery installation')
  await page
    .getByLabel('Import asset files')
    .setInputFiles(path.resolve('public/samples/triangle.glb'))
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  await page.getByLabel('X', { exact: true }).fill('3.75')
  await create(page, 'Empty studio')
  await expect(page.locator('.scene-list .tree-row')).toHaveCount(0)
  await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
  await expect(page.locator('.asset-item')).toHaveCount(0)

  await browse(page)
  await expect(
    page.getByRole('list', { name: 'Saved local projects' }).getByRole('listitem')
  ).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('local-projects.png'), fullPage: true })
  await page.getByLabel('Search local projects').fill('gAlLeRy')
  await expect(page.getByRole('button', { name: 'Open Empty studio', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open Gallery installation', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'triangle', exact: true }).click()
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('3.75')
  await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const download = await downloadPromise
  await download.saveAs(testInfo.outputPath('gallery.tmp3d'))
  expect(await download.failure()).toBeNull()

  await page.reload()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Gallery installation')
  await page.getByRole('button', { name: 'triangle', exact: true }).click()
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('3.75')
  await browse(page)
  await page.getByRole('button', { name: 'Open Empty studio', exact: true }).click()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Empty studio')
  await expect(page.locator('.scene-list .tree-row')).toHaveCount(0)
  // Opening an archive also preserves the project that was open beforehand.
  await page.getByLabel('Open project file').setInputFiles(testInfo.outputPath('gallery.tmp3d'))
  await expect(page.getByText('Project opened', { exact: true })).toBeVisible()
  await browse(page)
  await expect(
    page.getByRole('list', { name: 'Saved local projects' }).getByRole('listitem')
  ).toHaveCount(2)
  await expect(page.locator('.error-toast')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('deletes only the chosen project and its files, and keeps the active project', async ({
  page
}) => {
  await ready(page)
  await page.getByLabel('Project name', { exact: true }).fill('Disposable project')
  await page
    .getByLabel('Import asset files')
    .setInputFiles(path.resolve('public/samples/triangle.glb'))
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  await create(page, 'Keep this project')
  await browse(page)
  await expect(
    page.getByRole('button', { name: 'Delete Keep this project', exact: true })
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Delete Disposable project', exact: true }).click()
  await page.getByRole('button', { name: 'Keep project', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Open Disposable project', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Delete Disposable project', exact: true }).click()
  await page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Open Disposable project', exact: true })
  ).toHaveCount(0)
  expect(
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('twomanyprojectors', 2)
        request.onsuccess = () => resolve(request.result)
      })
      const count = await new Promise<number>((resolve) => {
        const request = db.transaction('projectFiles').objectStore('projectFiles').count()
        request.onsuccess = () => resolve(request.result)
      })
      db.close()
      return count
    })
  ).toBe(0)
  await page.getByLabel('Close local projects').click()
  await page.reload()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Keep this project')
  await browse(page)
  await expect(
    page.getByRole('list', { name: 'Saved local projects' }).getByRole('listitem')
  ).toHaveCount(1)
})

for (const inline of [false, true]) {
  test(`migrates the previous autosave with ${inline ? 'inline' : 'separate'} imported files and its latest checkpoint`, async ({
    page
  }) => {
    // A static page gives us the app's origin without starting the editor or its autosave.
    await page.goto('/samples/mesh.ply')
    await page.evaluate(async (inline) => {
      const { sampleDocument, makeNode } = await import('/src/lib/store.ts' as string)
      const doc = sampleDocument()
      doc.name = 'Legacy studio'
      const file = new File(
        [await (await fetch('/samples/triangle.glb')).arrayBuffer()],
        'triangle.glb'
      )
      const assetId = crypto.randomUUID()
      const assetPath = `assets/${assetId}/triangle.glb`
      doc.assets.push({
        id: assetId,
        name: 'triangle.glb',
        kind: 'mesh',
        files: [assetPath],
        primary: assetPath,
        units: 'm',
        upAxis: 'y',
        normals: 'imported',
        originalBytes: file.size
      })
      const node = makeNode('mesh')
      node.name = 'Legacy triangle'
      node.assetId = assetId
      doc.nodes.push(node)
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('twomanyprojectors', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('recovery')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('recovery', 'readwrite')
        const store = tx.objectStore('recovery')
        store.put(inline ? { doc, files: [[assetPath, file]] } : { doc }, 'latest')
        if (!inline) store.put(file, `file:${assetPath}`)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
      doc.name = 'Latest legacy edit'
      node.transform.position[0] = 4.25
      localStorage.setItem('twomanyprojectors.latest', JSON.stringify(doc))
    }, inline)
    await ready(page)
    await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Latest legacy edit')
    await page.getByRole('button', { name: 'Legacy triangle', exact: true }).click()
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('4.25')
    await create(page, 'New after upgrade')
    await browse(page)
    await page.getByRole('button', { name: 'Open Latest legacy edit', exact: true }).click()
    await page.getByRole('button', { name: 'Legacy triangle', exact: true }).click()
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('4.25')
    await expect(page.locator('.error-toast')).toHaveCount(0)
  })
}

test('isolates matching asset paths and restores files after rapid deletion and undo', async ({
  page
}) => {
  await ready(page)
  expect(
    await page.evaluate(async () => {
      const { exerciseFileIsolation } = await import('/tests/browser/project-fixture.ts' as string)
      return exerciseFileIsolation()
    })
  ).toEqual({ firstFile: 'first.png', secondFile: 'second.png', assets: 1 })
  await expect(page.locator('.error-toast')).toHaveCount(0)
})

test('a failed save keeps the current project and reports the failure in the dialog', async ({
  page
}) => {
  await ready(page)
  await page.getByLabel('Project name', { exact: true }).fill('Still here')
  await page.getByLabel('Project name', { exact: true }).press('Tab')
  await page.evaluate(async () => {
    const { autosave } = await import('/src/lib/persistence.ts' as string)
    await autosave()
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
      if (args[1] === 'readwrite')
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      return transaction.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('New project name', { exact: true }).fill('Cannot save')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Storage quota exceeded')
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Still here')
  await page.getByLabel('Close local projects').click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})
