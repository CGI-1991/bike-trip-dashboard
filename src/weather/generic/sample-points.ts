/**
 * Generic weather sample-point / day-definition builder (CDC Jalon C1) — the
 * `TripBundle` counterpart of the legacy `weather/sample-points.ts` (which is
 * built entirely around `RoadbookPointMatch`/`TripPlan`/`TripTimeline`/
 * `RoadbookMatchReport` and is never imported here — see this module's own
 * "no RGA hardcode" guard, enforced by a dedicated test). Produces the exact
 * same `WeatherDayDefinition`/`WeatherSamplePoint` shapes the rest of
 * `src/weather/*` already consumes (provider, cache, coordinator, alerts),
 * so nothing downstream needs a generic-specific fork of that machinery.
 *
 * Source of truth for WHICH points matter (CDC Jalon C1 sections 9-10): the
 * exact same `isSignificantWaypoint` policy already used by Parcours/map/
 * profile/Aperçu (`analysis/canonical-waypoints.ts`) — never a second,
 * divergent "which points are important" rule. Pause is checked first
 * inside that shared policy, so a paused city/village is never duplicated
 * into a separate "pause" + "place" pair — there is only ever one
 * `CanonicalWaypoint` per physical stop to begin with (same merge already
 * relied on for map/profile/timeline).
 *
 * ETAs (CDC section 11): reused as-is from `computeStageWaypoints`'s own
 * `elapsedMinutes` (via `createRouteClockTime`, a pure structural
 * conversion, not a timing recomputation) — this module never re-runs the
 * terrain-timing engine.
 *
 * OFF days (CDC section 12) and transfers (CDC section 13): use the same
 * adjacency resolution already relied on by the Voyage day cards
 * (`analysis/day-location-fill.ts`) for both the location's name and its
 * real coordinates (the nearest ride stage's own endpoint). A transfer day
 * yields up to two independent, single-point "off"-shaped definitions
 * (origin/destination) — never a single definition with two sample points,
 * which the legacy `associateOffDay` (`weather/selectors.ts`) does not
 * support (it only ever reads `definition.samplePoints[0]`). No weather
 * along the transfer itself: there is no route geometry to place points on.
 */

import { isSignificantWaypoint } from '../../analysis/canonical-waypoints.ts'
import type { CanonicalWaypoint, CanonicalWaypointKind } from '../../analysis/canonical-waypoints.ts'
import { nearestNextRideStage, nearestPreviousRideStage, resolveOffLocation, resolveTransferLocations } from '../../analysis/day-location-fill.ts'
import { parseClockToMinutes } from '../../analysis/timing.ts'
import { computeStageWaypoints, resolveStagePauseSettings } from '../../analysis/waypoint-timeline.ts'
import { createRouteClockTime } from '../../route/time.ts'
import { routeGeometry } from '../../route-enrichment/route-fingerprint.ts'
import type { RoadbookPointType } from '../../trip/roadbook-types.ts'
import type { RideStage, RouteGeometryPoint, TripBundle, TripDay } from '../../trip-core/index.ts'
import type { WeatherDayDefinition, WeatherRequestLocation, WeatherSamplePoint } from '../types.ts'

/**
 * `CanonicalWaypointKind` → the closest `RoadbookPointType` (CDC section 9)
 * — only ever used to feed the already-generic `src/weather/alerts/*` risk
 * vocabulary (which points are "always evaluated"/"essential coverage",
 * which get the summit/col altitude-exposure treatment) — never RGA data
 * itself.
 */
const KIND_TO_ROADBOOK_TYPE: Readonly<Record<CanonicalWaypointKind, RoadbookPointType>> = {
  start: 'start',
  end: 'end',
  'mountain-pass': 'col',
  saddle: 'col',
  // A principal climb with no matching col/saddle landmark is still its own
  // summit (CDC section 9's own worked example) — 'summit' carries the same
  // altitude/exposure weight as 'col' in `alerts/exposure.ts`.
  climb: 'summit',
  // A city/town/village only ever reaches this builder once it is
  // significant — i.e. it carries a pause, since a bare locality is
  // filtered out by `isSignificantWaypoint` upstream. 'passage' is the
  // roadbook vocabulary's own "arrêt principal" category, which is exactly
  // what a chosen stop is (CDC section 10: a pause is a significant
  // weather point).
  city: 'passage',
  town: 'passage',
  village: 'passage',
  pause: 'pause',
}

function toSamplePoint(
  dayId: string,
  dayType: 'ride' | 'off',
  tripDate: string,
  departureMinutes: number,
  waypoint: CanonicalWaypoint,
): WeatherSamplePoint {
  return {
    id: waypoint.id,
    dayId,
    dayType,
    tripDate: tripDate as WeatherSamplePoint['tripDate'],
    name: waypoint.name,
    type: KIND_TO_ROADBOOK_TYPE[waypoint.kind],
    latitude: waypoint.latitude,
    longitude: waypoint.longitude,
    elevationM: waypoint.elevationM ?? 0,
    trackDistanceKm: waypoint.trackDistanceKm,
    ...(waypoint.elapsedMinutes === null ? {} : { eta: createRouteClockTime(departureMinutes, waypoint.elapsedMinutes) }),
    sourcePointIds: [waypoint.id],
    references: [],
    source: 'roadbook-matched',
  }
}

