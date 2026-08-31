import { computeStageWaypoints, resolveStagePauseSettings } from '../analysis/waypoint-timeline.ts'
import { parseClockToMinutes } from '../analysis/timing.ts'
import { routeGeometry } from '../route-enrichment/route-fingerprint.ts'
import type { IsoDate, TripBundle, TripDay, TripDayId } from '../trip-core/index.ts'

export interface RideArrivalEta {
  readonly label: string
  readonly minutesFromDayStart: number
}

export interface TripDayTemporalState {
  readonly dayId: TripDayId
  readonly completed: boolean
  readonly current: boolean
  readonly upcoming: boolean
  readonly arrivalEta: RideArrivalEta | null
}

export interface TripTemporalState {
  readonly localDate: IsoDate | null
  readonly localMinutes: number | null
  readonly days: readonly TripDayTemporalState[]
  readonly priorityDayId: TripDayId | null
}

export interface DeriveDayCompletionInput {
  readonly day: Pick<TripDay, 'date' | 'type'>
  readonly localDate: IsoDate | null
  readonly localMinutes: number | null
  readonly arrivalEtaMinutes: number | null
}

/**
 * The single D1 completion rule. A ride dated today completes only once its
 * existing theoretical ETA is reached; an unknown ETA never completes the
 * current day. OFF/transfer days complete only after their calendar date.
 */
export function isTripDayCompleted(input: DeriveDayCompletionInput): boolean {
  const { day, localDate, localMinutes, arrivalEtaMinutes } = input
  if (day.date === null || localDate === null) return false
  if (day.date < localDate) return true
  if (day.date > localDate || day.type !== 'ride') return false
  return arrivalEtaMinutes !== null && localMinutes !== null && localMinutes >= arrivalEtaMinutes
}

function localClock(now: Date | string | null, timezone: string | null): { readonly date: IsoDate | null; readonly minutes: number | null } {
  if (now === null) return { date: null, minutes: null }
  if (typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now)) {
    return { date: now as IsoDate, minutes: null }
  }
  const instant = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(instant.getTime())) return { date: null, minutes: null }
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...(timezone === null ? {} : { timeZone: timezone }),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const values = new Map(parts.map(({ type, value }) => [type, value]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')
  const hour = values.get('hour')
  const minute = values.get('minute')
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) {
    return { date: null, minutes: null }
  }
  return { date: `${year}-${month}-${day}` as IsoDate, minutes: Number(hour) * 60 + Number(minute) }
}

/** Reuses `computeStageWaypoints`, the existing timing/ETA pipeline. */
export function computeRideArrivalEta(bundle: TripBundle, day: TripDay): RideArrivalEta | null {
  if (day.type !== 'ride' || day.stageId === null) return null
  const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
  if (stage === undefined) return null
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  if (route === undefined || routeGeometry(route) === null) return null
  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const departureTime = daySettings?.departureTime ?? '08:00'
  const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stage.id)
  const pauseResolution = resolveStagePauseSettings(bundle.settings.global.pausePlanMode, stageSettings)
  const waypoints = computeStageWaypoints({
    stage,
    route,
    routePoints: bundle.routePoints,
    climbs: bundle.climbs,
    settings: { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime },
    manualPauses: pauseResolution.mode === 'custom' ? pauseResolution.manualPauses : undefined,
    mountainMode: bundle.settings.global.mountainMode ?? false,
  })
  const arrival = waypoints.at(-1)
  if (arrival?.clockTime === null || arrival?.clockTime === undefined || arrival.elapsedMinutes === null) return null
  return {
    label: arrival.clockTime,
    minutesFromDayStart: parseClockToMinutes(departureTime) + arrival.elapsedMinutes,
  }
}

export function deriveTripTemporalState(bundle: TripBundle, now: Date | string | null): TripTemporalState {
  const clock = localClock(now, bundle.calendar.timezone)
  const orderedDays = bundle.days.slice().sort((left, right) => left.index - right.index)
  const preliminary = orderedDays.map((day) => {
    const arrivalEta = computeRideArrivalEta(bundle, day)
    return {
      dayId: day.id,
      completed: isTripDayCompleted({
        day,
        localDate: clock.date,
        localMinutes: clock.minutes,
        arrivalEtaMinutes: arrivalEta?.minutesFromDayStart ?? null,
      }),
      arrivalEta,
    }
  })
  const hasDatedDays = orderedDays.some((day) => day.date !== null)
  const priorityDayId = preliminary.find((state, index) => {
    if (state.completed) return false
    return !hasDatedDays || orderedDays[index]?.date !== null
  })?.dayId ?? null
  const days = preliminary.map((state) => {
    const day = orderedDays.find((candidate) => candidate.id === state.dayId)
    const current = !state.completed && state.dayId === priorityDayId && day?.date !== null && day?.date === clock.date
    return { ...state, current, upcoming: !state.completed && !current }
  })
  return { localDate: clock.date, localMinutes: clock.minutes, days, priorityDayId }
}

export function getTripDayTemporalState(state: TripTemporalState, dayId: TripDayId): TripDayTemporalState | null {
  return state.days.find((day) => day.dayId === dayId) ?? null
}

export function resolveAdjacentTripDayId(bundle: TripBundle, dayId: TripDayId, direction: -1 | 1): TripDayId | null {
  const ids = bundle.days.slice().sort((left, right) => left.index - right.index).map((day) => day.id)
  const adjacent = ids[ids.indexOf(dayId) + direction]
  return adjacent ?? null
}
