import type { AssetKind } from './types'
export function classifyPLY(bytes: ArrayBuffer): AssetKind {
  const text = new TextDecoder().decode(bytes.slice(0, 65536)),
    end = text.indexOf('end_header')
  if (!text.startsWith('ply') || end < 0)
    throw new Error('Invalid PLY header (missing ply or end_header).')
  const header = text.slice(0, end)
  if (/property\s+\w+\s+(?:f_dc_0|scale_0|rot_0)\b/.test(header)) {
    if (!/\brot_0\b/.test(header) || !/\bscale_0\b/.test(header))
      throw new Error('Incomplete Gaussian PLY properties: rotation and scale are required.')
    return 'splat'
  }
  return /element\s+face\s+[1-9]\d*/.test(header) ? 'mesh' : 'cloud'
}
// Spark's decoder accepts binary Gaussian PLY. Normalize ASCII without dropping
// SH coefficients or covariance properties before handing the asset to Spark.
export function binaryGaussianPLY(bytes: ArrayBuffer): ArrayBuffer {
  // Binary scans can be hundreds of MB: only decode the header unless conversion is needed.
  const preview = new TextDecoder().decode(bytes.slice(0, 65536)),
    end = preview.indexOf('end_header'),
    header = preview.slice(0, end)
  if (!/format ascii 1\.0/.test(header)) return bytes
  const text = new TextDecoder().decode(bytes)
  const count = Number(header.match(/element vertex (\d+)/)?.[1])
  if (!count || count > 10000000) throw new Error('Invalid Gaussian PLY vertex count.')
  const props = [...header.matchAll(/^property (\w+) (\w+)\r?$/gm)]
  const types: Record<string, [number, string]> = {
    float: [4, 'setFloat32'],
    float32: [4, 'setFloat32'],
    double: [8, 'setFloat64'],
    float64: [8, 'setFloat64'],
    uchar: [1, 'setUint8'],
    uint8: [1, 'setUint8'],
    char: [1, 'setInt8'],
    int8: [1, 'setInt8'],
    ushort: [2, 'setUint16'],
    uint16: [2, 'setUint16'],
    short: [2, 'setInt16'],
    int16: [2, 'setInt16'],
    uint: [4, 'setUint32'],
    uint32: [4, 'setUint32'],
    int: [4, 'setInt32'],
    int32: [4, 'setInt32']
  }
  for (const prop of props)
    if (!types[prop[1]]) throw new Error(`Unsupported Gaussian PLY property type: ${prop[1]}`)
  const outputHeader = new TextEncoder().encode(
      header.replace('format ascii 1.0', 'format binary_little_endian 1.0') + 'end_header\n'
    ),
    stride = props.reduce((n, p) => n + types[p[1]][0], 0),
    output = new Uint8Array(outputHeader.length + stride * count)
  output.set(outputHeader)
  const view = new DataView(output.buffer)
  const rows = text
    .slice(end + 'end_header'.length)
    .trim()
    .split(/\r?\n/)
  if (rows.length < count) throw new Error('Gaussian PLY data is truncated.')
  let offset = outputHeader.length
  for (let i = 0; i < count; i++) {
    const values = rows[i].trim().split(/\s+/).map(Number)
    if (values.length !== props.length || values.some((v) => !Number.isFinite(v)))
      throw new Error(`Invalid Gaussian PLY vertex at row ${i + 1}.`)
    props.forEach((p, j) => {
      const [size, method] = types[p[1]]
      ;(view as any)[method](offset, values[j], true)
      offset += size
    })
  }
  return output.buffer
}
