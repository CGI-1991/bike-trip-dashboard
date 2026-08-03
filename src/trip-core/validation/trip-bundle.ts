import { CURRENT_TRIP_BUNDLE_SCHEMA_VERSION } from '../schema/version.ts'
import type { TripBundle } from '../schema/version.ts'
import {
  addCivilDays,
  isBoolean,
  isFiniteNumber,
  isIsoDate,
  isIsoDateTime,
  isKnownIanaTimezone,
  isLatitude,
  isLongitude,
  isNonEmptyString,
  isNonEmptyStringArray,
  isNonNegativeInteger,
  isNonNegativeNumber,
  isOneOf,
  isPlainObject,
  isPositiveInteger,
  isPositiveNumber,
  isSha256Hex,
  isSlug,
  isStringArray,
  isTimeOfDay,
} from './primitives.ts'
import { issue } from './primitives.ts'
import type { ValidationIssue, ValidationResult } from './types.ts'

const TRIP_STATUSES = ['draft', 'ready', 'archived'] as const
const TRIP_UNITS = ['metric', 'imperial'] as const
const TRIP_DAY_TYPES = ['ride', 'off', 'transfer'] as const
const TRIP_DAY_ENRICHMENT_STATUSES = ['not-started', 'partial', 'complete'] as const
const RIDE_STAGE_VALIDATION_STATUSES = ['pending', 'valid', 'needs-review'] as const
const PARSING_STATUSES = ['pending', 'success', 'partial', 'error'] as const
const CLIMB_CONFIDENCES = ['confirmed', 'probable', 'uncertain'] as const
const ROUTE_POINT_TYPES = [
  'start', 'end', 'summit', 'village', 'passage', 'resupply', 'pause', 'shelter', 'lodging', 'poi',
] as const
const PRACTICAL_PLACE_CATEGORIES = [
  'shelter', 'bakery', 'cafe-or-ice-cream', 'water', 'fast-food', 'bike-service', 'supermarket', 'sports', 'toilet',
] as const
const OSM_ROUTE_FEATURE_TYPES = ['city', 'town', 'village', 'mountain-pass', 'saddle', 'peak'] as const
const ACCOMMODATION_TYPES = [
  'hotel', 'airbnb', 'gite', 'chambre-hotes', 'hostel', 'guest-house', 'refuge', 'camping',
] as const
const DATA_SOURCE_TYPES = ['user', 'gpx', 'osm', 'open-meteo', 'generated', 'migrated'] as const
const ENRICHMENT_PROVIDERS = ['gpx', 'osm', 'osm-practical-places', 'osm-route-enrichment', 'open-meteo'] as const
const ENRICHMENT_PROVIDER_STATUSES = ['not-configured', 'pending', 'success', 'partial', 'error'] as const
const DERIVED_DATA_STATUSES = ['not-generated', 'stale', 'partial', 'fresh'] as const
const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
const PAUSE_PLAN_MODES = ['automatic', 'custom'] as const
const OVERRIDE_TARGET_TYPES = [
  'trip-day', 'ride-stage', 'route-point', 'climb', 'practical-place', 'accommodation',
] as const

function validateProvenance(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isPlainObject(value)) {
    issues.push(issue(path, 'invalid-provenance', 'Provenance manquante ou invalide.'))
    return
  }
  if (!isOneOf(value.sourceType, DATA_SOURCE_TYPES)) {
    issues.push(issue(`${path}.sourceType`, 'invalid-enum', 'Type de source de provenance invalide.'))
  }
  if (value.sourceId !== null && !isNonEmptyString(value.sourceId)) {
    issues.push(issue(`${path}.sourceId`, 'invalid-value', 'sourceId doit être une chaîne non vide ou null.'))
  }
  if (value.fetchedAt !== null && !isIsoDateTime(value.fetchedAt)) {
    issues.push(issue(`${path}.fetchedAt`, 'invalid-datetime', 'fetchedAt doit être un ISO 8601 ou null.'))
  }
  if (!isNonEmptyString(value.engineVersion)) {
    issues.push(issue(`${path}.engineVersion`, 'missing-required', 'engineVersion est requis.'))
  }
  if (value.confidence !== null && !isOneOf(value.confidence, CONFIDENCE_LEVELS)) {
    issues.push(issue(`${path}.confidence`, 'invalid-enum', 'confidence invalide.'))
  }
  if (!isBoolean(value.manuallyOverridden)) {
    issues.push(issue(`${path}.manuallyOverridden`, 'invalid-type', 'manuallyOverridden doit être un booléen.'))
  }
}

function collectIds(items: readonly Record<string, unknown>[], field: string, collectionPath: string, issues: ValidationIssue[]): Set<string> {
  const ids = new Set<string>()
  items.forEach((item, index) => {
    const path = `${collectionPath}[${index}].${field}`
    const raw = item[field]
    if (!isNonEmptyString(raw)) {
      issues.push(issue(path, 'missing-required', `${field} doit être une chaîne non vide.`))
      return
    }
    if (ids.has(raw)) {
      issues.push(issue(path, 'duplicate-id', `Identifiant dupliqué : ${raw}.`))
      return
    }
    ids.add(raw)
  })
  return ids
}

function asRecordArray(value: unknown, path: string, issues: ValidationIssue[]): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'invalid-type', `${path} doit être une collection.`))
    return []
  }
  return value.map((item, index) => {
    if (!isPlainObject(item)) {
      issues.push(issue(`${path}[${index}]`, 'invalid-type', 'Élément de collection invalide.'))
      return {}
    }
    return item
  })
}

/**
 * Validates an unknown value as a TripBundle (current version only).
 *
 * Accumulates every issue it finds rather than stopping at the first one,
 * is fully deterministic, has no side effects, and never repairs data.
 */
