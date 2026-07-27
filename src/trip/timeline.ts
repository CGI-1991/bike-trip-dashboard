import type { GpxAnalysisResult } from '../gpx/types.ts'
import { routeEngineConfig } from '../route/config.ts'
import type { RouteEngineConfig } from '../route/config.ts'
import { buildRouteProfile, scheduleRouteTimeline } from '../route/engine.ts'
import { createRouteClockTime } from '../route/time.ts'
import type { RouteClockTime, RouteEngineSettings } from '../route/types.ts'
import { assertTripPlan } from './plan.ts'
import type {
  OffDayTimeline,
  RideDay,
  RideDayTimeline,
  TripDayTimeline,
  TripPlan,
  TripProfile,
  TripTimeline,
} from './types.ts'

const comparisonEpsilon = 1e-9

function fail(message: string): never {
  throw new Error(`Chronologie du voyage invalide : ${message}`)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur de calcul inconnue.'
}

function parseClock(value: string): number {
  const match = /^(?<hours>[01]\d|2[0-3]):(?<minutes>[0-5]\d)$/.exec(value)

  if (match?.groups === undefined) {
    fail(`heure invalide : ${value}.`)
  }

  return Number(match.groups.hours) * 60 + Number(match.groups.minutes)
}

function routeClockTimesMatch(
  left: RouteClockTime,
  right: RouteClockTime,
): boolean {
  return (
    Math.abs(
      left.totalMinutesFromDeparture - right.totalMinutesFromDeparture,
    ) <= comparisonEpsilon &&
    left.clockMinutes === right.clockMinutes &&
    left.dayOffset === right.dayOffset
  )
}

function assertGpxBinding(day: RideDay, result: GpxAnalysisResult): void {
  const { source } = result

  if (
    source.fileNumber !== day.gpxNumber ||
    source.fileName !== day.gpxFile ||
    source.startName !== day.startName ||
    source.endName !== day.endName
  ) {
    fail(`la source GPX ne correspond pas au contrat de ${day.id}.`)
  }

  if (
    result.status === 'success' &&
    (result.summary.fileNumber !== day.gpxNumber ||
      result.summary.fileName !== day.gpxFile ||
      result.summary.startName !== day.startName ||
      result.summary.endName !== day.endName)
  ) {
    fail(`l’analyse GPX ne correspond pas au contrat de ${day.id}.`)
  }
}

export function buildTripProfile(
  plan: TripPlan,
  results: readonly GpxAnalysisResult[],
  config: RouteEngineConfig = routeEngineConfig,
): TripProfile {
  assertTripPlan(plan)

  const resultsByFileName = new Map<string, GpxAnalysisResult>()
  const sourceNumbers = new Set<number>()

  for (const result of results) {
    if (
      resultsByFileName.has(result.source.fileName) ||
      sourceNumbers.has(result.source.fileNumber)
    ) {
      fail(`source GPX dupliquée : ${result.source.fileName}.`)
    }

    resultsByFileName.set(result.source.fileName, result)
    sourceNumbers.add(result.source.fileNumber)
  }

  const expectedFiles = new Set(
    plan.days.flatMap((day) => (day.type === 'ride' ? [day.gpxFile] : [])),
  )

  if (
    resultsByFileName.size !== plan.rideDays ||
    [...resultsByFileName.keys()].some((fileName) => !expectedFiles.has(fileName))
  ) {
    fail('les dix sources GPX attendues doivent être présentes une seule fois.')
  }

  const days = plan.days.map((day) => {
    if (day.type === 'off') {
      return { type: 'off', day } as const
    }

    const result = resultsByFileName.get(day.gpxFile)

    if (result === undefined) {
      fail(`source GPX absente pour ${day.id}.`)
    }

    assertGpxBinding(day, result)

    if (result.status === 'error') {
      return {
        type: 'ride',
        status: 'unavailable',
        day,
        message: result.message,
      } as const
    }

    try {
      return {
        type: 'ride',
        status: 'ready',
        day,
        routeProfile: buildRouteProfile([result], config),
      } as const
    } catch (error) {
      return {
        type: 'ride',
        status: 'unavailable',
        day,
        message: getErrorMessage(error),
      } as const
    }
  })

  return {
    tripId: plan.id,
    days,
    routeConfig: config,
  }
}

