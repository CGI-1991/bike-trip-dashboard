import type { RideStage, RouteGeometryPoint, TripBundle } from '../trip-core/index.ts'
import type { RaceBounds } from '../trip-core/model/ride-stage.ts'
import { selectRaceMode, selectOrganizationCapabilities } from '../trip-core/index.ts'
import { routeFingerprint, routeGeometry } from '../route-enrichment/route-fingerprint.ts'
import { indexRouteGeometry, sliceRouteGeometry } from '../route-enrichment/segment-geometry.ts'
import type { DistanceIndexedGeometry } from '../route-enrichment/segment-geometry.ts'
import { calculateSmoothedElevationMetrics } from '../import/gpx/analyze-gpx.ts'
import type { CanonicalWaypoint } from './canonical-waypoints.ts'

export interface RaceCourse {
  readonly fingerprint: string
  readonly indexed: DistanceIndexedGeometry
  readonly status: 'full' | 'bounded' | 'stale'
  readonly bounds: RaceBounds | null
  readonly geometry: readonly RouteGeometryPoint[] | null
}

const geometryIndexes = new WeakMap<readonly RouteGeometryPoint[], DistanceIndexedGeometry>()
const courses = new WeakMap<RideStage, { readonly geometry: readonly RouteGeometryPoint[]; readonly fingerprint: string; readonly course: RaceCourse }>()

export function validRaceOffsets(bounds: Pick<RaceBounds, 'startOffsetM' | 'finishOffsetM'>, lengthKm: number): boolean {
  return Number.isFinite(bounds.startOffsetM) && Number.isFinite(bounds.finishOffsetM)
    && bounds.startOffsetM >= 0 && bounds.finishOffsetM > bounds.startOffsetM
    && bounds.finishOffsetM <= lengthKm * 1000 + 0.001
}

/** One chainage shared with the map/profile/waypoints. No nearest-coordinate lookup:
 * multiple visits to an identical location remain distinct offsets. */
export function buildRaceCourse(bundle: TripBundle, stage: RideStage): RaceCourse | null {
  if (!selectRaceMode(bundle)) return null
  const route = bundle.routes.find(route => route.id === stage.sourceRouteId)
  const geometry = route === undefined ? null : routeGeometry(route)
  if (route === undefined || geometry === null) return null
  let indexed = geometryIndexes.get(geometry)
  if (indexed === undefined) { indexed = indexRouteGeometry(geometry); geometryIndexes.set(geometry, indexed) }
  if (indexed.lengthKm <= 0) return null
  const fingerprint = routeFingerprint(bundle, route)
  const cached = courses.get(stage)
  if (cached?.geometry === geometry && cached.fingerprint === fingerprint) return cached.course
  const bounds = stage.raceBounds ?? null
  if (bounds !== null && (bounds.routeFingerprint !== fingerprint || !validRaceOffsets(bounds, indexed.lengthKm))) {
    return { fingerprint, indexed, status: 'stale', bounds, geometry: null }
  }
  const course: RaceCourse = { fingerprint, indexed, status: bounds === null ? 'full' : 'bounded', bounds,
    geometry: bounds === null ? geometry : sliceRouteGeometry(indexed, bounds.startOffsetM / 1000, bounds.finishOffsetM / 1000) }
  courses.set(stage, { geometry, fingerprint, course })
  return course
}

type CourseElevationMetrics = { readonly elevationGainM: number | null; readonly elevationLossM: number | null }
const elevationMetrics = new WeakMap<readonly RouteGeometryPoint[], CourseElevationMetrics>()
export function raceCourseMetrics(geometry: readonly RouteGeometryPoint[]): {
  readonly elevationGainM: number | null; readonly elevationLossM: number | null
} {
  const cached = elevationMetrics.get(geometry)
  if (cached !== undefined) return cached
  // Reuse the import's 150 m smoothing, without modifying the original elevations.
  // A gap in altitude must not become a fictitious climb across that gap.
  let gain = 0, loss = 0, comparisons = 0
  let run: RouteGeometryPoint[] = []
  const flush = () => {
    if (run.length >= 2) {
      const metrics = calculateSmoothedElevationMetrics(run.map(point => ({ ...point, elevationM: point.altitudeM })))
      if (metrics.elevationGainM !== null && metrics.elevationLossM !== null) {
        gain += metrics.elevationGainM; loss += metrics.elevationLossM; comparisons++
      }
    }
    run = []
  }
  for (const point of geometry) { if (point.altitudeM === null) flush(); else run.push(point) }
  flush()
  const metrics = { elevationGainM: comparisons === 0 ? null : gain, elevationLossM: comparisons === 0 ? null : loss }
  elevationMetrics.set(geometry, metrics)
  return metrics
}

