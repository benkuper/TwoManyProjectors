import type { ProjectorSpec } from './types'

const verified = '2026-10-12'
const epsonSpecifications =
  'https://files.support.epson.com/pdf/specs/specifications_ebpu2010series_en_r106.pdf'
const epson2220Specifications =
  'https://files.support.epson.com/pdf/specs/specifications_ebpu2220series_en_r103.pdf'
const panasonicCatalogue =
  'https://docs.connect.panasonic.com/projector/download/catalog/pdf/PT_RZ990_S_2P_ctlg_Eng_PC.pdf'
const panasonicManual =
  'https://eu.connect.panasonic.com/sites/default/files/media/document/2025-01/rz990_manual_en.pdf'

// Shift coordinates are image-center displacement / full image width or height.
// Positive x is right and positive y is up, viewed toward the screen. Vertices
// are counterclockwise. These polygons transcribe the manufacturer diagrams;
// they take precedence over the independent extrema and the fallback shape.
const epsonShift: ProjectorSpec['shift'] = {
  horizontal: 0.3,
  vertical: 0.67,
  coupled: 'diamond',
  polygon: [
    [-0.3, 0.19],
    [-0.3, -0.19],
    [0, -0.67],
    [0.3, -0.19],
    [0.3, 0.19],
    [0, 0.67]
  ],
  note: 'Full-image fractions. Epson specifications p.75: vertical ±67%; at horizontal ±30%, vertical is limited to ±19%. Coupled polygon enforced. Normal-mode output with ELPLM08.'
}

const panasonicShift: ProjectorSpec['shift'] = {
  horizontal: 0.3,
  vertical: 0.5,
  coupled: 'diamond',
  polygon: [
    [-0.1, 0],
    [0, -0.16],
    [0.3, 0],
    [0.1, 0.5],
    [-0.1, 0.5]
  ],
  note: 'Full-image fractions. Manual p.77, floor installation: horizontal −10% to +30%, vertical −16% to +50%; coupled polygon enforced. Lumens are normal-mode standard-lens output (p.239); actual output varies with lens.'
}

const epson2220Shift: ProjectorSpec['shift'] = {
  horizontal: 0.18,
  vertical: 0.6,
  coupled: 'diamond',
  polygon: [
    [-0.18, 0.32],
    [-0.18, -0.32],
    [0, -0.6],
    [0.18, -0.32],
    [0.18, 0.32],
    [0, 0.6]
  ],
  note: 'Full-image fractions. Epson specifications pp.11–12: vertical ±60%; at horizontal ±18%, vertical is limited to ±32%. Coupled polygon enforced. Lens-specific normal-mode output at 220–240 V (pp.9–10); native WUXGA, with 4K enhancement.'
}

const epson2220ShortShift: ProjectorSpec['shift'] = {
  horizontal: 0.1,
  vertical: 0.24,
  coupled: 'diamond',
  note: 'Full-image fractions. Epson specifications p.12: vertical ±24%, horizontal ±10%; no vertical shift at maximum horizontal shift. Lens-specific output at 220–240 V (pp.9–10), including automatic brightness limits for ELPLU03, ELPLW05 and ELPLM08.'
}

function epson(
  model: string,
  lumens: number,
  lens = 'ELPLM08',
  throwRange: [number, number] = [1.44, 2.32],
  shift = epsonShift,
  specifications = epsonSpecifications
): ProjectorSpec {
  return {
    id: `epson-${model.toLowerCase()}-${lens.toLowerCase()}`,
    manufacturer: 'Epson',
    model,
    lens,
    resolution: [1920, 1200],
    lumens,
    throwRange,
    shift: structuredClone(shift),
    sources: [specifications],
    verified
  }
}

function panasonic(
  model: string,
  lumens: number,
  lens: string,
  throwRange: [number, number]
): ProjectorSpec {
  return {
    id: `panasonic-${model.toLowerCase()}-${lens.toLowerCase()}`,
    manufacturer: 'Panasonic',
    model,
    lens,
    resolution: [1920, 1200],
    lumens,
    throwRange,
    shift: structuredClone(panasonicShift),
    sources: [panasonicCatalogue, panasonicManual],
    verified
  }
}

