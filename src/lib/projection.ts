import {
  CanvasTexture,
  Color,
  DoubleSide,
  Matrix4,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Material,
  type IUniform,
  type Texture
} from 'three'
import { dyno, type GsplatModifier } from '@sparkjsdev/spark'
import { projectorCamera } from './optics'
import { originalFiles } from './assets'
import { CameraInputs } from './camera-inputs'
import { analysisProjectors } from './analysis'
import {
  luxBandColors,
  luxTargetColors,
  overlapColors,
  type ProjectorConfig,
  type SceneDocument,
  type SurfaceMaterial
} from './types'

const glslColor = (hex: string) =>
  `vec3(${new Color(hex).toArray().map((v) => v.toFixed(8)).join(',')})`

// Same ray/plane Jacobian as pixelFootprint() in optics.ts. Native resolution
// remains independent of the preview/depth atlas resolution.
export const projectionGLSL = `
uniform int tmpCount;
uniform mat4 tmpMatrices[8];
uniform vec3 tmpOrigins[8];
uniform vec3 tmpRight[8];
uniform vec3 tmpUp[8];
uniform vec3 tmpForward[8];
uniform vec4 tmpOptics[8];
uniform vec4 tmpOutput[8];
uniform vec4 tmpPatterns[8];
uniform sampler2D tmpMedia;
uniform sampler2D tmpDepth;
uniform int tmpMode;
uniform float tmpIncluded[8];
uniform vec2 tmpRange;
uniform int tmpLuxDisplay;
uniform vec2 tmpLuxTarget;
uniform bool tmpResponse;
uniform int tmpViewShading;
uniform vec3 tmpLightDirection;
uniform float tmpShadowBoost;
uniform bool tmpShadowHighlight;
bool tmpHighlightPixel=false;
float tmpUnpack(vec4 v) {return dot(v,vec4(255.0/256.0,255.0/65536.0,255.0/16777216.0,1.0/16777216.0));}
vec2 tmpAtlas(vec2 uv,int i) {return (clamp(uv,vec2(.001),vec2(.999))+vec2(float(i%4),float(i/4)))/vec2(4.,2.);}
vec3 tmpHeat(float value) {float t=clamp((value-tmpRange.x)/max(.0001,tmpRange.y-tmpRange.x),0.,1.);return clamp(vec3(1.5-abs(4.*t-3.),1.5-abs(4.*t-2.),1.5-abs(4.*t-1.)),0.,1.);}
vec3 tmpLuxColor(float value) {
 if(tmpLuxDisplay==2) {
  // Allow for float rounding when a summed contribution lies exactly on a limit.
  vec2 tolerance=2e-6*max(vec2(1.),tmpLuxTarget);
  if(value<tmpLuxTarget.x-tolerance.x)return ${glslColor(luxTargetColors[0])};
  if(value>tmpLuxTarget.y+tolerance.y)return ${glslColor(luxTargetColors[2])};
  return ${glslColor(luxTargetColors[1])};
 }
 if(tmpLuxDisplay==1) {
  float t=clamp((value-tmpRange.x)/max(.0001,tmpRange.y-tmpRange.x),0.,1.);
  ${luxBandColors.map((color, index) => `if(t<${((index + 1) / luxBandColors.length).toFixed(8)})return ${glslColor(color)};`).join('\n  ')}
  return ${glslColor(luxBandColors.at(-1)!)};
 }
 return tmpHeat(value);
}
vec3 tmpOverlap(int count) {
 ${overlapColors
   .map(
     (color, count) =>
       `if(count==${count})return vec3(${new Color(color)
         .toArray()
         .map((v) => v.toFixed(8))
         .join(',')});`
   )
   .join('\n ')}
 return vec3(0.);
}
vec3 tmpShadowView(vec3 color,float blocked,float total,bool shadowed) {
 if(tmpShadowHighlight&&shadowed) {tmpHighlightPixel=true;return vec3(1.,1.,0.);}
 float fraction=blocked/max(total,1e-12);
 return color*exp(-(tmpShadowBoost-1.)*fraction);
}
float tmpInk(float distance,float halfWidth,float aa) {
 return 1.-smoothstep(halfWidth-aa,halfWidth+aa,distance);
}
vec3 tmpPattern(vec2 uv,int i) {
 vec2 resolution=tmpOutput[i].yz;
 vec2 pixel=vec2(uv.x,1.-uv.y)*resolution;
 bool nativePixels=tmpPatterns[i].y>.5;
 if(nativePixels) {
  pixel=clamp(floor(pixel),vec2(0.),resolution-1.)+.5;
  uv=vec2(pixel.x/resolution.x,1.-pixel.y/resolution.y);
 }
 float kind=tmpPatterns[i].x;
 // Media uses its own half-texel inset, independent of the occlusion atlas.
 vec2 mediaUV=(clamp(uv,vec2(.5/1024.),vec2(1.-.5/1024.))+vec2(float(i%4),float(i/4)))/vec2(4.,2.);
 if(kind<.5)return texture(tmpMedia,mediaUV).rgb;
 if(kind>5.5&&kind<6.5)return vec3(1.);
 if(kind>4.5&&kind<5.5) {
  float bar=floor(min(uv.x,.999999)*7.);
  if(bar<.5)return vec3(1.);
  if(bar<1.5)return vec3(1.,1.,0.);
  if(bar<2.5)return vec3(0.,1.,1.);
  if(bar<3.5)return vec3(0.,1.,0.);
  if(bar<4.5)return vec3(1.,0.,1.);
  if(bar<5.5)return vec3(1.,0.,0.);
  return vec3(0.,0.,1.);
 }
 // Work in native pixel coordinates so cells and circles keep their physical aspect.
 float cell=tmpPatterns[i].z;
 float stroke=nativePixels?1.:max(1.,resolution.x/512.);
 float aa=nativePixels?.0001:max(.75,resolution.x/1024.);
 if(kind>6.5) {
  vec2 tile=floor(clamp(pixel,vec2(0.),resolution-.001)/cell);
  float checker=mod(tile.x+tile.y,2.);
  float hue=fract(tile.x/max(ceil(resolution.x/cell),1.)+tile.y*.07);
  vec3 rainbow=clamp(abs(fract(hue+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.);
  vec3 color=mix(vec3(.06),vec3(1.),rainbow)*mix(1.,.82,checker);
  vec2 line=abs(mod(pixel-.5+cell*.5,cell)-cell*.5);
  color=mix(color,vec3(.025),tmpInk(min(line.x,line.y),stroke*.5,aa));
  // Text and its dark outline use the atlas alpha; cell colors stay procedural.
  vec4 label=texture(tmpMedia,mediaUV);
  return mix(color,label.rgb,label.a);
 }
 vec3 color=vec3(48.,54.,49.)/255.;
 if(kind>1.5&&kind<2.5) {
  float checker=mod(floor(pixel.x/cell)+floor(pixel.y/cell),2.);
  color=mix(vec3(1.),vec3(18./255.),checker);
 } else if(kind>3.5)color=texture(tmpMedia,mediaUV).rgb;
 if(kind<2.5||kind>3.5) {
  vec2 line=abs(mod(pixel-.5+cell*.5,cell)-cell*.5);
  color=mix(color,vec3(230.,237.,223.)/255.,tmpInk(min(line.x,line.y),stroke*.5,aa));
 }
 vec2 center=resolution*.5;
 vec2 delta=abs(pixel-center);
 float cross=tmpInk(min(delta.x,delta.y),stroke,aa);
 float border=tmpInk(min(min(pixel.x,pixel.y),min(resolution.x-pixel.x,resolution.y-pixel.y)),stroke*2.,aa);
 float circle=tmpInk(abs(length(pixel-center)-min(resolution.x,resolution.y)*.16),stroke,aa);
 return mix(color,vec3(181.,243.,108.)/255.,max(cross,max(border,circle)));
}
float tmpMeshAmbient(vec3 normal) {
 if(tmpViewShading==0)return 1.;
 if(tmpViewShading==2)return .09;
 return .25+.75*max(0.,dot(normalize(normal),tmpLightDirection));
}
vec3 tmpShade(vec3 point,vec3 normal,vec3 base,float reflectance,float transmission,float confidence,float ambient) {
 tmpHighlightPixel=false;
 vec3 contribution=vec3(0.),blockedContribution=vec3(0.);
 float totalLux=0.,metric=0.,visibleLux=0.,blockedLux=0.;
 bool covered=false,shadowed=false;
 int overlap=0,blockedCount=0;
 vec3 n=normalize(normal+vec3(0.,0.,1e-12));
 for(int i=0;i<8;i++) {if(i>=tmpCount)break;
  vec3 delta=point-tmpOrigins[i];float d=dot(delta,tmpForward[i]);
  if(d<=.02||d>tmpOutput[i].w)continue;
  vec2 uv=vec2(dot(delta,tmpRight[i]),dot(delta,tmpUp[i]))/d*vec2(tmpOptics[i].x,tmpOptics[i].x*tmpOptics[i].y)+vec2(.5)-tmpOptics[i].zw;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))continue;
  vec4 clip=tmpMatrices[i]*vec4(point,1.);float depth=clip.z/clip.w*.5+.5;
  float blocker=tmpUnpack(texture(tmpDepth,tmpAtlas(uv,i)));
  float slope=(abs(dot(n,tmpRight[i]))+tmpOptics[i].y*abs(dot(n,tmpUp[i])))/max(abs(dot(n,delta/d)),.00001);
  float bias=.0000002+.012/d/(tmpOptics[i].x*512.)*slope;
  bool occluded=depth>blocker+bias;
  if(occluded&&tmpShadowBoost<=1.&&!tmpShadowHighlight)continue;
  vec3 ray=delta/d;float incidence=dot(n,ray);
  if(abs(incidence)<.00001)continue;
  if(tmpMode==4) {
   if(occluded) {blockedCount++;shadowed=true;}else overlap++;
   continue;
  }
  vec3 dx=tmpRight[i]/(tmpOptics[i].x*tmpOutput[i].y),dy=tmpUp[i]/(tmpOptics[i].x*tmpOutput[i].y);
  dx=d*(dx-ray*dot(n,dx)/incidence);dy=d*(dy-ray*dot(n,dy)/incidence);
  float area=max(1e-12,length(cross(dx,dy)));
  float lux=tmpOutput[i].x/(tmpOutput[i].y*tmpOutput[i].z*area);
  if(tmpMode==0) {
   vec3 light=pow(tmpPattern(uv,i),vec3(2.2))*lux/300.;
   if(occluded)blockedContribution+=light;else contribution+=light;
  } else {if(occluded)blockedLux+=lux;else visibleLux+=lux;}
  if(occluded) {shadowed=true;continue;}
  if(tmpIncluded[i]>.5) {
   totalLux+=lux;covered=true;
   // Density is the best available native resolution, not a sum of pixel grids.
   if(tmpMode==2)metric=max(metric,1./max(length(dx),length(dy)));
   else if(tmpMode==3) {float a=dot(dx,dx),b=dot(dy,dy),c=dot(dx,dy),disc=sqrt((a-b)*(a-b)+4.*c*c);metric=max(metric,sqrt((a+b+disc)/max(1e-20,a+b-disc)));}
  }
 }
 if(tmpMode>0) {
  if(confidence<.5)return vec3(.18,.18,.21);
  if(tmpMode==4)return tmpShadowView(tmpOverlap(overlap),float(blockedCount),float(overlap+blockedCount),shadowed);
  // Target view classifies zero-light and fully occluded surfaces as underlit too.
  vec3 color=tmpMode==1&&(covered||tmpLuxDisplay==2)?tmpLuxColor(totalLux):covered?tmpHeat(metric):vec3(.08);
  return tmpShadowView(color,blockedLux,visibleLux+blockedLux,shadowed);
 }
 // Preview contrast uses actual lost media brightness; analysis uses white-field light.
 // Yellow marks geometric occlusion, including dark media and zero-output footprints.
 // Apply visualization after computing each mode's values, leaving probes unchanged.
 vec3 luminance=vec3(.2126,.7152,.0722);
 float blockedLight=dot(blockedContribution,luminance);
 vec3 color=tmpResponse?base*(ambient+contribution*reflectance*(1.-transmission)):vec3(ambient*.5)+contribution;
 return tmpShadowView(color,blockedLight,dot(contribution+blockedContribution,luminance),shadowed);
}
// Captured clouds and splats already contain lighting; keep their ambient response.
vec3 tmpShade(vec3 point,vec3 normal,vec3 base,float reflectance,float transmission,float confidence) {
 return tmpShade(point,normal,base,reflectance,transmission,confidence,.09);
}
`
export class ProjectionSystem {
  canvas = document.createElement('canvas')
  media: CanvasTexture
  cameras: CameraInputs
  depth = new WebGLRenderTarget(2048, 1024, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true
  })
  uniforms: Record<string, IUniform>
  projectors: ProjectorConfig[] = []
  mediaKey = ''
  shadingKey = ''
  generation = 0
  private invalidate = () => {}
  constructor() {
    this.canvas.width = 4096
    this.canvas.height = 2048
    this.media = new CanvasTexture(this.canvas)
    this.media.colorSpace = NoColorSpace
    this.cameras = new CameraInputs((ids) => this.paintCameras(ids))
    this.uniforms = {
      tmpCount: { value: 0 },
      tmpMatrices: { value: Array.from({ length: 8 }, () => new Matrix4()) },
      tmpOrigins: { value: Array.from({ length: 8 }, () => new Vector3()) },
      tmpRight: { value: Array.from({ length: 8 }, () => new Vector3()) },
      tmpUp: { value: Array.from({ length: 8 }, () => new Vector3()) },
      tmpForward: { value: Array.from({ length: 8 }, () => new Vector3()) },
      tmpOptics: { value: Array.from({ length: 8 }, () => new Vector4()) },
      tmpOutput: { value: Array.from({ length: 8 }, () => new Vector4()) },
      tmpPatterns: { value: Array.from({ length: 8 }, () => new Vector4()) },
      tmpMedia: { value: this.media },
      tmpDepth: { value: this.depth.texture },
      tmpMode: { value: 0 },
      tmpIncluded: { value: Array(8).fill(0) },
      tmpRange: { value: new Vector2(0, 500) },
      tmpLuxDisplay: { value: 0 },
      tmpLuxTarget: { value: new Vector2(80, 120) },
      tmpResponse: { value: true },
      tmpViewShading: { value: 1 },
      tmpLightDirection: { value: new Vector3(0.5, Math.SQRT1_2, 0.5) },
      tmpShadowBoost: { value: 1 },
      tmpShadowHighlight: { value: false }
    }
  }
  update(doc: SceneDocument, selectedIds: readonly string[], invalidate: () => void) {
    this.invalidate = invalidate
    this.projectors = doc.projectors.filter((p) => p.enabled).slice(0, 8)
    this.cameras.sync(this.projectors)
    this.uniforms.tmpCount.value = this.projectors.length
    this.projectors.forEach((p, i) => {
      const camera = projectorCamera(p),
        q = new Quaternion().fromArray(p.transform.rotation)
      this.uniforms.tmpMatrices.value[i].multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      )
      this.uniforms.tmpOrigins.value[i].fromArray(p.transform.position)
      this.uniforms.tmpRight.value[i].set(1, 0, 0).applyQuaternion(q)
      this.uniforms.tmpUp.value[i].set(0, 1, 0).applyQuaternion(q)
      this.uniforms.tmpForward.value[i].set(0, 0, -1).applyQuaternion(q)
      this.uniforms.tmpOptics.value[i].set(
        p.throwRatio,
        p.spec.resolution[0] / p.spec.resolution[1],
        ...p.shift
      )
      this.uniforms.tmpOutput.value[i].set(
        p.spec.lumens * p.multiplier,
        ...p.spec.resolution,
        p.extent
      )
      this.uniforms.tmpPatterns.value[i].set(
        p.pattern === 'camera'
          ? 0
          : [
              'image',
              'grid',
              'checker',
              'crosshair',
              'alignment',
              'bars',
              'white',
              'uvmap'
            ].indexOf(p.pattern),
        p.nativePixelPreview ? 1 : 0,
        p.patternCellSize,
        0
      )
    })
    this.uniforms.tmpMode.value = ['preview', 'lux', 'density', 'distortion', 'overlap'].indexOf(
      doc.settings.analysis
    )
    const included = new Set(
      (doc.settings.analysis === 'preview' ||
      doc.settings.analysis === 'overlap' ||
      (doc.settings.analysis === 'lux' && doc.settings.analysisProjector === 'all')
        ? this.projectors
        : analysisProjectors(doc, selectedIds)
      ).map((p) => p.id)
    )
    this.uniforms.tmpIncluded.value = Array.from({ length: 8 }, (_, i) =>
      included.has(this.projectors[i]?.id) ? 1 : 0
    )
    this.uniforms.tmpRange.value.fromArray(doc.settings.range)
    this.uniforms.tmpLuxDisplay.value = ['smooth', 'bands', 'target'].indexOf(doc.settings.luxDisplay)
    this.uniforms.tmpLuxTarget.value.fromArray(doc.settings.luxTarget)
    this.uniforms.tmpResponse.value = doc.settings.materialResponse
    this.uniforms.tmpViewShading.value = ['none', 'directional', 'projectors'].indexOf(
      doc.settings.viewShading
    )
    const azimuth = (doc.settings.lightAzimuth * Math.PI) / 180,
      elevation = (doc.settings.lightElevation * Math.PI) / 180
    // Direction toward the light in world space: azimuth 0 is +Z, 90 is +X.
    this.uniforms.tmpLightDirection.value.set(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth)
    )
    this.uniforms.tmpShadowBoost.value = doc.settings.shadowBoost
    this.uniforms.tmpShadowHighlight.value = doc.settings.shadowHighlight
    const key = JSON.stringify(
      this.projectors.map((p) => [
        p.id,
        p.pattern,
        p.imageId,
        p.camera?.deviceId,
        p.imageFit,
        p.spec.resolution,
        p.patternCellSize
      ])
    )
    if (key !== this.mediaKey) {
      this.mediaKey = key
      void this.paint(doc, invalidate)
    }
    const shadingKey = JSON.stringify([
      this.projectors.map((p) => [
        p.transform.position,
        p.transform.rotation,
        p.throwRatio,
        p.shift,
        p.spec.resolution,
        p.spec.lumens,
        p.multiplier,
        p.extent,
        p.pattern,
        p.nativePixelPreview,
        p.patternCellSize,
        p.imageId,
        p.camera?.deviceId,
        p.imageFit
      ]),
      this.uniforms.tmpMode.value,
      this.uniforms.tmpIncluded.value,
      doc.settings.range,
      doc.settings.luxDisplay,
      doc.settings.luxTarget,
      doc.settings.materialResponse,
      doc.settings.viewShading,
      doc.settings.lightAzimuth,
      doc.settings.lightElevation,
      doc.settings.shadowBoost,
      doc.settings.shadowHighlight
    ])
    const changed = shadingKey !== this.shadingKey
    this.shadingKey = shadingKey
    return changed
  }
  async paint(doc: SceneDocument, invalidate: () => void) {
    const generation = ++this.generation,
      projectors = this.projectors,
      ctx = this.canvas.getContext('2d')!
    // Decode before touching the canvas so live frames never share an outstanding
    // save/clip stack with an asynchronous image import.
    const images = await Promise.all(
      projectors.map(async (p) => {
        if (p.pattern !== 'image' || !p.imageId) return undefined
        const a = doc.assets.find((a) => a.id === p.imageId),
          file = a && originalFiles.get(a.primary)
        if (!file) return undefined
        try {
          return await createImageBitmap(file)
        } catch {
          return null
        }
      })
    )
    if (generation !== this.generation) {
      images.forEach((bitmap) => bitmap?.close())
      return
    }
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 4096, 2048)
    for (let i = 0; i < projectors.length; i++) {
      const p = projectors[i],
        x = (i % 4) * 1024,
        y = (1 - Math.floor(i / 4)) * 1024,
        size = 1024
      // Geometric patterns are evaluated in the shader, without the media atlas's size limit.
      if (p.pattern === 'camera') {
        this.paintCamera(p, i)
        continue
      }
      if (p.pattern === 'image') {
        const bitmap = images[i]
        if (bitmap) {
          this.drawSource(bitmap, bitmap.width, bitmap.height, p, i)
          bitmap.close()
        } else if (bitmap === null) {
          ctx.fillStyle = '#601e30'
          ctx.fillRect(x, y, size, size)
        }
        continue
      }
      if (p.pattern !== 'alignment' && p.pattern !== 'uvmap') continue
      ctx.save()
      ctx.translate(x, y)
      ctx.beginPath()
      ctx.rect(0, 0, size, size)
      ctx.clip()
      const uvmap = p.pattern === 'uvmap'
      if (uvmap) ctx.clearRect(0, 0, size, size)
      else {
        ctx.fillStyle = '#303631'
        ctx.fillRect(0, 0, size, size)
      }
      const [width, height] = p.spec.resolution
      const cell = p.patternCellSize
      // Omit labels that would occupy fewer than 12 atlas pixels instead of drawing
      // millions of unreadable numbers for a fine grid on a high-resolution projector.
      if ((cell * size) / Math.max(width, height) >= 12) {
        ctx.scale(size / width, size / height)
        ctx.fillStyle = uvmap ? '#fff' : '#e5e9dd'
        ctx.font = `${uvmap ? 'bold ' : ''}${cell * (uvmap ? 0.3 : 0.22)}px monospace`
        ctx.textAlign = 'center'
        if (uvmap) {
          ctx.textBaseline = 'middle'
          ctx.strokeStyle = '#080810'
          ctx.lineWidth = cell * 0.035
          ctx.lineJoin = 'round'
        }
        const columns = Math.ceil(width / cell)
        const rows = Math.ceil(height / cell)
        for (let row = 0; row < rows; row++) {
          // Spreadsheet-style row names continue past Z as AA, AB, ...
          let rowLabel = ''
          if (uvmap)
            for (let n = row + 1; n > 0; n = Math.floor((n - 1) / 26))
              rowLabel = String.fromCharCode(65 + ((n - 1) % 26)) + rowLabel
          for (let column = 0; column < columns; column++) {
            if (uvmap) {
              const label = `${rowLabel}${column + 1}`,
                cx = (column + 0.5) * cell,
                cy = (row + 0.5) * cell
              ctx.strokeText(label, cx, cy, cell * 0.8)
              ctx.fillText(label, cx, cy, cell * 0.8)
            } else
              ctx.fillText(
                `${row * columns + column + 1}`,
                (column + 0.5) * cell,
                (row + 0.6) * cell
              )
          }
        }
      }
      ctx.restore()
    }
    this.media.needsUpdate = true
    invalidate()
  }
  private drawSource(
    source: CanvasImageSource,
    width: number,
    height: number,
    p: ProjectorConfig,
    i: number
  ) {
    const ctx = this.canvas.getContext('2d')!,
      size = 1024,
      x = (i % 4) * size,
      y = (1 - Math.floor(i / 4)) * size,
      aspect = p.spec.resolution[0] / p.spec.resolution[1],
      ratio = width / height / aspect
    let w = size,
      h = size
    if (p.imageFit === 'contain') {
      if (ratio > 1) h /= ratio
      else w *= ratio
    } else if (p.imageFit === 'cover') {
      if (ratio > 1) w *= ratio
      else h /= ratio
    }
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, size, size)
    ctx.clip()
    ctx.fillStyle = '#000'
    ctx.fillRect(x, y, size, size)
    ctx.drawImage(source, x + (size - w) / 2, y + (size - h) / 2, w, h)
    ctx.restore()
  }
  private paintCamera(p: ProjectorConfig, i: number) {
    const video = this.cameras.videoFor(p.id)
    if (video?.videoWidth && video.videoHeight)
      this.drawSource(video, video.videoWidth, video.videoHeight, p, i)
    else {
      const ctx = this.canvas.getContext('2d')!
      ctx.fillStyle = '#000'
      ctx.fillRect((i % 4) * 1024, (1 - Math.floor(i / 4)) * 1024, 1024, 1024)
    }
  }
  private paintCameras(ids: ReadonlySet<string>) {
    let changed = false
    this.projectors.forEach((p, i) => {
      if (p.pattern === 'camera' && ids.has(p.id)) {
        this.paintCamera(p, i)
        changed = true
      }
    })
    if (changed) {
      this.media.needsUpdate = true
      this.invalidate()
    }
  }
  meshMaterial(
    source: Material | undefined,
    surface: SurfaceMaterial,
    hasColor = false,
    texture?: Texture
  ) {
    const material =
      source instanceof MeshStandardMaterial ? source.clone() : new MeshStandardMaterial()
    if (source && !(source instanceof MeshStandardMaterial)) {
      // OBJ and FBX use Phong/Lambert materials; preserve their appearance when
      // adapting them to the common projection shader.
      const imported = source as Partial<MeshStandardMaterial>
      const properties = [
        'name',
        'map',
        'alphaMap',
        'alphaTest',
        'opacity',
        'transparent',
        'vertexColors',
        'flatShading',
        'normalMap',
        'normalMapType',
        'bumpMap',
        'bumpScale',
        'aoMap',
        'aoMapIntensity',
        'lightMap',
        'lightMapIntensity',
        'emissiveMap',
        'emissiveIntensity',
        'depthWrite',
        'depthTest'
      ] as const
      Object.assign(
        material,
        Object.fromEntries(
          properties.filter((key) => key in imported).map((key) => [key, imported[key]])
        )
      )
      if (imported.color) material.color.copy(imported.color)
      if (imported.emissive) material.emissive.copy(imported.emissive)
      if (imported.normalScale) material.normalScale.copy(imported.normalScale)
    }
    if (surface.preset === 'captured') material.color.multiply(new Color(surface.color))
    else {
      material.color.set(surface.color)
      material.roughness = surface.roughness
      material.metalness = surface.preset === 'metal' ? 0.7 : 0
    }
    material.vertexColors ||= hasColor
    if (texture) {
      material.map = texture
      material.color.set(surface.color)
      material.vertexColors = false
    }
    material.side = DoubleSide
    const reflectance = { value: surface.reflectance },
      transmission = { value: surface.transmission }
    material.userData.tmpReflectance = reflectance
    material.userData.tmpTransmission = transmission
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, {
        tmpReflectance: reflectance,
        tmpTransmission: transmission
      })
      shader.vertexShader = 'varying vec3 tmpWorld; varying vec3 tmpNormal;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <defaultnormal_vertex>',
          '#include <defaultnormal_vertex>\ntmpNormal = inverseTransformDirection(transformedNormal, viewMatrix);'
        )
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\ntmpWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
        )
      shader.fragmentShader =
        'varying vec3 tmpWorld; varying vec3 tmpNormal; uniform float tmpReflectance; uniform float tmpTransmission;\n' +
        projectionGLSL +
        shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        // Normal maps and flat/back-face normals shape the view light, while
        // projector calculations retain the geometric normals used by analysis.
        'vec3 tmpSurfaceNormal=inverseTransformDirection(normal,viewMatrix);\noutgoingLight=tmpShade(tmpWorld,normalize(tmpNormal),diffuseColor.rgb,tmpReflectance,tmpTransmission,1.,tmpMeshAmbient(tmpSurfaceNormal));\n#include <opaque_fragment>'
      )
      // Keep discrete diagnostic colors consistent with their legends under AgX.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <tonemapping_fragment>',
        'if(tmpMode!=4&&!tmpHighlightPixel&&!(tmpMode==1&&tmpLuxDisplay>0)) {\n#include <tonemapping_fragment>\n}'
      )
    }
    material.customProgramCacheKey = () => 'tmp-projection-v5'
    return material
  }
  pointsMaterial(surface: SurfaceMaterial, hasColor: boolean) {
    return new ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        tmpBase: { value: new Color(surface.color) },
        tmpReflectance: { value: surface.reflectance },
        tmpTransmission: { value: surface.transmission }
      },
      // A point's position, normal and projection are constant across its pixels.
      // Evaluate once per point instead of repeating all projector math per fragment.
      vertexShader: `attribute float confidence;uniform vec3 tmpBase;uniform float tmpReflectance;uniform float tmpTransmission;varying vec3 tmpColor;varying float tmpHighlight;${hasColor ? 'attribute vec3 color;' : ''}${projectionGLSL}void main(){vec3 world=(modelMatrix*vec4(position,1.)).xyz;vec3 n=normalize((vec4(normalize(normalMatrix*normal),0.)*viewMatrix).xyz);tmpColor=tmpShade(world,n,tmpBase*${hasColor ? 'color' : 'vec3(1.)'},tmpReflectance,tmpTransmission,confidence);tmpHighlight=tmpHighlightPixel?1.:0.;vec4 view=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*view;gl_PointSize=clamp(28./max(.1,-view.z),2.,10.);}`,
      fragmentShader: `uniform int tmpMode;uniform int tmpLuxDisplay;varying vec3 tmpColor;varying float tmpHighlight;
void main(){
 if(length(gl_PointCoord-.5)>.5)discard;
 gl_FragColor=vec4(tmpColor,1.);
 if(tmpMode!=4&&tmpHighlight<.5&&!(tmpMode==1&&tmpLuxDisplay>0)) {
  #include <tonemapping_fragment>
 }
 #include <colorspace_fragment>
}`
    })
  }
  splatUniforms(surface: SurfaceMaterial, size = 1) {
    return {
      tmpSplatSize: { value: size },
      tmpSplatBase: { value: new Color(surface.color) },
      tmpSplatReflectance: { value: surface.reflectance },
      tmpSplatTransmission: { value: surface.transmission }
    }
  }
  splatModifier(
    surface: SurfaceMaterial,
    appearance = this.splatUniforms(surface)
  ): GsplatModifier {
    return dyno.dyno({
      inTypes: { gsplat: dyno.Gsplat },
      outTypes: { gsplat: dyno.Gsplat },
      generate: ({ inputs, outputs }) => ({
        // Spark stores and displays sRGB, while tmpShade and the mesh shaders use linear light.
        globals: [
          projectionGLSL,
          `
uniform float tmpSplatSize;
uniform vec3 tmpSplatBase;
uniform float tmpSplatReflectance;
uniform float tmpSplatTransmission;
vec3 tmpSplatToLinear(vec3 c) {
 c=max(c,vec3(0.));
 return mix(pow((c+.055)/1.055,vec3(2.4)),c/12.92,lessThanEqual(c,vec3(.04045)));
}
vec3 tmpSplatToSRGB(vec3 c) {
 c=max(c,vec3(0.));
 return mix(1.055*pow(c,vec3(1./2.4))-.055,c*12.92,lessThanEqual(c,vec3(.0031308)));
}`
        ],
        uniforms: { ...this.uniforms, ...appearance },
        statements: [
          `${outputs.gsplat} = ${inputs.gsplat};`,
          `${outputs.gsplat}.scales *= tmpSplatSize;`,
          `vec3 tmpS = abs(${inputs.gsplat}.scales);`,
          `vec3 tmpAxis = tmpS.x < tmpS.y && tmpS.x < tmpS.z ? vec3(1,0,0) : tmpS.y < tmpS.z ? vec3(0,1,0) : vec3(0,0,1);`,
          `vec4 tmpQ = ${inputs.gsplat}.quaternion;`,
          `vec3 tmpN = tmpAxis + 2.0*cross(tmpQ.xyz,cross(tmpQ.xyz,tmpAxis)+tmpQ.w*tmpAxis);`,
          `${outputs.gsplat}.rgba.rgb = tmpSplatToSRGB(tmpShade(${inputs.gsplat}.center,tmpN,tmpSplatBase*tmpSplatToLinear(${inputs.gsplat}.rgba.rgb),tmpSplatReflectance,tmpSplatTransmission,min(tmpS.x,min(tmpS.y,tmpS.z))/max(tmpS.x,max(tmpS.y,tmpS.z)) < .35 ? 1. : 0.));`
        ]
      })
    })
  }
  dispose() {
    this.generation++
    this.cameras.dispose()
    this.depth.dispose()
    this.media.dispose()
  }
}
