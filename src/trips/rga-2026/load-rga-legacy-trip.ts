import type { PracticalData } from '../../practical/model.ts'
import { validatePracticalData } from '../../practical/model.ts'
import type { RoadbookDocument, RoadbookOverridesDocument } from '../../trip/roadbook-types.ts'
import { validateRoadbookDocument, validateRoadbookOverridesDocument } from '../../trip/roadbook-validation.ts'
import type { TripBundle } from '../../trip-core/index.ts'
import { validateTripBundle } from '../../trip-core/index.ts'
import {
  buildAccommodationDayIndex,
  buildLegacyDayIdIndex,
  mapAccommodations,
  mapCalendar,
  mapDaysAndStages,
  mapEnrichmentMetadata,
  mapGeneratedMetadata,
  mapMetadata,
  mapPracticalPlaces,
  mapRoutePoints,
  mapRoutes,
  mapSettings,
  mapSourceFiles,
} from './rga-legacy-mapping.ts'
import type { RgaLegacyAccommodationsDocument, RgaLegacyDefaultSettings, RgaLegacyGpxManifestEntry } from './rga-legacy-mapping.ts'

/**
 * Everything `createRgaLegacyTripBundle` needs, already parsed from the
 * canonical `public/trips/rga-2026/` package. Building this snapshot (I/O,
 * fetch, JSON parsing) is `loadRgaLegacyTrip`'s job; this type is the pure
 * boundary between the two.
 */
export interface RgaLegacyTripSnapshot {
  readonly roadbook: RoadbookDocument
  readonly overrides: RoadbookOverridesDocument
  readonly accommodations: RgaLegacyAccommodationsDocument
  readonly practicalData: PracticalData
  readonly gpxManifest: readonly RgaLegacyGpxManifestEntry[]
  readonly defaultSettings: RgaLegacyDefaultSettings
}

/**
 * Builds a TripBundle v1 from an already-loaded RGA legacy snapshot.
 *
 * Pure and synchronous: no fetch, no DOM/window/document, no localStorage or
 * sessionStorage, no `Date.now()`/`new Date()`, no `Math.random()`. Always
 * validates its result with `validateTripBundle` and throws with the first
 * issue's path/message rather than ever returning a partially invalid bundle.
 */