export const catalogue: ProjectorSpec[] = [
  epson('EB-PU1007B', 7000),
  epson('EB-PU1008B', 8500),
  panasonic('PT-RZ790', 7000, 'ET-DLE150', [1.3, 1.89]),
  panasonic('PT-RZ790', 7000, 'ET-DLE170', [1.71, 2.41]),
  panasonic('PT-RZ790', 7000, 'ET-DLE250', [2.27, 3.62]),
  panasonic('PT-RZ990', 9400, 'ET-DLE150', [1.3, 1.89]),
  panasonic('PT-RZ990', 9400, 'ET-DLE170', [1.71, 2.41]),
  panasonic('PT-RZ990', 9400, 'ET-DLE250', [2.27, 3.62]),
  // Conventional interchangeable lenses; mirrored UST optics are not simulated.
  ...(['EB-PU1007B', 'EB-PU1008B'] as const).flatMap((model, i) =>
    (
      [
        ['ELPLU03S', [0.65, 0.78], [6000, 7300]],
        ['ELPLU04', [0.87, 1.05], [6300, 7700]],
        ['ELPLW05', [1.04, 1.46], [6100, 7400]],
        ['ELPLW06', [1.62, 2.22], [6600, 8100]],
        ['ELPLW08', [1.18, 1.66], [6000, 7200]],
        ['ELPLM15', [2.16, 3.48], [6900, 8400]],
        ['ELPLM10', [3.32, 5.06], [6800, 8300]],
        ['ELPLM11', [4.85, 7.38], [6600, 8000]],
        ['ELPLL08', [7.21, 10.11], [6600, 8000]]
      ] satisfies [string, [number, number], [number, number]][]
    ).map(([lens, range, output]) =>
      epson(model, output[i], lens, range, {
        ...epsonShift,
        note: 'Full-image fractions. Epson specifications p.75: vertical ±67%; at horizontal ±30%, vertical is limited to ±19%. Coupled polygon enforced. Lens-specific normal-mode output (p.9); WUXGA throw ranges (pp.32–33).'
      })
    )
  ),
  ...(
    [
      ['ELPLM15', [1.57, 2.56], 20000, epson2220Shift],
      ['ELPLU03S', [0.48, 0.57], 17400, epson2220ShortShift],
      ['ELPLU04', [0.64, 0.77], 19000, epson2220Shift],
      ['ELPLW08', [0.86, 1.21], 19100, epson2220Shift],
      ['ELPLW06', [1.19, 1.62], 19200, epson2220Shift],
      ['ELPLM10', [2.42, 3.71], 19900, epson2220Shift],
      ['ELPLM11', [3.54, 5.41], 19000, epson2220Shift],
      ['ELPLL08', [5.27, 7.41], 19000, epson2220Shift],
      ['ELPLU03', [0.48, 0.57], 11700, epson2220ShortShift],
      ['ELPLW05', [0.77, 1.07], 11700, epson2220ShortShift],
      ['ELPLM08', [1.06, 1.69], 10000, epson2220ShortShift],
      ['ELPLM09', [1.57, 2.56], 12000, epson2220Shift]
    ] satisfies [string, [number, number], number, ProjectorSpec['shift']][]
  ).map(([lens, range, output, shift]) =>
    epson('EB-PU2220B', output, lens, range, shift, epson2220Specifications)
  )
]

export interface ProjectorModel {
  id: string
  manufacturer: string
  model: string
  /** First entry is the default lens. Keep resolved snapshots for v1 documents. */
  lenses: ProjectorSpec[]
}

export const projectorCatalogue: ProjectorModel[] = []
for (const spec of catalogue) {
  let projector = projectorCatalogue.find(
    (p) => p.manufacturer === spec.manufacturer && p.model === spec.model
  )
  if (!projector) {
    projector = {
      id: `${spec.manufacturer}-${spec.model}`.toLowerCase(),
      manufacturer: spec.manufacturer,
      model: spec.model,
      lenses: []
    }
    projectorCatalogue.push(projector)
  }
  projector.lenses.push(spec)
}

/** Resolve both new selections and older projects without replacing saved optics. */
export function projectorForSpec(spec: ProjectorSpec): ProjectorModel | undefined {
  if (spec.id === 'custom') return undefined
  return projectorCatalogue.find(
    (p) => p.manufacturer === spec.manufacturer && p.model === spec.model
  )
}

export const customSpec: ProjectorSpec = {
  id: 'custom',
  manufacturer: 'Custom',
  model: 'Custom projector',
  lens: 'Conventional lens',
  resolution: [1920, 1200],
  lumens: 6000,
  throwRange: [0.3, 5],
  shift: {
    horizontal: 0.5,
    vertical: 0.5,
    coupled: 'diamond',
    note: 'Editable planning values. Shift uses full-image fractions with a conservative diamond constraint; these are not manufacturer specifications.'
  },
  sources: [],
  verified: 'custom'
}

export function makeCustomSpec(spec: ProjectorSpec): ProjectorSpec {
  return {
    ...structuredClone(spec),
    id: 'custom',
    throwRange: [
      Math.min(customSpec.throwRange[0], spec.throwRange[0]),
      Math.max(customSpec.throwRange[1], spec.throwRange[1])
    ],
    shift: structuredClone(customSpec.shift),
    sources: [],
    verified: 'custom'
  }
}
