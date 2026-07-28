import type { RouteProfile, RouteProfilePauseAnchor, RouteProfilePosition } from '../route/types.ts'
import type { RideDayId } from './types.ts'

export const pausePlanStorageKey = 'rga-2026-dashboard.pause-plan.v1'

export interface PausePlanOverride {
  readonly dayId: RideDayId
  readonly disabledPauseIds: readonly string[]
  readonly replacements: Readonly<Record<string, string>>
}

export interface PausePlanDocument {
  readonly version: 1
  readonly overrides: readonly PausePlanOverride[]
}

const sharesByCount = {
  1: [1],
  2: [0.35, 0.65],
  3: [0.25, 0.5, 0.25],
  4: [0.15, 0.35, 0.35, 0.15],
} as const

const fractionsByCount = {
  1: [0.5],
  2: [0.35, 0.68],
  3: [0.25, 0.5, 0.75],
  4: [0.18, 0.4, 0.65, 0.84],
} as const

export function getPauseCount(movingMinutes: number): 1 | 2 | 3 | 4 {
  if (movingMinutes < 240) return 1
  if (movingMinutes < 360) return 2
  if (movingMinutes < 480) return 3
  return 4
}

export function getPauseDurationShares(count: 1 | 2 | 3 | 4): readonly number[] {
  return sharesByCount[count]
}

function closestPosition(profile: RouteProfile, fraction: number): RouteProfilePosition {
  const target = profile.summary.weightedDistanceKm * fraction
  const candidates = [
    ...profile.waypointSeeds.map(({ position }) => position),
    ...profile.segments.flatMap(({ startPosition, endPosition }) => [startPosition, endPosition]),
  ]
  const position = candidates.reduce((best, candidate) =>
    Math.abs(candidate.weightedDistanceKm - target) < Math.abs(best.weightedDistanceKm - target)
      ? candidate : best,
  )
  return position
}

export function createContextualPauseAnchors(
  profile: RouteProfile,
  averageSpeedKph: number,
): readonly RouteProfilePauseAnchor[] {
  const movingMinutes = (profile.summary.weightedDistanceKm / averageSpeedKph) * 60
  const count = getPauseCount(movingMinutes)
  return fractionsByCount[count].map((fraction, index) => ({
    id: index === Math.floor((count - 1) / 2) ? 'main' : `context-${index + 1}`,
    name: index === Math.floor((count - 1) / 2) ? 'Pause principale' : `Pause ${index + 1}`,
    durationShare: sharesByCount[count][index] ?? 0,
    position: closestPosition(profile, fraction),
  }))
}

export function loadPausePlan(storage: Storage = window.localStorage): PausePlanDocument {
  try {
    const raw = storage.getItem(pausePlanStorageKey)
    if (raw === null) return { version: 1, overrides: [] }
    const value: unknown = JSON.parse(raw)
    if (typeof value === 'object' && value !== null && 'version' in value && value.version === 1 && 'overrides' in value && Array.isArray(value.overrides)) {
      return value as PausePlanDocument
    }
  } catch { /* use an empty plan */ }
  return { version: 1, overrides: [] }
}

export function savePausePlan(plan: PausePlanDocument, storage: Storage = window.localStorage): boolean {
  try { storage.setItem(pausePlanStorageKey, JSON.stringify(plan)); return true } catch { return false }
}