export function createRgaLegacyTripBundle(input: RgaLegacyTripSnapshot): TripBundle {
  const accommodations = mapAccommodations(input.accommodations.accommodations)
  const accommodationIdByLegacyDay = buildAccommodationDayIndex(input.accommodations.accommodations)
  const sourceFiles = mapSourceFiles(input.gpxManifest)
  const routes = mapRoutes(input.gpxManifest)
  const routePoints = mapRoutePoints(input.overrides, input.roadbook)
  const { days, stages } = mapDaysAndStages(input.roadbook, accommodationIdByLegacyDay, input.overrides)
  const legacyDayIdIndex = buildLegacyDayIdIndex(input.roadbook)
  const practicalPlaces = mapPracticalPlaces(input.practicalData, legacyDayIdIndex)
  const rideDayIds = days.filter((day) => day.type === 'ride').map((day) => day.id)
  const settings = mapSettings(rideDayIds, input.defaultSettings)

  const candidate = {
    schemaVersion: 1 as const,
    metadata: mapMetadata(),
    calendar: mapCalendar(),
    days,
    stages,
    sourceFiles,
    routes,
    // Climb start/end distances would require either trusting the roadbook's
    // editorial climb length against a GPX-matched summit position (mixing two
    // provenances into one derived number) or running the live GPX-matching
    // pipeline (out of scope here) — see the phase 3 report's Limits section.
    climbs: [],
    routePoints,
    practicalPlaces,
    accommodations,
    // Weather always requires a date and is never frozen ahead of time; the
    // legacy weather system is untouched and keeps serving the live app.
    weather: [],
    settings,
    // No deterministic targetType/targetId/field/value correspondence exists
    // between the legacy roadbook-matching overrides and a TripOverride edit —
    // see the phase 3 report's Limits section. The raw overrides remain
    // available verbatim in the canonical package's overrides/ folder.
    overrides: [],
    enrichmentMetadata: mapEnrichmentMetadata(),
    generatedMetadata: mapGeneratedMetadata(),
  }

  const result = validateTripBundle(candidate)
  if (!result.ok) {
    const [first, ...rest] = result.issues
    const suffix = rest.length > 0 ? ` (+${rest.length} autre(s))` : ''
    throw new Error(
      `TripBundle RGA 2026 invalide : ${first?.path ?? ''} ${first?.message ?? 'erreur inconnue'}${suffix}`,
    )
  }
  return result.value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The manifest's `counts` block — every value computed by the generator, never hand-copied. */
export interface RgaTripManifestCounts {
  readonly days: number
  readonly rideDays: number
  readonly offDays: number
  readonly gpxFiles: number
  readonly documentedPointCandidates: number
  readonly roadbookOverrides: number
  readonly matchedOverrides: number
  readonly needsReviewOverrides: number
  readonly unmatchedOverrides: number
  readonly tripBundleRoutePoints: number
  readonly practicalPlaces: number
  readonly accommodations: number
}

/** Root `manifest.json` shape — the paths and GPX list `loadRgaLegacyTrip` fetches next. */
export interface RgaTripManifest {
  readonly manifestVersion: 1
  readonly tripId: string
  readonly counts: RgaTripManifestCounts
  readonly gpx: readonly RgaLegacyGpxManifestEntry[]
  readonly roadbookPath: string
  readonly accommodationsPath: string
  readonly practicalPlacesPath: string
  readonly overridesPath: string
  readonly settingsPath: string
}

const COUNT_FIELDS = [
  'days', 'rideDays', 'offDays', 'gpxFiles', 'documentedPointCandidates', 'roadbookOverrides',
  'matchedOverrides', 'needsReviewOverrides', 'unmatchedOverrides', 'tripBundleRoutePoints',
  'practicalPlaces', 'accommodations',
] as const

/** Light, explicit validation of the canonical package's manifest — see CDC section 5. */
export function parseRgaTripManifest(value: unknown): RgaTripManifest {
  if (!isRecord(value)) throw new Error('Manifeste de voyage RGA invalide : objet racine attendu.')
  if (value.manifestVersion !== 1) throw new Error('Manifeste de voyage RGA invalide : manifestVersion doit être 1.')
  if (typeof value.tripId !== 'string' || value.tripId.trim() === '') {
    throw new Error('Manifeste de voyage RGA invalide : tripId manquant.')
  }
  if (!Array.isArray(value.gpx) || value.gpx.length !== 10) {
    throw new Error('Manifeste de voyage RGA invalide : dix entrées GPX attendues.')
  }
  for (const entry of value.gpx) {
    if (
      !isRecord(entry) ||
      typeof entry.fileName !== 'string' ||
      typeof entry.startName !== 'string' ||
      typeof entry.endName !== 'string' ||
      !Number.isInteger(entry.sizeBytes) ||
      (entry.sizeBytes as number) < 0 ||
      typeof entry.sha256 !== 'string' ||
      !/^[0-9a-fA-F]{64}$/.test(entry.sha256)
    ) {
      throw new Error(`Manifeste de voyage RGA invalide : entrée GPX invalide (${JSON.stringify(entry)}).`)
    }
  }
  for (const pathField of ['roadbookPath', 'accommodationsPath', 'practicalPlacesPath', 'overridesPath', 'settingsPath'] as const) {
    const path = value[pathField]
    if (typeof path !== 'string' || path.trim() === '' || path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.includes('\\')) {
      throw new Error(`Manifeste de voyage RGA invalide : ${pathField} doit être un chemin relatif base-safe.`)
    }
  }
  const counts = value.counts
  if (!isRecord(counts)) throw new Error('Manifeste de voyage RGA invalide : counts manquant.')
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(counts[field]) || (counts[field] as number) < 0) {
      throw new Error(`Manifeste de voyage RGA invalide : counts.${field} doit être un entier non négatif.`)
    }
  }
  const validCounts = counts as unknown as RgaTripManifestCounts
  if (validCounts.days !== validCounts.rideDays + validCounts.offDays) {
    throw new Error('Manifeste de voyage RGA invalide : counts.days doit égaler rideDays + offDays.')
  }
  if (validCounts.gpxFiles !== value.gpx.length) {
    throw new Error('Manifeste de voyage RGA invalide : counts.gpxFiles doit égaler la taille du tableau gpx.')
  }
  if (validCounts.roadbookOverrides !== validCounts.matchedOverrides + validCounts.needsReviewOverrides + validCounts.unmatchedOverrides) {
    throw new Error('Manifeste de voyage RGA invalide : counts.roadbookOverrides doit égaler matched + needsReview + unmatched.')
  }
  if (validCounts.documentedPointCandidates !== validCounts.roadbookOverrides) {
    throw new Error('Manifeste de voyage RGA invalide : counts.documentedPointCandidates doit égaler counts.roadbookOverrides.')
  }
  if (validCounts.tripBundleRoutePoints !== validCounts.matchedOverrides) {
    throw new Error('Manifeste de voyage RGA invalide : counts.tripBundleRoutePoints doit égaler counts.matchedOverrides.')
  }
  return value as unknown as RgaTripManifest
}

