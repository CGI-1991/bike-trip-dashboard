import type { RouteProfile, RouteProfilePauseAnchor, RouteProfilePosition } from '../route/types.ts'
import type { RideDayId } from './types.ts'

export const pausePlanStorageKey = 'rga-2026-dashboard.pause-plan.v1'
export type PausePlanMode = 'automatic' | 'custom'

export interface PausePlanItem {
  readonly id: string
  readonly active: boolean
  readonly placeId: string
  readonly placeName: string
  readonly durationMinutes: number
  readonly order: number
  readonly origin: 'automatic' | 'custom'
}

export interface PauseDayPlan { readonly dayId: RideDayId; readonly mode: PausePlanMode; readonly pauses: readonly PausePlanItem[] }
export interface PausePlanDocument { readonly version: 1; readonly days: readonly PauseDayPlan[] }
export interface PausePlace { readonly id: string; readonly name: string; readonly trackDistanceKm: number; readonly offRoute: boolean }

export const emptyPausePlan: PausePlanDocument = { version: 1, days: [] }

const sharesByCount = { 1: [1], 2: [0.35, 0.65], 3: [0.25, 0.5, 0.25], 4: [0.15, 0.35, 0.35, 0.15] } as const
const fractionsByCount = { 1: [0.5], 2: [0.35, 0.68], 3: [0.25, 0.5, 0.75], 4: [0.18, 0.4, 0.65, 0.84] } as const

export function getPauseCount(movingMinutes: number): 1 | 2 | 3 | 4 {
  if (movingMinutes < 240) return 1
  if (movingMinutes < 360) return 2
  if (movingMinutes < 480) return 3
  return 4
}
export const getPauseDurationShares = (count: 1 | 2 | 3 | 4): readonly number[] => sharesByCount[count]

function candidates(profile: RouteProfile): readonly RouteProfilePosition[] {
  return [...profile.waypointSeeds.map(({ position }) => position), ...profile.segments.flatMap(({ startPosition, endPosition }) => [startPosition, endPosition])]
}
function closestWeighted(profile: RouteProfile, target: number): RouteProfilePosition {
  return candidates(profile).reduce((best, candidate) => Math.abs(candidate.weightedDistanceKm - target) < Math.abs(best.weightedDistanceKm - target) ? candidate : best)
}
function closestDistance(profile: RouteProfile, target: number): RouteProfilePosition {
  return candidates(profile).reduce((best, candidate) => Math.abs(candidate.distanceKm - target) < Math.abs(best.distanceKm - target) ? candidate : best)
}

export function createContextualPauseAnchors(profile: RouteProfile, averageSpeedKph: number): readonly RouteProfilePauseAnchor[] {
  const count = getPauseCount((profile.summary.weightedDistanceKm / averageSpeedKph) * 60)
  return fractionsByCount[count].map((fraction, index) => ({
    id: index === Math.floor((count - 1) / 2) ? 'main' : `context-${index + 1}`,
    name: index === Math.floor((count - 1) / 2) ? 'Pause principale' : `Pause ${index + 1}`,
    durationShare: sharesByCount[count][index] ?? 0,
    position: closestWeighted(profile, profile.summary.weightedDistanceKm * fraction),
  }))
}

export function getPauseDayPlan(document: PausePlanDocument, dayId: RideDayId): PauseDayPlan | null {
  return document.days.find((day) => day.dayId === dayId) ?? null
}
export function upsertPauseDayPlan(document: PausePlanDocument, plan: PauseDayPlan): PausePlanDocument {
  return { version: 1, days: [...document.days.filter(({ dayId }) => dayId !== plan.dayId), plan] }
}
export function removePauseDayPlan(document: PausePlanDocument, dayId: RideDayId): PausePlanDocument {
  return { version: 1, days: document.days.filter((day) => day.dayId !== dayId) }
}

export function createCustomPauseAnchors(profile: RouteProfile, plan: PauseDayPlan, places: readonly PausePlace[]): readonly RouteProfilePauseAnchor[] | null {
  if (plan.mode !== 'custom') return null
  const placeById = new Map(places.map((place) => [place.id, place]))
  return plan.pauses.filter(({ active, durationMinutes }) => active && durationMinutes > 0).sort((a, b) => a.order - b.order).flatMap((pause) => {
    const place = placeById.get(pause.placeId)
    return place === undefined ? [] : [{ id: pause.id, name: pause.placeName, durationShare: pause.durationMinutes, position: closestDistance(profile, place.trackDistanceKm) }]
  })
}

function isPauseItem(value: unknown): value is PausePlanItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.active === 'boolean' && typeof item.placeId === 'string' && typeof item.placeName === 'string' && Number.isInteger(item.durationMinutes) && Number(item.durationMinutes) >= 0 && Number(item.durationMinutes) <= 240 && Number.isInteger(item.order) && (item.origin === 'automatic' || item.origin === 'custom')
}
function isDocument(value: unknown): value is PausePlanDocument {
  if (typeof value !== 'object' || value === null) return false
  const document = value as Record<string, unknown>
  return document.version === 1 && Array.isArray(document.days) && document.days.every((day) => typeof day === 'object' && day !== null && typeof (day as Record<string, unknown>).dayId === 'string' && ((day as Record<string, unknown>).mode === 'automatic' || (day as Record<string, unknown>).mode === 'custom') && Array.isArray((day as Record<string, unknown>).pauses) && ((day as Record<string, unknown>).pauses as unknown[]).every(isPauseItem))
}
export function loadPausePlan(storage: Storage = window.localStorage): PausePlanDocument {
  try { const raw = storage.getItem(pausePlanStorageKey); if (raw === null) return emptyPausePlan; const parsed: unknown = JSON.parse(raw); return isDocument(parsed) ? parsed : emptyPausePlan } catch { return emptyPausePlan }
}
export function savePausePlan(plan: PausePlanDocument, storage: Storage = window.localStorage): boolean {
  if (!isDocument(plan)) return false
  try { storage.setItem(pausePlanStorageKey, JSON.stringify(plan)); return true } catch { return false }
}
