import { calculateHaversineDistanceKm } from '../gpx/parser.ts'
import { addIsoDays, buildTripCalendar, differenceInIsoDays } from '../trip/calendar.ts'
import type { RoadbookMatchReport, RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { TripDay, TripPlan, TripTimeline } from '../trip/types.ts'
import { getRoadbookPointRole } from '../trip/point-role.ts'
import { weatherConfig } from './config.ts'
import type {
  WeatherDayDefinition,
  WeatherRequestLocation,
  WeatherSamplePoint,
  WeatherSampleReference,
} from './types.ts'

interface WeatherPointGroup {
  readonly representative: RoadbookPointMatch
  readonly members: readonly RoadbookPointMatch[]
}

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
}

function isOperationalMatchedPoint(point: RoadbookPointMatch): boolean {
  return (
    point.resolution === 'matched' &&
    isFiniteNumber(point.matchedLatitude) &&
    isFiniteNumber(point.matchedLongitude) &&
    isFiniteNumber(point.matchedElevationM) &&
    isFiniteNumber(point.matchedTrackDistanceKm) &&
    point.eta !== undefined
  )
}

function hasSameProjection(
  left: RoadbookPointMatch,
  right: RoadbookPointMatch,
): boolean {
  return (
    left.matchedSegmentIndex !== undefined &&
    left.matchedPointIndex !== undefined &&
    left.matchedNextPointIndex !== undefined &&
    left.matchedSegmentFraction !== undefined &&
    left.matchedSegmentIndex === right.matchedSegmentIndex &&
    left.matchedPointIndex === right.matchedPointIndex &&
    left.matchedNextPointIndex === right.matchedNextPointIndex &&
    Math.abs(
      left.matchedSegmentFraction - (right.matchedSegmentFraction ?? NaN),
    ) < 1e-9
  )
}

export function shouldDeduplicateWeatherPoints(
  left: RoadbookPointMatch,
  right: RoadbookPointMatch,
  maximumDistanceM = weatherConfig.dedupeDistanceM,
  maximumElevationDifferenceM = weatherConfig.dedupeElevationM,
): boolean {
  if (left.dayId !== right.dayId) {
    return false
  }

  if (hasSameProjection(left, right)) {
    return true
  }

  if (
    !isFiniteNumber(left.matchedLatitude) ||
    !isFiniteNumber(left.matchedLongitude) ||
    !isFiniteNumber(left.matchedElevationM) ||
    !isFiniteNumber(right.matchedLatitude) ||
    !isFiniteNumber(right.matchedLongitude) ||
    !isFiniteNumber(right.matchedElevationM)
  ) {
    return false
  }

  const distanceM =
    calculateHaversineDistanceKm(
      {
        latitude: left.matchedLatitude,
        longitude: left.matchedLongitude,
        elevationM: left.matchedElevationM,
      },
      {
        latitude: right.matchedLatitude,
        longitude: right.matchedLongitude,
        elevationM: right.matchedElevationM,
      },
    ) * 1_000

  return (
    distanceM < maximumDistanceM &&
    Math.abs(left.matchedElevationM - right.matchedElevationM) <
      maximumElevationDifferenceM
  )
}

const POINT_TYPE_PRIORITY = new Map([
  ['start', 0],
  ['end', 1],
  ['col', 2],
  ['summit', 3],
  ['poi', 4],
  ['passage', 5],
])

function comparePrimaryPoints(
  left: RoadbookPointMatch,
  right: RoadbookPointMatch,
): number {
  return (
    (POINT_TYPE_PRIORITY.get(left.type) ?? 10) -
      (POINT_TYPE_PRIORITY.get(right.type) ?? 10) ||
    left.id.localeCompare(right.id)
  )
}

export function deduplicateMatchedWeatherPoints(
  points: readonly RoadbookPointMatch[],
): readonly WeatherPointGroup[] {
  const sorted = points
    .filter(isOperationalMatchedPoint)
    .sort(
      (left, right) =>
        (left.matchedTrackDistanceKm ?? 0) -
          (right.matchedTrackDistanceKm ?? 0) ||
        left.id.localeCompare(right.id),
    )
  const groups: RoadbookPointMatch[][] = []

  for (const point of sorted) {
    const compatibleGroup = groups.find((group) =>
      group.every((member) => shouldDeduplicateWeatherPoints(point, member)),
    )

    if (compatibleGroup === undefined) {
      groups.push([point])
    } else {
      compatibleGroup.push(point)
    }
  }

  return groups.map((members) => ({
    representative: [...members].sort(comparePrimaryPoints)[0] as RoadbookPointMatch,
    members: [...members].sort(
      (left, right) =>
        (left.matchedTrackDistanceKm ?? 0) -
          (right.matchedTrackDistanceKm ?? 0) ||
        left.id.localeCompare(right.id),
    ),
  }))
}

