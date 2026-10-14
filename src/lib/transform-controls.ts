import { Vector2, Vector3 } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'

/** Scale planes preserve proportions; center scaling has a fixed screen-space sensitivity. */
export class EditorTransformControls extends TransformControls {
  private scalePointer = new Vector2()
  private scaleDirection = new Vector2()
  private initialScale = new Vector3()
  private scaleViewport = new Vector2()

  override pointerDown(pointer: PointerEvent | null) {
    const wasDragging = this.dragging
    super.pointerDown(pointer)
    if (wasDragging || !this.dragging || !pointer || !this.object || this.mode !== 'scale') return

    const rect = this.domElement!.getBoundingClientRect()
    this.scaleViewport.set(rect.width / 2, rect.height / 2)
    this.scalePointer.set(pointer.x, pointer.y).multiply(this.scaleViewport)
    this.initialScale.copy(this.object.scale)
    // Right/up enlarges from the center. Plane handles follow their outward screen direction.
    this.scaleDirection.set(1, 1).normalize()
    if (this.axis !== 'XYZ') {
      const center = this.object.getWorldPosition(new Vector3()).project(this.camera)
      const direction = this.scalePointer
        .clone()
        .sub(new Vector2(center.x, center.y).multiply(this.scaleViewport))
      if (direction.lengthSq() > 1) this.scaleDirection.copy(direction).normalize()
    }
  }

  override pointerMove(pointer: PointerEvent | null) {
    if (this.mode !== 'scale' || !this.axis || this.axis.length < 2 || !pointer) {
      super.pointerMove(pointer)
      return
    }
    if (!this.dragging || !this.object || pointer.button !== -1) return

    const delta = new Vector2(pointer.x, pointer.y)
      .multiply(this.scaleViewport)
      .sub(this.scalePointer)
    // 150 CSS pixels doubles/halves the scale, independent of zoom or the initial click offset.
    let factor = 2 ** Math.max(-20, Math.min(20, delta.dot(this.scaleDirection) / 150))
    if (this.scaleSnap)
      factor = Math.max(this.scaleSnap, Math.round(factor / this.scaleSnap) * this.scaleSnap)
    this.object.scale.copy(this.initialScale)
    if (this.axis.includes('X')) this.object.scale.x *= factor
    if (this.axis.includes('Y')) this.object.scale.y *= factor
    if (this.axis.includes('Z')) this.object.scale.z *= factor
    this.dispatchEvent({ type: 'change' })
    this.dispatchEvent({ type: 'objectChange' })
  }
}
