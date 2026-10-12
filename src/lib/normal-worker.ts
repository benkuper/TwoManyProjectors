// Spatially indexed local PCA. Confidence gates prevent sparse/volumetric scans
// from masquerading as measured surfaces. Runs off the UI thread.
export function estimateNormals(positions: Float32Array) {
  const count = positions.length / 3,
    normals = new Float32Array(positions.length),
    confidence = new Float32Array(count)
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i])
    maxX = Math.max(maxX, positions[i])
    minY = Math.min(minY, positions[i + 1])
    maxY = Math.max(maxY, positions[i + 1])
    minZ = Math.min(minZ, positions[i + 2])
    maxZ = Math.max(maxZ, positions[i + 2])
  }
  const cell = Math.max(
    1e-5,
    (Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / Math.cbrt(Math.max(count, 1))) * 2
  )
  const buckets = new Map<string, number[]>(),
    key = (x: number, y: number, z: number) => `${x},${y},${z}`
  for (let i = 0; i < count; i++) {
    const k = key(
      Math.floor(positions[i * 3] / cell),
      Math.floor(positions[i * 3 + 1] / cell),
      Math.floor(positions[i * 3 + 2] / cell)
    )
    const b = buckets.get(k)
    if (b) b.push(i)
    else buckets.set(k, [i])
  }
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2],
      cx = Math.floor(x / cell),
      cy = Math.floor(y / cell),
      cz = Math.floor(z / cell),
      near: { i: number; d: number }[] = []
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const bucket = buckets.get(key(cx + a, cy + b, cz + c))
          if (bucket) {
            const stride = Math.max(1, Math.floor(bucket.length / 128))
            for (let j = 0; j < bucket.length; j += stride) {
              const index = bucket[j]
              if (index !== i)
                near.push({
                  i: index,
                  d:
                    (positions[index * 3] - x) ** 2 +
                    (positions[index * 3 + 1] - y) ** 2 +
                    (positions[index * 3 + 2] - z) ** 2
                })
            }
          }
        }
    near.sort((a, b) => a.d - b.d)
    near.length = Math.min(16, near.length)
    if (near.length < 6) continue
    const mean = [0, 0, 0]
    for (const v of near)
      for (let j = 0; j < 3; j++) mean[j] += positions[v.i * 3 + j] / near.length
    const m = Array.from({ length: 3 }, () => [0, 0, 0]),
      eigen = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ]
    for (const v of near) {
      const d = [
        positions[v.i * 3] - mean[0],
        positions[v.i * 3 + 1] - mean[1],
        positions[v.i * 3 + 2] - mean[2]
      ]
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a][b] += d[a] * d[b]
    }
    for (let iteration = 0; iteration < 12; iteration++) {
      let p = 0,
        q = 1
      for (let a = 0; a < 3; a++)
        for (let b = a + 1; b < 3; b++)
          if (Math.abs(m[a][b]) > Math.abs(m[p][q])) {
            p = a
            q = b
          }
      if (Math.abs(m[p][q]) < 1e-14) break
      const angle = 0.5 * Math.atan2(2 * m[p][q], m[q][q] - m[p][p]),
        co = Math.cos(angle),
        si = Math.sin(angle)
      const app = m[p][p],
        aqq = m[q][q],
        apq = m[p][q]
      for (let k = 0; k < 3; k++) {
        if (k !== p && k !== q) {
          const kp = m[k][p],
            kq = m[k][q]
          m[k][p] = m[p][k] = co * kp - si * kq
          m[k][q] = m[q][k] = si * kp + co * kq
        }
        const ep = eigen[k][p],
          eq = eigen[k][q]
        eigen[k][p] = co * ep - si * eq
        eigen[k][q] = si * ep + co * eq
      }
      m[p][p] = co * co * app - 2 * si * co * apq + si * si * aqq
      m[q][q] = si * si * app + 2 * si * co * apq + co * co * aqq
      m[p][q] = m[q][p] = 0
    }
    const order = [0, 1, 2].sort((a, b) => m[a][a] - m[b][b]),
      lo = order[0],
      mid = order[1],
      hi = order[2]
    if (m[mid][mid] < 1e-12 || m[lo][lo] / m[mid][mid] > 0.12 || m[mid][mid] / m[hi][hi] < 0.04)
      continue
    for (let k = 0; k < 3; k++) normals[i * 3 + k] = eigen[k][lo]
    confidence[i] = 1
  }
  return { normals, confidence }
}
if (typeof self !== 'undefined' && typeof document === 'undefined')
  self.onmessage = (event: MessageEvent<Float32Array>) => {
    const result = estimateNormals(event.data)
    self.postMessage(result, { transfer: [result.normals.buffer, result.confidence.buffer] })
  }
