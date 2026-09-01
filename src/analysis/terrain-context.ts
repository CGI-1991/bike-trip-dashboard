/**
 * D3.1 sections 13-16 — a live, honest "does this trip look mountainous"
 * read, replacing the plain `mountainMode ?? false` reflex every engine call
 * site used to reach for. `settings.global.mountainMode` itself is
 * UNTOUCHED (CDC section 16: "ne pas créer une migration lourde juste pour
 * remplacer un booléen") — its existing three states already carry exactly
 * the vocabulary this needs, and were simply never read this way before:
 *
 * - `undefined` (absent — every bundle from before this milestone, and any
 *   trip that never overrides it since): **automatic** — derive live from
 *   the trip's own aggregate elevation-gain-per-km, exactly the same metric
 *   `import-wizard-state.ts::deriveMountainModeDefault` already uses at
 *   import time, just applied continuously to whatever the trip's data
 *   looks like today instead of a one-time GPX pre-analysis snapshot.
 * - `true` — an explicit **forced-mountain** override (CDC section 15's
 *   "Réglages avancés" — never the default, only ever set by an explicit
 *   user action).
 * - `false` — an explicit **forced-normal** override, same rationale.
 *
 * `classifyClimbImportance` (`canonical-waypoints.ts`) still only ever
 * consumes the plain resulting boolean (`effectiveMountainMode`) — this
 * module owns exactly one thing: deciding what that boolean should be when
 * nobody explicitly overrode it, plus the three-way French label for the
 * "Informations" section (CDC section 14: "ne pas inventer 12 catégories").
 */

import type { TripBundle } from '../trip-core/index.ts'

export type TripTerrainLabel = 'rolling' | 'mixed' | 'mountain'
export type TripTerrainMode = 'automatic' | 'forced-mountain' | 'forced-normal'

export interface TripTerrainContext {
  readonly mode: TripTerrainMode
  readonly label: TripTerrainLabel
  /** The single boolean every engine call site (`canonical-waypoints.ts` et al.) actually needs — always resolved, never `undefined`. */
  readonly effectiveMountainMode: boolean
}

/**
 * Same cutoff as `import-wizard-state.ts::MOUNTAIN_MODE_ELEVATION_GAIN_PER_KM_THRESHOLD`
 * — a local, honestly-approximate rolling/local-vs-alpine boundary, not a
 * precise classification. `MIXED_THRESHOLD_M_PER_KM` adds the one extra
 * bucket CDC section 14 asks for ("Roulant"/"Mixte"/"Montagneux") — below it
 * is "rolling", at/above it but under the mountain cutoff is "mixed".
 */
const MOUNTAIN_THRESHOLD_M_PER_KM = 18
const MIXED_THRESHOLD_M_PER_KM = 10

/** Aggregate elevation gain per km across every ride stage with known metrics — `0` when the trip has no such data yet (never `NaN`/negative). */
export function computeTripElevationGainPerKm(bundle: TripBundle): number {
  const totalDistanceKm = bundle.stages.reduce((total, stage) => total + (stage.distanceKm ?? 0), 0)
  if (!(totalDistanceKm > 0)) return 0
  const totalElevationGainM = bundle.stages.reduce((total, stage) => total + Math.max(0, stage.elevationGainM ?? 0), 0)
  return totalElevationGainM / totalDistanceKm
}

export function deriveTerrainLabelFromElevationGainPerKm(elevationGainPerKm: number): TripTerrainLabel {
  if (elevationGainPerKm >= MOUNTAIN_THRESHOLD_M_PER_KM) return 'mountain'
  if (elevationGainPerKm >= MIXED_THRESHOLD_M_PER_KM) return 'mixed'
  return 'rolling'
}

/** The one function every screen should call instead of reading `settings.global.mountainMode` directly (CDC section 13-16). */
export function deriveTripTerrainContext(bundle: TripBundle): TripTerrainContext {
  const override = bundle.settings.global.mountainMode
  const autoLabel = deriveTerrainLabelFromElevationGainPerKm(computeTripElevationGainPerKm(bundle))
  if (override === true) return { mode: 'forced-mountain', label: 'mountain', effectiveMountainMode: true }
  if (override === false) return { mode: 'forced-normal', label: autoLabel === 'mountain' ? 'mixed' : autoLabel, effectiveMountainMode: false }
  return { mode: 'automatic', label: autoLabel, effectiveMountainMode: autoLabel === 'mountain' }
}

/** The plain boolean alone, for call sites that don't need the full context (CDC section 13's actual behavioural fix — was `bundle.settings.global.mountainMode ?? false`). */
export function resolveEffectiveMountainMode(bundle: TripBundle): boolean {
  return deriveTripTerrainContext(bundle).effectiveMountainMode
}

export const TRIP_TERRAIN_LABELS: Readonly<Record<TripTerrainLabel, string>> = {
  rolling: 'Roulant',
  mixed: 'Mixte',
  mountain: 'Montagneux',
}
