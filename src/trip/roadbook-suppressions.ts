import type { RideDayId } from './types.ts'

/**
 * Documented points the user has permanently removed from the operational trip.
 * This is a standing product decision, not a geometric or editorial verdict — it
 * must not be re-evaluated when the roadbook, overrides or GPX files change.
 *
 * `docs/sources/roadbook-rga-2026.md` and `public/data/trip/roadbook.json` keep
 * these points for historical/documentary traceability. This list is the single
 * source of truth that filters them out of every operational model — matching,
 * weather sampling, map, elevation profile, pause candidates — before those
 * models are built (see `createSourcePoints` and `buildRoadbookMatchReport` in
 * `roadbook-match.ts`).
 */
export interface RoadbookSuppressionEntry {
  readonly pointId: string
  readonly dayId: RideDayId
  readonly name: string
  readonly status: 'suppressed'
  readonly justification: string
  readonly origin: 'user-confirmed'
  readonly decidedOn: string
}

const commonJustification =
  'Point explicitement retiré du voyage opérationnel par décision utilisateur.'

export const roadbookSuppressions: readonly RoadbookSuppressionEntry[] = [
  {
    pointId: 'j01-passage-bellevaux',
    dayId: 'J1',
    name: 'Bellevaux',
    status: 'suppressed',
    justification: commonJustification,
    origin: 'user-confirmed',
    decidedOn: '2026-07-28',
  },
  {
    pointId: 'j03-passage-crest-voland',
    dayId: 'J3',
    name: 'Crest-Voland',
    status: 'suppressed',
    justification: commonJustification,
    origin: 'user-confirmed',
    decidedOn: '2026-07-28',
  },
  {
    pointId: 'j04-passage-areches',
    dayId: 'J4',
    name: 'Arêches',
    status: 'suppressed',
    justification: commonJustification,
    origin: 'user-confirmed',
    decidedOn: '2026-07-28',
  },
  {
    pointId: 'j04-passage-les-chapieux',
    dayId: 'J4',
    name: 'Les Chapieux',
    status: 'suppressed',
    justification: commonJustification,
    origin: 'user-confirmed',
    decidedOn: '2026-07-28',
  },
  {
    pointId: 'j06-passage-tignes',
    dayId: 'J6',
    name: 'Tignes',
    status: 'suppressed',
    justification: commonJustification,
    origin: 'user-confirmed',
    decidedOn: '2026-07-28',
  },
  {
    pointId: 'j09-passage-chateau-queyras',
    dayId: 'J9',
    name: 'Château-Queyras',
    status: 'suppressed',
    justification: commonJustification,
    origin: 'user-confirmed',
    decidedOn: '2026-07-28',
  },
  {
    pointId: 'j10-option-cime-de-la-bonette',
    dayId: 'J10',
    name: 'Cime de la Bonette',
    status: 'suppressed',
    justification: commonJustification,
    origin: 'user-confirmed',
    decidedOn: '2026-07-28',
  },
] as const

export const suppressedDocumentedPointIds: ReadonlySet<string> = new Set(
  roadbookSuppressions.map((entry) => entry.pointId),
)

export function isSuppressedDocumentedPoint(pointId: string): boolean {
  return suppressedDocumentedPointIds.has(pointId)
}
