import { test, expect } from '@playwright/test'
import { catalogue, projectorForSpec } from '../../src/lib/catalogue'

for (const method of ['dropdown', 'copy'] as const) {
  for (const spec of [catalogue[0], catalogue[2]]) {
    test(`${method} restores custom lens limits after ${spec.model}`, async ({ page }) => {
      await page.goto('/')
      await page.waitForFunction(() => {
        const e = (window as any).__TMP_VIEWPORT__
        return e && !e.state.recovering && e.transform.object
      })
      const preset = page.getByLabel('Projector preset', { exact: true })
      const throwRatio = page.getByLabel('Throw ratio', { exact: true })
      const horizontal = page.getByLabel('Horizontal shift', { exact: true })
      const vertical = page.getByLabel('Vertical shift', { exact: true })
      await preset.selectOption(projectorForSpec(spec)!.id)
      await expect(throwRatio).toHaveAttribute('min', String(spec.throwRange[0]))
      await expect(page.getByLabel('Output', { exact: true })).toBeDisabled()

      if (method === 'dropdown') await preset.selectOption('custom')
      else await page.getByRole('button', { name: 'Make custom copy', exact: true }).click()

      await expect(page.getByLabel('Output', { exact: true })).toBeEnabled()
      await expect(page.getByLabel('Output', { exact: true })).toHaveValue(String(spec.lumens))
      await expect(page.getByLabel('Native width', { exact: true })).toHaveValue('1920')
      await expect(page.getByLabel('Native height', { exact: true })).toHaveValue('1200')
      for (const value of ['0.3', '5']) {
        await throwRatio.fill(value)
        await throwRatio.press('Tab')
        await expect(throwRatio).toHaveValue(value)
      }
      // Both axes use custom limits; the manufacturer's asymmetric polygon is gone.
      await horizontal.fill('-50')
      await horizontal.press('Tab')
      await expect(horizontal).toHaveValue('-50')
      await horizontal.fill('0')
      await horizontal.press('Tab')
      await vertical.fill('-50')
      await vertical.press('Tab')
      await expect(vertical).toHaveValue('-50')
      await expect(page.locator('.source-note')).toHaveCount(0)

      await preset.selectOption(projectorForSpec(spec)!.id)
      await expect(throwRatio).toHaveAttribute('min', String(spec.throwRange[0]))
      await expect(throwRatio).toHaveValue(String(spec.throwRange[0]))
      await expect(horizontal).toHaveValue('0')
      await expect(vertical).toHaveValue('0')
      await expect(page.getByLabel('Output', { exact: true })).toBeDisabled()
    })
  }
}