function toLocation(point: WeatherSamplePoint): WeatherRequestLocation {
  return { id: point.id, name: point.name, latitude: point.latitude, longitude: point.longitude, elevationM: point.elevationM, samplePointIds: [point.id] }
}

function unavailableDefinition(dayId: string, dayType: 'ride' | 'off', tripDate: string, reason: string): WeatherDayDefinition {
  return { dayId, dayType, tripDate: tripDate as WeatherDayDefinition['tripDate'], samplePoints: [], locations: [], requiredDates: [tripDate as WeatherDayDefinition['requiredDates'][number]], unavailableReason: reason }
}

/**
 * Builds the single `WeatherDayDefinition` for one ride day. Returns `null`
 * when `day` isn't a resolvable ride day at all (mirrors
 * `day-detail-view.ts::buildDayDetail`'s own null cases) — the caller skips
 * it entirely rather than showing an "unavailable" weather card for a day
 * that has no Étape screen either.
 */
export function buildRideDayWeatherDefinition(bundle: TripBundle, day: TripDay): WeatherDayDefinition | null {
  if (day.type !== 'ride' || day.stageId === null || day.date === null) return null
  const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
  if (stage === undefined) return null
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  if (route === undefined || routeGeometry(route) === null) return null

  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const departureTime = daySettings?.departureTime ?? '08:00'
  const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime }
  const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stage.id)
  const pauseResolution = resolveStagePauseSettings(bundle.settings.global.pausePlanMode, stageSettings)
  const waypoints = computeStageWaypoints({
    stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs, settings,
    manualPauses: pauseResolution.mode === 'custom' ? pauseResolution.manualPauses : undefined,
    mountainMode: bundle.settings.global.mountainMode ?? false,
  })
  // Never sends a point with no computed clock time at all (defensive —
  // `computeStageWaypoints` only omits `elapsedMinutes` for a degenerate
  // reference speed/distance, which should not happen for a validated
  // stage) — the legacy `associateRideDay` throws on a sample point with no
  // `eta`, so this module never builds one in the first place.
  const significant = waypoints.filter((waypoint) => isSignificantWaypoint(waypoint) && waypoint.elapsedMinutes !== null)
  if (significant.length === 0) return unavailableDefinition(day.id, 'ride', day.date, 'Aucun point météo disponible pour cette étape.')

  const departureMinutes = parseClockToMinutes(departureTime)
  const samplePoints = significant.map((waypoint) => toSamplePoint(day.id, 'ride', day.date as string, departureMinutes, waypoint))
  return {
    dayId: day.id,
    dayType: 'ride',
    tripDate: day.date,
    samplePoints,
    locations: samplePoints.map(toLocation),
    requiredDates: [day.date],
  }
}

/** First/last point of a stage's route geometry, with a safe elevation fallback (CDC section 12: OFF weather needs real coordinates, never invented ones) — the same endpoints `canonical-waypoints.ts` itself anchors départ/arrivée on. */
function endpointOf(stage: RideStage, bundle: TripBundle, which: 'start' | 'end'): { readonly latitude: number; readonly longitude: number; readonly elevationM: number; readonly name: string } | null {
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  const geometry = route === undefined ? null : routeGeometry(route)
  if (geometry === null || geometry.length === 0) return null
  const point: RouteGeometryPoint | undefined = which === 'start' ? geometry[0] : geometry[geometry.length - 1]
  if (point === undefined) return null
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    elevationM: point.altitudeM ?? 0,
    name: (which === 'start' ? stage.startLocationName : stage.endLocationName) ?? 'Lieu',
  }
}

/** Real coordinates for an OFF/transfer day's resolved location, from whichever neighbouring ride stage the name itself was resolved from — never invented. */
function resolveAdjacentCoordinates(bundle: TripBundle, day: TripDay, fallbackName: string): { readonly latitude: number; readonly longitude: number; readonly elevationM: number; readonly name: string } | null {
  const previous = nearestPreviousRideStage(bundle, day.index)
  const fromPrevious = previous === null ? null : endpointOf(previous, bundle, 'end')
  if (fromPrevious !== null) return { ...fromPrevious, name: fallbackName }
  const next = nearestNextRideStage(bundle, day.index)
  const fromNext = next === null ? null : endpointOf(next, bundle, 'start')
  return fromNext === null ? null : { ...fromNext, name: fallbackName }
}

/**
 * Builds the single `WeatherDayDefinition` for an OFF day (CDC section 12):
 * one location, the same one `resolveOffLocation` already names for the
 * Voyage day card — never a fabricated trace or displacement.
 */