function parseRgaLegacyAccommodationsDocument(value: unknown): RgaLegacyAccommodationsDocument {
  if (!isRecord(value) || value.version !== 1 || value.tripId !== 'rga-2026' || !Array.isArray(value.accommodations)) {
    throw new Error('Document de logements RGA invalide.')
  }
  return value as unknown as RgaLegacyAccommodationsDocument
}

function parseRgaLegacyDefaultSettings(value: unknown): RgaLegacyDefaultSettings {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.referenceSpeedKph !== 'number' ||
    typeof value.departureTime !== 'string' ||
    typeof value.totalBreakMinutes !== 'number'
  ) {
    throw new Error('Document de réglages par défaut RGA invalide.')
  }
  return value as unknown as RgaLegacyDefaultSettings
}

/**
 * Resolves the base URL to fetch the canonical package from. Defaults to
 * Vite's `import.meta.env.BASE_URL` — evaluated lazily, only when
 * `publicBaseUrl` is not supplied, so calling this with an explicit override
 * (as tests do) never touches `import.meta.env` at all. That global is
 * injected by Vite at build/dev time and is `undefined` under plain
 * `node --test`, which is exactly why every other fetch-based loader in this
 * codebase (`src/gpx/load.ts`, `src/trip/roadbook-loader.ts`,
 * `src/trip/accommodations.ts`) has historically gone untested directly.
 */
function resolveRgaTripBaseUrl(publicBaseUrl?: string): string {
  const raw = publicBaseUrl ?? import.meta.env.BASE_URL
  return raw.endsWith('/') ? raw : `${raw}/`
}

function getRgaTripPublicUrl(relativePath: string, publicBaseUrl?: string): string {
  return `${resolveRgaTripBaseUrl(publicBaseUrl)}trips/rga-2026/${relativePath}`
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`Ressource RGA inaccessible (HTTP ${response.status}) : ${url}`)
  return response.json()
}

/**
 * Fetches the canonical `public/trips/rga-2026/` package and builds a
 * TripBundle v1 from it.
 *
 * Async, not the CDC's preferred plain synchronous signature — deliberately:
 * the package includes ten real GPX files and ~1700 practical places
 * (~3.4 MB total). Embedding that into the JavaScript bundle just to expose
 * a synchronous function would bloat every page load with data most views
 * never touch; fetching it on demand keeps the bundle small, works
 * unmodified on GitHub Pages, and leaves room for the existing service
 * worker to serve it offline once cached. `createRgaLegacyTripBundle` above
 * stays the pure, synchronous, fully testable core.
 *
 * `fetchImpl` and `publicBaseUrl` are both injectable — the latter lets
 * `node --test` exercise this function directly against a `file://`/local
 * base without ever touching Vite's `import.meta.env.BASE_URL`. Only the
 * canonical package is ever read; nothing here falls back to `public/data/`.
 */
export async function loadRgaLegacyTrip(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  publicBaseUrl?: string,
): Promise<TripBundle> {
  const manifest = parseRgaTripManifest(await fetchJson(fetchImpl, getRgaTripPublicUrl('manifest.json', publicBaseUrl)))

  const [roadbookRaw, overridesRaw, accommodationsRaw, practicalRaw, settingsRaw] = await Promise.all([
    fetchJson(fetchImpl, getRgaTripPublicUrl(manifest.roadbookPath, publicBaseUrl)),
    fetchJson(fetchImpl, getRgaTripPublicUrl(manifest.overridesPath, publicBaseUrl)),
    fetchJson(fetchImpl, getRgaTripPublicUrl(manifest.accommodationsPath, publicBaseUrl)),
    fetchJson(fetchImpl, getRgaTripPublicUrl(manifest.practicalPlacesPath, publicBaseUrl)),
    fetchJson(fetchImpl, getRgaTripPublicUrl(manifest.settingsPath, publicBaseUrl)),
  ])

  const roadbook = validateRoadbookDocument(roadbookRaw)
  const overrides = validateRoadbookOverridesDocument(overridesRaw, roadbook)
  const accommodations = parseRgaLegacyAccommodationsDocument(accommodationsRaw)
  const practicalData = validatePracticalData(practicalRaw)
  const defaultSettings = parseRgaLegacyDefaultSettings(settingsRaw)

  return createRgaLegacyTripBundle({
    roadbook,
    overrides,
    accommodations,
    practicalData,
    gpxManifest: manifest.gpx,
    defaultSettings,
  })
}