function assertReadyRideDayTimeline(
  dayTimeline: RideDayTimeline,
  settings: RouteEngineSettings,
): void {
  const { day, route } = dayTimeline
  const firstWaypoint = route.waypoints[0]
  const firstSegment = route.segments[0]
  const expectedDepartureMinutes = parseClock(settings.departureTime)
  const expectedArrivalTime = createRouteClockTime(
    expectedDepartureMinutes,
    route.summary.totalDurationMinutes,
  )
  const pauseMinutes = route.pauses.reduce(
    (total, pause) => total + pause.durationMinutes,
    0,
  )

  if (
    route.summary.sourceGpxCount !== 1 ||
    route.summary.firstSourceFileNumber !== day.gpxNumber ||
    route.summary.lastSourceFileNumber !== day.gpxNumber ||
    route.segments.length !== 1
  ) {
    fail(`${day.id} doit contenir uniquement le GPX ${day.gpxNumber}.`)
  }

  if (
    firstWaypoint?.type !== 'route-start' ||
    firstSegment === undefined ||
    Math.abs(firstWaypoint.progress.distanceKm) > comparisonEpsilon ||
    Math.abs(firstWaypoint.progress.movingElapsedMinutes) > comparisonEpsilon ||
    Math.abs(firstWaypoint.progress.elapsedMinutes) > comparisonEpsilon ||
    Math.abs(firstWaypoint.progress.theoreticalTimeMinutes - expectedDepartureMinutes) >
      comparisonEpsilon ||
    Math.abs(firstSegment.startDistanceKm) > comparisonEpsilon ||
    Math.abs(firstSegment.startElapsedMinutes) > comparisonEpsilon ||
    Math.abs(firstSegment.startProgress.distanceKm) > comparisonEpsilon ||
    Math.abs(firstSegment.startProgress.movingElapsedMinutes) > comparisonEpsilon ||
    Math.abs(firstSegment.startProgress.elapsedMinutes) > comparisonEpsilon ||
    Math.abs(firstSegment.startTimeMinutes - expectedDepartureMinutes) >
      comparisonEpsilon ||
    route.summary.departureTimeMinutes !== expectedDepartureMinutes
  ) {
    fail(`${day.id} ne recommence pas à l’heure de départ configurée.`)
  }

  if (
    route.settings.averageSpeedKph !== settings.averageSpeedKph ||
    route.settings.departureTime !== settings.departureTime ||
    route.settings.totalBreakMinutes !== settings.totalBreakMinutes ||
    pauseMinutes !== settings.totalBreakMinutes ||
    route.summary.pauseDurationMinutes !== settings.totalBreakMinutes ||
    Math.abs(
      route.summary.arrivalTimeMinutes -
        route.summary.departureTimeMinutes -
        route.summary.movingDurationMinutes -
        route.summary.pauseDurationMinutes,
    ) > comparisonEpsilon
  ) {
    fail(`les pauses ou l’ETA de ${day.id} sont incohérentes.`)
  }

  for (let index = 1; index < route.waypoints.length; index++) {
    const previousWaypoint = route.waypoints[index - 1]
    const waypoint = route.waypoints[index]

    if (
      previousWaypoint === undefined ||
      waypoint === undefined ||
      waypoint.progress.elapsedMinutes + comparisonEpsilon <
        previousWaypoint.progress.elapsedMinutes ||
      waypoint.progress.distanceKm + comparisonEpsilon <
        previousWaypoint.progress.distanceKm
    ) {
      fail(`les waypoints de ${day.id} ne sont pas ordonnés.`)
    }
  }

  if (
    dayTimeline.startTime !== settings.departureTime ||
    !routeClockTimesMatch(dayTimeline.arrivalTime, expectedArrivalTime)
  ) {
    fail(`l’ETA locale de ${day.id} est incohérente.`)
  }
}

