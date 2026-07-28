import type { RoadbookPointStatus, RoadbookResolution } from './roadbook-types.ts'

export interface RoadbookResolutionEntry {
  readonly pointId: string
  readonly resolution: RoadbookResolution
  readonly justification: string
  /**
   * Renames the point for display purposes only (name, not geometry or status).
   * Used for editorial groups whose roadbook title still mentions a permanently
   * suppressed place (see `roadbook-suppressions.ts`) — e.g. the Tignes / Val
   * d'Isère pause, kept only to enrich Val-d'Isère once Tignes is removed.
   */
  readonly displayName?: string
}

/**
 * Manual editorial resolutions for roadbook points whose geometric status alone
 * (`matched` / `needs-review` / `unmatched`) does not reflect the right product
 * decision. Each entry documents the technical reasoning so a reviewer can audit
 * or revisit it without re-deriving the analysis from scratch.
 *
 * Points not listed here fall back to the default rule in `resolveRoadbookResolution`.
 *
 * The seven points permanently removed by user decision (see
 * `roadbook-suppressions.ts`) are not listed here: they never reach this layer
 * at all, having already been filtered out of the operational model in
 * `createSourcePoints`.
 */
export const roadbookResolutionOverrides: readonly RoadbookResolutionEntry[] = [
  {
    pointId: 'j02-pause-cluses',
    resolution: 'informational',
    justification:
      'Pause éditoriale sans coordonnée propre : Cluses existe déjà comme passage apparié (j02-passage-cluses). Ce point reste une note de groupe, pas un waypoint géographique distinct.',
  },
  {
    pointId: 'j06-pause-tignes-val-d-isere',
    resolution: 'informational',
    displayName: 'Val-d’Isère',
    justification:
      'Tignes est supprimé du voyage opérationnel par décision utilisateur (roadbook-suppressions.ts) : ce point de pause n’enrichit plus qu’une seule localité, Val d’Isère, déjà appariée comme passage individuel. Conservé comme note de groupe, pas comme point géographique autonome.',
  },
  {
    pointId: 'j07-pause-modane-valloire',
    resolution: 'informational',
    justification:
      'Pause éditoriale combinant Modane et Valloire, déjà appariés individuellement comme passages. Conservée comme note de groupe, pas comme point géographique autonome.',
  },
  {
    pointId: 'j09-pause-guillestre-embrun',
    resolution: 'informational',
    justification:
      'Pause éditoriale combinant Guillestre et Embrun, déjà appariés individuellement comme passages. Conservée comme note de groupe, pas comme point géographique autonome.',
  },
  {
    pointId: 'j12-pause-sospel',
    resolution: 'informational',
    justification:
      'Pause éditoriale sans coordonnée propre : Sospel existe déjà comme passage apparié (j12-passage-sospel). Ce point reste une note de groupe, pas un waypoint géographique distinct.',
  },
] as const

const resolutionByPointId = new Map(
  roadbookResolutionOverrides.map((entry) => [entry.pointId, entry]),
)

export function getRoadbookResolutionEntry(
  pointId: string,
): RoadbookResolutionEntry | null {
  return resolutionByPointId.get(pointId) ?? null
}

/**
 * A point without a curated entry defaults to `matched` when the matching engine
 * already confirmed it, or `user-decision-required` otherwise — never a silent
 * `excluded`, which must always be an explicit, justified editorial choice.
 */
export function resolveRoadbookResolution(
  pointId: string,
  status: RoadbookPointStatus,
): RoadbookResolution {
  const entry = resolutionByPointId.get(pointId)

  if (entry !== undefined) {
    return entry.resolution
  }

  return status === 'matched' ? 'matched' : 'user-decision-required'
}
