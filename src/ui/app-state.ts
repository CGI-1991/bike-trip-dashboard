import { differenceInIsoDays, getDateInTimezone, getTripDate } from '../trip/calendar.ts'
import { isTripDayId, rga2026TripPlan } from '../trip/plan.ts'
import type { TripDayId } from '../trip/types.ts'

export type AppView = 'today' | 'trip' | 'day-detail' | 'settings'

export interface AppUiState {
  readonly currentView: AppView
  readonly selectedDayId: TripDayId
  readonly returnView: Exclude<AppView, 'day-detail'>
}

export type TripPeriod =
  | { readonly kind: 'before'; readonly dayId: 'J1'; readonly daysUntilStart: number }
  | { readonly kind: 'during'; readonly dayId: TripDayId }
  | { readonly kind: 'after'; readonly dayId: 'J12' }

export function getTripPeriod(now: Date): TripPeriod {
  const localDate = getDateInTimezone(now, rga2026TripPlan.timezone)
  const firstDate = getTripDate(1)
  const lastDate = getTripDate(12)
  if (localDate < firstDate) {
    return { kind: 'before', dayId: 'J1', daysUntilStart: differenceInIsoDays(firstDate, localDate) }
  }
  if (localDate > lastDate) return { kind: 'after', dayId: 'J12' }
  return { kind: 'during', dayId: `J${differenceInIsoDays(localDate, firstDate) + 1}` as TripDayId }
}

export function parseAppHash(hash: string, fallbackDayId: TripDayId = 'J1'): AppUiState {
  const match = /^#\/day\/(J(?:[1-9]|1[0-2]))$/.exec(hash)
  if (match?.[1] !== undefined && isTripDayId(match[1])) {
    return { currentView: 'day-detail', selectedDayId: match[1], returnView: 'trip' }
  }
  if (hash === '#/trip') return { currentView: 'trip', selectedDayId: fallbackDayId, returnView: 'trip' }
  if (hash === '#/settings') return { currentView: 'settings', selectedDayId: fallbackDayId, returnView: 'today' }
  return { currentView: 'today', selectedDayId: fallbackDayId, returnView: 'today' }
}

export function hashForDay(dayId: TripDayId): string {
  return `#/day/${dayId}`
}