export function validateTripBundle(value: unknown): ValidationResult<TripBundle> {
  const issues: ValidationIssue[] = []

  if (!isPlainObject(value)) {
    return { ok: false, issues: [issue('', 'invalid-root', 'La racine du TripBundle doit être un objet.')] }
  }

  if (value.schemaVersion !== CURRENT_TRIP_BUNDLE_SCHEMA_VERSION) {
    issues.push(
      issue('schemaVersion', 'unsupported-schema-version', `Version de schéma non prise en charge : ${String(value.schemaVersion)}.`),
    )
  }

  // --- metadata ---------------------------------------------------------
  const metadata = value.metadata
  if (!isPlainObject(metadata)) {
    issues.push(issue('metadata', 'missing-required', 'metadata est requis.'))
  } else {
    if (!isNonEmptyString(metadata.id)) issues.push(issue('metadata.id', 'missing-required', 'metadata.id est requis.'))
    if (!isSlug(metadata.slug)) issues.push(issue('metadata.slug', 'invalid-value', 'metadata.slug doit être un slug utilisable.'))
    if (!isNonEmptyString(metadata.name)) issues.push(issue('metadata.name', 'missing-required', 'metadata.name est requis.'))
    if (metadata.description !== null && !isNonEmptyString(metadata.description)) {
      issues.push(issue('metadata.description', 'invalid-value', 'metadata.description doit être une chaîne non vide ou null.'))
    }
    if (!isIsoDateTime(metadata.createdAt)) issues.push(issue('metadata.createdAt', 'invalid-datetime', 'metadata.createdAt invalide.'))
    if (!isIsoDateTime(metadata.updatedAt)) issues.push(issue('metadata.updatedAt', 'invalid-datetime', 'metadata.updatedAt invalide.'))
    if (
      isIsoDateTime(metadata.createdAt) &&
      isIsoDateTime(metadata.updatedAt) &&
      Date.parse(metadata.createdAt as string) > Date.parse(metadata.updatedAt as string)
    ) {
      issues.push(issue('metadata.updatedAt', 'inconsistent-timestamps', 'metadata.updatedAt doit être postérieur ou égal à metadata.createdAt.'))
    }
    if (metadata.startDate !== null && !isIsoDate(metadata.startDate)) {
      issues.push(issue('metadata.startDate', 'invalid-date', 'metadata.startDate doit être une date ISO ou null.'))
    }
    if (metadata.endDate !== null && !isIsoDate(metadata.endDate)) {
      issues.push(issue('metadata.endDate', 'invalid-date', 'metadata.endDate doit être une date ISO ou null.'))
    }
    if (metadata.timezone !== null) {
      if (!isNonEmptyString(metadata.timezone)) {
        issues.push(issue('metadata.timezone', 'invalid-value', 'metadata.timezone doit être une chaîne non vide ou null.'))
      } else if (!isKnownIanaTimezone(metadata.timezone)) {
        issues.push(issue('metadata.timezone', 'unknown-timezone', `Fuseau horaire IANA inconnu : ${metadata.timezone}.`))
      }
    }
    if (!isNonEmptyString(metadata.language)) issues.push(issue('metadata.language', 'missing-required', 'metadata.language est requis.'))
    if (!isOneOf(metadata.units, TRIP_UNITS)) issues.push(issue('metadata.units', 'invalid-enum', 'metadata.units invalide.'))
    if (!isOneOf(metadata.status, TRIP_STATUSES)) issues.push(issue('metadata.status', 'invalid-enum', 'metadata.status invalide.'))
    if (metadata.schemaVersion !== value.schemaVersion) {
      issues.push(issue('metadata.schemaVersion', 'inconsistent-schema-version', 'metadata.schemaVersion doit être identique à schemaVersion.'))
    }
    if (!isNonEmptyString(metadata.engineVersion)) {
      issues.push(issue('metadata.engineVersion', 'missing-required', 'metadata.engineVersion est requis.'))
    }
  }

  // --- calendar -----------------------------------------------------------
  const calendar = value.calendar
  let calendarStartDate: string | null = null
  let calendarEndDate: string | null = null
  if (!isPlainObject(calendar)) {
    issues.push(issue('calendar', 'missing-required', 'calendar est requis.'))
  } else {
    if (calendar.startDate !== null && !isIsoDate(calendar.startDate)) {
      issues.push(issue('calendar.startDate', 'invalid-date', 'calendar.startDate doit être une date ISO ou null.'))
    } else if (isIsoDate(calendar.startDate)) {
      calendarStartDate = calendar.startDate
    }
    if (calendar.endDate !== null && !isIsoDate(calendar.endDate)) {
      issues.push(issue('calendar.endDate', 'invalid-date', 'calendar.endDate doit être une date ISO ou null.'))
    } else if (isIsoDate(calendar.endDate)) {
      calendarEndDate = calendar.endDate
    }
    if (calendarStartDate !== null && calendarEndDate !== null && calendarEndDate < calendarStartDate) {
      issues.push(issue('calendar.endDate', 'inconsistent-date-range', 'calendar.endDate est antérieure à calendar.startDate.'))
    }
    // v1 supports exactly two calendar states — fully undated, or fully dated
    // (startDate + endDate + timezone all set) — never an ambiguous partial one.
    if (calendarStartDate === null && calendarEndDate !== null) {
      issues.push(issue('calendar.startDate', 'missing-required', 'calendar.startDate est requis lorsque calendar.endDate est défini.'))
    }
    if (calendarStartDate !== null && calendarEndDate === null) {
      issues.push(issue('calendar.endDate', 'missing-required', 'calendar.endDate est requis lorsque calendar.startDate est défini.'))
    }
    if (calendar.timezone !== null) {
      if (!isNonEmptyString(calendar.timezone)) {
        issues.push(issue('calendar.timezone', 'invalid-value', 'calendar.timezone doit être une chaîne non vide ou null.'))
      } else if (!isKnownIanaTimezone(calendar.timezone)) {
        issues.push(issue('calendar.timezone', 'unknown-timezone', `Fuseau horaire IANA inconnu : ${calendar.timezone}.`))
      }
    }
    if (calendarStartDate !== null && calendar.timezone === null) {
      issues.push(issue('calendar.timezone', 'missing-required', 'calendar.timezone est requis lorsque le voyage est daté.'))
    }
  }

  // --- metadata / calendar consistency ------------------------------------
  // `calendar` is the operational structure; `metadata`'s copies must always agree with it.
  if (isPlainObject(metadata) && isPlainObject(calendar)) {
    if (metadata.startDate !== calendar.startDate) {
      issues.push(issue('metadata.startDate', 'inconsistent-metadata-calendar', 'metadata.startDate doit être identique à calendar.startDate.'))
    }
    if (metadata.endDate !== calendar.endDate) {
      issues.push(issue('metadata.endDate', 'inconsistent-metadata-calendar', 'metadata.endDate doit être identique à calendar.endDate.'))
    }
    if (metadata.timezone !== calendar.timezone) {
      issues.push(issue('metadata.timezone', 'inconsistent-metadata-calendar', 'metadata.timezone doit être identique à calendar.timezone.'))
    }
  }

  // --- sourceFiles ----------------------------------------------------------
  const sourceFiles = asRecordArray(value.sourceFiles, 'sourceFiles', issues)
  const sourceFileIds = collectIds(sourceFiles, 'id', 'sourceFiles', issues)
  sourceFiles.forEach((file, index) => {
    const path = `sourceFiles[${index}]`
    if (!isNonEmptyString(file.originalName)) issues.push(issue(`${path}.originalName`, 'missing-required', 'originalName est requis.'))
    if (!isNonEmptyString(file.mimeType)) issues.push(issue(`${path}.mimeType`, 'missing-required', 'mimeType est requis.'))
    if (!isNonNegativeInteger(file.sizeBytes)) issues.push(issue(`${path}.sizeBytes`, 'invalid-value', 'sizeBytes doit être un entier non négatif.'))
    if (file.lastModifiedAt !== null && !isIsoDateTime(file.lastModifiedAt)) {
      issues.push(issue(`${path}.lastModifiedAt`, 'invalid-datetime', 'lastModifiedAt invalide.'))
    }
    if (file.sha256 !== null && !isSha256Hex(file.sha256)) {
      issues.push(issue(`${path}.sha256`, 'invalid-value', 'sha256 doit être composé de 64 caractères hexadécimaux ou être null.'))
    }
    if (!isIsoDateTime(file.importedAt)) issues.push(issue(`${path}.importedAt`, 'invalid-datetime', 'importedAt invalide.'))
    if (!isOneOf(file.parsingStatus, PARSING_STATUSES)) issues.push(issue(`${path}.parsingStatus`, 'invalid-enum', 'parsingStatus invalide.'))
    if (!isNonEmptyStringArray(file.parsingErrors)) issues.push(issue(`${path}.parsingErrors`, 'invalid-type', 'parsingErrors doit être un tableau de chaînes non vides.'))
  })

  // --- routes -----------------------------------------------------------
  const routes = asRecordArray(value.routes, 'routes', issues)
  const routeIds = collectIds(routes, 'id', 'routes', issues)
  routes.forEach((route, index) => {
    const path = `routes[${index}]`
    if (route.sourceFileId !== null) {
      if (!isNonEmptyString(route.sourceFileId)) {
        issues.push(issue(`${path}.sourceFileId`, 'invalid-value', 'sourceFileId doit être une chaîne non vide ou null.'))
      } else if (!sourceFileIds.has(route.sourceFileId)) {
        issues.push(issue(`${path}.sourceFileId`, 'unknown-reference', `sourceFileId inconnu : ${route.sourceFileId}.`))
      }
    }
    if (!Array.isArray(route.segments)) {
      issues.push(issue(`${path}.segments`, 'invalid-type', 'segments doit être un tableau.'))
    } else {
      route.segments.forEach((segment: unknown, segmentIndex: number) => {
        const segmentPath = `${path}.segments[${segmentIndex}]`
        if (!isPlainObject(segment)) {
          issues.push(issue(segmentPath, 'invalid-type', 'Segment invalide.'))
          return
        }
        if (!isNonNegativeInteger(segment.index)) {
          issues.push(issue(`${segmentPath}.index`, 'invalid-value', 'index de segment invalide.'))
        } else if (segment.index !== segmentIndex) {
          issues.push(issue(`${segmentPath}.index`, 'non-contiguous-index', 'Les segments doivent être ordonnés avec un index continu à partir de 0.'))
        }
        if (segment.name !== null && !isNonEmptyString(segment.name)) issues.push(issue(`${segmentPath}.name`, 'invalid-value', 'name invalide.'))
        if (segment.distanceKm !== null && !isNonNegativeNumber(segment.distanceKm)) issues.push(issue(`${segmentPath}.distanceKm`, 'invalid-value', 'distanceKm doit être ≥ 0 ou null.'))
        if (segment.elevationGainM !== null && !isNonNegativeNumber(segment.elevationGainM)) issues.push(issue(`${segmentPath}.elevationGainM`, 'invalid-value', 'elevationGainM doit être ≥ 0 ou null.'))
        if (segment.elevationLossM !== null && !isNonNegativeNumber(segment.elevationLossM)) issues.push(issue(`${segmentPath}.elevationLossM`, 'invalid-value', 'elevationLossM doit être ≥ 0 ou null.'))
      })
    }
    if (route.geometry !== null) {
      if (!isPlainObject(route.geometry)) {
        issues.push(issue(`${path}.geometry`, 'invalid-type', 'geometry doit être un objet ou null.'))
      } else {
        for (const key of ['full', 'simplified'] as const) {
          const points = route.geometry[key]
          if (points === null) continue
          if (!Array.isArray(points)) {
            issues.push(issue(`${path}.geometry.${key}`, 'invalid-type', `${key} doit être un tableau ou null.`))
            continue
          }
          points.forEach((point: unknown, pointIndex: number) => {
            const pointPath = `${path}.geometry.${key}[${pointIndex}]`
            if (!isPlainObject(point) || !isLatitude(point.latitude) || !isLongitude(point.longitude)) {
              issues.push(issue(pointPath, 'invalid-value', 'Point de géométrie invalide (coordonnées hors bornes ou non finies).'))
              return
            }
            if (point.altitudeM !== null && !isFiniteNumber(point.altitudeM)) {
              issues.push(issue(`${pointPath}.altitudeM`, 'invalid-value', 'altitudeM doit être un nombre fini ou null.'))
            }
          })
        }
      }
    }
    if (route.profile !== null) {
      if (!isPlainObject(route.profile)) {
        issues.push(issue(`${path}.profile`, 'invalid-type', 'profile doit être un objet ou null.'))
      } else {
        if (!isPositiveNumber(route.profile.resampleIntervalMeters)) {
          issues.push(issue(`${path}.profile.resampleIntervalMeters`, 'invalid-value', 'resampleIntervalMeters doit être > 0.'))
        }
        if (!Array.isArray(route.profile.points)) {
          issues.push(issue(`${path}.profile.points`, 'invalid-type', 'points doit être un tableau.'))
        } else {
          let previousDistanceKm: number | null = null
          route.profile.points.forEach((point: unknown, pointIndex: number) => {
            const pointPath = `${path}.profile.points[${pointIndex}]`
            if (!isPlainObject(point) || !isNonNegativeNumber(point.distanceKm)) {
              issues.push(issue(pointPath, 'invalid-value', 'distanceKm de profil invalide.'))
              return
            }
            if (previousDistanceKm !== null && point.distanceKm <= previousDistanceKm) {
              issues.push(issue(`${pointPath}.distanceKm`, 'non-increasing-distance', 'distanceKm doit être strictement croissante entre points de profil consécutifs.'))
            }
            previousDistanceKm = point.distanceKm
            if (point.elevationM !== null && !isFiniteNumber(point.elevationM)) issues.push(issue(`${pointPath}.elevationM`, 'invalid-value', 'elevationM invalide.'))
            if (point.gradePercent !== null && !isFiniteNumber(point.gradePercent)) issues.push(issue(`${pointPath}.gradePercent`, 'invalid-value', 'gradePercent invalide.'))
          })
        }
      }
    }
    if (!isOneOf(route.parsingStatus, PARSING_STATUSES)) issues.push(issue(`${path}.parsingStatus`, 'invalid-enum', 'parsingStatus invalide.'))
    if (!isNonEmptyStringArray(route.parsingErrors)) issues.push(issue(`${path}.parsingErrors`, 'invalid-type', 'parsingErrors doit être un tableau de chaînes non vides.'))
    validateProvenance(route.provenance, `${path}.provenance`, issues)
  })

  // --- climbs -------------------------------------------------------------
  const climbs = asRecordArray(value.climbs, 'climbs', issues)
  const climbIds = collectIds(climbs, 'id', 'climbs', issues)
  const climbsById = new Map(climbs.map((climb) => [climb.id, climb]))
  climbs.forEach((climb, index) => {
    const path = `climbs[${index}]`
    if (!isNonEmptyString(climb.routeId)) {
      issues.push(issue(`${path}.routeId`, 'missing-required', 'routeId est requis.'))
    } else if (!routeIds.has(climb.routeId)) {
      issues.push(issue(`${path}.routeId`, 'unknown-reference', `routeId inconnu : ${climb.routeId}.`))
    }
    if (climb.name !== null && !isNonEmptyString(climb.name)) issues.push(issue(`${path}.name`, 'invalid-value', 'name invalide.'))
    if (!isNonNegativeNumber(climb.startDistanceKm)) issues.push(issue(`${path}.startDistanceKm`, 'invalid-value', 'startDistanceKm doit être ≥ 0.'))
    if (!isNonNegativeNumber(climb.endDistanceKm)) issues.push(issue(`${path}.endDistanceKm`, 'invalid-value', 'endDistanceKm doit être ≥ 0.'))
    if (
      isNonNegativeNumber(climb.startDistanceKm) &&
      isNonNegativeNumber(climb.endDistanceKm) &&
      (climb.endDistanceKm as number) < (climb.startDistanceKm as number)
    ) {
      issues.push(issue(`${path}.endDistanceKm`, 'inconsistent-range', 'endDistanceKm doit être ≥ startDistanceKm.'))
    }
    if (!isNonNegativeNumber(climb.elevationGainM)) issues.push(issue(`${path}.elevationGainM`, 'invalid-value', 'elevationGainM doit être ≥ 0.'))
    if (!isFiniteNumber(climb.averageGradientPercent)) issues.push(issue(`${path}.averageGradientPercent`, 'invalid-value', 'averageGradientPercent invalide.'))
    if (climb.maxGradientPercent !== null && !isFiniteNumber(climb.maxGradientPercent)) issues.push(issue(`${path}.maxGradientPercent`, 'invalid-value', 'maxGradientPercent invalide.'))
    if (climb.startAltitudeM !== null && !isFiniteNumber(climb.startAltitudeM)) issues.push(issue(`${path}.startAltitudeM`, 'invalid-value', 'startAltitudeM invalide.'))
    if (climb.endAltitudeM !== null && !isFiniteNumber(climb.endAltitudeM)) issues.push(issue(`${path}.endAltitudeM`, 'invalid-value', 'endAltitudeM invalide.'))
    if (!isOneOf(climb.confidence, CLIMB_CONFIDENCES)) issues.push(issue(`${path}.confidence`, 'invalid-enum', 'confidence invalide.'))
    validateProvenance(climb.provenance, `${path}.provenance`, issues)
  })

  // --- routePoints --------------------------------------------------------
  const routePoints = asRecordArray(value.routePoints, 'routePoints', issues)
  const routePointIds = collectIds(routePoints, 'id', 'routePoints', issues)
  const routePointsById = new Map(routePoints.map((point) => [point.id, point]))
  routePoints.forEach((point, index) => {
    const path = `routePoints[${index}]`
    if (!isNonEmptyString(point.routeId)) {
      issues.push(issue(`${path}.routeId`, 'missing-required', 'routeId est requis.'))
    } else if (!routeIds.has(point.routeId)) {
      issues.push(issue(`${path}.routeId`, 'unknown-reference', `routeId inconnu : ${point.routeId}.`))
    }
    if (!isOneOf(point.type, ROUTE_POINT_TYPES)) issues.push(issue(`${path}.type`, 'invalid-enum', 'type invalide.'))
    if (!isNonEmptyString(point.name)) issues.push(issue(`${path}.name`, 'missing-required', 'name est requis.'))
    if (!isLatitude(point.latitude)) issues.push(issue(`${path}.latitude`, 'invalid-value', 'latitude invalide.'))
    if (!isLongitude(point.longitude)) issues.push(issue(`${path}.longitude`, 'invalid-value', 'longitude invalide.'))
    if (point.elevationM !== null && !isFiniteNumber(point.elevationM)) issues.push(issue(`${path}.elevationM`, 'invalid-value', 'elevationM invalide.'))
    if (point.trackDistanceKm !== null && !isNonNegativeNumber(point.trackDistanceKm)) issues.push(issue(`${path}.trackDistanceKm`, 'invalid-value', 'trackDistanceKm doit être ≥ 0 ou null.'))
    if (point.osmFeatureType !== undefined && point.osmFeatureType !== null && !isOneOf(point.osmFeatureType, OSM_ROUTE_FEATURE_TYPES)) {
      issues.push(issue(`${path}.osmFeatureType`, 'invalid-enum', 'osmFeatureType invalide.'))
    }
    if (point.lateralDistanceKm !== undefined && point.lateralDistanceKm !== null && !isNonNegativeNumber(point.lateralDistanceKm)) {
      issues.push(issue(`${path}.lateralDistanceKm`, 'invalid-value', 'lateralDistanceKm doit être ≥ 0 ou null.'))
    }
    validateProvenance(point.provenance, `${path}.provenance`, issues)
  })

  // --- practicalPlaces -----------------------------------------------------
  const practicalPlaces = asRecordArray(value.practicalPlaces, 'practicalPlaces', issues)
  const practicalPlaceIds = collectIds(practicalPlaces, 'id', 'practicalPlaces', issues)
  practicalPlaces.forEach((place, index) => {
    const path = `practicalPlaces[${index}]`
    if (!isOneOf(place.category, PRACTICAL_PLACE_CATEGORIES)) issues.push(issue(`${path}.category`, 'invalid-enum', 'category invalide.'))
    if (place.name !== null && !isNonEmptyString(place.name)) issues.push(issue(`${path}.name`, 'invalid-value', 'name doit être une chaîne non vide ou null.'))
    if (!isLatitude(place.latitude)) issues.push(issue(`${path}.latitude`, 'invalid-value', 'latitude invalide.'))
    if (!isLongitude(place.longitude)) issues.push(issue(`${path}.longitude`, 'invalid-value', 'longitude invalide.'))
    if (place.description !== null && !isNonEmptyString(place.description)) issues.push(issue(`${path}.description`, 'invalid-value', 'description invalide.'))
    if (place.trackDistanceKm !== null && !isNonNegativeNumber(place.trackDistanceKm)) issues.push(issue(`${path}.trackDistanceKm`, 'invalid-value', 'trackDistanceKm doit être ≥ 0 ou null.'))
    if (place.detourKm !== null && !isNonNegativeNumber(place.detourKm)) issues.push(issue(`${path}.detourKm`, 'invalid-value', 'detourKm doit être ≥ 0 ou null.'))
    if (place.openingHours !== null && !isNonEmptyString(place.openingHours)) issues.push(issue(`${path}.openingHours`, 'invalid-value', 'openingHours invalide.'))
    if (!isBoolean(place.hidden)) issues.push(issue(`${path}.hidden`, 'invalid-type', 'hidden doit être un booléen.'))
    if (!isBoolean(place.pinned)) issues.push(issue(`${path}.pinned`, 'invalid-type', 'pinned doit être un booléen.'))
    if (place.stageId !== undefined && place.stageId !== null && !isNonEmptyString(place.stageId)) {
      issues.push(issue(`${path}.stageId`, 'invalid-value', 'stageId doit être une chaîne non vide ou null.'))
    }
    if (place.usefulTags !== undefined && place.usefulTags !== null && !isPlainObject(place.usefulTags)) {
      issues.push(issue(`${path}.usefulTags`, 'invalid-type', 'usefulTags doit être un objet ou null.'))
    } else if (isPlainObject(place.usefulTags)) {
      Object.entries(place.usefulTags).forEach(([key, tagValue]) => {
        if (!isNonEmptyString(key) || !isNonEmptyString(tagValue)) {
          issues.push(issue(`${path}.usefulTags`, 'invalid-value', 'usefulTags doit contenir uniquement des chaînes non vides.'))
        }
      })
    }
    if (!Array.isArray(place.dayIds)) {
      issues.push(issue(`${path}.dayIds`, 'invalid-type', 'dayIds doit être un tableau.'))
    } else {
      const seenPlaceDayIds = new Set<string>()
      place.dayIds.forEach((dayIdValue: unknown, dayIdIndex: number) => {
        const itemPath = `${path}.dayIds[${dayIdIndex}]`
        if (!isNonEmptyString(dayIdValue)) {
          issues.push(issue(itemPath, 'invalid-value', 'dayIds doit contenir des chaînes non vides.'))
          return
        }
        if (seenPlaceDayIds.has(dayIdValue)) {
          issues.push(issue(itemPath, 'duplicate-reference', `dayIds contient un identifiant en double : ${dayIdValue}.`))
        }
        seenPlaceDayIds.add(dayIdValue)
      })
    }
    validateProvenance(place.provenance, `${path}.provenance`, issues)
  })

  // --- accommodations ------------------------------------------------------
  const accommodations = asRecordArray(value.accommodations, 'accommodations', issues)
  const accommodationIds = collectIds(accommodations, 'id', 'accommodations', issues)
  accommodations.forEach((accommodation, index) => {
    const path = `accommodations[${index}]`
    if (!isNonEmptyString(accommodation.name)) issues.push(issue(`${path}.name`, 'missing-required', 'name est requis.'))
    if (!isOneOf(accommodation.type, ACCOMMODATION_TYPES)) issues.push(issue(`${path}.type`, 'invalid-enum', 'type invalide.'))
    for (const field of ['address', 'mapsUrl', 'website', 'phone', 'bookingReference', 'notes'] as const) {
      const fieldValue = accommodation[field]
      if (fieldValue !== null && !isNonEmptyString(fieldValue)) {
        issues.push(issue(`${path}.${field}`, 'invalid-value', `${field} doit être une chaîne non vide ou null.`))
      }
    }
    if (accommodation.latitude !== null && !isLatitude(accommodation.latitude)) issues.push(issue(`${path}.latitude`, 'invalid-value', 'latitude invalide.'))
    if (accommodation.longitude !== null && !isLongitude(accommodation.longitude)) issues.push(issue(`${path}.longitude`, 'invalid-value', 'longitude invalide.'))
    if (!isBoolean(accommodation.confirmed)) issues.push(issue(`${path}.confirmed`, 'invalid-type', 'confirmed doit être un booléen.'))
    validateProvenance(accommodation.provenance, `${path}.provenance`, issues)
  })

  // --- days ---------------------------------------------------------------
  const days = asRecordArray(value.days, 'days', issues)
  const dayIds = collectIds(days, 'id', 'days', issues)
  days.forEach((day, index) => {
    const path = `days[${index}]`
    if (!isNonNegativeInteger(day.index)) issues.push(issue(`${path}.index`, 'invalid-value', 'index doit être un entier ≥ 0.'))
    if (day.index !== index) {
      issues.push(issue(`${path}.index`, 'non-contiguous-index', `Journées non ordonnées ou non contiguës à la position ${index}.`))
    }
    if (!isPositiveInteger(day.displayNumber)) issues.push(issue(`${path}.displayNumber`, 'invalid-value', 'displayNumber doit être un entier > 0.'))
    if (day.date !== null && !isIsoDate(day.date)) issues.push(issue(`${path}.date`, 'invalid-date', 'date invalide.'))
    if (calendarStartDate === null) {
      // Undated trip: no day may carry a date (no false temporal state).
      if (day.date !== null && day.date !== undefined) {
        issues.push(issue(`${path}.date`, 'inconsistent-calendar', 'Une journée datée exige un calendrier défini (calendar.startDate).'))
      }
    } else if (isNonNegativeInteger(day.index)) {
      // Dated trip: every day must carry the exact date derived from calendar.startDate + index civil days.
      const expectedDate = addCivilDays(calendarStartDate, day.index)
      if (day.date === null || day.date === undefined) {
        issues.push(issue(`${path}.date`, 'missing-required', 'Une journée exige une date lorsque le calendrier est défini (calendar.startDate).'))
      } else if (isIsoDate(day.date) && day.date !== expectedDate) {
        issues.push(issue(`${path}.date`, 'inconsistent-day-date', `date doit être calendar.startDate + index jours (attendu ${expectedDate}).`))
      }
    }
    if (!isOneOf(day.type, TRIP_DAY_TYPES)) {
      issues.push(issue(`${path}.type`, 'invalid-enum', 'type invalide.'))
    } else if (day.type === 'ride') {
      if (!isNonEmptyString(day.stageId)) issues.push(issue(`${path}.stageId`, 'missing-required', 'Une journée ride requiert stageId.'))
    } else if (day.stageId !== null) {
      // off and transfer: v1 has no stage model to attach (RideStage only
      // models a cyclable ride) — stageId must always be null for both.
      issues.push(issue(`${path}.stageId`, 'unexpected-value', `Une journée ${String(day.type)} ne référence aucune étape.`))
    }
    if (day.startLocationName !== null && !isNonEmptyString(day.startLocationName)) issues.push(issue(`${path}.startLocationName`, 'invalid-value', 'startLocationName invalide.'))
    if (day.endLocationName !== null && !isNonEmptyString(day.endLocationName)) issues.push(issue(`${path}.endLocationName`, 'invalid-value', 'endLocationName invalide.'))
    if (day.accommodationId !== null) {
      if (!isNonEmptyString(day.accommodationId)) {
        issues.push(issue(`${path}.accommodationId`, 'invalid-value', 'accommodationId doit être une chaîne non vide ou null.'))
      } else if (!accommodationIds.has(day.accommodationId)) {
        issues.push(issue(`${path}.accommodationId`, 'unknown-reference', `accommodationId inconnu : ${day.accommodationId}.`))
      }
    }
    if (day.notes !== null && !isNonEmptyString(day.notes)) issues.push(issue(`${path}.notes`, 'invalid-value', 'notes invalide.'))
    if (!isOneOf(day.enrichmentStatus, TRIP_DAY_ENRICHMENT_STATUSES)) issues.push(issue(`${path}.enrichmentStatus`, 'invalid-enum', 'enrichmentStatus invalide.'))
  })
  const daysById = new Map(days.map((day) => [day.id, day]))

  // practicalPlaces.dayIds referential check — deferred until here since it needs `dayIds`.
  practicalPlaces.forEach((place, index) => {
    if (!Array.isArray(place.dayIds)) return // already reported above
    const path = `practicalPlaces[${index}]`
    place.dayIds.forEach((dayIdValue: unknown, dayIdIndex: number) => {
      if (typeof dayIdValue === 'string' && dayIdValue.trim() !== '' && !dayIds.has(dayIdValue)) {
        issues.push(issue(`${path}.dayIds[${dayIdIndex}]`, 'unknown-reference', `dayIds inconnu : ${dayIdValue}.`))
      }
    })
  })

  // The calendar's own duration must match the number of days — not just each
  // day individually: calendar.endDate must equal calendar.startDate + (days.length - 1).
  if (calendarStartDate !== null && calendarEndDate !== null && days.length > 0) {
    const expectedEndDate = addCivilDays(calendarStartDate, days.length - 1)
    if (calendarEndDate !== expectedEndDate) {
      issues.push(
        issue(
          'calendar.endDate',
          'inconsistent-duration',
          `calendar.endDate doit correspondre à calendar.startDate + ${days.length - 1} jour(s) (attendu ${expectedEndDate}).`,
        ),
      )
    }
  }

  // --- weather --------------------------------------------------------------
  const weather = asRecordArray(value.weather, 'weather', issues)
  const weatherIds = collectIds(weather, 'id', 'weather', issues)
  const weatherById = new Map(weather.map((record) => [record.id, record]))
  weather.forEach((record, index) => {
    const path = `weather[${index}]`
    let recordDay: Record<string, unknown> | undefined
    if (!isNonEmptyString(record.dayId)) {
      issues.push(issue(`${path}.dayId`, 'missing-required', 'dayId est requis.'))
    } else if (!dayIds.has(record.dayId)) {
      issues.push(issue(`${path}.dayId`, 'unknown-reference', `dayId inconnu : ${record.dayId}.`))
    } else {
      recordDay = daysById.get(record.dayId)
    }
    if (record.routePointId !== null) {
      if (!isNonEmptyString(record.routePointId)) {
        issues.push(issue(`${path}.routePointId`, 'invalid-value', 'routePointId doit être une chaîne non vide ou null.'))
      } else if (!routePointIds.has(record.routePointId)) {
        issues.push(issue(`${path}.routePointId`, 'unknown-reference', `routePointId inconnu : ${record.routePointId}.`))
      }
    }
    if (!isIsoDate(record.forDate)) {
      issues.push(issue(`${path}.forDate`, 'invalid-date', 'forDate invalide.'))
    } else if (recordDay !== undefined && recordDay.date !== null && record.forDate !== recordDay.date) {
      issues.push(issue(`${path}.forDate`, 'inconsistent-day-date', 'forDate doit correspondre à la date de la journée référencée (dayId).'))
    }
    if (record.forecastAt !== null && !isIsoDateTime(record.forecastAt)) issues.push(issue(`${path}.forecastAt`, 'invalid-datetime', 'forecastAt invalide.'))
    if (record.temperatureMinC !== null && !isFiniteNumber(record.temperatureMinC)) issues.push(issue(`${path}.temperatureMinC`, 'invalid-value', 'temperatureMinC invalide.'))
    if (record.temperatureMaxC !== null && !isFiniteNumber(record.temperatureMaxC)) issues.push(issue(`${path}.temperatureMaxC`, 'invalid-value', 'temperatureMaxC invalide.'))
    if (
      isFiniteNumber(record.temperatureMinC) &&
      isFiniteNumber(record.temperatureMaxC) &&
      (record.temperatureMinC as number) > (record.temperatureMaxC as number)
    ) {
      issues.push(issue(`${path}.temperatureMaxC`, 'inconsistent-range', 'temperatureMaxC doit être ≥ temperatureMinC.'))
    }
    if (record.windSpeedKph !== null && !isFiniteNumber(record.windSpeedKph)) issues.push(issue(`${path}.windSpeedKph`, 'invalid-value', 'windSpeedKph invalide.'))
    if (record.precipitationMm !== null && !isNonNegativeNumber(record.precipitationMm)) issues.push(issue(`${path}.precipitationMm`, 'invalid-value', 'precipitationMm doit être ≥ 0 ou null.'))
    if (record.weatherCode !== null && !Number.isInteger(record.weatherCode)) issues.push(issue(`${path}.weatherCode`, 'invalid-value', 'weatherCode doit être un entier ou null.'))
    validateProvenance(record.provenance, `${path}.provenance`, issues)
  })

  // --- stages ---------------------------------------------------------------
  const stages = asRecordArray(value.stages, 'stages', issues)
  const stageIds = collectIds(stages, 'id', 'stages', issues)
  const stagesById = new Map(stages.map((stage) => [stage.id, stage]))
  practicalPlaces.forEach((place, index) => {
    if (isNonEmptyString(place.stageId) && !stageIds.has(place.stageId)) {
      issues.push(issue(`practicalPlaces[${index}].stageId`, 'unknown-reference', `stageId inconnu : ${place.stageId}.`))
    }
  })
  const rideDaysById = new Map(days.filter((day) => day.type === 'ride').map((day) => [day.id as string, day]))
  const stageCountByDayId = new Map<string, number>()
  stages.forEach((stage, index) => {
    const path = `stages[${index}]`
    if (!isNonEmptyString(stage.dayId)) {
      issues.push(issue(`${path}.dayId`, 'missing-required', 'dayId est requis.'))
    } else {
      stageCountByDayId.set(stage.dayId, (stageCountByDayId.get(stage.dayId) ?? 0) + 1)
      if (!dayIds.has(stage.dayId)) {
        issues.push(issue(`${path}.dayId`, 'unknown-reference', `dayId inconnu : ${stage.dayId}.`))
      } else if (!rideDaysById.has(stage.dayId)) {
        issues.push(issue(`${path}.dayId`, 'invalid-reference', 'dayId doit référencer une journée de type ride.'))
      }
    }
    if (!isNonEmptyString(stage.sourceRouteId)) {
      issues.push(issue(`${path}.sourceRouteId`, 'missing-required', 'sourceRouteId est requis.'))
    } else if (!routeIds.has(stage.sourceRouteId)) {
      issues.push(issue(`${path}.sourceRouteId`, 'unknown-reference', `sourceRouteId inconnu : ${stage.sourceRouteId}.`))
    }
    if (stage.name !== null && !isNonEmptyString(stage.name)) issues.push(issue(`${path}.name`, 'invalid-value', 'name invalide.'))
    if (stage.startLocationName !== null && !isNonEmptyString(stage.startLocationName)) issues.push(issue(`${path}.startLocationName`, 'invalid-value', 'startLocationName invalide.'))
    if (stage.endLocationName !== null && !isNonEmptyString(stage.endLocationName)) issues.push(issue(`${path}.endLocationName`, 'invalid-value', 'endLocationName invalide.'))
    for (const field of ['distanceKm', 'elevationGainM', 'elevationLossM', 'movingDurationSeconds', 'pauseDurationSeconds', 'totalDurationSeconds'] as const) {
      const fieldValue = stage[field]
      if (fieldValue !== null && !isNonNegativeNumber(fieldValue)) {
        issues.push(issue(`${path}.${field}`, 'invalid-value', `${field} doit être ≥ 0 ou null.`))
      }
    }
    if (stage.estimatedAverageSpeedKph !== null && !isPositiveNumber(stage.estimatedAverageSpeedKph)) {
      issues.push(issue(`${path}.estimatedAverageSpeedKph`, 'invalid-value', 'estimatedAverageSpeedKph doit être > 0 ou null.'))
    }
    if (stage.metricsProvenance !== null) {
      validateProvenance(stage.metricsProvenance, `${path}.metricsProvenance`, issues)
    } else if (stage.distanceKm !== null || stage.elevationGainM !== null || stage.elevationLossM !== null) {
      issues.push(
        issue(
          `${path}.metricsProvenance`,
          'missing-required',
          'metricsProvenance est requis dès que distanceKm, elevationGainM ou elevationLossM est renseigné.',
        ),
      )
    }
    if (
      isNonNegativeNumber(stage.movingDurationSeconds) &&
      isNonNegativeNumber(stage.pauseDurationSeconds) &&
      isNonNegativeNumber(stage.totalDurationSeconds) &&
      Math.abs(
        (stage.movingDurationSeconds as number) + (stage.pauseDurationSeconds as number) - (stage.totalDurationSeconds as number),
      ) > 1e-9
    ) {
      issues.push(issue(`${path}.totalDurationSeconds`, 'inconsistent-duration', 'totalDurationSeconds doit être égal à movingDurationSeconds + pauseDurationSeconds.'))
    }
    if (stage.minAltitudeM !== null && !isFiniteNumber(stage.minAltitudeM)) issues.push(issue(`${path}.minAltitudeM`, 'invalid-value', 'minAltitudeM invalide.'))
    if (stage.maxAltitudeM !== null && !isFiniteNumber(stage.maxAltitudeM)) issues.push(issue(`${path}.maxAltitudeM`, 'invalid-value', 'maxAltitudeM invalide.'))
    if (
      isFiniteNumber(stage.minAltitudeM) &&
      isFiniteNumber(stage.maxAltitudeM) &&
      (stage.maxAltitudeM as number) < (stage.minAltitudeM as number)
    ) {
      issues.push(issue(`${path}.maxAltitudeM`, 'inconsistent-range', 'maxAltitudeM doit être ≥ minAltitudeM.'))
    }
    if (!isOneOf(stage.validationStatus, RIDE_STAGE_VALIDATION_STATUSES)) issues.push(issue(`${path}.validationStatus`, 'invalid-enum', 'validationStatus invalide.'))

    const hasKnownRoute = isNonEmptyString(stage.sourceRouteId) && routeIds.has(stage.sourceRouteId)
    for (const [field, knownIds, byId] of [
      ['climbIds', climbIds, climbsById],
      ['routePointIds', routePointIds, routePointsById],
    ] as const) {
      const fieldValue = stage[field]
      if (!isStringArray(fieldValue)) {
        issues.push(issue(`${path}.${field}`, 'invalid-type', `${field} doit être un tableau de chaînes.`))
        continue
      }
      const seen = new Set<string>()
      fieldValue.forEach((referencedId, referenceIndex) => {
        const itemPath = `${path}.${field}[${referenceIndex}]`
        if (seen.has(referencedId)) {
          issues.push(issue(itemPath, 'duplicate-reference', `${field} contient un identifiant en double : ${referencedId}.`))
        }
        seen.add(referencedId)
        if (!knownIds.has(referencedId)) {
          issues.push(issue(itemPath, 'unknown-reference', `${field} inconnu : ${referencedId}.`))
          return
        }
        const entity = byId.get(referencedId)
        if (entity !== undefined && hasKnownRoute && entity.routeId !== stage.sourceRouteId) {
          issues.push(issue(itemPath, 'route-mismatch', `${field} référence une entité qui n'appartient pas à sourceRouteId.`))
        }
      })
    }

    if (!isStringArray(stage.weatherRecordIds)) {
      issues.push(issue(`${path}.weatherRecordIds`, 'invalid-type', 'weatherRecordIds doit être un tableau de chaînes.'))
    } else {
      const seenWeatherIds = new Set<string>()
      stage.weatherRecordIds.forEach((weatherRecordId, weatherIndex) => {
        const itemPath = `${path}.weatherRecordIds[${weatherIndex}]`
        if (seenWeatherIds.has(weatherRecordId)) {
          issues.push(issue(itemPath, 'duplicate-reference', `weatherRecordIds contient un identifiant en double : ${weatherRecordId}.`))
        }
        seenWeatherIds.add(weatherRecordId)
        if (!weatherIds.has(weatherRecordId)) {
          issues.push(issue(itemPath, 'unknown-reference', `weatherRecordIds inconnu : ${weatherRecordId}.`))
          return
        }
        const record = weatherById.get(weatherRecordId)
        if (record === undefined) return
        if (isNonEmptyString(stage.dayId) && record.dayId !== stage.dayId) {
          issues.push(issue(itemPath, 'day-mismatch', 'Le relevé météo référencé ne correspond pas à dayId de cette étape.'))
        }
        if (record.routePointId !== null && isNonEmptyString(record.routePointId)) {
          const point = routePointsById.get(record.routePointId)
          if (point !== undefined && hasKnownRoute && point.routeId !== stage.sourceRouteId) {
            issues.push(issue(itemPath, 'route-mismatch', "Le point météo référencé n'appartient pas à sourceRouteId de cette étape."))
          }
        }
      })
    }
  })
  stageCountByDayId.forEach((count, dayId) => {
    if (count > 1) issues.push(issue('stages', 'duplicate-stage-for-day', `Plusieurs étapes référencent la même journée : ${dayId}.`))
  })
  days.forEach((day, index) => {
    if (day.type !== 'ride' || !isNonEmptyString(day.stageId)) return
    const path = `days[${index}].stageId`
    if (!stageIds.has(day.stageId)) {
      issues.push(issue(path, 'unknown-reference', `stageId inconnu : ${day.stageId}.`))
      return
    }
    const referencedStage = stages.find((stage) => stage.id === day.stageId)
    if (referencedStage !== undefined && referencedStage.dayId !== day.id) {
      issues.push(issue(path, 'inconsistent-relationship', 'La journée et son étape ne se référencent pas mutuellement.'))
    }
  })

  // --- settings ---------------------------------------------------------
  const settings = value.settings
  if (!isPlainObject(settings)) {
    issues.push(issue('settings', 'missing-required', 'settings est requis.'))
  } else {
    if (!isPlainObject(settings.global)) {
      issues.push(issue('settings.global', 'missing-required', 'settings.global est requis.'))
    } else {
      if (!isPositiveNumber(settings.global.referenceSpeedKph)) issues.push(issue('settings.global.referenceSpeedKph', 'invalid-value', 'referenceSpeedKph doit être > 0.'))
      if (!isOneOf(settings.global.pausePlanMode, PAUSE_PLAN_MODES)) issues.push(issue('settings.global.pausePlanMode', 'invalid-enum', 'pausePlanMode invalide.'))
    }
    const settingsDays = asRecordArray(settings.days, 'settings.days', issues)
    const seenSettingsDayIds = new Set<string>()
    settingsDays.forEach((entry, index) => {
      const path = `settings.days[${index}]`
      if (!isNonEmptyString(entry.dayId)) {
        issues.push(issue(`${path}.dayId`, 'missing-required', 'dayId est requis.'))
      } else {
        if (!dayIds.has(entry.dayId)) issues.push(issue(`${path}.dayId`, 'unknown-reference', `dayId inconnu : ${entry.dayId}.`))
        if (seenSettingsDayIds.has(entry.dayId)) issues.push(issue(`${path}.dayId`, 'duplicate-id', `Réglages dupliqués pour la journée ${entry.dayId}.`))
        seenSettingsDayIds.add(entry.dayId)
      }
      if (entry.departureTime !== null && !isTimeOfDay(entry.departureTime)) issues.push(issue(`${path}.departureTime`, 'invalid-value', 'departureTime doit être HH:MM ou null.'))
      if (entry.totalBreakSeconds !== null && !isNonNegativeNumber(entry.totalBreakSeconds)) issues.push(issue(`${path}.totalBreakSeconds`, 'invalid-value', 'totalBreakSeconds doit être ≥ 0 ou null.'))
    })
    const settingsStages = asRecordArray(settings.stages, 'settings.stages', issues)
    const seenSettingsStageIds = new Set<string>()
    settingsStages.forEach((entry, index) => {
      const path = `settings.stages[${index}]`
      let targetStage: Record<string, unknown> | undefined
      if (!isNonEmptyString(entry.stageId)) {
        issues.push(issue(`${path}.stageId`, 'missing-required', 'stageId est requis.'))
      } else {
        if (!stageIds.has(entry.stageId)) {
          issues.push(issue(`${path}.stageId`, 'unknown-reference', `stageId inconnu : ${entry.stageId}.`))
        } else {
          targetStage = stagesById.get(entry.stageId)
        }
        if (seenSettingsStageIds.has(entry.stageId)) issues.push(issue(`${path}.stageId`, 'duplicate-id', `Réglages dupliqués pour l'étape ${entry.stageId}.`))
        seenSettingsStageIds.add(entry.stageId)
      }
      if (entry.pausePlanMode !== null && !isOneOf(entry.pausePlanMode, PAUSE_PLAN_MODES)) issues.push(issue(`${path}.pausePlanMode`, 'invalid-enum', 'pausePlanMode invalide.'))
      if (!Array.isArray(entry.pauses)) {
        issues.push(issue(`${path}.pauses`, 'invalid-type', 'pauses doit être un tableau.'))
      } else {
        const seenPauseIds = new Set<string>()
        const seenOrders = new Set<number>()
        const orders: number[] = []
        entry.pauses.forEach((pause: unknown, pauseIndex: number) => {
          const pausePath = `${path}.pauses[${pauseIndex}]`
          if (!isPlainObject(pause)) {
            issues.push(issue(pausePath, 'invalid-type', 'pause invalide.'))
            return
          }
          if (!isNonEmptyString(pause.id)) {
            issues.push(issue(`${pausePath}.id`, 'missing-required', 'id est requis.'))
          } else if (seenPauseIds.has(pause.id)) {
            issues.push(issue(`${pausePath}.id`, 'duplicate-id', `Identifiant de pause dupliqué : ${pause.id}.`))
          } else {
            seenPauseIds.add(pause.id)
          }
          if (!isBoolean(pause.active)) issues.push(issue(`${pausePath}.active`, 'invalid-type', 'active doit être un booléen.'))
          if (pause.routePointId !== null) {
            if (!isNonEmptyString(pause.routePointId)) {
              issues.push(issue(`${pausePath}.routePointId`, 'invalid-value', 'routePointId doit être une chaîne non vide ou null.'))
            } else if (!routePointIds.has(pause.routePointId)) {
              issues.push(issue(`${pausePath}.routePointId`, 'unknown-reference', `routePointId inconnu : ${pause.routePointId}.`))
            } else if (targetStage !== undefined && isNonEmptyString(targetStage.sourceRouteId) && routeIds.has(targetStage.sourceRouteId)) {
              const point = routePointsById.get(pause.routePointId)
              if (point !== undefined && point.routeId !== targetStage.sourceRouteId) {
                issues.push(issue(`${pausePath}.routePointId`, 'route-mismatch', "routePointId n'appartient pas à la route de l'étape."))
              }
            }
          }
          if (!isNonNegativeNumber(pause.durationSeconds)) issues.push(issue(`${pausePath}.durationSeconds`, 'invalid-value', 'durationSeconds doit être fini et ≥ 0.'))
          if (!isNonNegativeInteger(pause.order)) {
            issues.push(issue(`${pausePath}.order`, 'invalid-value', 'order doit être un entier ≥ 0.'))
          } else {
            if (seenOrders.has(pause.order)) issues.push(issue(`${pausePath}.order`, 'duplicate-order', `Valeur order dupliquée : ${pause.order}.`))
            seenOrders.add(pause.order)
            orders.push(pause.order)
          }
          if (!isOneOf(pause.origin, PAUSE_PLAN_MODES)) issues.push(issue(`${pausePath}.origin`, 'invalid-enum', 'origin invalide.'))
        })
        const sortedOrders = [...orders].sort((left, right) => left - right)
        const isContiguousFromZero = sortedOrders.every((orderValue, orderIndex) => orderValue === orderIndex)
        if (orders.length > 0 && !isContiguousFromZero) {
          issues.push(issue(`${path}.pauses`, 'non-contiguous-order', 'Les valeurs order doivent former une suite continue à partir de 0.'))
        }
      }
    })
  }

  // --- overrides ----------------------------------------------------------
  const overrideTargetIdsByType: Readonly<Record<(typeof OVERRIDE_TARGET_TYPES)[number], Set<string>>> = {
    'trip-day': dayIds,
    'ride-stage': stageIds,
    'route-point': routePointIds,
    climb: climbIds,
    'practical-place': practicalPlaceIds,
    accommodation: accommodationIds,
  }
  const overrides = asRecordArray(value.overrides, 'overrides', issues)
  collectIds(overrides, 'id', 'overrides', issues)
  const seenOverrideTriplets = new Set<string>()
  overrides.forEach((override, index) => {
    const path = `overrides[${index}]`
    const hasKnownTargetType = isOneOf(override.targetType, OVERRIDE_TARGET_TYPES)
    if (!hasKnownTargetType) issues.push(issue(`${path}.targetType`, 'invalid-enum', 'targetType invalide.'))
    if (!isNonEmptyString(override.targetId)) {
      issues.push(issue(`${path}.targetId`, 'missing-required', 'targetId est requis.'))
    } else if (hasKnownTargetType) {
      const knownIds = overrideTargetIdsByType[override.targetType as (typeof OVERRIDE_TARGET_TYPES)[number]]
      if (!knownIds.has(override.targetId)) {
        issues.push(issue(`${path}.targetId`, 'unknown-reference', `targetId inconnu pour targetType=${String(override.targetType)} : ${override.targetId}.`))
      }
    }
    if (!isNonEmptyString(override.field)) issues.push(issue(`${path}.field`, 'missing-required', 'field est requis.'))
    if (override.reason !== null && !isNonEmptyString(override.reason)) issues.push(issue(`${path}.reason`, 'invalid-value', 'reason doit être une chaîne non vide ou null.'))
    if (!isIsoDateTime(override.createdAt)) issues.push(issue(`${path}.createdAt`, 'invalid-datetime', 'createdAt invalide.'))
    if (hasKnownTargetType && isNonEmptyString(override.targetId) && isNonEmptyString(override.field)) {
      const tripletKey = `${String(override.targetType)}::${override.targetId}::${override.field}`
      if (seenOverrideTriplets.has(tripletKey)) {
        issues.push(issue(path, 'duplicate-override', 'Override en double pour le même triplet targetType/targetId/field.'))
      }
      seenOverrideTriplets.add(tripletKey)
    }
  })

  // --- enrichmentMetadata ---------------------------------------------------
  const enrichmentMetadata = value.enrichmentMetadata
  if (!isPlainObject(enrichmentMetadata)) {
    issues.push(issue('enrichmentMetadata', 'missing-required', 'enrichmentMetadata est requis.'))
  } else if (!Array.isArray(enrichmentMetadata.providers)) {
    issues.push(issue('enrichmentMetadata.providers', 'invalid-type', 'providers doit être un tableau.'))
  } else {
    enrichmentMetadata.providers.forEach((provider: unknown, index: number) => {
      const path = `enrichmentMetadata.providers[${index}]`
      if (!isPlainObject(provider)) {
        issues.push(issue(path, 'invalid-type', 'Entrée de fournisseur invalide.'))
        return
      }
      if (!isOneOf(provider.provider, ENRICHMENT_PROVIDERS)) issues.push(issue(`${path}.provider`, 'invalid-enum', 'provider invalide.'))
      if (provider.lastAttemptedAt !== null && !isIsoDateTime(provider.lastAttemptedAt)) issues.push(issue(`${path}.lastAttemptedAt`, 'invalid-datetime', 'lastAttemptedAt invalide.'))
      if (provider.lastSuccessAt !== null && !isIsoDateTime(provider.lastSuccessAt)) issues.push(issue(`${path}.lastSuccessAt`, 'invalid-datetime', 'lastSuccessAt invalide.'))
      if (!isOneOf(provider.status, ENRICHMENT_PROVIDER_STATUSES)) issues.push(issue(`${path}.status`, 'invalid-enum', 'status invalide.'))
      if (provider.message !== null && !isNonEmptyString(provider.message)) issues.push(issue(`${path}.message`, 'invalid-value', 'message doit être une chaîne non vide ou null.'))
    })
  }

  // --- generatedMetadata ----------------------------------------------------
  const generatedMetadata = value.generatedMetadata
  if (!isPlainObject(generatedMetadata)) {
    issues.push(issue('generatedMetadata', 'missing-required', 'generatedMetadata est requis.'))
  } else {
    if (!isNonEmptyString(generatedMetadata.engineVersion)) issues.push(issue('generatedMetadata.engineVersion', 'missing-required', 'engineVersion est requis.'))
    if (generatedMetadata.generatedAt !== null && !isIsoDateTime(generatedMetadata.generatedAt)) issues.push(issue('generatedMetadata.generatedAt', 'invalid-datetime', 'generatedAt invalide.'))
    if (!isOneOf(generatedMetadata.derivedDataStatus, DERIVED_DATA_STATUSES)) issues.push(issue('generatedMetadata.derivedDataStatus', 'invalid-enum', 'derivedDataStatus invalide.'))
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  return { ok: true, value: value as unknown as TripBundle }
}

export function assertTripBundle(value: unknown): asserts value is TripBundle {
  const result = validateTripBundle(value)
  if (!result.ok) {
    const [first] = result.issues
    const suffix = result.issues.length > 1 ? ` (+${result.issues.length - 1} autre(s))` : ''
    throw new Error(`TripBundle invalide : ${first?.path ?? ''} ${first?.message ?? 'erreur inconnue'}${suffix}`)
  }
}