export function assertTripTimeline(timeline: TripTimeline): void {
  if (
    timeline.tripId !== 'rga-2026' ||
    timeline.days.length !== 12 ||
    timeline.summary.totalDays !== 12 ||
    timeline.summary.rideDays !== 10 ||
    timeline.summary.offDays !== 2
  ) {
    fail('le résultat doit contenir exactement 12 jours, 10 roulés et 2 OFF.')
  }

  let readyRideDays = 0
  let unavailableRideDays = 0
  let offDays = 0
  let totalDistanceKm = 0
  let totalElevationGainM = 0

  timeline.days.forEach((dayTimeline, index) => {
    if (
      dayTimeline.day.dayNumber !== index + 1 ||
      dayTimeline.day.id !== `J${index + 1}`
    ) {
      fail(`ordre incorrect pour ${dayTimeline.day.id}.`)
    }

    if (dayTimeline.type === 'off') {
      offDays++

      if (
        'route' in dayTimeline ||
        'startTime' in dayTimeline ||
        'arrivalTime' in dayTimeline
      ) {
        fail(`${dayTimeline.day.id} OFF ne doit contenir aucune donnée cycliste.`)
      }

      return
    }

    if (dayTimeline.status === 'unavailable') {
      unavailableRideDays++

      if ('route' in dayTimeline || 'arrivalTime' in dayTimeline) {
        fail(`${dayTimeline.day.id} indisponible ne doit pas contenir de fausse ETA.`)
      }

      return
    }

    readyRideDays++
    totalDistanceKm += dayTimeline.route.summary.distanceKm
    totalElevationGainM += dayTimeline.route.summary.elevationGainM
    assertReadyRideDayTimeline(dayTimeline, timeline.settings)
  })

  const j5 = timeline.days[4]
  const j8 = timeline.days[7]

  if (
    offDays !== 2 ||
    j5?.type !== 'off' ||
    j5.day.id !== 'J5' ||
    j5.day.locationName !== 'Bourg-Saint-Maurice' ||
    j8?.type !== 'off' ||
    j8.day.id !== 'J8' ||
    j8.day.locationName !== 'Briançon' ||
    readyRideDays !== timeline.summary.availableRideDays ||
    unavailableRideDays !== timeline.summary.unavailableRideDays ||
    readyRideDays + unavailableRideDays !== 10 ||
    !Number.isFinite(timeline.summary.totalDistanceKm) ||
    !Number.isFinite(timeline.summary.totalElevationGainM) ||
    Math.abs(timeline.summary.totalDistanceKm - totalDistanceKm) >
      comparisonEpsilon ||
    Math.abs(timeline.summary.totalElevationGainM - totalElevationGainM) >
      comparisonEpsilon
  ) {
    fail('les compteurs de journées sont incohérents.')
  }
}

export function scheduleTripTimeline(
  profile: TripProfile,
  settings: RouteEngineSettings,
): TripTimeline {
  const days: TripDayTimeline[] = profile.days.map((dayProfile) => {
    if (dayProfile.type === 'off') {
      const offTimeline: OffDayTimeline = {
        type: 'off',
        day: dayProfile.day,
      }
      return offTimeline
    }

    if (dayProfile.status === 'unavailable') {
      return {
        type: 'ride',
        status: 'unavailable',
        day: dayProfile.day,
        message: dayProfile.message,
      }
    }

    try {
      const route = scheduleRouteTimeline(dayProfile.routeProfile, settings)
      return {
        type: 'ride',
        status: 'ready',
        day: dayProfile.day,
        startTime: settings.departureTime,
        arrivalTime: createRouteClockTime(
          route.summary.departureTimeMinutes,
          route.summary.totalDurationMinutes,
        ),
        route,
      }
    } catch (error) {
      return {
        type: 'ride',
        status: 'unavailable',
        day: dayProfile.day,
        message: getErrorMessage(error),
      }
    }
  })
  const readyRideDays = days.filter(
    (day): day is RideDayTimeline =>
      day.type === 'ride' && day.status === 'ready',
  )
  const timeline: TripTimeline = {
    tripId: profile.tripId,
    settings: { ...settings },
    days,
    summary: {
      totalDays: 12,
      rideDays: 10,
      offDays: 2,
      availableRideDays: readyRideDays.length,
      unavailableRideDays: 10 - readyRideDays.length,
      totalDistanceKm: readyRideDays.reduce(
        (total, day) => total + day.route.summary.distanceKm,
        0,
      ),
      totalElevationGainM: readyRideDays.reduce(
        (total, day) => total + day.route.summary.elevationGainM,
        0,
      ),
    },
  }

  assertTripTimeline(timeline)
  return timeline
}

export function createTripTimeline(
  plan: TripPlan,
  results: readonly GpxAnalysisResult[],
  settings: RouteEngineSettings,
  config: RouteEngineConfig = routeEngineConfig,
): TripTimeline {
  return scheduleTripTimeline(buildTripProfile(plan, results, config), settings)
}

export function getTripTimelineDay(
  timeline: TripTimeline,
  dayId: string,
): TripDayTimeline | null {
  return timeline.days.find(({ day }) => day.id === dayId) ?? null
}
