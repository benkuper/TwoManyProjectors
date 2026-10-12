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
import type { ProjectorConfig, SceneDocument, SurfaceMaterial } from './types'

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
uniform int tmpSelected;
uniform vec2 tmpRange;
uniform bool tmpResponse;
float tmpUnpack(vec4 v) {return dot(v,vec4(255.0/256.0,255.0/65536.0,255.0/16777216.0,1.0/16777216.0));}
vec2 tmpAtlas(vec2 uv,int i) {return (clamp(uv,vec2(.001),vec2(.999))+vec2(float(i%4),float(i/4)))/vec2(4.,2.);}
vec3 tmpHeat(float value) {float t=clamp((value-tmpRange.x)/max(.0001,tmpRange.y-tmpRange.x),0.,1.);return clamp(vec3(1.5-abs(4.*t-3.),1.5-abs(4.*t-2.),1.5-abs(4.*t-1.)),0.,1.);}
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
 if(kind>5.5)return vec3(1.);
 if(kind>4.5) {
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
vec3 tmpShade(vec3 point,vec3 normal,vec3 base,float reflectance,float transmission,float confidence) {
 vec3 contribution=vec3(0.);float totalLux=0.,metric=0.;bool covered=false;
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
  if(depth>blocker+bias)continue;
  vec3 ray=delta/d;float incidence=dot(n,ray);
  if(abs(incidence)<.00001)continue;
  vec3 dx=tmpRight[i]/(tmpOptics[i].x*tmpOutput[i].y),dy=tmpUp[i]/(tmpOptics[i].x*tmpOutput[i].y);
  dx=d*(dx-ray*dot(n,dx)/incidence);dy=d*(dy-ray*dot(n,dy)/incidence);
  float area=max(1e-12,length(cross(dx,dy)));
  float lux=tmpOutput[i].x/(tmpOutput[i].y*tmpOutput[i].z*area);
  if(tmpMode==0)contribution+=pow(tmpPattern(uv,i),vec3(2.2))*lux/300.;
  if(tmpSelected<0||tmpSelected==i)totalLux+=lux;
  if(tmpSelected==i) {covered=true; if(tmpMode==2)metric=1./max(length(dx),length(dy)); else {float a=dot(dx,dx),b=dot(dy,dy),c=dot(dx,dy),disc=sqrt((a-b)*(a-b)+4.*c*c);metric=sqrt((a+b+disc)/max(1e-20,a+b-disc));}}
 }
 if(tmpMode>0) {if(confidence<.5)return vec3(.18,.18,.21);if(tmpMode==1)return tmpHeat(totalLux);return covered?tmpHeat(metric):vec3(.08,.09,.12);}
 if(!tmpResponse)return vec3(.045)+contribution;
 return base*(.09+contribution*reflectance*(1.-transmission));
}
`
export class ProjectionSystem {
  canvas = document.createElement('canvas')
  media: CanvasTexture
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
  constructor() {
    this.canvas.width = 4096
    this.canvas.height = 2048
    this.media = new CanvasTexture(this.canvas)
    this.media.colorSpace = NoColorSpace
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
      tmpSelected: { value: -1 },
      tmpRange: { value: new Vector2(0, 500) },
      tmpResponse: { value: true }
    }
  }
  update(doc: SceneDocument, selected: string | null, invalidate: () => void) {
    this.projectors = doc.projectors.filter((p) => p.enabled).slice(0, 8)
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
        ['image', 'grid', 'checker', 'crosshair', 'alignment', 'bars', 'white'].indexOf(p.pattern),
        p.nativePixelPreview ? 1 : 0,
        p.patternCellSize,
        0
      )
    })
    this.uniforms.tmpMode.value = ['preview', 'lux', 'density', 'distortion'].indexOf(
      doc.settings.analysis
    )
    const chosen =
      doc.settings.analysisProjector === 'all' ? selected : doc.settings.analysisProjector
    this.uniforms.tmpSelected.value =
      doc.settings.analysis === 'preview' ||
      (doc.settings.analysis === 'lux' && doc.settings.analysisProjector === 'all')
        ? -1
        : Math.max(
            0,
            this.projectors.findIndex((p) => p.id === chosen)
          )
    this.uniforms.tmpRange.value.fromArray(doc.settings.range)
    this.uniforms.tmpResponse.value = doc.settings.materialResponse
    const key = JSON.stringify(
      this.projectors.map((p) => [
        p.pattern,
        p.imageId,
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
        p.imageFit
      ]),
      this.uniforms.tmpMode.value,
      this.uniforms.tmpSelected.value,
      doc.settings.range,
      doc.settings.materialResponse
    ])
    const changed = shadingKey !== this.shadingKey
    this.shadingKey = shadingKey
    return changed
  }
  async paint(doc: SceneDocument, invalidate: () => void) {
    const generation = ++this.generation,
      ctx = this.canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 4096, 2048)
    for (let i = 0; i < this.projectors.length; i++) {
      const p = this.projectors[i],
        x = (i % 4) * 1024,
        y = (1 - Math.floor(i / 4)) * 1024,
        size = 1024
      // Geometric patterns are evaluated in the shader, without the media atlas's size limit.
      if (p.pattern !== 'image' && p.pattern !== 'alignment') continue
      ctx.save()
      ctx.translate(x, y)
      ctx.beginPath()
      ctx.rect(0, 0, size, size)
      ctx.clip()
      if (p.pattern === 'image' && p.imageId) {
        const a = doc.assets.find((a) => a.id === p.imageId),
          file = a && originalFiles.get(a.primary)
        if (file) {
          try {
            const bitmap = await createImageBitmap(file)
            if (generation !== this.generation) {
              bitmap.close()
              ctx.restore()
              return
            }
            const aspect = p.spec.resolution[0] / p.spec.resolution[1],
              ratio = bitmap.width / bitmap.height / aspect
            let w = size,
              h = size
            if (p.imageFit === 'contain') {
              if (ratio > 1) h /= ratio
              else w *= ratio
            } else if (p.imageFit === 'cover') {
              if (ratio > 1) w *= ratio
              else h /= ratio
            }
            ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
            bitmap.close()
          } catch {
            ctx.fillStyle = '#601e30'
            ctx.fillRect(0, 0, size, size)
          }
        }
      } else {
        ctx.fillStyle = '#303631'
        ctx.fillRect(0, 0, size, size)
        const [width, height] = p.spec.resolution
        const cell = p.patternCellSize
        // Omit labels that would occupy fewer than 12 atlas pixels instead of drawing
        // millions of unreadable numbers for a fine grid on a high-resolution projector.
        if ((cell * size) / Math.max(width, height) >= 12) {
          ctx.scale(size / width, size / height)
          ctx.fillStyle = '#e5e9dd'
          ctx.font = `${cell * 0.22}px monospace`
          ctx.textAlign = 'center'
          const columns = Math.ceil(width / cell)
          const rows = Math.ceil(height / cell)
          for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
              ctx.fillText(
                `${row * columns + column + 1}`,
                (column + 0.5) * cell,
                (row + 0.6) * cell
              )
            }
          }
        }
      }
      ctx.restore()
    }
    this.media.needsUpdate = true
    invalidate()
  }
  meshMaterial(source: Material | undefined, surface: SurfaceMaterial) {
    const material =
      source instanceof MeshStandardMaterial ? source.clone() : new MeshStandardMaterial()
    material.color.set(surface.color)
    material.roughness = surface.roughness
    material.metalness = surface.preset === 'metal' ? 0.7 : 0
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
        'outgoingLight=tmpShade(tmpWorld,normalize(tmpNormal),diffuseColor.rgb,tmpReflectance,tmpTransmission,1.);\n#include <opaque_fragment>'
      )
    }
    material.customProgramCacheKey = () => 'tmp-projection-v2'
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
      vertexShader: `attribute float confidence;uniform vec3 tmpBase;uniform float tmpReflectance;uniform float tmpTransmission;varying vec3 tmpColor;${hasColor ? 'attribute vec3 color;' : ''}${projectionGLSL}void main(){vec3 world=(modelMatrix*vec4(position,1.)).xyz;vec3 n=normalize((vec4(normalize(normalMatrix*normal),0.)*viewMatrix).xyz);tmpColor=tmpShade(world,n,tmpBase*${hasColor ? 'color' : 'vec3(1.)'},tmpReflectance,tmpTransmission,confidence);vec4 view=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*view;gl_PointSize=clamp(28./max(.1,-view.z),2.,10.);}`,
      fragmentShader:
        `varying vec3 tmpColor;void main(){if(length(gl_PointCoord-.5)>.5)discard;gl_FragColor=vec4(tmpColor,1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`.replace(
          ';#include',
          ';\n#include'
        )
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
    this.depth.dispose()
    this.media.dispose()
  }
}