export function buildOffDayWeatherDefinition(bundle: TripBundle, day: TripDay): WeatherDayDefinition | null {
  if (day.type !== 'off' || day.date === null) return null
  const location = resolveOffLocation(bundle, day)
  if (location.name === null) return unavailableDefinition(day.id, 'off', day.date, 'Lieu de la journée OFF inconnu.')
  const coordinates = resolveAdjacentCoordinates(bundle, day, location.name)
  if (coordinates === null) return unavailableDefinition(day.id, 'off', day.date, 'Coordonnées indisponibles pour cette journée OFF.')

  const samplePoint: WeatherSamplePoint = {
    id: `${day.id}:off-location`,
    dayId: day.id,
    dayType: 'off',
    tripDate: day.date,
    name: coordinates.name,
    type: 'off-location',
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    elevationM: coordinates.elevationM,
    sourcePointIds: [`${day.id}:off-location`],
    references: [],
    source: 'adjacent-endpoint',
  }
  return { dayId: day.id, dayType: 'off', tripDate: day.date, samplePoints: [samplePoint], locations: [toLocation(samplePoint)], requiredDates: [day.date] }
}

export interface TransferWeatherDefinitions {
  readonly origin: WeatherDayDefinition | null
  readonly destination: WeatherDayDefinition | null
}

/** Suffix convention for a transfer's two independent "off"-shaped virtual days (CDC section 13) — never registered as the transfer's own real `TripDayId` with the coordinator, only ever looked up through `buildTransferWeatherDefinitions`'s own return value. */
export function transferOriginDayKey(dayId: string): string { return `${dayId}::origin` }
export function transferDestinationDayKey(dayId: string): string { return `${dayId}::destination` }

/**
 * Builds up to two independent, single-point "off"-shaped `WeatherDayDefinition`s
 * for a transfer day's origin/destination (CDC section 13) — never a route,
 * never an invented time of transfer. `dedicated`/`after_previous`/
 * `before_next` only ever affects which calendar date this transfer's own
 * `day.date` already resolved to upstream (`day-structure.ts`); this module
 * only ever reads that already-resolved date, never a transfer-specific
 * clock time (none exists in the data model).
 */
export function buildTransferWeatherDefinitions(bundle: TripBundle, day: TripDay): TransferWeatherDefinitions {
  if (day.type !== 'transfer' || day.date === null) return { origin: null, destination: null }
  const tripDate = day.date
  const { origin, destination } = resolveTransferLocations(bundle, day)

  const buildSide = (name: string | null, key: string, coordinates: ReturnType<typeof resolveAdjacentCoordinates>): WeatherDayDefinition | null => {
    if (name === null || coordinates === null) return null
    const samplePoint: WeatherSamplePoint = {
      id: `${key}:location`,
      dayId: key,
      dayType: 'off',
      tripDate,
      name: coordinates.name,
      type: 'off-location',
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      elevationM: coordinates.elevationM,
      sourcePointIds: [`${key}:location`],
      references: [],
      source: 'adjacent-endpoint',
    }
    return { dayId: key, dayType: 'off', tripDate, samplePoints: [samplePoint], locations: [toLocation(samplePoint)], requiredDates: [tripDate] }
  }

  const previous = nearestPreviousRideStage(bundle, day.index)
  const next = nearestNextRideStage(bundle, day.index)
  const originCoordinates = origin === null ? null : (previous === null ? null : endpointOf(previous, bundle, 'end'));
  const destinationCoordinates = destination === null ? null : (next === null ? null : endpointOf(next, bundle, 'start'))

  return {
    origin: buildSide(origin, transferOriginDayKey(day.id), originCoordinates === null ? null : { ...originCoordinates, name: origin as string }),
    destination: buildSide(destination, transferDestinationDayKey(day.id), destinationCoordinates === null ? null : { ...destinationCoordinates, name: destination as string }),
  }
}

/**
 * Builds every weather day-definition for the whole trip in one pass (CDC
 * Jalon C1 section 8's pipeline: `TripBundle` → journée → ... → weather
 * request) — the generic counterpart of the legacy
 * `buildWeatherDayDefinitions(plan, timeline, report, ...)`, fed straight
 * into `WeatherCoordinator.setDefinitions()`. Transfers contribute their
 * origin/destination virtual definitions under suffixed keys rather than
 * their own real `day.id` (see `transferOriginDayKey`/
 * `transferDestinationDayKey`) — `generic/coordinator.ts` is what stitches
 * those back together into one view-model per real `TripDay`.
 */
export function buildTripWeatherDayDefinitions(bundle: TripBundle): readonly WeatherDayDefinition[] {
  const definitions: WeatherDayDefinition[] = []
  for (const day of bundle.days) {
    if (day.type === 'ride') {
      const definition = buildRideDayWeatherDefinition(bundle, day)
      if (definition !== null) definitions.push(definition)
    } else if (day.type === 'off') {
      const definition = buildOffDayWeatherDefinition(bundle, day)
      if (definition !== null) definitions.push(definition)
    } else {
      const { origin, destination } = buildTransferWeatherDefinitions(bundle, day)
      if (origin !== null) definitions.push(origin)
      if (destination !== null) definitions.push(destination)
    }
  }
  return definitions
}
