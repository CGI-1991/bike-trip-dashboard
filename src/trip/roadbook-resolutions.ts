import type { RoadbookPointStatus, RoadbookResolution } from './roadbook-types.ts'

export interface RoadbookResolutionEntry {
  readonly pointId: string
  readonly resolution: RoadbookResolution
  readonly justification: string
}

/**
 * Manual editorial resolutions for roadbook points whose geometric status alone
 * (`matched` / `needs-review` / `unmatched`) does not reflect the right product
 * decision. Each entry documents the technical reasoning so a reviewer can audit
 * or revisit it without re-deriving the analysis from scratch.
 *
 * Points not listed here fall back to the default rule in `resolveRoadbookResolution`.
 */
export const roadbookResolutionOverrides: readonly RoadbookResolutionEntry[] = [
  {
    pointId: 'j03-passage-crest-voland',
    resolution: 'informational',
    justification:
      'Le centre de Crest-Voland reste à 1,9 km de la trace retenue (hors seuil "à contrôler" de 1 km) : la mention reste utile pour situer le secteur, sans coordonnée ni météo dédiées.',
  },
  {
    pointId: 'j04-passage-areches',
    resolution: 'informational',
    justification:
      'Le centre d’Arêches reste à environ 3 km de la trace retenue ("passage à confirmer" dans l’audit) : conservé comme repère de secteur plutôt que comme waypoint actif.',
  },
  {
    pointId: 'j04-passage-les-chapieux',
    resolution: 'informational',
    justification:
      'Deux passages GPX comparables à 521 m minimum (au-delà du seuil "matched" de 250 m), sans élément technique permettant de trancher entre eux : conservé comme repère de secteur.',
  },
  {
    pointId: 'j09-passage-chateau-queyras',
    resolution: 'informational',
    justification:
      'Le centre de Château-Queyras reste à 1,57 km de la trace retenue, légèrement au-delà du seuil "à contrôler" de 1 km : conservé comme repère de secteur plutôt que comme waypoint actif.',
  },
  {
    pointId: 'j01-passage-bellevaux',
    resolution: 'excluded',
    justification:
      'Localité non traversée : la projection GPX la plus proche (3,04 km) retombe dans le secteur déjà couvert par Lullin. Le tracé réel ne passe pas par Bellevaux.',
  },
  {
    pointId: 'j06-passage-tignes',
    resolution: 'excluded',
    justification:
      'Localité non traversée : les deux branches GPX les plus proches restent à plus de 3,27 km. Le tracé réel ne passe pas par Tignes (Val d’Isère, apparié séparément, reste actif).',
  },
  {
    pointId: 'j10-option-cime-de-la-bonette',
    resolution: 'excluded',
    justification:
      'Option non parcourue par ce plan de voyage : altitude GPX maximale (2 717 m) inférieure à la Cime (2 802 m) et aucune boucle distincte avec retour au col n’est présente dans la trace. Conservée comme mention roadbook, jamais utilisée pour la météo ni la chronologie.',
  },
  {
    pointId: 'j02-pause-cluses',
    resolution: 'informational',
    justification:
      'Pause éditoriale sans coordonnée propre : Cluses existe déjà comme passage apparié (j02-passage-cluses). Ce point reste une note de groupe, pas un waypoint géographique distinct.',
  },
  {
    pointId: 'j06-pause-tignes-val-d-isere',
    resolution: 'informational',
    justification:
      'Pause éditoriale combinant deux localités déjà représentées individuellement (Tignes exclu, Val d’Isère apparié). Conservée comme note de groupe, pas comme point géographique autonome.',
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