test('projector and compatible lens selections update optics, remain independent, and save', async ({
  page
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
  const projector = page.getByLabel('Projector preset', { exact: true })
  const lens = page.getByRole('combobox', { name: 'Lens', exact: true })
  const ratio = page.getByLabel('Throw ratio', { exact: true })
  const horizontal = page.getByLabel('Horizontal shift', { exact: true })
  const vertical = page.getByLabel('Vertical shift', { exact: true })
  const output = page.getByLabel('Output', { exact: true })
  await expect(projector.locator('option')).toHaveCount(6)
  await projector.selectOption({ label: 'Epson EB-PU2220B' })
  await expect(lens).toHaveValue('ELPLM15')
  await expect(ratio).toHaveAttribute('min', '1.57')
  await expect(ratio).toHaveAttribute('max', '2.56')
  await expect(output).toHaveValue('20000')
  await expect(page.getByLabel('Native width', { exact: true })).toHaveValue('1920')
  await expect(page.getByLabel('Native height', { exact: true })).toHaveValue('1200')
  await horizontal.fill('18')
  await horizontal.press('Tab')
  await lens.selectOption('ELPLU03S')
  await expect(projector).toHaveValue('epson-eb-pu2220b')
  await expect(ratio).toHaveValue('0.57')
  await expect(ratio).toHaveAttribute('min', '0.48')
  await expect(horizontal).toHaveValue('10')
  await expect(vertical).toHaveAttribute('max', '24')
  await expect(output).toHaveValue('17400')
  // The same physical lens has different optics on a different panel size.
  await projector.selectOption({ label: 'Epson EB-PU1008B' })
  await expect(lens).toHaveValue('ELPLU03S')
  await expect(ratio).toHaveAttribute('min', '0.65')
  await expect(ratio).toHaveAttribute('max', '0.78')
  await expect(output).toHaveValue('7300')
  await projector.selectOption({ label: 'Panasonic PT-RZ990' })
  await expect(lens).toHaveValue('ET-DLE150')
  await expect(lens.locator('option')).toHaveCount(3)
  await expect(lens.locator('option')).toHaveText([
    'ET-DLE150 · 1.3–1.89:1',
    'ET-DLE170 · 1.71–2.41:1',
    'ET-DLE250 · 2.27–3.62:1'
  ])
  await lens.selectOption('ET-DLE250')
  await expect(ratio).toHaveValue('2.27')
  await expect(output).toHaveValue('9400')
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(lens).toHaveValue('ET-DLE150')
  await page.getByLabel('Redo', { exact: true }).click()
  await expect(lens).toHaveValue('ET-DLE250')
  await page.getByRole('button', { name: 'Add projector', exact: true }).click()
  await projector.selectOption({ label: 'Epson EB-PU2220B' })
  await expect(lens).toHaveValue('ELPLM15')
  await page.getByRole('button', { name: 'Projector 01', exact: true }).click()
  await expect(projector).toHaveValue('panasonic-pt-rz990')
  await expect(lens).toHaveValue('ET-DLE250')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const file = info.outputPath('equipment.tmp3d')
  await (await downloaded).saveAs(file)
  await lens.selectOption('ET-DLE170')
  await page.getByLabel('Open project file').setInputFiles(file)
  await expect(page.getByText('Project opened', { exact: true })).toBeVisible()
  await expect(projector).toHaveValue('panasonic-pt-rz990')
  await expect(lens).toHaveValue('ET-DLE250')
  await page.getByRole('button', { name: 'Projector 02', exact: true }).click()
  await expect(projector).toHaveValue('epson-eb-pu2220b')
  await expect(lens).toHaveValue('ELPLM15')
  await page.screenshot({ path: info.outputPath('projector-and-lens.png') })
  expect(errors).toEqual([])
})

test('custom projector exposes editable lens limits and preserves them on reload', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
  const edit = async (label: string, value: string) => {
    const field = page.getByLabel(label, { exact: true })
    await field.fill(value)
    await field.press('Tab')
    await expect(field).toHaveValue(value)
  }
  await edit('Manufacturer', 'My manufacturer')
  await edit('Model', 'My projector')
  await edit('Lens', 'My lens')
  await edit('Output', '18000')
  await edit('Native width', '3840')
  await edit('Native height', '2160')
  await edit('Minimum throw ratio', '0.05')
  await edit('Maximum throw ratio', '14')
  await edit('Horizontal shift limit', '150')
  await edit('Vertical shift limit', '200')
  await page.getByLabel('Combined shift limits', { exact: true }).selectOption('rectangle')
  await edit('Throw ratio', '8')
  await edit('Horizontal shift', '120')
  await edit('Vertical shift', '180')
  await page.reload()
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
  for (const [label, value] of [
    ['Manufacturer', 'My manufacturer'],
    ['Model', 'My projector'],
    ['Lens', 'My lens'],
    ['Output', '18000'],
    ['Native width', '3840'],
    ['Native height', '2160'],
    ['Minimum throw ratio', '0.05'],
    ['Maximum throw ratio', '14'],
    ['Horizontal shift limit', '150'],
    ['Vertical shift limit', '200'],
    ['Throw ratio', '8'],
    ['Horizontal shift', '120'],
    ['Vertical shift', '180']
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value)
  await expect(page.getByLabel('Combined shift limits', { exact: true })).toHaveValue('rectangle')
  await edit('Maximum throw ratio', '6')
  await expect(page.getByLabel('Throw ratio', { exact: true })).toHaveValue('6')
  await edit('Horizontal shift limit', '50')
  await expect(page.getByLabel('Horizontal shift', { exact: true })).toHaveValue('50')
  await edit('Vertical shift limit', '0')
  await expect(page.getByLabel('Vertical shift', { exact: true })).toHaveValue('0')
  await expect(page.locator('.source-note')).toHaveCount(0)
})
