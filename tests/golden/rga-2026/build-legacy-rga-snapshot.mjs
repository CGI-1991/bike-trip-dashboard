// Builds a deterministic, JSON-serializable summary of the RGA 2026 legacy,
// operational pipeline — the exact code paths `src/main.ts` runs today
// (`rga2026TripPlan`, the real GPX parser, `buildRoadbookMatchReport`, the
// route/timeline engine with explicit default settings). This module reads
// only from `public/data/**` and `src/**`; it never touches the new
// `TripBundle`/`trip-core` code, and never reads `localStorage` or the
// current date/time.
//
// No raw GPX coordinate arrays are kept here — only counts, distances and
// hashes, per the golden master's "no massive JSON" rule.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

const projectRoot = new URL('../../../', import.meta.url)
const readText = (relativePath) => readFile(new URL(relativePath, projectRoot), 'utf8')
const readBytes = (relativePath) => readFile(new URL(relativePath, projectRoot))
const readJson = async (relativePath) => JSON.parse(await readText(relativePath))

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sortBy(array, keyFn) {
  return [...array].sort((left, right) => {
    const a = keyFn(left)
    const b = keyFn(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/** Stable JSON stringify (recursively sorted object keys) — used only for hashing, never stored raw. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hashOf(value) {
  return sha256Hex(Buffer.from(stableStringify(value), 'utf8'))
}

async function buildTripPlanSection() {
  const { rga2026TripPlan } = await import('../../../src/trip/plan.ts')
  const days = sortBy(rga2026TripPlan.days, (day) => day.dayNumber).map((day) => ({
    id: day.id,
    dayNumber: day.dayNumber,
    type: day.type,
    startName: day.type === 'ride' ? day.startName : null,
    endName: day.type === 'ride' ? day.endName : null,
    locationName: day.type === 'off' ? day.locationName : null,
    gpxNumber: day.type === 'ride' ? day.gpxNumber : null,
    gpxFile: day.type === 'ride' ? day.gpxFile : null,
    variant: day.type === 'ride' ? (day.variant ?? null) : null,
  }))
  return {
    id: rga2026TripPlan.id,
    name: rga2026TripPlan.name,
    timezone: rga2026TripPlan.timezone,
    totalDays: rga2026TripPlan.totalDays,
    rideDays: rga2026TripPlan.rideDays,
    offDays: rga2026TripPlan.offDays,
    days,
  }
}

async function buildCalendarSection() {
  const { TRIP_CALENDAR, buildTripCalendar } = await import('../../../src/trip/calendar.ts')
  const { rga2026TripPlan } = await import('../../../src/trip/plan.ts')
  const days = sortBy(buildTripCalendar(rga2026TripPlan), (day) => day.dayNumber)
  return {
    startDate: TRIP_CALENDAR.startDate,
    endDate: days.at(-1).date,
    timezone: TRIP_CALENDAR.timezone,
    days: days.map((day) => ({ dayId: day.dayId, dayNumber: day.dayNumber, date: day.date })),
  }
}

/** cols + resupplyPassages + options across the ten ride days, plus the start/end/pause point counts CDC section 5 asks for. */
function buildDocumentedPointCounts(roadbook, overridesRaw) {
  const rideDays = roadbook.days.filter((day) => day.type === 'ride')
  let cols = 0
  let passages = 0
  let options = 0
  let pauses = 0
  for (const day of rideDays) {
    cols += day.cols.length
    passages += day.resupplyPassages.length
    options += day.options.length
    pauses += day.explicitPauses.length
  }
  const documentedPointCandidates = cols + passages + options
  const starts = rideDays.length
  const ends = rideDays.length
  const documentedObjectCount = documentedPointCandidates + starts + ends + pauses

  const overridesByStatus = { matched: 0, 'needs-review': 0, unmatched: 0 }
  for (const override of overridesRaw.overrides) {
    if (override.approvedStatus in overridesByStatus) overridesByStatus[override.approvedStatus] += 1
  }
  const suppressed = overridesByStatus['needs-review'] + overridesByStatus.unmatched
  const operationalObjectCount = documentedObjectCount - suppressed

  return {
    cols,
    passages,
    options,
    explicitPauses: pauses,
    starts,
    ends,
    documentedPointCandidates,
    roadbookOverrides: overridesRaw.overrides.length,
    matchedOverrides: overridesByStatus.matched,
    needsReviewOverrides: overridesByStatus['needs-review'],
    unmatchedOverrides: overridesByStatus.unmatched,
    suppressed,
    documentedObjectCount,
    operationalObjectCount,
  }
}

async function buildRoadbookSection() {
  const roadbookRaw = await readJson('public/data/trip/roadbook.json')
  const overridesRaw = await readJson('public/data/trip/roadbook-overrides.json')
  const { validateRoadbookDocument, validateRoadbookOverridesDocument } = await import(
    '../../../src/trip/roadbook-validation.ts'
  )
  const roadbook = validateRoadbookDocument(roadbookRaw)
  const overrides = validateRoadbookOverridesDocument(overridesRaw, roadbook)
  const { roadbookSuppressions } = await import('../../../src/trip/roadbook-suppressions.ts')

  const days = sortBy(roadbook.days, (day) => day.dayNumber).map((day) => ({
    id: day.id,
    dayNumber: day.dayNumber,
    type: day.type,
    title: day.title,
    notes: day.notes,
    editorialStats: day.type === 'ride' ? day.editorialStats : null,
    variant: day.type === 'ride' ? day.variant : null,
    colIds: day.type === 'ride' ? sortBy(day.cols, (col) => col.id).map((col) => col.id) : [],
    resupplyPassageIds: day.type === 'ride' ? sortBy(day.resupplyPassages, (p) => p.id).map((p) => p.id) : [],
    optionIds: day.type === 'ride' ? sortBy(day.options, (o) => o.id).map((o) => o.id) : [],
    explicitPauseIds: day.type === 'ride' ? sortBy(day.explicitPauses, (p) => p.id).map((p) => p.id) : [],
  }))

  return {
    version: roadbook.version,
    tripId: roadbook.tripId,
    days,
    pointCounts: buildDocumentedPointCounts(roadbook, overridesRaw),
    suppressedPointIds: sortBy(roadbookSuppressions, (entry) => entry.pointId).map((entry) => entry.pointId),
    skippedOverrideCount: overrides.skippedOverrides.length,
    roadbookHash: hashOf(roadbookRaw),
    overridesHash: hashOf(overridesRaw),
  }
}

async function buildRoadbookMatchSummary() {
  const { rga2026TripPlan } = await import('../../../src/trip/plan.ts')
  const { parseGpxDocument } = await import('../../../src/gpx/parser.ts')
  const { parseGpxFileNumber } = await import('../../../src/gpx/load.ts')
  const { validateRoadbookDocument, validateRoadbookOverridesDocument } = await import(
    '../../../src/trip/roadbook-validation.ts'
  )
  const { buildTripProfile, scheduleTripTimeline } = await import('../../../src/trip/timeline.ts')
  const { buildRoadbookMatchReport } = await import('../../../src/trip/roadbook-match.ts')
  const { emptyPausePlan } = await import('../../../src/trip/pause-plan.ts')
  const { createDefaultRideDaySettingsDocument, getRideDaySettings } = await import(
    '../../../src/storage/ride-day-settings.ts'
  )

  const manifest = await readJson('public/data/gpx/manifest.json')
  const gpxResults = await Promise.all(
    manifest.files.map(async (entry) => {
      const fileNumber = parseGpxFileNumber(entry.fileName)
      const source = { ...entry, fileNumber, url: entry.fileName, isVariant: false }
      const xmlText = await readText(`public/data/gpx/${entry.fileName}`)
      return parseGpxDocument(xmlText, source)
    }),
  )

  const roadbook = validateRoadbookDocument(await readJson('public/data/trip/roadbook.json'))
  const overrides = validateRoadbookOverridesDocument(await readJson('public/data/trip/roadbook-overrides.json'), roadbook)

  // Explicit default settings only — never localStorage (CDC phase 4 section 11/13).
  const defaults = createDefaultRideDaySettingsDocument()
  const getDaySettings = (dayId) => ({ ...getRideDaySettings(defaults, dayId), referenceSpeedKph: defaults.referenceSpeedKph })

  const profile = buildTripProfile(rga2026TripPlan, gpxResults)
  // Pass 1: no documented-point report yet (mirrors main.ts's first pass).
  const firstPassTimeline = scheduleTripTimeline(profile, getDaySettings, emptyPausePlan, {})
  const firstReport = buildRoadbookMatchReport(roadbook, overrides, rga2026TripPlan, gpxResults, firstPassTimeline)
  // Pass 2: reschedule with the real documented points now available.
  const pausePlacesByDay = {}
  for (const day of firstReport.days) {
    if (day.type !== 'ride') continue
    const places = day.points
      .filter((point) => point.matchedTrackDistanceKm !== undefined)
      .map((point) => ({ id: point.id, name: point.name, trackDistanceKm: point.matchedTrackDistanceKm, offRoute: false }))
    pausePlacesByDay[day.dayId] = places
  }
  const timeline = scheduleTripTimeline(profile, getDaySettings, emptyPausePlan, pausePlacesByDay)
  const report = buildRoadbookMatchReport(roadbook, overrides, rga2026TripPlan, gpxResults, timeline)

  return { summary: report.summary, gpxResults, timeline }
}

function buildGpxTechnicalSection(gpxResults) {
  return sortBy(gpxResults, (result) => result.source.fileNumber).map((result) => {
    if (result.status !== 'success') {
      return { fileNumber: result.source.fileNumber, fileName: result.source.fileName, status: 'error' }
    }
    return {
      fileNumber: result.source.fileNumber,
      fileName: result.source.fileName,
      status: 'success',
      totalPoints: result.summary.totalPoints,
      segmentCount: result.summary.segmentCount,
      hasMultipleSegments: result.summary.hasMultipleSegments,
      distanceKm: Math.round(result.summary.distanceKm * 1000) / 1000,
      elevationGainM: result.summary.elevationGainM === null ? null : Math.round(result.summary.elevationGainM),
      elevationLossM: result.summary.elevationLossM === null ? null : Math.round(result.summary.elevationLossM),
      minElevationM: result.summary.minElevationM,
      maxElevationM: result.summary.maxElevationM,
      hasAltitude: result.summary.minElevationM !== null,
      waypointCount: result.internalInspection.waypointCount,
      namedPointCount: result.internalInspection.namedPointCount,
    }
  })
}

function buildTimingsSection(timeline) {
  const rideDays = sortBy(
    timeline.days.filter((day) => day.type === 'ride' && day.status === 'ready'),
    (day) => day.day.dayNumber,
  )
  const days = rideDays.map((day) => ({
    dayId: day.day.id,
    departureTimeMinutes: day.route.summary.departureTimeMinutes,
    movingDurationMinutes: Math.round(day.route.summary.movingDurationMinutes * 100) / 100,
    pauseDurationMinutes: Math.round(day.route.summary.pauseDurationMinutes * 100) / 100,
    totalDurationMinutes: Math.round(day.route.summary.totalDurationMinutes * 100) / 100,
    arrivalTimeMinutes: day.route.summary.arrivalTimeMinutes,
  }))
  return {
    readyRideDayCount: rideDays.length,
    totalTripMovingMinutes: Math.round(days.reduce((total, day) => total + day.movingDurationMinutes, 0) * 100) / 100,
    days,
  }
}

async function buildAccommodationsSection() {
  const raw = await readJson('public/data/trip/accommodations.json')
  const accommodations = sortBy(raw.accommodations, (item) => item.id).map((item) => ({
    id: item.id,
    dayIds: [...item.dayIds].sort(),
    name: item.name,
    type: item.type,
    address: item.address,
    website: item.website ?? null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    confirmed: item.confirmed,
  }))
  return { version: raw.version, tripId: raw.tripId, count: accommodations.length, accommodations }
}

async function buildPracticalPlacesSection() {
  const { validatePracticalData } = await import('../../../src/practical/model.ts')
  const raw = await readJson('public/data/practical/practical-points.json')
  const data = validatePracticalData(raw)
  const byCategory = {}
  for (const layer of data.layers) byCategory[layer.iconKey] = (byCategory[layer.iconKey] ?? 0) + layer.pointCount
  const multiDayCount = data.points.filter((point) => point.dayIds.length > 1).length
  // Normalized to bare day numbers (not the "J1" legacy id, nor the generic TripDayId
  // scheme) so this hash is meaningfully comparable against the TripBundle snapshot,
  // which necessarily uses a different id scheme for the same days.
  const dayIdShape = sortBy(data.points, (point) => point.id).map((point) => ({
    id: point.id,
    dayNumbers: [...point.dayIds].map((legacyDayId) => Number(legacyDayId.slice(1))).sort((a, b) => a - b),
  }))
  return {
    schemaVersion: data.schemaVersion,
    distanceLimitKm: data.distanceLimitKm,
    layerCount: data.layers.length,
    totalCount: data.points.length,
    byCategory,
    multiDayCount,
    dayIdShapeHash: hashOf(dayIdShape),
  }
}

async function buildOfflineSection() {
  const { offlineResources, collectOfflineResources } = await import('../../../scripts/offline-resources.mjs')
  const { resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const publicDir = resolve(fileURLToPath(projectRoot), 'public')
  const discovered = collectOfflineResources(publicDir)
  const combined = [...new Set([...offlineResources, ...discovered])].sort()
  return {
    historicalResourceCount: offlineResources.length,
    historicalResources: [...offlineResources].sort(),
    tripPackageResourceCount: discovered.filter((resource) => resource.startsWith('trips/')).length,
    combinedResourceCount: combined.length,
    duplicateCount: offlineResources.length + discovered.length - combined.length,
    hasAbsoluteUrl: combined.some((resource) => /^https?:/i.test(resource)),
    hasWindowsPath: combined.some((resource) => /[a-zA-Z]:\\|\\\\/.test(resource)),
  }
}

async function buildGpxSourceFilesSection() {
  const manifest = await readJson('public/data/gpx/manifest.json')
  const entries = await Promise.all(
    manifest.files.map(async (entry) => {
      const bytes = await readBytes(`public/data/gpx/${entry.fileName}`)
      return { fileName: entry.fileName, startName: entry.startName, endName: entry.endName, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }
    }),
  )
  return { count: entries.length, files: entries }
}

async function buildSettingsSection() {
  const { defaultSettings } = await import('../../../src/storage/settings.ts')
  const { createDefaultRideDaySettingsDocument, rideDaySettingsDayIds } = await import(
    '../../../src/storage/ride-day-settings.ts'
  )
  const document = createDefaultRideDaySettingsDocument()
  return {
    referenceSpeedKph: defaultSettings.referenceSpeedKph,
    departureTime: defaultSettings.departureTime,
    totalBreakMinutes: defaultSettings.totalBreakMinutes,
    rideDayCount: rideDaySettingsDayIds.length,
    documentReferenceSpeedKph: document.referenceSpeedKph,
  }
}

export async function buildLegacyRgaSnapshot() {
  const [tripPlan, calendar, roadbook, accommodations, practicalPlaces, offline, gpxSourceFiles, settings] = await Promise.all([
    buildTripPlanSection(),
    buildCalendarSection(),
    buildRoadbookSection(),
    buildAccommodationsSection(),
    buildPracticalPlacesSection(),
    buildOfflineSection(),
    buildGpxSourceFilesSection(),
    buildSettingsSection(),
  ])
  const { summary: roadbookMatchSummary, gpxResults, timeline } = await buildRoadbookMatchSummary()

  return {
    tripPlan,
    calendar,
    roadbook,
    roadbookMatchSummary,
    gpxTechnical: buildGpxTechnicalSection(gpxResults),
    gpxSourceFiles,
    timingsDefault: buildTimingsSection(timeline),
    accommodations,
    practicalPlaces,
    offline,
    settings,
  }
}
