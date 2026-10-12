import {
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer
} from 'three'

/** A screen-space silhouette, using shared mesh geometry rather than a bounding box. */
export class SelectionOutline {
  target: Object3D | undefined
  mask = new WebGLRenderTarget(1, 1)
  scene = new Scene()
  camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  overlay = new Scene()
  meshMaterial = new MeshBasicMaterial({ color: 'white', side: DoubleSide, toneMapped: false })
  pointsMaterial = new PointsMaterial({ color: 'white', size: 0.035, toneMapped: false })
  material = new ShaderMaterial({
    uniforms: {
      mask: { value: this.mask.texture },
      texel: { value: new Vector2(1, 1) },
      color: { value: new Color('#bbef79') }
    },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `
      uniform sampler2D mask;
      uniform vec2 texel;
      uniform vec3 color;
      varying vec2 vUv;
      void main(){
        float center=texture2D(mask,vUv).r;
        float lo=center, hi=center;
        for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++){
          float m=texture2D(mask,vUv+vec2(float(x),float(y))*texel*1.5).r;
          lo=min(lo,m); hi=max(hi,m);
        }
        float alpha=(hi-lo)*.95+center*.04;
        if(alpha<.001) discard;
        gl_FragColor=vec4(color,alpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  })
  quad = new Mesh(new PlaneGeometry(2, 2), this.material)
  copies: { source: Mesh | Points; copy: Mesh | Points }[] = []
  size = new Vector2()

  constructor() {
    this.overlay.add(this.quad)
  }

  setTarget(target: Object3D | undefined) {
    if (this.target === target) return
    this.target = target
    this.scene.clear()
    this.copies = []
    target?.traverse((source) => {
      if (!(source instanceof Mesh || source instanceof Points) || source.userData.splatProxy)
        return
      const copy = source.clone(false)
      copy.material = source instanceof Points ? this.pointsMaterial : this.meshMaterial
      copy.matrixAutoUpdate = false
      copy.layers.set(0)
      copy.raycast = () => {}
      this.scene.add(copy)
      this.copies.push({ source, copy })
    })
  }

  render(renderer: WebGLRenderer, camera: Camera) {
    if (!this.target?.visible || !this.copies.length) return
    renderer.getDrawingBufferSize(this.size)
    if (this.mask.width !== this.size.x || this.mask.height !== this.size.y) {
      this.mask.setSize(this.size.x, this.size.y)
      this.material.uniforms.texel.value.set(1 / this.size.x, 1 / this.size.y)
    }
    this.target.updateWorldMatrix(true, true)
    for (const { source, copy } of this.copies) {
      copy.matrix.copy(source.matrixWorld)
      copy.visible = source.visible
      for (let parent = source.parent; parent; parent = parent.parent)
        if (!parent.visible) copy.visible = false
    }
    const target = renderer.getRenderTarget(),
      clear = renderer.getClearColor(new Color()),
      alpha = renderer.getClearAlpha(),
      viewport = renderer.getViewport(new Vector4()),
      scissor = renderer.getScissor(new Vector4()),
      scissorTest = renderer.getScissorTest(),
      autoClear = renderer.autoClear
    renderer.setRenderTarget(this.mask)
    renderer.setScissorTest(false)
    renderer.setClearColor(0, 0)
    renderer.clear()
    renderer.render(this.scene, camera)
    renderer.setRenderTarget(target)
    renderer.setViewport(viewport)
    renderer.setScissor(scissor)
    renderer.setScissorTest(scissorTest)
    renderer.autoClear = false
    renderer.render(this.overlay, this.camera)
    renderer.autoClear = autoClear
    renderer.setClearColor(clear, alpha)
  }

  dispose() {
    this.mask.dispose()
    this.meshMaterial.dispose()
    this.pointsMaterial.dispose()
    this.material.dispose()
    this.quad.geometry.dispose()
    this.scene.clear()
    this.copies = []
  }
}