/** Operational figures; source RideStage metrics continue to describe the GPX. */
export function selectStageCourseMetrics(bundle: TripBundle, stage: RideStage): Pick<RideStage, 'distanceKm' | 'elevationGainM' | 'elevationLossM'> {
  const course = buildRaceCourse(bundle, stage)
  if (selectOrganizationCapabilities(bundle).explicitRaceBounds && course?.status !== 'bounded') return { distanceKm: null, elevationGainM: null, elevationLossM: null }
  if (course === null || course.status === 'full') return stage
  if (course.geometry === null || course.bounds === null) return { distanceKm: null, elevationGainM: null, elevationLossM: null }
  return { distanceKm: (course.bounds.finishOffsetM - course.bounds.startOffsetM) / 1000, ...raceCourseMetrics(course.geometry) }
}

/** Stable, separate endpoint ids. GPX offsets stay absolute for map/profile/wind. */
export function courseWaypoints(base: readonly CanonicalWaypoint[], stage: RideStage, course: RaceCourse): readonly CanonicalWaypoint[] {
  if (course.status === 'stale' || course.geometry === null) return []
  if (course.bounds === null) return base
  const start = course.bounds.startOffsetM / 1000, finish = course.bounds.finishOffsetM / 1000
  const endpoint = (kind: 'start' | 'end', distanceKm: number, point: RouteGeometryPoint): CanonicalWaypoint => ({
    id: `${stage.id}:race-${kind}`, kind, importance: 'major', visibleByDefault: true,
    name: kind === 'start' ? 'Départ de course' : 'Arrivée de course', trackDistanceKm: distanceKm,
    latitude: point.latitude, longitude: point.longitude, elevationM: point.altitudeM,
    climbId: null, pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
  })
  return [endpoint('start', start, course.geometry[0]!),
    ...base.filter(point => point.kind !== 'start' && point.kind !== 'end' && point.trackDistanceKm > start && point.trackDistanceKm < finish),
    endpoint('end', finish, course.geometry.at(-1)!) ]
}

/** Intended for updateTripBundle: guards the latest route inside the transaction.
 * Does not touch GPX payloads, dates, weather, source metrics or other stages. */
export function applyRaceBounds(bundle: TripBundle, stageId: RideStage['id'], bounds: RaceBounds | null, expectedFingerprint: string, updatedAt: string): TripBundle {
  const stage = bundle.stages.find(stage => stage.id === stageId)
  const course = stage === undefined ? null : buildRaceCourse(bundle, stage)
  if (stage === undefined || course === null || course.fingerprint !== expectedFingerprint) {
    throw new Error('Le parcours a changé. Rouvrez la course avant de définir ses limites.')
  }
  if (bounds !== null && (bounds.routeFingerprint !== course.fingerprint || !validRaceOffsets(bounds, course.indexed.lengthKm))) {
    throw new Error('Choisissez un départ avant l’arrivée, dans les limites de la trace GPX.')
  }
  if ((bounds === null && stage.raceBounds === undefined) || (bounds !== null && stage.raceBounds?.routeFingerprint === bounds.routeFingerprint
    && stage.raceBounds.startOffsetM === bounds.startOffsetM && stage.raceBounds.finishOffsetM === bounds.finishOffsetM)) return bundle
  const { raceBounds: _previous, ...rest } = stage
  const weather = bundle.weather.some(record => record.dayId === stage.dayId) ? bundle.weather.filter(record => record.dayId !== stage.dayId) : bundle.weather
  return { ...bundle, weather, metadata: { ...bundle.metadata, updatedAt }, stages: bundle.stages.map(candidate => candidate.id !== stageId ? candidate : { ...rest, weatherRecordIds: [], ...(bounds === null ? {} : { raceBounds: bounds }) }) }
}
