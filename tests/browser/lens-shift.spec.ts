import { test, expect, type Page } from '@playwright/test'

async function ready(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
}

async function envelopeOwners(page: Page) {
  return page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e.state.doc.projectors
      .filter((p: any) => e.projectors.get(p.id).getObjectByName('lens-shift-envelope'))
      .map((p: any) => p.name)
  })
}

async function envelopeGeometry(page: Page) {
  return page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    const group = e.projectors.get(e.state.selected)
    const envelope = group.getObjectByName('lens-shift-envelope')
    const outline = envelope.children.find((o: any) => o.isLineSegments)
    outline.geometry.computeBoundingBox()
    return {
      positions: Array.from(outline.geometry.attributes.position.array),
      min: outline.geometry.boundingBox.min.toArray(),
      max: outline.geometry.boundingBox.max.toArray(),
      dashed: outline.material.isLineDashedMaterial,
      helperLayer: envelope.children.every((o: any) => o.layers.mask === 2),
      followsProjector: envelope.parent === e.transform.object
    }
  })
}

test('only the selected enabled projector shows its lens-shift envelope', async ({ page }) => {
  await ready(page)
  expect(await envelopeOwners(page)).toEqual(['Projector 01'])
  await expect(page.getByText('Lens-shift reach', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Main screen', exact: true }).click()
  expect(await envelopeOwners(page)).toEqual([])
  await expect(page.getByText('Lens-shift reach', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Projector 01', exact: true }).click()
  await page.getByRole('button', { name: 'Add projector', exact: true }).click()
  const name = await page.getByLabel('Object name').inputValue()
  expect(await envelopeOwners(page)).toEqual([name])
  await page.keyboard.press('Escape')
  expect(await envelopeOwners(page)).toEqual([])
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: `Disable ${name}`, exact: true }).click()
  expect(await envelopeOwners(page)).toEqual([])
  await page.getByRole('button', { name: `Enable ${name}`, exact: true }).click()
  expect(await envelopeOwners(page)).toEqual([name])
})

test('reach follows optics and transforms, stays fixed during shift, and respects visibility', async ({
  page
}, info) => {
  await ready(page)
  const initial = await envelopeGeometry(page)
  expect(initial).toMatchObject({
    min: [-12, -7.5, -12],
    max: [12, 7.5, 0],
    dashed: true,
    helperLayer: true,
    followsProjector: true
  })
  await page.getByLabel('Horizontal shift', { exact: true }).fill('25')
  await page.getByLabel('Horizontal shift', { exact: true }).press('Tab')
  expect((await envelopeGeometry(page)).positions).toEqual(initial.positions)
  expect(
    await page.evaluate(
      () => (window as any).__TMP_VIEWPORT__.projection.uniforms.tmpOptics.value[0].z
    )
  ).toBe(0.25)
  await page.screenshot({ path: info.outputPath('lens-shift-reach.png'), fullPage: true })

  await page.getByLabel('Throw ratio', { exact: true }).fill('2')
  await page.getByLabel('Throw ratio', { exact: true }).press('Tab')
  expect((await envelopeGeometry(page)).min).toEqual([-6, -3.75, -12])
  await page.getByLabel('Maximum extent', { exact: true }).fill('8')
  await page.getByLabel('Maximum extent', { exact: true }).press('Tab')
  expect((await envelopeGeometry(page)).min).toEqual([-4, -2.5, -8])
  await page.getByLabel('X', { exact: true }).fill('2')
  await page.getByLabel('Y rotation', { exact: true }).fill('30')
  await page.getByLabel('Y rotation', { exact: true }).press('Tab')
  expect((await envelopeGeometry(page)).followsProjector).toBe(true)
  expect((await envelopeGeometry(page)).min).toEqual([-4, -2.5, -8])

  await page.getByLabel('Outline', { exact: true }).uncheck()
  expect(
    await page.evaluate(() => {
      const e = (window as any).__TMP_VIEWPORT__
      return e.projectors
        .get(e.state.selected)
        .getObjectByName('lens-shift-envelope')
        .children.map((o: any) => o.type)
    })
  ).toEqual(['Mesh'])
  await page.getByLabel('Filled volume', { exact: true }).uncheck()
  expect(await envelopeOwners(page)).toEqual([])
  await page.getByLabel('Outline', { exact: true }).check()
  expect(await envelopeOwners(page)).toEqual(['Projector 01'])
  await expect(page.locator('.error-toast')).toHaveCount(0)
})
