import type { SceneDocument } from './types'

/** Resolve the analysis scope without falling back to an unrelated projector. */
export function analysisProjectors(doc: SceneDocument, selectedIds: readonly string[]) {
  const enabled = doc.projectors.filter((p) => p.enabled).slice(0, 8)
  if (doc.settings.analysisProjector !== 'all')
    return enabled.filter((p) => p.id === doc.settings.analysisProjector)
  // Receiver-only or empty selections show every enabled projector.
  const selected = new Set(selectedIds)
  return doc.projectors.some((p) => selected.has(p.id))
    ? enabled.filter((p) => selected.has(p.id))
    : enabled
}
