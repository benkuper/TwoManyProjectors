<script lang="ts">
  import { onDestroy } from 'svelte'
  import { beginEdit, endEdit } from '../lib/store'
  let {
    label,
    value,
    min = -100000,
    max = 100000,
    step = 0.1,
    suffix = '',
    disabled = false,
    slider = false,
    oncommit
  }: {
    label: string
    value: number
    min?: number
    max?: number
    step?: number
    suffix?: string
    disabled?: boolean
    slider?: boolean
    oncommit: (value: number) => void
  } = $props()
  let scrubbing = $state(false)
  let cleanup: (() => void) | undefined
  function change(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const parsed = input.valueAsNumber
    // Leave partial/out-of-range text alone while typing (e.g. the leading 0
    // of 0.25 in a field whose minimum is positive). Scrubbing clamps separately.
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max && parsed !== value)
      oncommit(parsed)
  }
  function scrub(event: PointerEvent) {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    cleanup?.()
    const input = event.currentTarget as HTMLInputElement
    const startX = event.clientX,
      startValue = value
    input.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      const delta = e.clientX - startX
      if (!scrubbing && Math.abs(delta) < 3) return
      if (!scrubbing) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        endEdit()
        beginEdit()
        scrubbing = true
      }
      e.preventDefault()
      const sensitivity = e.shiftKey ? 0.1 : e.ctrlKey || e.metaKey ? 10 : 1
      oncommit(
        Math.max(min, Math.min(max, Number((startValue + delta * step * sensitivity).toFixed(6))))
      )
    }
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      const dragged = scrubbing
      cleanup?.()
      if (!dragged && e.type === 'pointerup') {
        input.focus()
        input.select()
      }
    }
    cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', cancel)
      input.removeEventListener('lostpointercapture', finish)
      if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId)
      if (scrubbing) endEdit()
      scrubbing = false
      cleanup = undefined
    }
    const cancel = () => cleanup?.()
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', cancel)
    input.addEventListener('lostpointercapture', finish)
  }
  function slide(event: PointerEvent) {
    if (disabled || event.button !== 0) return
    // Own the drag so reactive value updates cannot interrupt native range dragging.
    event.preventDefault()
    cleanup?.()
    const input = event.currentTarget as HTMLInputElement
    input.focus()
    beginEdit()
    input.setPointerCapture(event.pointerId)
    const rect = input.getBoundingClientRect()
    const thumbSize = parseFloat(getComputedStyle(input).getPropertyValue('--range-thumb-size'))
    const update = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      const fraction = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left - thumbSize / 2) / (rect.width - thumbSize))
      )
      const next = Math.max(
        min,
        Math.min(max, Number((min + Math.round((fraction * (max - min)) / step) * step).toFixed(6)))
      )
      if (next !== value) oncommit(next)
    }
    const finish = (e: PointerEvent) => {
      if (e.pointerId === event.pointerId) cleanup?.()
    }
    const cancel = () => cleanup?.()
    cleanup = () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', cancel)
      input.removeEventListener('lostpointercapture', finish)
      if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId)
      cleanup = undefined
      endEdit()
    }
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', cancel)
    input.addEventListener('lostpointercapture', finish)
    update(event)
  }
  onDestroy(() => cleanup?.())
</script>

<label class="number-field" class:scrubbing
  ><span>{label}</span>
  <div>
    <input
      type="number"
      aria-label={label}
      {value}
      {min}
      {max}
      {step}
      {disabled}
      title="Drag to adjust · Shift for precision · Click to type"
      readonly={scrubbing}
      onpointerdown={scrub}
      onfocus={beginEdit}
      oninput={change}
      onblur={(e) => {
        e.currentTarget.value = String(value)
        endEdit()
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />{#if suffix}<small>{suffix}</small>{/if}
  </div></label
>
{#if slider}
  <input
    class="range"
    type="range"
    aria-label={`${label} slider`}
    {min}
    {max}
    {step}
    {disabled}
    {value}
    onpointerdown={slide}
    oninput={(e) => {
      beginEdit()
      change(e)
    }}
    onchange={() => {
      if (!cleanup) endEdit()
    }}
    onblur={() => {
      if (!cleanup) endEdit()
    }}
    onkeydown={beginEdit}
    onkeyup={endEdit}
  />
{/if}
