/**
 * C2 user-facing taxonomy (CDC C2 section 3): exactly six categories shown
 * to the user — Vélo / Supermarché / Boulangerie / Eau / Abris / Toilette —
 * nothing else. Deliberately a thin display/filter layer on top of the
 * already-persisted `PracticalPlaceCategory` enum (`trip-core/model/
 * practical-place.ts`) rather than a new stored taxonomy: every one of the
 * six already exists verbatim as a category value (`bike-service`,
 * `supermarket`, `bakery`, `water`, `shelter`, `toilet`), so no
 * `schemaVersion` migration is needed (CDC section 3's own explicit
 * preference). `fast-food`/`cafe-or-ice-cream`/`sports` remain valid,
 * readable category values (never removed from the model) but are excluded
 * from every C2 UI surface — `isPracticalPlaceUxCategory` is the single
 * gate every map layer/popup builder filters through.
 */

import type { PracticalPlaceCategory } from '../trip-core/index.ts'

/** The six categories C2 ever shows — in the CDC's own display order. */
export const PRACTICAL_PLACE_UX_CATEGORIES = [
  'bike-service',
  'supermarket',
  'bakery',
  'water',
  'shelter',
  'toilet',
] as const satisfies readonly PracticalPlaceCategory[]

export type PracticalPlaceUxCategory = typeof PRACTICAL_PLACE_UX_CATEGORIES[number]

/** User-facing label per UX category (CDC section 3's own exact wording — "Vélo", never "Service vélo"/"Atelier"). */
export const PRACTICAL_PLACE_UX_LABELS: Readonly<Record<PracticalPlaceUxCategory, string>> = {
  'bike-service': 'Vélo',
  supermarket: 'Supermarché',
  bakery: 'Boulangerie',
  water: 'Eau',
  shelter: 'Abris',
  toilet: 'Toilette',
}

/** `true` for exactly the six categories C2 ever surfaces — the single gate every map layer/popup/count builder must filter through, never a category-by-category ad hoc check. */
export function isPracticalPlaceUxCategory(category: PracticalPlaceCategory): category is PracticalPlaceUxCategory {
  return (PRACTICAL_PLACE_UX_CATEGORIES as readonly PracticalPlaceCategory[]).includes(category)
}

/** Corridor categories (CDC section 10.A): searched continuously along the whole stage, retained within a fixed lateral distance of the GPX trace — never anchored to a specific stop. */
export const PRACTICAL_PLACE_CORRIDOR_CATEGORIES = ['water', 'shelter', 'toilet'] as const satisfies readonly PracticalPlaceUxCategory[]

/** Anchor categories (CDC section 10.B): searched only around départ/arrivée/localités retenues/pauses — never scanned along the full corridor. */
export const PRACTICAL_PLACE_ANCHOR_CATEGORIES = ['bike-service', 'supermarket', 'bakery'] as const satisfies readonly PracticalPlaceUxCategory[]

export function isPracticalPlaceCorridorCategory(category: PracticalPlaceCategory): boolean {
  return (PRACTICAL_PLACE_CORRIDOR_CATEGORIES as readonly PracticalPlaceCategory[]).includes(category)
}
