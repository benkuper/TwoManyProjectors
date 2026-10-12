export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export type AssetKind = 'mesh' | 'cloud' | 'splat'
export interface Transform {
  position: Vec3
  rotation: Quat
  scale: Vec3
}
export interface SurfaceMaterial {
  preset: 'white' | 'concrete' | 'metal' | 'glass' | 'captured'
  color: string
  reflectance: number
  roughness: number
  transmission: number
}
export interface AssetRecord {
  id: string
  name: string
  kind: AssetKind | 'image'
  files: string[]
  primary: string
  units: 'm' | 'cm' | 'mm' | 'ft'
  upAxis: 'y' | 'z'
  normals: 'imported' | 'estimated' | 'unavailable'
  originalBytes: number
}
export interface SceneNode {
  id: string
  name: string
  kind: 'plane' | 'box' | 'cylinder' | AssetKind
  transform: Transform
  visible: boolean
  locked: boolean
  material: SurfaceMaterial
  assetId?: string
  dimensions: Vec3
}
export type Pattern = 'grid' | 'checker' | 'crosshair' | 'alignment' | 'bars' | 'white' | 'image'
export interface ProjectorSpec {
  id: string
  manufacturer: string
  model: string
  lens: string
  resolution: [number, number]
  lumens: number
  throwRange: [number, number]
  shift: {
    horizontal: number
    vertical: number
    coupled: 'diamond' | 'ellipse' | 'rectangle'
    polygon?: [number, number][]
    note: string
  }
  sources: string[]
  verified: string
}
export interface ProjectorConfig {
  id: string
  name: string
  transform: Transform
  enabled: boolean
  locked: boolean
  spec: ProjectorSpec
  throwRatio: number
  shift: [number, number]
  multiplier: number
  pattern: Pattern
  nativePixelPreview: boolean
  patternCellSize: number
  imageId?: string
  imageFit: 'contain' | 'cover' | 'stretch'
  color: string
  showOutline: boolean
  showVolume: boolean
  /** Legacy per-projector value, retained when reading older projects. */
  volumeOpacity?: number
  extent: number
}
export type AnalysisMode = 'preview' | 'lux' | 'density' | 'distortion'
export interface SceneDocument {
  format: 'TwoManyProjectors'
  version: 1
  id: string
  name: string
  nodes: SceneNode[]
  projectors: ProjectorConfig[]
  assets: AssetRecord[]
  settings: {
    materialResponse: boolean
    analysis: AnalysisMode
    analysisProjector: string | 'all'
    range: [number, number]
    grid: boolean
    snap: boolean
    volumeOpacity: number
    outlineOpacity: number
  }
  modified: string
}
export interface AnalysisSample {
  point: Vec3
  normal: Vec3 | null
  confidence: 'mesh' | 'estimated' | 'unavailable'
  lux: number | null
  density: [number, number] | null
  millimetresPerPixel: [number, number] | null
  distortion: number | null
  luminance: number | null
  projectors: { id: string; lux: number; occluded: boolean }[]
}
export const identity = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1]
})
export const materials: Record<SurfaceMaterial['preset'], SurfaceMaterial> = {
  white: { preset: 'white', color: '#e7e7e3', reflectance: 0.85, roughness: 0.9, transmission: 0 },
  concrete: {
    preset: 'concrete',
    color: '#8c8e90',
    reflectance: 0.4,
    roughness: 1,
    transmission: 0
  },
  metal: { preset: 'metal', color: '#515760', reflectance: 0.12, roughness: 0.3, transmission: 0 },
  glass: {
    preset: 'glass',
    color: '#b5d6dc',
    reflectance: 0.08,
    roughness: 0.08,
    transmission: 0.8
  },
  captured: {
    preset: 'captured',
    color: '#ffffff',
    reflectance: 0.5,
    roughness: 1,
    transmission: 0
  }
}
