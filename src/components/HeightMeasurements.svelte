<script lang="ts">
  import type { ViewportEngine } from '../lib/engine'
  import { heightText, heightRelation, type HeightOverlay } from '../lib/height-measurement'
  let { engine }: { engine: ViewportEngine } = $props()
  let measurements = $state<HeightOverlay[]>([])
  let width = $state(1),
    height = $state(1)
  $effect(() => engine.heightMeasurements.subscribe((value) => (measurements = value)))

  type PlacedLabel = { x: number; y: number; lane: number; origin: [number, number] }
  const drawings = $derived.by(() => {
    const placed: PlacedLabel[] = []
    return measurements.map((measurement) => {
      const nearby = placed.filter(
        (label) =>
          Math.hypot(
            label.origin[0] - measurement.origin[0],
            label.origin[1] - measurement.origin[1]
          ) < 80
      )
      const lane = nearby.length ? Math.max(...nearby.map((label) => label.lane)) + 1 : 0
      const drawing = layout(measurement, lane, placed)
      placed.push({ ...drawing, lane, origin: measurement.origin })
      return { measurement, ...drawing }
    })
  })

  function layout(measurement: HeightOverlay, lane: number, placed: PlacedLabel[]) {
    const [ox, oy] = measurement.origin,
      [bx, by] = measurement.base
    const length = Math.hypot(bx - ox, by - oy)
    const dx = length > 1 ? (bx - ox) / length : 0
    const dy = length > 1 ? (by - oy) / length : 1
    let nx = -dy,
      ny = dx
    if (nx < 0) {
      nx = -nx
      ny = -ny
    }
    const offset = 30 + lane * 16
    const a = [ox + nx * offset, oy + ny * offset]
    const b = [bx + nx * offset, by + ny * offset]
    const mx = (a[0] + b[0]) / 2,
      my = (a[1] + b[1]) / 2
    const preferredX = mx + nx * 112 - 95,
      preferredY = my + ny * 48 - 34
    const offsets = [
      0,
      ...Array.from({ length: measurements.length }, (_, i) => [(i + 1) * 84, -(i + 1) * 84]).flat()
    ]
    const candidates = [0, 206, -206].flatMap((shift) =>
      offsets.map((offsetY) => ({
        x: Math.max(8, Math.min(width - 198, preferredX + shift)),
        y: Math.max(60, Math.min(height - 125, preferredY + offsetY))
      }))
    )
    const { x, y } =
      candidates.find((candidate) =>
        placed.every(
          (label) =>
            candidate.x + 198 <= label.x ||
            label.x + 198 <= candidate.x ||
            candidate.y + 82 <= label.y ||
            label.y + 82 <= candidate.y
        )
      ) ?? candidates[0]
    const arrows =
      length < 18
        ? ''
        : `M ${a[0] + dx * 8 + nx * 4} ${a[1] + dy * 8 + ny * 4} L ${a} L ${a[0] + dx * 8 - nx * 4} ${a[1] + dy * 8 - ny * 4} M ${b[0] - dx * 8 + nx * 4} ${b[1] - dy * 8 + ny * 4} L ${b} L ${b[0] - dx * 8 - nx * 4} ${b[1] - dy * 8 - ny * 4}`
    return {
      a,
      b,
      x,
      y,
      arrows,
      leader: `M ${mx} ${my} L ${Math.max(x, Math.min(x + 190, mx))} ${Math.max(y, Math.min(y + 74, my))}`,
      ticks: `M ${a[0] - nx * 6} ${a[1] - ny * 6} l ${nx * 12} ${ny * 12} M ${b[0] - nx * 6} ${b[1] - ny * 6} l ${nx * 12} ${ny * 12}`
    }
  }
</script>

<div class="height-measurements" bind:clientWidth={width} bind:clientHeight={height}>
  <svg width="100%" height="100%" aria-label="Projector height dimensions">
    {#each drawings as drawing (drawing.measurement.id)}
      {@const measurement = drawing.measurement}
      <g class="height-dimension" data-projector-id={measurement.id}>
        <title
          >{measurement.name}: {heightText(measurement.height)}
          {heightRelation(measurement.height)}
          {measurement.referenceName}</title
        >
        {#if measurement.point}
          <line
            class="height-guide"
            x1={measurement.base[0]}
            y1={measurement.base[1]}
            x2={measurement.point[0]}
            y2={measurement.point[1]}
          />
          <circle
            class="height-reference-point"
            cx={measurement.point[0]}
            cy={measurement.point[1]}
            r="4"
          />
        {/if}
        <path
          class="height-extension"
          d={`M ${measurement.origin} L ${drawing.a} M ${measurement.base} L ${drawing.b}`}
        />
        <path
          class="height-dimension-line"
          d={`M ${drawing.a} L ${drawing.b} ${drawing.arrows} ${drawing.ticks}`}
        />
        <circle
          class="height-origin-point"
          cx={measurement.origin[0]}
          cy={measurement.origin[1]}
          r="3"
        />
        <path class="height-extension" d={drawing.leader} />
      </g>
    {/each}
    <!-- Keep every label above every dimension line when projectors are close together. -->
    {#each drawings as drawing (drawing.measurement.id)}
      {@const measurement = drawing.measurement}
      <foreignObject x={drawing.x} y={drawing.y} width="190" height="78">
        <div class="height-dimension-label">
          <span class="height-projector-name">{measurement.name} · Height</span>
          <strong>{heightText(measurement.height)}</strong>
          <span>{heightRelation(measurement.height)} {measurement.referenceName}</span>
        </div>
      </foreignObject>
    {/each}
  </svg>
</div>