function createReference(point: RoadbookPointMatch): WeatherSampleReference {
  if (point.matchedTrackDistanceKm === undefined || point.eta === undefined) {
    throw new Error(`Point météo incomplet : ${point.id}`)
  }

  return {
    pointId: point.id,
    name: point.name,
    type: point.type,
    ...(point.subtype === undefined ? {} : { subtype: point.subtype }),
    trackDistanceKm: point.matchedTrackDistanceKm,
    eta: point.eta,
  }
}

function createRideSamplePoint(
  tripDate: WeatherSamplePoint['tripDate'],
  group: WeatherPointGroup,
): WeatherSamplePoint {
  const point = group.representative

  if (
    point.matchedLatitude === undefined ||
    point.matchedLongitude === undefined ||
    point.matchedElevationM === undefined ||
    point.matchedTrackDistanceKm === undefined ||
    point.eta === undefined
  ) {
    throw new Error(`Point météo incomplet : ${point.id}`)
  }

  return {
    id: `weather-${point.dayId}-${point.id}`,
    dayId: point.dayId,
    dayType: 'ride',
    tripDate,
    name: point.name,
    type: point.type,
    latitude: point.matchedLatitude,
    longitude: point.matchedLongitude,
    elevationM: point.matchedElevationM,
    trackDistanceKm: point.matchedTrackDistanceKm,
    eta: point.eta,
    sourcePointIds: group.members.map(({ id }) => id),
    references: group.members.map(createReference),
    source: 'roadbook-matched',
    role: 'route-point',
    contributesToDayRisk: true,
  }
}

function createWeatherReferenceSamplePoint(
  tripDate: WeatherSamplePoint['tripDate'],
  point: RoadbookPointMatch,
  plannedReferenceIds: ReadonlySet<string>,
): WeatherSamplePoint | null {
  if (
    getRoadbookPointRole(point) !== 'weather-reference' ||
    point.sourceLatitude === undefined || point.sourceLongitude === undefined ||
    (point.elevationM === undefined && point.matchedElevationM === undefined) ||
    point.matchedTrackDistanceKm === undefined || point.eta === undefined
  ) return null
  return {
    id: `weather-reference-${point.dayId}-${point.id}`,
    dayId: point.dayId,
    dayType: 'ride',
    tripDate,
    name: point.name,
    type: point.type,
    latitude: point.sourceLatitude,
    longitude: point.sourceLongitude,
    elevationM: point.elevationM ?? point.matchedElevationM as number,
    trackDistanceKm: point.matchedTrackDistanceKm,
    eta: point.eta,
    sourcePointIds: [point.id],
    references: [createReference(point)],
    source: 'roadbook-weather-reference',
    role: 'weather-reference',
    contributesToDayRisk: plannedReferenceIds.has(point.id),
  }
}

function toRequestLocation(point: WeatherSamplePoint): WeatherRequestLocation {
  return {
    id: `location-${point.id}`,
    name: point.name,
    latitude: point.latitude,
    longitude: point.longitude,
    elevationM: point.elevationM,
    samplePointIds: [point.id],
  }
}

function findAdjacentEndpoint(
  plan: TripPlan,
  offDay: Extract<TripDay, { type: 'off' }>,
  report: RoadbookMatchReport,
): RoadbookPointMatch | null {
  const dayIndex = plan.days.findIndex(({ id }) => id === offDay.id)
  const previousDay = plan.days[dayIndex - 1]
  const nextDay = plan.days[dayIndex + 1]
  const candidates = [
    ...(previousDay?.type === 'ride'
      ? report.allPointMatches.filter(
          ({ dayId, type }) => dayId === previousDay.id && type === 'end',
        )
      : []),
    ...(nextDay?.type === 'ride'
      ? report.allPointMatches.filter(
          ({ dayId, type }) => dayId === nextDay.id && type === 'start',
        )
      : []),
  ]

  return candidates.find(isOperationalMatchedPoint) ?? null
}

function createOffSamplePoint(
  plan: TripPlan,
  offDay: Extract<TripDay, { type: 'off' }>,
  tripDate: WeatherSamplePoint['tripDate'],
  report: RoadbookMatchReport,
): WeatherSamplePoint | null {
  const endpoint = findAdjacentEndpoint(plan, offDay, report)

  if (
    endpoint?.matchedLatitude === undefined ||
    endpoint.matchedLongitude === undefined ||
    endpoint.matchedElevationM === undefined
  ) {
    return null
  }

  return {
    id: `weather-${offDay.id}-off-location`,
    dayId: offDay.id,
    dayType: 'off',
    tripDate,
    name: offDay.locationName,
    type: 'off-location',
    latitude: endpoint.matchedLatitude,
    longitude: endpoint.matchedLongitude,
    elevationM: endpoint.matchedElevationM,
    sourcePointIds: [endpoint.id],
    references: [],
    source: 'adjacent-endpoint',
  }
}

