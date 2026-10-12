import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'

async function ready(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
}

test('locking selected objects detaches handles and excludes them from group edits', async ({
  page
}) => {
  await ready(page)
  const before = await page.evaluate(() => {
    const { doc } = (window as any).__TMP_VIEWPORT__.state
    return [doc.projectors[0], doc.nodes[0]].map((o: any) => ({ id: o.id, transform: o.transform }))
  })
  await page
    .getByRole('button', { name: 'Main screen', exact: true })
    .click({ modifiers: ['Control'] })
  await page.getByLabel('Lock Main screen', { exact: true }).click()
  await expect(page.locator('.tree-row.selected')).toHaveCount(1)
  await page.getByLabel('Lock Projector 01', { exact: true }).click()
  await expect(page.locator('.tree-row.selected')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Main screen', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Projector 01', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.transform.object == null)).toBe(
    true
  )
  await page.keyboard.press('Control+a')
  await expect(page.locator('.tree-row.selected')).toHaveCount(2)
  await page.getByLabel('X', { exact: true }).fill('5')
  await page.getByLabel('X', { exact: true }).press('Tab')
  expect(
    await page.evaluate((before) => {
      const { doc } = (window as any).__TMP_VIEWPORT__.state
      return before.map(
        ({ id }) => [...doc.projectors, ...doc.nodes].find((o: any) => o.id === id).transform
      )
    }, before)
  ).toEqual(before.map((o: any) => o.transform))
  await page.getByLabel('Duplicate selected', { exact: true }).click()
  await expect(page.locator('.tree-row')).toHaveCount(6)
  await page.getByLabel('Delete selected', { exact: true }).click()
  await expect(page.locator('.tree-row')).toHaveCount(4)
  await page.getByLabel('Unlock Main screen', { exact: true }).click()
  await page.getByRole('button', { name: 'Main screen', exact: true }).click()
  await expect(page.getByLabel('Object name', { exact: true })).toHaveValue('Main screen')
})

test('viewport clicks skip locked objects and projectors while probes still sample locked surfaces', async ({
  page
}) => {
  await ready(page)
  await page.keyboard.press('Escape')
  const points = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      rect = e.renderer.domElement.getBoundingClientRect()
    return ['Test plinth', 'Projector 01'].map((name) => {
      const object = [...e.state.doc.nodes, ...e.state.doc.projectors].find(
        (o: any) => o.name === name
      )
      const group = e.nodes.get(object.id)?.group ?? e.projectors.get(object.id)
      const p = group.position.clone().set(0, 0, 'spec' in object ? 0.14 : 0)
      group.localToWorld(p)
      p.project(e.camera)
      return {
        id: object.id,
        name,
        x: rect.left + ((p.x + 1) * rect.width) / 2,
        y: rect.top + ((1 - p.y) * rect.height) / 2
      }
    })
  })
  for (const point of points) {
    await page.mouse.click(point.x, point.y)
    await expect(page.getByLabel('Object name', { exact: true })).toHaveValue(point.name)
    await page.getByLabel(`Lock ${point.name}`, { exact: true }).click()
    await page.keyboard.press('Escape')
    await page.mouse.click(point.x, point.y)
    expect(
      await page.evaluate(
        (id) => (window as any).__TMP_VIEWPORT__.state.selectedIds.includes(id),
        point.id
      )
    ).toBe(false)
    await page.keyboard.down('Control')
    await page.mouse.click(point.x, point.y)
    await page.keyboard.up('Control')
    expect(
      await page.evaluate(
        (id) => (window as any).__TMP_VIEWPORT__.state.selectedIds.includes(id),
        point.id
      )
    ).toBe(false)
    await page.keyboard.press('Escape')
  }
  await page.getByRole('button', { name: 'Probe', exact: true }).click()
  await page.mouse.click(points[0].x, points[0].y)
  expect(await page.evaluate(() => !!(window as any).__TMP_VIEWPORT__.state.probe)).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByLabel('Unlock Test plinth', { exact: true }).click()
  await page.mouse.click(points[0].x, points[0].y)
  await expect(page.getByLabel('Object name', { exact: true })).toHaveValue('Test plinth')
})

test('locks survive project save, open and recovery without selecting locked items', async ({
  page
}, info) => {
  await ready(page)
  const names = ['Projector 01', 'Main screen', 'Stage floor', 'Test plinth']
  for (const name of names) await page.getByLabel(`Lock ${name}`, { exact: true }).click()
  await page.screenshot({ path: info.outputPath('locked-scene.png') })
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const file = info.outputPath('locked.tmp3d')
  await (await downloading).saveAs(file)
  const entries = unzipSync(new Uint8Array(await readFile(file)))
  const doc = JSON.parse(strFromU8(entries['scene.json']))
  expect([...doc.projectors, ...doc.nodes].every((o: any) => o.locked)).toBe(true)
  await page.getByLabel('Unlock Projector 01', { exact: true }).click()
  await page.getByLabel('Open project file').setInputFiles(file)
  await expect(page.getByLabel('Unlock Projector 01', { exact: true })).toBeVisible()
  await expect(page.locator('.tree-row.selected')).toHaveCount(0)
  await page.reload()
  for (const name of names) {
    await expect(page.getByLabel(`Unlock ${name}`, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  }
  await page.keyboard.press('Control+a')
  await expect(page.locator('.tree-row.selected')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.transform.object == null)).toBe(
    true
  )
})