function createRequiredDates(
  tripDate: WeatherSamplePoint['tripDate'],
  dayType: 'ride' | 'off',
  today: WeatherSamplePoint['tripDate'],
): readonly WeatherSamplePoint['tripDate'][] {
  const tripDates =
    dayType === 'off'
      ? [tripDate]
      : Array.from(
          { length: weatherConfig.retainedEtaDayOffsets + 1 },
          (_, dayOffset) => addIsoDays(tripDate, dayOffset),
        )

  return [...new Set([...tripDates, today])].sort()
}

/**
 * Outside the forecast horizon, only the three explicitly allowed current
 * references are requested: start, highest documented col and finish.
 */
export function selectCurrentReferenceSamplePoints(
  samplePoints: readonly WeatherSamplePoint[],
): readonly WeatherSamplePoint[] {
  const start = samplePoints.find((point) =>
    point.references.some(({ type }) => type === 'start'),
  )
  const finish = samplePoints.find((point) =>
    point.references.some(({ type }) => type === 'end'),
  )
  const mainCol = [...samplePoints]
    .filter((point) => point.references.some(({ type }) => type === 'col'))
    .sort(
      (left, right) =>
        right.elevationM - left.elevationM || left.id.localeCompare(right.id),
    )[0]

  return [...new Map(
    [start, mainCol, finish]
      .filter((point): point is WeatherSamplePoint => point !== undefined)
      .map((point) => [point.id, point]),
  ).values()]
}

export function buildWeatherDayDefinitions(
  plan: TripPlan,
  timeline: TripTimeline,
  report: RoadbookMatchReport,
  today: WeatherSamplePoint['tripDate'],
  plannedReferenceIds: ReadonlySet<string> = new Set(),
): readonly WeatherDayDefinition[] {
  const calendarByDayId = new Map(
    buildTripCalendar(plan).map(({ dayId, date }) => [dayId, date]),
  )
  const timelineByDayId = new Map(
    timeline.days.map((dayTimeline) => [dayTimeline.day.id, dayTimeline]),
  )

  return plan.days.map((day): WeatherDayDefinition => {
    const tripDate = calendarByDayId.get(day.id)

    if (tripDate === undefined) {
      throw new Error(`Date calendaire introuvable : ${day.id}`)
    }

    if (day.type === 'off') {
      const samplePoint = createOffSamplePoint(plan, day, tripDate, report)
      const samplePoints = samplePoint === null ? [] : [samplePoint]
      return {
        dayId: day.id,
        dayType: 'off',
        tripDate,
        samplePoints,
        locations: samplePoints.map(toRequestLocation),
        requiredDates: createRequiredDates(tripDate, 'off', today),
        ...(samplePoint === null
          ? { unavailableReason: 'Coordonnées locales OFF indisponibles.' }
          : {}),
      }
    }

    const timelineDay = timelineByDayId.get(day.id)
    if (
      timelineDay === undefined ||
      timelineDay.type !== 'ride' ||
      timelineDay.status !== 'ready'
    ) {
      return {
        dayId: day.id,
        dayType: 'ride',
        tripDate,
        samplePoints: [],
        locations: [],
        requiredDates: createRequiredDates(tripDate, 'ride', today),
        unavailableReason: 'Chronologie de la journée indisponible.',
      }
    }

    const pointGroups = deduplicateMatchedWeatherPoints(
      report.allPointMatches.filter(({ dayId }) => dayId === day.id),
    )
    const routePoints = pointGroups.map((group) => createRideSamplePoint(tripDate, group))
    const weatherReferences = report.allPointMatches
      .filter(({ dayId }) => dayId === day.id)
      .map((point) => createWeatherReferenceSamplePoint(tripDate, point, plannedReferenceIds))
      .filter((point): point is WeatherSamplePoint => point !== null)
    const allSamplePoints = [...routePoints, ...weatherReferences]
    const dayOffset = differenceInIsoDays(tripDate, today)
    const samplePoints =
      dayOffset >= weatherConfig.forecastDays
        ? selectCurrentReferenceSamplePoints(allSamplePoints)
        : allSamplePoints

    return {
      dayId: day.id,
      dayType: 'ride',
      tripDate,
      samplePoints,
      locations: samplePoints.map(toRequestLocation),
      requiredDates: createRequiredDates(tripDate, 'ride', today),
      ...(samplePoints.length === 0
        ? { unavailableReason: 'Aucun point roadbook apparié pour la météo.' }
        : {}),
    }
  })
}
