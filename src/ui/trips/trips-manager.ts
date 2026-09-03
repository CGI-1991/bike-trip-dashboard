/**
 * "Mes voyages" — CDC phase 6C1 sections 5-7/24-27, reworked across Jalons
 * B4.2/B4.3. Lists every stored `TripBundle`, lets the user create one (the
 * import wizard), open its technical view, or delete it. Independent of the
 * historical RGA runtime — see `README.md`.
 */

import { createTripRepository } from '../../storage/indexeddb/trip-repository.ts'
import { createSourceFileRepository } from '../../storage/indexeddb/source-file-repository.ts'
import type { SourceFilePayloadContent } from '../../storage/indexeddb/source-file-repository.ts'
import { enrichStoredTripEndpoints, tripNeedsEndpointGeocoding } from '../../geocoding/endpoint-enrichment.ts'
import type { GeocodingProvider } from '../../geocoding/types.ts'
import type { RouteEnrichmentProgress, RouteEnrichmentProvider } from '../../route-enrichment/types.ts'
import { runStoredTripAutomaticEnrichment, tripNeedsAutomaticEnrichment } from '../../route-enrichment/automatic-enrichment.ts'
import { RETRY_POSTPASS_SEGMENT_KM } from '../../route-enrichment/segmentation.ts'
import { unsettleStageForRetry } from '../../route-enrichment/settled-stages.ts'
import { buildPracticalPlaceViewModels } from '../../practical-places/view-model.ts'
import type { PracticalPlacesProvider } from '../../practical-places/types.ts'
import { createSingleFlightGuard } from '../../trips-manager/single-flight.ts'
import { computeTripPreparationSummary, deriveStagePreparationStatus } from '../../trips-manager/stage-preparation.ts'
import type { StagePreparationContext, StagePreparationStatus } from '../../trips-manager/stage-preparation.ts'
import { deriveStageInvalidation } from '../../trips-manager/pause-invalidation.ts'
import { enrichStoredTripPracticalPlaces } from '../../practical-places/enrichment.ts'
import type {
  AccommodationId, IsoDate, LatitudeDegrees, LongitudeDegrees, RideStageId, RideStageSettings, RoutePointId, StagePauseSetting, TripBundle, TripDayId, TripId,
} from '../../trip-core/index.ts'
import { getActiveTripId } from '../../storage/indexeddb/active-trip.ts'
import { resolvePreferredActiveTripId } from '../../trips-manager/active-trip-selection.ts'
import { deriveTripTemporalState, resolveAdjacentTripDayId } from '../../trips-manager/trip-day-temporal-state.ts'
import { deleteTripCompletely, listTripSummaries, setActiveTrip } from '../../trips-manager/trip-manager-actions.ts'
import type { TripListEntry } from '../../trips-manager/trip-summary.ts'
import { formatShortDate } from '../date-format.ts'
import type { MapLayerDefinition, RouteMapInteractionHandle } from '../route-map.ts'
import { buildGenericOverviewDetailMarkers, buildGenericOverviewRouteMapModel, buildGenericRouteMapModel } from '../route-map-model.ts'
import type { RouteMapModel } from '../route-map-model.ts'
import { buildPracticalPlaceMapLayers } from '../practical-place-map-layers.ts'
import { mountClimbProfileInteraction, renderGenericElevationProfile } from '../elevation-profile.ts'
import { downloadBlob } from '../gpx-share.ts'
import { buildZipArchive } from '../zip-writer.ts'
import type { ZipEntryInput } from '../zip-writer.ts'
import { isSignificantWaypoint } from '../../analysis/canonical-waypoints.ts'
import { resolveOffCoordinates, resolveOffLocation, resolveSharedInfoDayId, resolveTransferCoordinates, resolveTransferLocations } from '../../analysis/day-location-fill.ts'
import { normalizePauseDurationMinutes } from '../../analysis/pause-duration.ts'
import { observeStickyHeaderHeight } from '../sticky-header-offset.ts'
import type { StickyHeaderObserverHandle } from '../sticky-header-offset.ts'
import { buildDayDetail } from './day-detail-view.ts'
import type { DayDetail } from './day-detail-view.ts'
import { createImportWizard } from './import-wizard.ts'
import type { ImportWizardResult } from './import-wizard.ts'
import { createTripEditor } from './trip-editor.ts'
import { renderStagePreparationIndicator, renderStageRetryRow, renderTripDetail } from './trip-detail-view.ts'
import { buildTripOverview } from './trip-overview-view.ts'
import type { TripOverview } from './trip-overview-view.ts'
import { createTripDetailAutoScrollSession, scrollTripDayCardIntoView } from '../trip-detail-auto-scroll.ts'
import { createOpenMeteoProvider } from '../../weather/open-meteo.ts'
import type { WeatherProvider } from '../../weather/types.ts'
import { GenericWeatherCoordinator } from '../../weather/generic/coordinator.ts'
import { renderGenericDayCardWeatherLine, renderGenericOverviewWeatherBlock, renderGenericStageWeatherPanel, renderInlineWaypointWeather, renderWeatherAlertsSummary } from '../weather-view.ts'
import type { GenericDayWeatherViewModel } from '../../weather/generic/view-model.ts'
import type { GenericTransferWeatherViewModel } from '../../weather/generic/coordinator.ts'
import { GENERIC_APP_HEADER_NO_ACTIVE_TRIP, buildGenericAppHeader } from './app-header.ts'
import type { GenericAppHeaderState } from './app-header.ts'
import { sharedCurrentLocationService } from '../current-location.ts'

/** One "Villages" layer entry for the fullscreen map (CDC Jalon B4 section 9) — `[]` when the stage has no village at all, so the "Calques" button stays hidden rather than showing an empty layer. */
function villagesLayer(waypoints: readonly import('../../analysis/canonical-waypoints.ts').CanonicalWaypoint[]): readonly MapLayerDefinition[] {
  if (waypoints.length === 0) return []
  return [{ id: 'villages', label: 'Villages', markers: buildGenericRouteMapModel(waypoints, []).markers, defaultVisible: false }]
}

function payloadToUint8Array(content: SourceFilePayloadContent): Promise<Uint8Array> {
  return content instanceof Blob ? content.arrayBuffer().then((buffer) => new Uint8Array(buffer)) : Promise.resolve(new Uint8Array(content))
}

function payloadToBlob(content: SourceFilePayloadContent, mimeType: string): Blob {
  return content instanceof Blob ? content : new Blob([content], { type: mimeType })
}

export interface TripsManagerDeps {
  readonly database: IDBDatabase
  readonly now: () => string
  readonly idFactory: () => string
  readonly geocodingProvider?: GeocodingProvider
  readonly routeEnrichmentProvider?: RouteEnrichmentProvider
  /**
   * C2's automatic runtime source for practical POI (CDC C2 sections 2/15)
   * — wired into the same `startAutomaticEnrichment` pass as the other two
   * providers, once per trip open; the Étape fullscreen map's own "Calques"
   * panel only ever reads whatever is already persisted (`mountMapAndProfile`),
   * it never triggers a search of its own.
   */
  readonly practicalPlacesProvider?: PracticalPlacesProvider
  readonly onRouteEnrichmentDiagnostic?: (progress: RouteEnrichmentProgress) => void
  /**
   * Drives the top-level app nav (URL hash + bottom-nav highlighting) when
   * this component navigates on its own initiative — e.g. "Ouvrir" on a
   * trip card (CDC Jalon B4.2 section 5: must be strictly equivalent to
   * selecting the trip active, then clicking the Aperçu nav link). Omitted
   * in tests that don't exercise top-level navigation.
   */
  readonly onNavigateToView?: (view: 'today' | 'trip') => void
  /**
   * Drives the app-shell header (bug 48B closeout) — `main.ts` owns the
   * actual `.brand`/`[data-day-indicator]` DOM nodes (outside this
   * component's own `[data-trips-manager]` container) and applies whatever
   * state this reports. Called on every full render of Mes voyages/Aperçu/
   * Voyage/Étape, plus the wizard/editor/confirmation screens (all of which
   * report `GENERIC_APP_HEADER_NO_ACTIVE_TRIP` — CDC: never leak the last
   * active trip's name outside of an actual trip screen). Omitted in tests
   * that only check this component's own container markup.
   */
  readonly onHeaderChange?: (state: GenericAppHeaderState) => void
  /**
   * Leaflet-touching map rendering (CDC Jalon C1 closeout) — injected
   * rather than imported directly by this module, exactly like
   * `route-map-model.ts` already splits itself off from `route-map.ts` for
   * the same reason (its own doc comment: "importing `route-map.ts` itself
   * pulls in Leaflet's CSS, which only works inside a bundler"). Always the
   * real `renderGenericRouteMap`/`closeExpandedRouteMap` in production
   * (wired by `main.ts`, which already imports `route-map.ts` for the
   * historical RGA runtime) — this seam only exists so a plain-Node test
   * that never renders a real map (its map containers are never registered,
   * so these are never actually invoked) doesn't have to load Leaflet + its
   * CSS just to import this file.
   */
  readonly renderMap: (container: HTMLElement, dialog: HTMLDialogElement, model: RouteMapModel | null, layers?: readonly MapLayerDefinition[], options?: { readonly directLayerToggle?: boolean }) => void
  readonly closeMap: (dialog: HTMLDialogElement) => void
  /**
   * Same injection seam as `renderMap`/`closeMap` above, for the profile→map
   * temporary-marker sync (CDC D1.1 sections 18-19) — always the real
   * `route-map.ts::getRouteMapInteractionHandle` in production. Optional
   * (defaults to always returning `null`, i.e. no sync) so existing tests
   * that never register a real map keep working unchanged.
   */
  readonly getMapInteractionHandle?: (container: HTMLElement) => RouteMapInteractionHandle | null
  /**
   * R3 sections 30-35 — "Choisir sur la carte": always the real
   * `route-map.ts::mountLocationPicker` in production, mounting a small,
   * dedicated, always-interactive map synchronously (no
   * `requestAnimationFrame` polling — see that function's own doc comment).
   * Optional (defaults to always returning `null`, i.e. the picker is
   * unavailable) so existing tests that never render a real map keep
   * working unchanged, and so the picker degrades to "unavailable" rather
   * than crashing wherever Leaflet itself cannot mount.
   */
  readonly mountLocationPicker?: (container: HTMLElement, initial: { readonly latitude: number; readonly longitude: number } | null) => RouteMapInteractionHandle | null
  /**
   * Weather provider (CDC Jalon C1 section 14) — defaults to the real,
   * unmodified `createOpenMeteoProvider()` when omitted. Injectable purely
   * for tests that want to avoid a real network call; production
   * (`main.ts`) never supplies this, always taking the default.
   */
  readonly weatherProvider?: WeatherProvider
}

/** Where the Étape screen's "Retour" action leads back to (CDC section 13). */
type DayOrigin = 'overview' | 'detail'

type Mode =
  | { readonly kind: 'list' }
  | { readonly kind: 'wizard' }
  | { readonly kind: 'editor'; readonly tripId: TripId }
  | { readonly kind: 'overview'; readonly tripId: TripId }
  | { readonly kind: 'detail'; readonly tripId: TripId }
  | { readonly kind: 'day'; readonly tripId: TripId; readonly dayId: TripDayId; readonly origin: DayOrigin }
  | { readonly kind: 'confirmation'; readonly result: ImportWizardResult }

/**
 * Every day, in the trip's own structural order (CDC Jalon B4.4 section 25):
 * the Étape/Journée sticky nav's ‹/› traverses the whole trip chronology now
 * that OFF/transfer days have a shell to land on too (`day-detail-view.ts`),
 * not just ride days. Sorting by `index` — never `date` — is what keeps a
 * `transferTiming: 'after_previous' | 'before_next'` transfer (which shares
 * its calendar date with a neighbouring ride day) in its correct structural
 * position rather than colliding/reordering on that shared date.
 */
function openableDayIds(bundle: TripBundle): readonly TripDayId[] {
  return bundle.days.slice().sort((left, right) => left.index - right.index).map((day) => day.id)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

/**
 * The whole card navigates ("Ouvrir" → Aperçu, CDC Jalon B4.3 section 4) —
 * `role="button" tabindex="0"` plus the shared keydown handler below give it
 * the same Enter/Space behaviour a real `<button>` gets for free. Modifier/
 * Supprimer stay as real nested buttons: `.closest('[data-action]')`
 * resolves to whichever is nearest, so clicking them never also triggers
 * the card's own `open-trip` action.
 */
// UI-POLISH-01 section 24: `TripStatus` is an internal storage word — never
// shown to the user raw ("ready"/"draft"/"archived").
//
// R1 section 23 ("silence when healthy"): `ready` renders no badge at all —
// it is the permanent, non-actionable state every dated trip is set to once
// at import and never changes afterward (no archive/un-archive action exists
// in this app today), so showing "Prêt" on every single card is exactly the
// internal/default status the CDC asks to hide, not a real business signal
// like `draft` (genuinely undated, actionable — "ajoutez une date de
// départ") or `archived` (kept for if/when an archive action exists).
const TRIP_STATUS_LABELS: Readonly<Record<TripListEntry['status'], string | null>> = {
  draft: 'Brouillon',
  ready: null,
  archived: 'Archivé',
}

/** Same short-date convention as everywhere else (`app-header.ts`/`trip-detail-view.ts`) — never a raw ISO `YYYY-MM-DD` string, the year only shown once, on the last date. */
function formatTripDateRange(trip: TripListEntry): string {
  if (trip.startDate === null) return 'Non daté'
  if (trip.endDate === null) return `${formatShortDate(trip.startDate)} ${trip.startDate.slice(0, 4)}`
  return `${formatShortDate(trip.startDate)} → ${formatShortDate(trip.endDate)} ${trip.endDate.slice(0, 4)}`
}

/**
 * RC2 final-closeout sections 19-20 — a discreet, jargon-free line while
 * this trip's ride days are still being enriched (never "Postpass"/
 * "cache"/"provider" — a plain sentence plus a bare ready/total count).
 * `null` (every ride day ready, or none at all) renders nothing at all —
 * silence when healthy, same convention as every other status surface here.
 */
function renderTripPreparationLine(summary: TripListEntry['preparationSummary']): string {
  if (summary === null) return ''
  return `<p class="trip-card__prep" role="status">Préparation du roadbook · ${summary.ready}/${summary.total}</p>`
}

function renderTripCard(trip: TripListEntry): string {
  const dateLabel = formatTripDateRange(trip)
  const statusLabel = TRIP_STATUS_LABELS[trip.status]
  const statusBadge = statusLabel === null ? '' : `<span class="tag tag--data">${escapeHtml(statusLabel)}</span>`
  return `
    <li class="trip-card" data-action="open-trip" data-trip-id="${escapeHtml(trip.id)}" role="button" tabindex="0">
      <div class="trip-card__header"><h3>${escapeHtml(trip.name)}</h3>${statusBadge}</div>
      ${renderTripPreparationLine(trip.preparationSummary)}
      <dl class="trip-card__stats">
        <div><dt>Dates</dt><dd>${escapeHtml(dateLabel)}</dd></div>
        <div><dt>Journées</dt><dd>${trip.dayCount}</dd></div>
        <div><dt>Étapes</dt><dd>${trip.stageCount}</dd></div>
        <div><dt>Distance</dt><dd>${trip.totalDistanceKm.toFixed(1)} km</dd></div>
      </dl>
      <div class="trip-card__actions">
        <button class="button button--quiet" type="button" data-action="edit-trip" data-trip-id="${escapeHtml(trip.id)}">Modifier</button>
        <button class="button button--danger" type="button" data-action="delete-trip" data-trip-id="${escapeHtml(trip.id)}">Supprimer</button>
      </div>
    </li>`
}

export interface TripsManagerHandle {
  readonly refresh: () => Promise<void>
  readonly goToList: () => void
  /** Opens Aperçu for the currently active trip (CDC Jalon B4 section 3: "Mes voyages détermine le voyage actif affiché ailleurs") — falls back to the trip list when there is none yet. */
  readonly goToOverviewForActiveTrip: () => Promise<void>
  /** Same, for Voyage. */
  readonly goToDetailForActiveTrip: () => Promise<void>
  /**
   * Whether a background automatic-enrichment pass (`startAutomaticEnrichment`
   * — endpoints/route/practical-places, all fire-and-forget from
   * `openOverview`/`openDetail`) is still running for `tripId` right now.
   * Display-only (R3 sections 41-42: it never gates opening a day any more)
   * — exists so a caller can know when every trailing side effect of that
   * pass (including its own `refreshIfShowing` calls) has genuinely
   * settled, e.g. before tearing down the database in a test.
   */
  readonly isAutomaticEnrichmentInFlight: (tripId: TripId) => boolean
  /**
   * Resolves once the weather coordinator's own queue is idle — `refreshWeather`
   * (called at the end of `renderOverview`/`renderDetail`/`renderDay`) never
   * awaits `weatherCoordinator.setTripBundle`'s own fetch/cache round-trip
   * (by design: a screen renders immediately with whatever weather is
   * already known, and `weatherCoordinator.subscribe` patches it in once a
   * fetch actually settles). Exists so a caller can know when that trailing
   * work has genuinely finished, same spirit as `isAutomaticEnrichmentInFlight`.
   */
  readonly waitForWeatherIdle: () => Promise<void>
}

export function initializeTripsManager(container: HTMLElement, deps: TripsManagerDeps): TripsManagerHandle {
  let mode: Mode = { kind: 'list' }
  /**
   * R3 sections 30-35 — "Choisir sur la carte": at most one picker is ever
   * open at a time (the whole Infos edit form it lives in is itself a
   * single-open surface), so simple closure state — never a WeakMap keyed
   * by DOM node — is enough. Reset by both `confirm-choose-location` and
   * `cancel-choose-location`.
   */
  let activePickerHandle: RouteMapInteractionHandle | null = null
  let activePickerTarget: 'start' | 'end' | null = null
  let activePickerCoordinate: { readonly latitude: number; readonly longitude: number } | null = null
  // RC2 final-closeout sections 51-55: whether the visitor has typed into
  // the picker's own label field themselves since it was last opened — a
  // reverse-geocode response arriving after that point never overwrites
  // their own entry (section 52). `activePickerLabelInputController` is the
  // AbortController behind that one listener (registered fresh on every
  // `start-choose-location`, aborted on confirm/cancel/teardown) — the same
  // scoped-listener convention the wizard/editor already use elsewhere in
  // this file, never a permanent top-level `input` listener (this
  // container's own "zero stray listeners once nothing needs them" contract
  // — CDC Jalon B4.3 section 16 — is specifically about that).
  let activePickerLabelEditedByVisitor = false
  let activePickerLabelInputController: AbortController | null = null
  // The wizard/editor own their own live DOM listeners (AbortController-based)
  // separate from this container's single delegated click listener — torn
  // down by `teardownSubComponent` at the top of every full-screen render in
  // this file (CDC Jalon B4.3 section 16/2: navigating away — even via the
  // bottom-nav Aperçu/Voyage links, not just "Mes voyages" — while a
  // wizard/editor was still open used to leave its listeners attached to
  // this shared `container`, so a later click could still reach stale
  // wizard/editor state. Every entry point tearing it down structurally
  // rules that out, rather than only the ones this component itself thought
  // to call it from).
  let activeSubComponent: { readonly destroy: () => void } | null = null

  function teardownSubComponent(): void {
    activeSubComponent?.destroy()
    activeSubComponent = null
    // R3 section 35: any active "Choisir sur la carte" picker's own Leaflet
    // map is torn down along with its DOM subtree the moment ANY of the 4
    // render entry points below replaces `container.innerHTML` — the
    // handle itself would otherwise dangle, a zombie `onMapClick` still
    // registered against a map instance nothing references any more.
    // Always reset here (unconditionally, unlike GPS tracking below, which
    // deliberately persists across day-to-day navigation) since a picker
    // never survives ANY re-render, including Précédent/Suivant.
    activePickerHandle?.onMapClick(null)
    activePickerHandle?.clearTemporaryMarker()
    activePickerHandle = null
    activePickerTarget = null
    activePickerCoordinate = null
    activePickerLabelEditedByVisitor = false
    activePickerLabelInputController?.abort()
    activePickerLabelInputController = null
    // CDC C3.B section 44: every one of the four render* entry points
    // (list/detail/day/overview) calls this first, by which point `mode`
    // already reflects the DESTINATION screen (each `open*` helper sets it
    // before invoking its own render function) — stopping only when that
    // destination isn't another day keeps the watch alive across plain
    // Précédent/Suivant day navigation (no reacquisition flicker) while
    // still covering every real exit ("quitter l'étape / Voyage / Aperçu /
    // Mes voyages") without a second, divergent teardown list.
    if (mode.kind !== 'day') stopCurrentLocationTracking()
  }

  const geocodingInFlight = new Set<TripId>()
  const geocodingErrors = new Map<TripId, string>()
  const automaticEnrichmentGuard = createSingleFlightGuard<TripId>()
  const automaticEnrichmentProgress = new Map<TripId, string>()
  const automaticEnrichmentErrors = new Map<TripId, string>()
  /**
   * DER-DES-DER sections 38-39: the ONE trip currently allowed to run an
   * enrichment orchestration. Claiming it is what stops the previous trip's
   * pass — every enrichment loop checks `enrichmentOwner === its own tripId`
   * between units and returns cleanly when it no longer holds the claim.
   * Never two trips enriching in parallel (section 38), never a rollback of
   * what the stopped trip already persisted (section 39).
   */
  let enrichmentOwner: TripId | null = null
  /**
   * C2.5 sections 5-22: the in-memory precision `deriveStagePreparationStatus`
   * needs beyond what's persisted (trip-wide only) — which ride day the
   * engine is actively working on right now, and which ones a local
   * mutation (a pause anchor change, section 27) marked stale pending a
   * targeted re-enrichment. Both reset to empty on reload (section 20: never
   * a phantom "running") and are cleared once their run settles.
   */
  const runningStageByTrip = new Map<TripId, TripDayId | null>()
  const staleStagesByTrip = new Map<TripId, Set<TripDayId>>()
  const EMPTY_STALE_SET: ReadonlySet<TripDayId> = new Set()
  const detailAutoScrollSession = createTripDetailAutoScrollSession()
  /** One `AbortController` per profile container (CDC D1.1 section 18) — aborted and replaced on every `mountMapAndProfile` call so the profile→map sync listener never accumulates across a full render + `patchDayDetail` patches. */
  const profileSyncControllers = new WeakMap<HTMLElement, AbortController>()
  const getMapInteractionHandle = deps.getMapInteractionHandle ?? (() => null)

  /**
   * One `GenericWeatherCoordinator` for the whole component's lifetime
   * (CDC Jalon C1 sections 16/22) — reused across every trip/day the user
   * navigates to, exactly like `main.ts`'s own single `WeatherCoordinator`
   * for the historical RGA runtime. `setTripBundle` is cheap to call on
   * every render (it delegates its own dedup to the underlying
   * `WeatherCoordinator`/`WeatherCache` — see that module's doc comment).
   */
  const weatherCoordinator = new GenericWeatherCoordinator({
    provider: deps.weatherProvider ?? createOpenMeteoProvider(),
    now: () => new Date(deps.now()),
  })
  /** Whichever bundle is currently on screen — the single source `mountWeatherViews` reads from when the coordinator emits a new snapshot (fetch/refresh completed) asynchronously, well after the render that triggered it returned. */
  let currentWeatherBundle: TripBundle | null = null

  /**
   * Fills in every weather mount point currently in the DOM (CDC Jalon C1
   * section 22: Aperçu/Voyage/Étape all read the same per-day view-model,
   * they just each show a different amount of it) — silently a no-op for
   * whichever mount points aren't present on the currently-rendered screen.
   * Never a full re-render: only these specific subtrees are touched, same
   * discipline as `mountMapAndProfile`/`patchDayDetail`.
   */
  function mountWeatherViews(bundle: TripBundle): void {
    if (mode.kind === 'day') {
      const { dayId } = mode
      const panel = container.querySelector<HTMLElement>('[data-day-detail-weather]')
      const day = bundle.days.find((candidate) => candidate.id === dayId)
      if (panel !== null && day !== undefined) {
        const model = weatherCoordinator.getDayWeatherViewModel(day)
        // CDC D1.2 section 24: a ride day's own "Points significatifs" list
        // is dropped from this mount — every significant point already
        // carries its own inline weather line in the Parcours timeline
        // below (`mountTimelineWaypointWeather`). OFF/transfer days have no
        // Parcours timeline to fold into (section 29) and keep the list.
        renderGenericStageWeatherPanel(panel, model, false, { includePointsList: day.type !== 'ride' })
        if (day.type === 'ride') mountTimelineWaypointWeather(model)
        // R3 sections 24-28: the always-visible "Alertes météo" summary,
        // between map/profile and Parcours — reuses this exact same
        // `model` (never a second fetch), so it always stays in sync with
        // the full Météo panel above.
        const alertsMount = container.querySelector<HTMLElement>('[data-day-detail-weather-alerts]')
        if (alertsMount !== null) alertsMount.innerHTML = renderWeatherAlertsSummary(model)
      }
    }
    const overviewMount = container.querySelector<HTMLElement>('[data-trip-overview-weather-mount]')
    if (overviewMount !== null) {
      const day = bundle.days.find((candidate) => candidate.id === overviewMount.dataset.dayId)
      if (day !== undefined) overviewMount.innerHTML = renderGenericOverviewWeatherBlock(weatherCoordinator.getDayWeatherViewModel(day))
    }
    for (const mount of container.querySelectorAll<HTMLElement>('[data-trip-day-weather-mount]')) {
      const day = bundle.days.find((candidate) => candidate.id === mount.dataset.dayId)
      if (day !== undefined) mount.innerHTML = renderGenericDayCardWeatherLine(weatherCoordinator.getDayWeatherViewModel(day))
    }
  }

  /**
   * CDC D1.2 sections 18-22/26: fills every Parcours row's own
   * `[data-waypoint-weather]` mount point — matched to the view-model's own
   * points by id (`weather/generic/sample-points.ts::toSamplePoint` sets
   * `id: waypoint.id`, the exact same id `day-detail-view.ts` already
   * stamps every row/climb-card with — a join that already existed, never a
   * new lookup table). Never a fresh weather fetch: `model` is whatever the
   * coordinator already has cached/computed for this day.
   */
  function mountTimelineWaypointWeather(model: GenericDayWeatherViewModel | GenericTransferWeatherViewModel | null): void {
    const points = model !== null && !('origin' in model) ? model.points : []
    const byId = new Map(points.map((point) => [point.id, point]))
    for (const mount of container.querySelectorAll<HTMLElement>('[data-waypoint-weather]')) {
      const waypointId = mount.dataset.waypointId
      mount.innerHTML = waypointId === undefined ? '' : renderInlineWaypointWeather(byId.get(waypointId))
    }
  }

  /** Rebuilds every weather day-definition for `bundle` and re-renders whatever weather mount points are currently showing — the one place this component ever talks to the weather coordinator. */
  function refreshWeather(bundle: TripBundle, selectedDayId: TripDayId | TripId): void {
    currentWeatherBundle = bundle
    weatherCoordinator.setTripBundle(bundle, selectedDayId)
    mountWeatherViews(bundle)
  }

  // Re-renders the currently-visible weather mount points whenever the
  // coordinator's own state changes (a fetch/refresh completed) — mirrors
  // `main.ts`'s own `weatherCoordinator.subscribe(...)` for the historical
  // runtime, but scoped to just the weather subtrees here, never a full
  // screen rebuild.
  weatherCoordinator.subscribe(() => {
    if (currentWeatherBundle !== null) mountWeatherViews(currentWeatherBundle)
  })

  async function renderList(): Promise<void> {
    teardownSubComponent()
    deps.onHeaderChange?.(GENERIC_APP_HEADER_NO_ACTIVE_TRIP)
    container.innerHTML = '<p role="status">Chargement de vos voyages…</p>'
    const trips = await listTripSummaries(deps.database, stagePreparationContext)

    if (trips.length === 0) {
      container.innerHTML = `
        <div class="trips-empty" data-trips-empty>
          <header class="view-heading"><p class="eyebrow">Mes voyages</p><h2>Aucun voyage pour le moment</h2></header>
          <p>Importez vos traces GPX pour créer votre premier voyage.</p>
          <button class="button button--primary button--full" type="button" data-action="create-trip">Créer un voyage</button>
        </div>`
      return
    }

    container.innerHTML = `
      <div class="trips-list" data-trips-list>
        <header class="view-heading"><p class="eyebrow">Mes voyages</p><h2>${trips.length} voyage${trips.length > 1 ? 's' : ''}</h2></header>
        <button class="button button--primary button--full" type="button" data-action="create-trip">Créer un voyage</button>
        <ul class="trip-card-list">${trips.map(renderTripCard).join('')}</ul>
      </div>`
  }

  async function renderDetail(tripId: TripId): Promise<void> {
    teardownSubComponent()
    container.innerHTML = '<p role="status">Chargement du voyage…</p>'
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) {
      mode = { kind: 'list' }
      await renderList()
      return
    }
    const now = deps.now()
    deps.onHeaderChange?.(buildGenericAppHeader(bundle, { view: 'trip', now }))
    const enrichmentBusy = geocodingInFlight.has(tripId) || automaticEnrichmentGuard.isInFlight(tripId)
    container.innerHTML = renderTripDetail(bundle, {
      now,
      canEnrichEndpoints: !enrichmentBusy && deps.geocodingProvider !== undefined && tripNeedsEndpointGeocoding(bundle),
      geocodingPending: geocodingInFlight.has(tripId),
      geocodingError: geocodingErrors.get(tripId) ?? null,
      automaticEnrichmentPending: automaticEnrichmentGuard.isInFlight(tripId),
      automaticEnrichmentProgress: automaticEnrichmentProgress.get(tripId) ?? null,
      automaticEnrichmentError: automaticEnrichmentErrors.get(tripId) ?? null,
      stagePreparationStatuses: computeAllStagePreparationStatuses(bundle, tripId),
    })
    refreshWeather(bundle, tripId)
    const priorityDayId = deriveTripTemporalState(bundle, now).priorityDayId
    const shouldAutoScroll = detailAutoScrollSession.consume(tripId)
    if (priorityDayId !== null && shouldAutoScroll) {
      queueMicrotask(() => scrollTripDayCardIntoView(container, priorityDayId))
    }
  }

  async function renderDay(tripId: TripId, dayId: TripDayId): Promise<void> {
    teardownSubComponent()
    container.innerHTML = '<p role="status">Chargement de la journée…</p>'
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) {
      mode = { kind: 'list' }
      await renderList()
      return
    }
    mountDayDetail(bundle, dayId)
  }

  /**
   * Single source of truth for "which waypoints actually show" (CDC Jalon
   * B4.4 sections 5-6/32): the exact same `isSignificantWaypoint` policy the
   * Parcours timeline and Aperçu already use — a village/town only earns its
   * place once it carries a pause, whatever `visibleByDefault` says on its
   * own. Before this fix, the map/profile filtered on `visibleByDefault`
   * directly, which does NOT go through the pause-priority rule (CDC
   * section 27) — a paused village showed on the Parcours list yet vanished
   * from the map/profile right above it. Filtering the shared
   * `detail.waypoints` array here (rather than reusing `detail.timelineHtml`,
   * a string) keeps map/profile/timeline three views of one waypoint set,
   * never three independent filters.
   */
  function getDisplayedStageWaypoints(detail: DayDetail): readonly import('../../analysis/canonical-waypoints.ts').CanonicalWaypoint[] {
    return detail.waypoints.filter((waypoint) => isSignificantWaypoint(waypoint))
  }

  /** Live measured offset for the Étape tabbar (CDC Jalon B4.4 sections 12-13) — replaces the previous fixed-px `--day-sticky-identity-h`/`--day-sticky-nav-h` guesses, which broke as soon as the identity line wrapped to two rows. Re-created on every full mount; the previous mount's observer (if any) is disconnected first so observers never pile up across day-to-day navigation. */
  let stickyHeaderObserver: StickyHeaderObserverHandle | null = null

  function teardownStickyHeaderObserver(): void {
    stickyHeaderObserver?.destroy()
    stickyHeaderObserver = null
  }

  /** Builds and mounts the whole Étape screen (map + profile + everything) — the *only* place that does a full teardown/rebuild of this screen; every pause/filter mutation instead goes through `patchDayDetail` (CDC Jalon B4.2 section 3). */
  function mountDayDetail(bundle: TripBundle, dayId: TripDayId): DayDetail | null {
    const detail = buildDayDetail(bundle, dayId, dayPreparationOptions(bundle, dayId))
    if (detail === null) {
      mode = { kind: 'detail', tripId: bundle.metadata.id }
      void renderDetail(bundle.metadata.id)
      return null
    }
    const day = bundle.days.find((candidate) => candidate.id === dayId) ?? null
    deps.onHeaderChange?.(day === null ? buildGenericAppHeader(bundle, { view: 'trip', now: deps.now() }) : buildGenericAppHeader(bundle, { view: 'day', day }))
    teardownStickyHeaderObserver()
    container.innerHTML = detail.html
    mountMapAndProfile(bundle, detail, dayId)
    wireDepartureTimeInput(bundle.metadata.id, dayId)
    refreshWeather(bundle, dayId)
    const stickyHeader = container.querySelector<HTMLElement>('[data-day-detail-sticky-header]')
    if (stickyHeader !== null) stickyHeaderObserver = observeStickyHeaderHeight(stickyHeader, container, '--day-sticky-header-h')
    // Sticky nav (CDC section 13): ‹/› only ever step between openable days —
    // see `openableDayIds` (CDC Jalon B4.4 section 25: traverses the whole
    // trip chronology, not just ride days, now that OFF/transfer days have
    // their own Étape-shell screen to land on too).
    const openableIds = openableDayIds(bundle)
    const currentIndex = openableIds.indexOf(dayId)
    const previousButton = container.querySelector<HTMLButtonElement>('[data-action="previous-day"]')
    const nextButton = container.querySelector<HTMLButtonElement>('[data-action="next-day"]')
    if (previousButton !== null) previousButton.disabled = currentIndex <= 0
    if (nextButton !== null) nextButton.disabled = currentIndex < 0 || currentIndex >= openableIds.length - 1
    return detail
  }

  /**
   * C2 (CDC C2 sections 16-19): the Étape fullscreen map's own "Calques"
   * panel, and ONLY that surface — never the compact Étape map, never any
   * Aperçu map (`mountOverviewMap` never calls this). Reads whatever is
   * already persisted in `bundle.practicalPlaces` for this stage; never
   * triggers a search of its own (that only ever happens in
   * `startAutomaticEnrichment`, at trip-open time — CDC section 15/tests
   * AR-AS). `[]` for an untimed/degenerate stage or a day with no stage at
   * all, so `villagesLayer`'s own downstream `usableLayers` filtering hides
   * every practical layer exactly like an empty Villages layer already does.
   */
  function practicalPlaceLayers(bundle: TripBundle, detail: DayDetail, dayId: TripDayId): readonly MapLayerDefinition[] {
    const day = bundle.days.find((candidate) => candidate.id === dayId)
    if (day === undefined || day.type !== 'ride' || day.stageId === null) return []
    const places = bundle.practicalPlaces.filter((place) => place.stageId === day.stageId)
    if (places.length === 0) return []
    const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
    const departureTime = daySettings?.departureTime ?? '08:00'
    const viewModels = buildPracticalPlaceViewModels(places, day, detail.timingCurve, departureTime)
    return buildPracticalPlaceMapLayers(viewModels)
  }

  /**
   * C3.B sections 38-50: one shared subscription drives both the compact
   * and fullscreen maps (section 43 — never a second `watchPosition` of its
   * own) — re-queried fresh on every position update rather than captured
   * once, so it keeps working across `patchDayDetail`/fullscreen-open
   * remounting either map's own Leaflet instance. Idempotent: a second call
   * while already subscribed is a no-op (`teardownSubComponent` may run
   * between two day screens without actually stopping tracking, section
   * 44's own "Précédent/Suivant" exception above).
   */
  let currentLocationUnsubscribe: (() => void) | null = null

  function stopCurrentLocationTracking(): void {
    if (currentLocationUnsubscribe === null) return
    currentLocationUnsubscribe()
    currentLocationUnsubscribe = null
    sharedCurrentLocationService.stop()
  }

  function ensureCurrentLocationTracking(): void {
    if (currentLocationUnsubscribe !== null) return
    currentLocationUnsubscribe = sharedCurrentLocationService.subscribe((state) => {
      if (state.position === null) return
      for (const selector of ['[data-day-detail-map]', '[data-route-map-expanded]'] as const) {
        const mapContainer = container.querySelector<HTMLElement>(selector)
        if (mapContainer === null) continue
        getMapInteractionHandle(mapContainer)?.setCurrentLocationMarker(state.position.latitude, state.position.longitude, state.position.accuracyMeters)
      }
    })
    // CDC C3.B section 41: opportunistic, silent auto-start ONLY when the
    // browser already reports the permission as granted from a previous
    // explicit "Me localiser" click — never a fresh prompt on every open.
    // The Permissions API itself isn't universally available; absent or
    // erroring, this simply stays quiet and leaves the button as the only
    // way in, exactly section 41's own fallback.
    void navigator.permissions?.query({ name: 'geolocation' as PermissionName })
      .then((status) => { if (status.state === 'granted') sharedCurrentLocationService.start() })
      .catch(() => {})
  }

  function mountMapAndProfile(bundle: TripBundle, detail: DayDetail, dayId: TripDayId): void {
    const mapContainer = container.querySelector<HTMLElement>('[data-day-detail-map]')
    const mapDialog = container.querySelector<HTMLDialogElement>('[data-day-detail-map-dialog]')
    const visibleWaypoints = getDisplayedStageWaypoints(detail)
    if (mapContainer !== null && mapDialog !== null) {
      // CDC C3.B section 49: only a ride day actually has a map to show a
      // "vous êtes ici" marker on — OFF/transfer days never reach this branch.
      ensureCurrentLocationTracking()
      // R2.1 sections 38/40-41: an OFF/transfer day has no route geometry
      // at all — its own markers-only model (resolved location, or the
      // transfer's origin/destination pair) stands in instead, never a
      // fabricated line.
      const model = detail.geometry === null
        ? detail.markersOnlyMapModel
        : buildGenericRouteMapModel(visibleWaypoints, detail.geometry.map((point) => [point.latitude, point.longitude] as const))
      deps.renderMap(mapContainer, mapDialog, model, [...villagesLayer(detail.villageWaypoints), ...practicalPlaceLayers(bundle, detail, dayId)])
      mapDialog.querySelector<HTMLButtonElement>('[data-close-map]')?.addEventListener('click', () => deps.closeMap(mapDialog))
    }
    const profileContainer = container.querySelector<HTMLElement>('[data-day-detail-profile]')
    if (profileContainer !== null) {
      renderGenericElevationProfile(profileContainer, detail.geometry, visibleWaypoints, detail.stageLabel, detail.timingCurve)
    }
    // Profile→map sync (CDC D1.1 sections 18-19): re-wired on every call —
    // `mountMapAndProfile` runs on every full mount AND every
    // `patchDayDetail` patch, and `renderGenericElevationProfile` just
    // replaced `profileContainer`'s own children, but never the container
    // element itself, so a listener attached directly to it (as opposed to
    // its children) would otherwise accumulate across renders — aborted and
    // re-attached here exactly like `elevation-profile.ts`'s own internal
    // pointer/keyboard listeners are.
    if (profileContainer !== null && mapContainer !== null) {
      profileSyncControllers.get(profileContainer)?.abort()
      const controller = new AbortController()
      profileSyncControllers.set(profileContainer, controller)
      const mapHandle = getMapInteractionHandle(mapContainer)
      if (mapHandle !== null) {
        profileContainer.addEventListener('profile-sample-active', (event) => {
          const detail = (event as CustomEvent<{ readonly latitude: number; readonly longitude: number }>).detail
          mapHandle.setTemporaryMarker(detail.latitude, detail.longitude)
        }, { signal: controller.signal })
        profileContainer.addEventListener('profile-sample-cleared', () => mapHandle.clearTemporaryMarker(), { signal: controller.signal })
      }
    }
    // Real pointer/touch/keyboard tooltip for every climb mini-profile in
    // the timeline (CDC Jalon B4.4 section 30) — `mountMapAndProfile` runs
    // on every full mount AND every `patchDayDetail` patch (pause/filter
    // mutation, both of which replace the timeline subtree), so this always
    // re-wires freshly-created climb-card SVGs; nothing to tear down first,
    // since the old ones were discarded along with their own listeners when
    // their subtree's `innerHTML` was replaced.
    for (const svg of container.querySelectorAll<SVGSVGElement>('[data-climb-profile-interactive]')) mountClimbProfileInteraction(svg)
  }

  /**
   * Targeted refresh after a pause/filter mutation (CDC Jalon B4.2/B4.3
   * section 3): patches only the stats/pauses/timeline subtrees plus the
   * map/profile — never wipes the whole Étape screen (no loading flash, no
   * lost scroll position, no unrelated focus loss). Silently no-ops if the
   * screen isn't showing this day any more (e.g. the user navigated away
   * meanwhile).
   */
  function patchDayDetail(bundle: TripBundle, dayId: TripDayId): void {
    if (mode.kind !== 'day' || mode.dayId !== dayId) return
    const detail = buildDayDetail(bundle, dayId, dayPreparationOptions(bundle, dayId))
    if (detail === null) return
    const statsEl = container.querySelector('[data-day-detail-stats]')
    // The fresh `statsHtml` is always the Départ cell's display state
    // (CDC D1.2 section 11) — replacing it here is what collapses an
    // in-progress inline edit back to plain text after a successful save.
    if (statsEl !== null) statsEl.outerHTML = detail.statsHtml
    wireDepartureTimeInput(bundle.metadata.id, dayId)
    const pausesEl = container.querySelector('[data-day-detail-pauses]')
    if (pausesEl !== null) pausesEl.outerHTML = detail.pausesHtml
    const timelineEl = container.querySelector('[data-day-detail-timeline]')
    if (timelineEl !== null) timelineEl.innerHTML = detail.timelineHtml
    mountMapAndProfile(bundle, detail, dayId)
    // A pause edit shifts every downstream eta (CDC Jalon C1 section 26) —
    // the weather request signature itself is unaffected unless the set of
    // significant points changed, so this is cheap (see
    // `GenericWeatherCoordinator.setTripBundle`'s own doc comment).
    refreshWeather(bundle, dayId)
  }

  /** One `AbortController` per departure-time `<input>` (CDC D1.2 section 11) — aborted and replaced on every full mount/patch, exactly like `profileSyncControllers`, so its keydown/blur listeners never accumulate across `patchDayDetail` calls. */
  const departureInputControllers = new WeakMap<HTMLElement, AbortController>()

  /**
   * CDC D1.2 section 11: the Départ stat cell is itself the editing surface
   * — both the plain display button and the (initially hidden) `<input
   * type="time">` are always rendered side by side in `statsHtml`; this
   * only wires the input's keydown/blur behaviour, exactly the same "pure
   * `hidden` toggle, no dynamically created element" shape
   * `renderInfosPanel`'s own read/edit split already uses elsewhere in this
   * file (never `document.createElement`, which the plain-Node test harness
   * for this module has no polyfill for — and real browsers don't need it
   * here either). Enter commits, Escape reverts, blur commits if the value
   * actually changed and is valid (an unchanged value just reverts —
   * nothing to persist). A successful save goes through `patchDayDetail`,
   * which already recalculates ETA/timing/waypoints/météo/profil/scénarios
   * from the single `computeStageWaypoints`/`computeStageTimingCurve`/
   * weather-coordinator pipeline (sections 12/17/26) — never a second
   * engine — and its fresh `statsHtml` has the input hidden again, so
   * there's nothing left to restore manually on success.
   */
  function wireDepartureTimeInput(tripId: TripId, dayId: TripDayId): void {
    const input = container.querySelector<HTMLInputElement>('[data-day-departure-input]')
    const displayButton = container.querySelector<HTMLButtonElement>('[data-day-departure-value]')
    if (input === null || displayButton === null) return
    departureInputControllers.get(input)?.abort()
    const controller = new AbortController()
    departureInputControllers.set(input, controller)
    const originalValue = input.value

    const cancel = (): void => {
      input.value = originalValue
      input.hidden = true
      displayButton.hidden = false
    }
    const commit = (): void => {
      const value = input.value
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value) || value === originalValue) { cancel(); return }
      void (async () => {
        const updated = await saveDayDepartureTime(tripId, dayId, value)
        if (updated !== null) patchDayDetail(updated, dayId)
        else cancel()
      })()
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); commit() }
      else if (event.key === 'Escape') { event.preventDefault(); cancel() }
    }, { signal: controller.signal })
    input.addEventListener('blur', commit, { signal: controller.signal })
  }

  /**
   * Targeted refresh for the Infos tab only (CDC Jalon B4.2/B4.3 sections
   * 3/35-36): saving free text or lodging must not reload the whole Étape
   * screen — that would silently flip the visible tab back to Parcours and
   * reset scroll, the exact regression class section 3 exists to prevent.
   * Preserves whichever tab is currently open across the patch, and always
   * lands back in read mode (the fresh fragment's own default).
   */
  function patchInfosPanel(bundle: TripBundle, dayId: TripDayId): void {
    if (mode.kind !== 'day' || mode.dayId !== dayId) return
    const detail = buildDayDetail(bundle, dayId, dayPreparationOptions(bundle, dayId))
    if (detail === null) return
    const infosEl = container.querySelector<HTMLElement>('[data-day-panel="infos"]')
    if (infosEl === null) return
    const wasHidden = infosEl.hidden
    infosEl.outerHTML = detail.infosHtml
    const replaced = container.querySelector<HTMLElement>('[data-day-panel="infos"]')
    if (replaced !== null) replaced.hidden = wasHidden
  }

  /**
   * R2 section 2: an OFF/transfer day's own Résumé card — a targeted patch
   * (never a full `renderDay`) so a transfer's mode/heures, saved from
   * Infos, show up immediately in the always-visible summary above it. A
   * ride day has no `summaryHtml`/`[data-day-detail-summary]` at all, so
   * this is a no-op there.
   */
  function patchDaySummary(bundle: TripBundle, dayId: TripDayId): void {
    if (mode.kind !== 'day' || mode.dayId !== dayId) return
    const detail = buildDayDetail(bundle, dayId, dayPreparationOptions(bundle, dayId))
    if (detail === null) return
    if (detail.summaryHtml !== '') {
      const summaryEl = container.querySelector<HTMLElement>('[data-day-detail-summary]')
      if (summaryEl !== null) summaryEl.outerHTML = detail.summaryHtml
    }
    // R3 sections 36-37: a location override (saved from Infos or the map
    // picker) changes the identity bandeau's own label too (e.g. "OFF —
    // Hilltown") — patched here, always present, so it never goes stale
    // until the screen is reopened.
    const identityEl = container.querySelector<HTMLElement>('[data-day-detail-identity]')
    if (identityEl !== null) identityEl.outerHTML = detail.identityHtml
    // R3 sections 36-37: an OFF/transfer day's map card isn't always in the
    // DOM at all (only once at least one side resolves) — the always-present
    // `[data-day-detail-map-slot]` wrapper is patched in first (a no-op for
    // a ride day, which has no such slot) so `mountMapAndProfile` right
    // after can actually find `[data-day-detail-map]` the very first time a
    // location override resolves it, not just on every subsequent one.
    const mapSlot = container.querySelector<HTMLElement>('[data-day-detail-map-slot]')
    if (mapSlot !== null) mapSlot.innerHTML = detail.mapCardHtml
    mountMapAndProfile(bundle, detail, dayId)
  }

  /**
   * The Aperçu global map (CDC D1.1 sections 1-3): the base model — full
   * ridden trace, principal points only — is always what both the compact
   * card and the fullscreen dialog start from; the fullscreen-only "Détail"
   * layer (villes/pauses/cols/sommets significatifs) is a togglable
   * `MapLayerDefinition`, exactly like the historical Villages layer, never
   * a second model swapped in on the compact card itself (that toggle is
   * gone — D1.1 section 2).
   */
  function mountOverviewMap(overview: TripOverview): void {
    const mapContainer = container.querySelector<HTMLElement>('[data-trip-overview-map]')
    const mapDialog = container.querySelector<HTMLDialogElement>('[data-trip-overview-map-dialog]')
    if (mapContainer === null || mapDialog === null) return
    const model = buildGenericOverviewRouteMapModel(overview.mapStages)
    const detailMarkers = buildGenericOverviewDetailMarkers(overview.mapDetailStages)
    const layers: MapLayerDefinition[] = detailMarkers.length === 0 ? [] : [{ id: 'detail', label: 'Détail', markers: detailMarkers, defaultVisible: false }]
    deps.renderMap(mapContainer, mapDialog, model, layers, { directLayerToggle: true })
    const close = mapDialog.querySelector<HTMLButtonElement>('[data-close-map]')
    if (close !== null) close.onclick = () => deps.closeMap(mapDialog)
  }

  /**
   * `diffGated: true` (R2.1 sections 42-43) is used only by
   * `refreshIfShowing`'s background-enrichment path — never a genuine
   * navigation open, which always wants the normal placeholder→content
   * sequence below. Diff-gated skips the "Chargement…" wipe and the whole
   * content/map replacement whenever the freshly-computed HTML is byte-
   * identical to what is already on screen (the common case: the
   * enrichment pass that just finished didn't change anything Aperçu
   * itself surfaces) — the root cause of the "double refresh" observed on
   * the field was this same function running unconditionally a second time
   * once background enrichment settled, always re-showing the placeholder
   * and always tearing down/remounting the Leaflet map even when nothing
   * about the trip's own Aperçu content had actually changed.
   */
  async function renderOverview(tripId: TripId, options: { readonly diffGated?: boolean } = {}): Promise<void> {
    teardownSubComponent()
    if (options.diffGated !== true) container.innerHTML = '<p role="status">Chargement du voyage…</p>'
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) {
      if (options.diffGated === true) return
      mode = { kind: 'list' }
      await renderList()
      return
    }
    const overview = buildTripOverview(bundle, deps.now())
    if (options.diffGated === true && overview.html === container.innerHTML) return
    deps.onHeaderChange?.(buildGenericAppHeader(bundle, { view: 'overview' }))
    container.innerHTML = overview.html
    mountOverviewMap(overview)
    // The highlighted day's own compact map (CDC Jalon B4.3 section 8) — a
    // second, independent, non-interactive preview; no fullscreen dialog of
    // its own (that's what "Voir cette étape" / the card's own navigation
    // leads to, via the real Étape screen's map).
    const dayMapContainer = container.querySelector<HTMLElement>('[data-trip-overview-day-map]')
    if (dayMapContainer !== null && overview.highlightedDayMap !== null) {
      const model = buildGenericRouteMapModel(overview.highlightedDayMap.waypoints, overview.highlightedDayMap.geometry)
      // Reuses the same primitive as the main map, but this preview has no
      // expand dialog of its own — a throwaway `<dialog>` keeps the shared
      // function's dialog-wiring a no-op here.
      deps.renderMap(dayMapContainer, document.createElement('dialog'), model, [])
    }
    refreshWeather(bundle, overview.highlightedDayId ?? tripId)
  }

  /**
   * Single-flight per `tripId` via `automaticEnrichmentGuard` (stability
   * hardening 2026-08-04): opening the same trip twice in a row (a double
   * click on "Ouvrir", or navigating away and back before the first job
   * settles) used to run two full enrichment jobs concurrently for the same
   * trip — observed in the network capture as duplicate/correlated Postpass
   * requests — because the old ad-hoc guard only claimed its `Set` entry
   * *after* its first `await`. `createSingleFlightGuard` claims
   * synchronously, before `fn` runs at all, so that race is now structurally
   * impossible.
   */
  async function startAutomaticEnrichment(tripId: TripId, segmentLengthKm?: number): Promise<void> {
    // Section 39: claimed synchronously, before any await, so the previous
    // owner sees the change at its very next unit boundary — and so a rapid
    // A → B → A sequence can never leave two owners believing they hold it.
    enrichmentOwner = tripId
    await automaticEnrichmentGuard.run(tripId, async () => {
      const requestId = deps.idFactory()
      // `import.meta.env` is injected by Vite at build/dev time and is
      // `undefined` under plain `node --test` (same caveat already
      // documented at `src/trips/rga-2026/load-rga-legacy-trip.ts`'s
      // `resolveRgaTripBaseUrl`) — optional-chained so a dev-only debug log
      // never crashes a test that legitimately exercises this function,
      // rather than leaving it untestable.
      if (import.meta.env?.DEV) console.debug('[automatic-enrichment] start', { tripId, requestId })

      try {
        const repository = createTripRepository(deps.database)
        const bundle = await repository.loadTripBundle(tripId)
        if (bundle === null) return
        if (!tripNeedsAutomaticEnrichment(bundle, deps)) return
        // R2 section 3 (offline robustness): `navigator.onLine === false` is
        // only ever a UX hint (section 19 — a lying `true` still hits the
        // provider's own error handling below), but a confirmed `false`
        // means every one of Postpass/Nominatim/route-enrichment would
        // otherwise be attempted and only fail after their own ~30s
        // timeout — up to ~90s of dead time on every single offline trip
        // open. Skip straight to the same "will complete later" state the
        // `catch` below already produces on a real failure.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          automaticEnrichmentErrors.set(tripId, 'Sera complété une fois la connexion rétablie.')
          return
        }

        automaticEnrichmentErrors.delete(tripId)
        const report = await runStoredTripAutomaticEnrichment({
          database: deps.database,
          tripId,
          geocodingProvider: deps.geocodingProvider,
          routeEnrichmentProvider: deps.routeEnrichmentProvider,
          practicalPlacesProvider: deps.practicalPlacesProvider,
          idFactory: deps.idFactory,
          now: deps.now,
          shouldContinue: () => enrichmentOwner === tripId,
          ...(segmentLengthKm === undefined ? {} : { segmentLengthKm }),
          onProgress: (progress) => {
            let runningDayId: TripDayId | null = null
            if (progress.phase === 'endpoints') {
              automaticEnrichmentProgress.set(tripId, 'Départs / arrivées')
            } else if (progress.phase === 'route') {
              const detail = progress.detail
              if (import.meta.env?.DEV) {
                console.debug('[automatic-enrichment] stage', {
                  tripId, requestId, stageId: detail.stageId, source: detail.source,
                  status: detail.status, durationMs: detail.durationMs,
                })
              }
              deps.onRouteEnrichmentDiagnostic?.(detail)
              const source = detail.source === 'cache' ? 'cache' : `${Math.round(detail.durationMs)} ms`
              const errors = detail.errorCount === 0 ? '' : ` · ${detail.errorCount} étape(s) en erreur`
              automaticEnrichmentProgress.set(tripId, `Points structurants — étape ${detail.stageIndex + 1}/${detail.stageCount} · ${source} · ${detail.retainedCandidateCount}/${detail.rawCandidateCount} retenus${errors}`)
              runningDayId = bundle.stages.find((stage) => stage.id === detail.stageId)?.dayId ?? null
            } else {
              const detail = progress.detail
              const source = detail.fromCache ? 'cache' : 'réseau'
              automaticEnrichmentProgress.set(tripId, `POI pratiques — étape ${detail.stageIndex + 1}/${detail.stageCount} · ${source}`)
              runningDayId = bundle.stages[detail.stageIndex]?.dayId ?? null
            }
            // C2.5 sections 3-4/22-23: a targeted indicator patch — never the
            // full-rebuild `refreshIfShowing` this used to call on EVERY
            // single per-stage tick (the "refresh chaos" this milestone
            // fixes: on a 10-stage trip, 20+ full Aperçu/Voyage rebuilds,
            // each remounting Leaflet on Aperçu or re-fetching weather on
            // Voyage). That full rebuild now only runs once, in `finally`
            // below, once the whole pass has actually settled — Aperçu is
            // never touched mid-run at all (section 30), and Voyage only
            // ever gets these two tiny per-card patches while it runs.
            const previousRunningDayId = runningStageByTrip.get(tripId) ?? null
            runningStageByTrip.set(tripId, runningDayId)
            patchStagePreparationIndicators(tripId, bundle, [previousRunningDayId, runningDayId])
          },
        })
        if (report.partial) automaticEnrichmentErrors.set(tripId, 'Certaines données seront complétées lors d’une prochaine ouverture.')
      } catch (error) {
        automaticEnrichmentErrors.set(tripId, error instanceof Error ? error.message : 'Certaines données seront complétées ultérieurement.')
      } finally {
        if (import.meta.env?.DEV) console.debug('[automatic-enrichment] finish', { tripId, requestId })
        automaticEnrichmentProgress.delete(tripId)
        runningStageByTrip.delete(tripId)
        // Only release the claim if this run still holds it — a newer trip
        // may already have taken over while this one was winding down.
        if (enrichmentOwner === tripId) enrichmentOwner = null
        await refreshIfShowing(tripId)
      }
    })
  }

  /** C2.5 sections 5-9: every ride day's derived status, keyed by `TripDay.id` — the exact map `renderTripDetail`'s `stagePreparationStatuses` option expects. */
  function computeAllStagePreparationStatuses(bundle: TripBundle, tripId: TripId): Map<TripDayId, StagePreparationStatus | null> {
    const context = stagePreparationContext(tripId)
    return new Map(bundle.days.map((day) => [day.id, deriveStagePreparationStatus(bundle, day.id, context)]))
  }

  /** The options `buildDayDetail` needs to show its own "Réessayer" banner (section 16-17) for this one day, derived the same way the Voyage list's own indicator is. */
  function dayPreparationOptions(bundle: TripBundle, dayId: TripDayId): { readonly preparationStatus: StagePreparationStatus | null } {
    return { preparationStatus: deriveStagePreparationStatus(bundle, dayId, stagePreparationContext(bundle.metadata.id)) }
  }

  function stagePreparationContext(tripId: TripId): StagePreparationContext {
    return {
      runningDayId: runningStageByTrip.get(tripId) ?? null,
      staleDayIds: staleStagesByTrip.get(tripId) ?? EMPTY_STALE_SET,
      routeEnrichmentConfigured: deps.routeEnrichmentProvider !== undefined,
      practicalPlacesConfigured: deps.practicalPlacesProvider !== undefined,
    }
  }

  function escapeSelectorValue(value: string): string {
    return globalThis.CSS?.escape === undefined ? value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') : globalThis.CSS.escape(value)
  }

  /**
   * C2.5 section 22: patches exactly the `[data-trip-day-prep-slot]` mount of
   * each given day's card, plus the global "N/M étapes prêtes" summary —
   * never `container.innerHTML`, never a scroll/tab/focus reset, never
   * touching any other card. A no-op unless Voyage (the day-LIST) is the
   * screen currently on display for this exact trip (section 23: another
   * screen, or another trip entirely after a switch, is left untouched).
   *
   * R1: targets the always-present `[data-trip-day-prep-slot]` wrapper by
   * `.innerHTML`, not the indicator glyph's own `[data-trip-day-prep]` by
   * `.outerHTML` — `renderStagePreparationIndicator` now renders nothing at
   * all for `ready`, so that glyph may simply not exist in the DOM yet; the
   * slot around it always does, whatever the current status is.
   */
  function patchStagePreparationIndicators(tripId: TripId, bundle: TripBundle, dayIds: readonly (TripDayId | null)[]): void {
    if (mode.kind !== 'detail' || mode.tripId !== tripId) return
    const context = stagePreparationContext(tripId)
    for (const dayId of dayIds) {
      if (dayId === null) continue
      const status = deriveStagePreparationStatus(bundle, dayId, context)
      const button = container.querySelector<HTMLElement>(`[data-day-id="${escapeSelectorValue(dayId)}"]`)
      const slot = button?.querySelector<HTMLElement>('[data-trip-day-prep-slot]') ?? null
      if (slot !== null) slot.innerHTML = renderStagePreparationIndicator(status)
      // DER-DES-DER sections 52-53: the retry row lives OUTSIDE the card
      // button (invalid nesting otherwise), so it has its own always-present
      // mount and is patched the same targeted way — never a full rebuild.
      const retrySlot = container.querySelector<HTMLElement>(`[data-trip-day-retry-slot][data-day-id="${escapeSelectorValue(dayId)}"]`)
      if (retrySlot !== null) retrySlot.innerHTML = renderStageRetryRow(tripId, dayId, status)
    }
    patchStagePreparationSummary(bundle, context)
  }

  function patchStagePreparationSummary(bundle: TripBundle, context: StagePreparationContext): void {
    const summaryEl = container.querySelector<HTMLElement>('[data-trip-prep-summary]')
    const summary = computeTripPreparationSummary(bundle, context)
    if (summary === null) { summaryEl?.remove(); return }
    if (summaryEl !== null) summaryEl.textContent = `${summary.ready}/${summary.total} étapes prêtes`
    // Else: the summary line didn't exist in the current DOM (the rare case
    // of a fully-ready trip whose one stage a local mutation then marked
    // stale, section 24-27) — inserting it live is not worth the extra
    // DOM-construction code here; the next full render reconciles it.
  }

  /**
   * C2.5 sections 24/27: a pause anchor change marks its own stage `stale`
   * (never `pending` — the previous, still-valid snapshot stays visible/
   * openable the whole time, section 24) and re-runs the SAME
   * `enrichStoredTripPracticalPlaces` engine used at trip-open time —
   * cache-first, so the new anchor fingerprint (section 28) only misses
   * cache for THIS stage; every other stage's cached POI results are
   * untouched. Reuses `automaticEnrichmentGuard` (section 7: never two
   * concurrent Postpass runs for the same trip) — if an initial preparation
   * pass happens to be running already, it will itself pick up the
   * just-saved anchors once it reaches this stage's own lookup, so skipping
   * here is correct, never a lost update.
   */
  async function reenrichStagePracticalPlaces(tripId: TripId, dayId: TripDayId, bundleAfterPauseSave: TripBundle): Promise<void> {
    if (deps.practicalPlacesProvider === undefined) return
    const stale = staleStagesByTrip.get(tripId) ?? new Set<TripDayId>()
    stale.add(dayId)
    staleStagesByTrip.set(tripId, stale)
    patchStagePreparationIndicators(tripId, bundleAfterPauseSave, [dayId])
    await automaticEnrichmentGuard.run(tripId, async () => {
      try {
        const report = await enrichStoredTripPracticalPlaces({
          database: deps.database,
          tripId,
          provider: deps.practicalPlacesProvider as PracticalPlacesProvider,
          now: deps.now,
          onlyDayId: dayId,
        })
        const refreshed = report?.bundle ?? bundleAfterPauseSave
        stale.delete(dayId)
        patchStagePreparationIndicators(tripId, refreshed, [dayId])
        if (mode.kind === 'day' && mode.tripId === tripId && mode.dayId === dayId) patchDayDetail(refreshed, dayId)
      } finally {
        stale.delete(dayId)
      }
    })
  }

  /**
   * C2.5 sections 17-19: "Réessayer" for `partial`/`error` — poursuit
   * plutôt que recommence (section 18): `startAutomaticEnrichment` is the
   * exact same cache-first entrypoint the initial preparation used, single-
   * flighted per trip, so a retry only ever redoes the work that genuinely
   * failed/never finished — an already-cached stage is never re-fetched.
   * One call per click, no automatic retry loop (section 17/AA).
   */
  function retryStagePreparation(tripId: TripId, dayId?: TripDayId): void {
    // Scoped strictly to the user's own click (unlike `refreshIfShowing`,
    // which also fires from the routine, unawaited enrichment every
    // trip-open kicks off) — only reconciles the day-detail screen if it's
    // still the SAME day, of the SAME trip, once this specific run settles.
    const dayIdToReconcile = mode.kind === 'day' && mode.tripId === tripId ? mode.dayId : null
    void (async () => {
      // DER-DES-DER sections 48/52: a settled stage is skipped by every
      // automatic pass, so an explicit retry must first forget THAT stage's
      // settled record — and only that stage's, so the retry never turns
      // into a whole-trip re-query.
      if (dayId !== undefined) {
        const repository = createTripRepository(deps.database)
        const current = await repository.loadTripBundle(tripId)
        if (current !== null) {
          const unsettled = unsettleStageForRetry(current, dayId)
          if (unsettled !== current) await repository.saveTripBundle(unsettled)
        }
      }
      // Section 49: a retry uses genuinely smaller Postpass segments rather
      // than replaying the same slow query that just timed out. Segments that
      // did succeed are served from cache, so only the failing area is
      // actually re-queried (section 48).
      await startAutomaticEnrichment(tripId, RETRY_POSTPASS_SEGMENT_KM)
      if (dayIdToReconcile === null) return
      if (mode.kind !== 'day' || mode.tripId !== tripId || mode.dayId !== dayIdToReconcile) return
      const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
      if (bundle !== null) patchDayDetail(bundle, dayIdToReconcile)
    })()
  }

  /** Re-renders whichever of Aperçu/Voyage is currently open for `tripId` — enrichment can finish while the user is on either screen. */
  async function refreshIfShowing(tripId: TripId): Promise<void> {
    if (mode.kind === 'overview' && mode.tripId === tripId) await renderOverview(tripId, { diffGated: true })
    else if (mode.kind === 'detail' && mode.tripId === tripId) await renderDetail(tripId)
    // `mode.kind === 'day'` is deliberately left untouched here — this
    // callback also fires from the ordinary, unawaited `startAutomaticEnrichment`
    // every trip-open kicks off (section 30), so reaching into storage again
    // here would run in the background of screens that never asked for it.
    // `retryStagePreparation` below reconciles the open day explicitly,
    // scoped to only the user's own "Réessayer" click.
  }

  /**
   * The trip's landing screen (CDC: Mes voyages → Aperçu → Voyage → Étape) —
   * kicks off automatic enrichment exactly once, same as opening used to from
   * Voyage directly. Also the single place that marks a trip active (CDC
   * section 3): every path that lands here (list click, or the bottom-nav
   * Aperçu/Voyage links resolving the last active trip) agrees on the same
   * trip afterwards. Creating/editing a trip deliberately does NOT call this
   * any more (CDC Jalon B4.3 section 17) — it returns to the list instead.
   */
  async function openOverview(tripId: TripId): Promise<void> {
    setActiveTrip(tripId)
    mode = { kind: 'overview', tripId }
    await renderOverview(tripId)
    void startAutomaticEnrichment(tripId)
  }

  /**
   * CDC Jalon B4.4 sections 2-3: delegates to `resolvePreferredActiveTripId`
   * (an explicit `setActiveTrip` choice always wins over automatic
   * selection — see that function's own doc for the "wrong trip opens" bug
   * this fixes). Re-resolved from storage every call, so switching trips in
   * "Mes voyages" is immediately reflected the next time Aperçu/Voyage is
   * opened from the bottom nav.
   */
  async function resolveActiveTripId(): Promise<TripId | null> {
    const trips = await listTripSummaries(deps.database)
    return resolvePreferredActiveTripId(trips, deps.now().slice(0, 10) as IsoDate, getActiveTripId())
  }

  async function goToOverviewForActiveTrip(): Promise<void> {
    const tripId = await resolveActiveTripId()
    if (tripId === null) { goToList(); return }
    await openOverview(tripId)
  }

  async function goToDetailForActiveTrip(): Promise<void> {
    const tripId = await resolveActiveTripId()
    if (tripId === null) { goToList(); return }
    await openDetail(tripId)
  }

  async function openDetail(tripId: TripId): Promise<void> {
    detailAutoScrollSession.enter(tripId)
    mode = { kind: 'detail', tripId }
    await renderDetail(tripId)
  }

  async function openDay(tripId: TripId, dayId: TripDayId, origin: DayOrigin): Promise<void> {
    mode = { kind: 'day', tripId, dayId, origin }
    await renderDay(tripId, dayId)
  }

  /**
   * Persists one stage's pause plan (CDC Jalon B4 section 15): replaces
   * (or, for `entry === null`, drops — reverting to the trip-wide default)
   * that stage's entry in `TripSettings.stages` and re-saves the whole
   * bundle, exactly like every other mutation in this file — never a second
   * storage path alongside `saveTripBundle`. Silently no-ops if the trip
   * disappeared meanwhile (deleted from another tab, etc.). Returns the
   * freshly saved bundle so the caller can patch the screen from it directly
   * — avoids a second full-bundle read+validate just to re-render.
   */
  async function saveStagePauseSettings(tripId: TripId, stageId: RideStageId, entry: RideStageSettings | null): Promise<TripBundle | null> {
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) return null
    const stages = bundle.settings.stages.filter((candidate) => candidate.stageId !== stageId)
    if (entry !== null) stages.push(entry)
    const updated: TripBundle = { ...bundle, settings: { ...bundle.settings, stages } }
    await tripRepository.saveTripBundle(updated)
    return updated
  }

  /** Order must stay a contiguous 0..n-1 sequence (validated by `validateTripBundle`) — reassigned every time the pause list changes rather than trusted to already be correct. */
  function withContiguousOrder(pauses: readonly StagePauseSetting[]): readonly StagePauseSetting[] {
    return pauses.slice().sort((left, right) => left.order - right.order).map((pause, index) => ({ ...pause, order: index }))
  }

  /** Global "Mes voyages" nav click (CDC hardening section 14): always returns to the trip list, whatever screen was open — the reason none of Aperçu/Voyage/Étape carries its own "Retour à Mes voyages" button. */
  function goToList(): void {
    mode = { kind: 'list' }
    void renderList()
  }

  async function enrichEndpoints(tripId: TripId): Promise<void> {
    if (deps.geocodingProvider === undefined || automaticEnrichmentGuard.isInFlight(tripId) || geocodingInFlight.has(tripId)) return
    geocodingInFlight.add(tripId)
    geocodingErrors.delete(tripId)
    await renderDetail(tripId)
    try {
      await enrichStoredTripEndpoints({
        database: deps.database,
        tripId,
        provider: deps.geocodingProvider,
        idFactory: deps.idFactory,
        now: deps.now,
      })
    } catch (error) {
      geocodingErrors.set(tripId, error instanceof Error ? error.message : 'L’enrichissement des lieux a échoué.')
    } finally {
      geocodingInFlight.delete(tripId)
      if (mode.kind === 'detail' && mode.tripId === tripId) await renderDetail(tripId)
    }
  }

  function renderConfirmation(result: ImportWizardResult): void {
    deps.onHeaderChange?.(GENERIC_APP_HEADER_NO_ACTIVE_TRIP)
    const dateLabel = result.startDate === null ? 'Non daté' : result.endDate === null ? result.startDate : `${result.startDate} → ${result.endDate}`
    container.innerHTML = `
      <div class="trip-confirmation" data-trip-confirmation>
        <header class="view-heading"><p class="eyebrow">Voyage créé</p><h2>${escapeHtml(result.name)}</h2></header>
        <dl class="trip-confirmation__summary">
          <div><dt>Dates</dt><dd>${escapeHtml(dateLabel)}</dd></div>
          <div><dt>Étapes</dt><dd>${result.stageCount}</dd></div>
          <div><dt>Distance</dt><dd>${result.totalDistanceKm.toFixed(1)} km</dd></div>
          <div><dt>D+</dt><dd>+${Math.round(result.totalElevationGainM)} m</dd></div>
          <div><dt>Montées détectées</dt><dd>${result.climbCount}</dd></div>
        </dl>
        <button class="button button--primary button--full" type="button" data-action="back-to-list">Retour à Mes voyages</button>
      </div>`
  }

  async function refresh(): Promise<void> {
    if (mode.kind === 'list') await renderList()
    else if (mode.kind === 'overview') await renderOverview(mode.tripId)
    else if (mode.kind === 'detail') await renderDetail(mode.tripId)
    else if (mode.kind === 'day') await renderDay(mode.tripId, mode.dayId)
    else if (mode.kind === 'confirmation') renderConfirmation(mode.result)
    // Wizard/editor modes own their rendering through their dedicated components.
  }

  /**
   * CDC Jalon B4.3 section 17: creating/editing a trip always returns to
   * Mes voyages — never opens Aperçu automatically, never silently changes
   * the active trip. The trip simply appears in the list; the user's own
   * "Ouvrir" click is what makes it active (CDC section 4/5).
   */
  function openWizard(): void {
    mode = { kind: 'wizard' }
    deps.onHeaderChange?.(GENERIC_APP_HEADER_NO_ACTIVE_TRIP)
    let wizard: { readonly destroy: () => void }
    wizard = createImportWizard(
      container,
      deps,
      () => {
        wizard.destroy()
        activeSubComponent = null
        goToList()
      },
      () => {
        wizard.destroy()
        activeSubComponent = null
        goToList()
      },
    )
    activeSubComponent = wizard
  }

  function openEditor(tripId: TripId): void {
    mode = { kind: 'editor', tripId }
    deps.onHeaderChange?.(GENERIC_APP_HEADER_NO_ACTIVE_TRIP)
    let editor: { readonly destroy: () => void }
    editor = createTripEditor(
      container,
      deps,
      tripId,
      () => {
        editor.destroy()
        activeSubComponent = null
        goToList()
      },
      () => {
        editor.destroy()
        activeSubComponent = null
        goToList()
      },
    )
    activeSubComponent = editor
  }

  /** Persists a full-bundle mutation the same way every other action in this file does — load, mutate, save, return the fresh bundle (or `null` if the trip vanished meanwhile). */
  async function mutateTripBundle(tripId: TripId, mutate: (bundle: TripBundle) => TripBundle): Promise<TripBundle | null> {
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) return null
    const updated = mutate(bundle)
    await tripRepository.saveTripBundle(updated)
    return updated
  }

  /**
   * Sections 13-17/41 closeout: `TripDaySettings.departureTime` is the ONE
   * source of truth for a ride day's departure time — per day, never the
   * trip-wide `referenceSpeedKph`. Mutates only this day's entry in
   * `settings.days` (by-reference-replace, same idiom as
   * `saveStagePauseSettings` above), preserving its `totalBreakSeconds` and
   * every other day's own entry untouched — J1's departure time changing
   * must never move J2's.
   */
  async function saveDayDepartureTime(tripId: TripId, dayId: TripDayId, departureTime: string): Promise<TripBundle | null> {
    return mutateTripBundle(tripId, (bundle) => {
      const existing = bundle.settings.days.find((entry) => entry.dayId === dayId)
      const days = bundle.settings.days.filter((entry) => entry.dayId !== dayId)
      days.push({ dayId, departureTime, totalBreakSeconds: existing?.totalBreakSeconds ?? null })
      return { ...bundle, settings: { ...bundle.settings, days } }
    })
  }

  function trimmedOrNull(value: string): string | null {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  /** GPX filename for one route's original source file — never a technical id, never a reconstruction (CDC Jalon B4.3 sections 15/33). */
  async function downloadRouteGpx(tripId: TripId, sourceFileId: string): Promise<void> {
    const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
    const sourceFile = bundle?.sourceFiles.find((candidate) => candidate.id === sourceFileId)
    if (bundle === undefined || bundle === null || sourceFile === undefined) return
    const payload = await createSourceFileRepository(deps.database).getSourceFilePayload(tripId, sourceFile.id)
    if (payload === null) return
    downloadBlob(payloadToBlob(payload.content, 'application/gpx+xml'), sourceFile.originalName)
  }

  /**
   * One archive of every ride day's original GPX, in chronological order
   * (CDC D1.1 section 4) — the stored originals, never a re-serialization of
   * the analysed geometry; OFF/transfer days (no GPX) are naturally excluded
   * since they have no route/source file to begin with. Iterates
   * `bundle.days` (sorted by `index`, the same structural order every other
   * day-traversal in this file uses — see `openableDayIds`) rather than
   * `bundle.stages` directly, so this stays chronologically correct even if
   * a future edit ever changes `stages`' own array order.
   */
  async function downloadTripGpxArchive(tripId: TripId, tripName: string): Promise<void> {
    const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
    if (bundle === null) return
    const sourceFileRepository = createSourceFileRepository(deps.database)
    const entries: ZipEntryInput[] = []
    const orderedStages = openableDayIds(bundle)
      .map((dayId) => bundle.stages.find((stage) => stage.dayId === dayId))
      .filter((stage): stage is (typeof bundle.stages)[number] => stage !== undefined)
    for (const stage of orderedStages) {
      const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
      const sourceFile = route?.sourceFileId === null || route?.sourceFileId === undefined
        ? undefined
        : bundle.sourceFiles.find((candidate) => candidate.id === route.sourceFileId)
      if (sourceFile === undefined) continue
      const payload = await sourceFileRepository.getSourceFilePayload(tripId, sourceFile.id)
      if (payload === null) continue
      entries.push({ name: sourceFile.originalName, data: await payloadToUint8Array(payload.content) })
    }
    if (entries.length === 0) return
    const zip = buildZipArchive(entries, new Date(deps.now()))
    const safeName = tripName.replaceAll(/[\\/:*?"<>|]/g, '_').trim() || 'voyage'
    downloadBlob(zip, `${safeName}_GPX.zip`)
  }

  container.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    // Pure client-side UI toggles (CDC Jalon B4.2/B4.3 sections 3/17): never
    // a data mutation, never a re-render — a full detail rebuild here would
    // reintroduce exactly the "reload feel" bug this pass fixes.
    const tab = target.closest<HTMLButtonElement>('[data-day-tab]')
    if (tab !== null && container.contains(tab)) {
      const requested = tab.dataset.dayTab
      for (const panel of container.querySelectorAll<HTMLElement>('[data-day-panel]')) panel.hidden = panel.dataset.dayPanel !== requested
      for (const candidate of container.querySelectorAll<HTMLButtonElement>('[data-day-tab]')) {
        candidate.setAttribute('aria-selected', String(candidate === tab))
        candidate.tabIndex = candidate === tab ? 0 : -1
      }
      return
    }
    const climbToggle = target.closest<HTMLButtonElement>('[data-action="toggle-climb-profile"]')
    if (climbToggle !== null) {
      const panel = container.querySelector<HTMLElement>(`#${CSS.escape(climbToggle.getAttribute('aria-controls') ?? '')}`)
      if (panel !== null) {
        const nextExpanded = panel.hidden
        panel.hidden = !nextExpanded
        climbToggle.setAttribute('aria-expanded', String(nextExpanded))
      }
      return
    }
    // R2.1 sections 3-4: the Pauses/Météo bottom block — at most one panel
    // open at a time. Clicking the currently-open panel's own toggle closes
    // it (both end up closed); clicking the other one closes whichever was
    // open and opens the clicked one. Pure client-side, never a re-render —
    // same "no full rebuild for a UI toggle" rule as the tab/climb toggles
    // above.
    const bottomToggle = target.closest<HTMLButtonElement>('[data-action="toggle-bottom-panel"]')
    if (bottomToggle !== null) {
      const panel = container.querySelector<HTMLElement>(`#${CSS.escape(bottomToggle.getAttribute('aria-controls') ?? '')}`)
      if (panel === null) return
      const opening = panel.hidden
      for (const otherPanel of container.querySelectorAll<HTMLElement>('[data-bottom-panel]')) otherPanel.hidden = true
      for (const otherToggle of container.querySelectorAll<HTMLButtonElement>('[data-action="toggle-bottom-panel"]')) otherToggle.setAttribute('aria-expanded', 'false')
      if (opening) {
        panel.hidden = false
        bottomToggle.setAttribute('aria-expanded', 'true')
      }
      return
    }
    if (target.closest('[data-action="edit-day-infos"]') !== null) {
      const readView = container.querySelector<HTMLElement>('[data-day-infos-read]')
      const editView = container.querySelector<HTMLElement>('[data-day-infos-edit]')
      if (readView !== null) readView.hidden = true
      if (editView !== null) editView.hidden = false
      return
    }
    if (target.closest('[data-action="cancel-edit-day-infos"]') !== null) {
      const readView = container.querySelector<HTMLElement>('[data-day-infos-read]')
      const editView = container.querySelector<HTMLElement>('[data-day-infos-edit]')
      if (editView !== null) editView.hidden = true
      if (readView !== null) readView.hidden = false
      return
    }

    const button = target.closest<HTMLElement>('[data-action]')
    if (button === null) return
    const action = button.dataset.action
    const tripId = button.dataset.tripId
    const dayId = button.dataset.dayId

    if (action === 'create-trip') {
      openWizard()
    } else if (action === 'edit-trip' && tripId !== undefined) {
      openEditor(tripId as TripId)
    } else if (action === 'open-trip' && tripId !== undefined) {
      // CDC Jalon B4.4 section 4: one click must resolve to exactly one
      // tripId and one render. Marking the trip active here (synchronous,
      // localStorage-backed) then handing off to `onNavigateToView` lets the
      // top-level nav (`navigateGenericTripView` → `syncGenericTripNav` →
      // `goToOverviewForActiveTrip`) do the one real render itself — it
      // re-reads the same `activeTripId` we just wrote, so it resolves to
      // the same trip, never a second competing resolution. Calling
      // `openOverview` directly here AND letting the nav callback trigger
      // `goToOverviewForActiveTrip` afterwards used to run the whole Aperçu
      // render (plus `startAutomaticEnrichment`) twice per click. Falls back
      // to rendering directly only when there is no top-level nav to hand
      // off to (e.g. this component used standalone, outside `main.ts`).
      setActiveTrip(tripId as TripId)
      if (deps.onNavigateToView !== undefined) deps.onNavigateToView('today')
      else void openOverview(tripId as TripId)
    } else if (action === 'open-day-detail' && dayId !== undefined && (mode.kind === 'detail' || mode.kind === 'overview')) {
      // R3 sections 41-42: Postpass/POI enrichment (`pending`/`running`)
      // NEVER gates opening a ride any more — its route/profil/timing/
      // timeline come straight from the already-imported GPX, entirely
      // independent of Postpass. The only real gate stays `buildDayDetail`
      // itself (`renderDay` → `openDay`), which already falls back
      // gracefully when a ride's stage/route genuinely can't be resolved
      // (truly absent/unusable structural data — the one legitimate case
      // from section 42, never "still enriching").
      void openDay(mode.tripId, dayId as TripDayId, mode.kind)
    } else if (action === 'back-to-trip-detail' && mode.kind === 'day') {
      if (mode.origin === 'overview') void openOverview(mode.tripId)
      else void openDetail(mode.tripId)
    } else if (action === 'previous-day' && mode.kind === 'day') {
      void (async () => {
        const bundle = await createTripRepository(deps.database).loadTripBundle(mode.tripId)
        if (bundle === null) return
        const previousId = resolveAdjacentTripDayId(bundle, mode.dayId, -1)
        if (previousId !== null) await openDay(mode.tripId, previousId, mode.origin)
      })()
    } else if (action === 'next-day' && mode.kind === 'day') {
      void (async () => {
        const bundle = await createTripRepository(deps.database).loadTripBundle(mode.tripId)
        if (bundle === null) return
        const nextId = resolveAdjacentTripDayId(bundle, mode.dayId, 1)
        if (nextId !== null) await openDay(mode.tripId, nextId, mode.origin)
      })()
    } else if (action === 'back-to-list') {
      goToList()
    } else if (action === 'enrich-trip-endpoints' && mode.kind === 'detail') {
      void enrichEndpoints(mode.tripId)
    } else if (action === 'locate-me') {
      // CDC C3.B section 41/48: the permission prompt (if any) is only ever
      // triggered by this explicit user action — never automatically on
      // screen open. `start()` itself is idempotent (section 43: at most
      // one active watch), so a repeated click while already tracking is a
      // harmless no-op.
      sharedCurrentLocationService.start()
    } else if (action === 'retry-stage-preparation' && tripId !== undefined) {
      // RC2 final-closeout sections 14-15: a real, single-stage retry when
      // this stage's own outstanding issue is specifically the POI phase
      // (`practicalPlacesStageErrors`, progressive per-stage enrichment) —
      // structural (route-enrichment) issues stay on the whole-trip retry,
      // exactly like before, since that phase intentionally stays global
      // (section 6-7). Either path is single-flight via
      // `automaticEnrichmentGuard` — a second click while one is already
      // running for this trip is a harmless no-op, never a doubled request.
      if (dayId !== undefined) {
        void (async () => {
          const bundle = await createTripRepository(deps.database).loadTripBundle(tripId as TripId)
          if (bundle !== null && (bundle.enrichmentMetadata.practicalPlacesStageErrors?.includes(dayId as TripDayId) ?? false)) {
            await reenrichStagePracticalPlaces(tripId as TripId, dayId as TripDayId, bundle)
            return
          }
          retryStagePreparation(tripId as TripId, dayId as TripDayId)
        })()
      } else {
        retryStagePreparation(tripId as TripId)
      }
    } else if (action === 'delete-trip' && tripId !== undefined) {
      if (!window.confirm('Supprimer définitivement ce voyage et toutes ses données ?')) return
      void (async () => {
        await deleteTripCompletely(deps.database, tripId as TripId, deps.now().slice(0, 10))
        mode = { kind: 'list' }
        await renderList()
      })()
    } else if (action === 'pause-mode-automatic' && mode.kind === 'day') {
      const stageId = findCurrentStageId()
      const { tripId, dayId } = mode
      if (stageId === undefined) return
      void (async () => {
        const bundle = await saveStagePauseSettings(tripId, stageId, null)
        if (bundle !== null) patchDayDetail(bundle, dayId)
      })()
    } else if (action === 'save-manual-pauses' && mode.kind === 'day') {
      const { tripId, dayId } = mode
      const stageId = findCurrentStageId()
      if (stageId === undefined) return
      const rows = container.querySelectorAll<HTMLElement>('.day-pause-editor__row')
      const existingPauses = new Map<string, StagePauseSetting>()
      void (async () => {
        const tripRepository = createTripRepository(deps.database)
        const bundle = await tripRepository.loadTripBundle(tripId)
        const current = bundle?.settings.stages.find((entry) => entry.stageId === stageId)
        for (const pause of current?.pauses ?? []) if (pause.routePointId !== null) existingPauses.set(pause.routePointId, pause)
        const nextPauses: StagePauseSetting[] = []
        rows.forEach((row) => {
          const candidateId = row.dataset.candidateId
          const checkbox = row.querySelector<HTMLInputElement>('[data-field="pause-active"]')
          const durationInput = row.querySelector<HTMLInputElement>('[data-field="pause-duration"]')
          if (candidateId === undefined || checkbox === null || !checkbox.checked) return
          // R3 sections 9-12: normalized to the nearest 5-minute step at
          // save time — the `<input step="5">` already steers a mouse/
          // keyboard-arrow user there, but a typed/pasted value could still
          // slip through un-stepped. A genuine `0` (or negative/non-finite)
          // stays `0`, same as before — `normalizePauseDurationMinutes`
          // itself never rounds a non-positive value up to a fabricated 5.
          const minutes = durationInput !== null && Number.isFinite(durationInput.valueAsNumber) ? normalizePauseDurationMinutes(durationInput.valueAsNumber) : 15
          const existing = existingPauses.get(candidateId)
          nextPauses.push({
            id: existing?.id ?? deps.idFactory(), active: true, routePointId: candidateId as RoutePointId,
            durationSeconds: minutes * 60, order: nextPauses.length, origin: existing?.origin ?? 'custom',
          })
        })
        // C2.5 sections 26-27: a duration-only change never touches
        // Postpass (already true today — `patchDayDetail` below only ever
        // recomputes timing/ETA/opening-status, all pure/in-memory); moving
        // a pause to a different anchor DOES need a targeted re-search, for
        // this one stage only (`reenrichStagePracticalPlaces` below).
        const invalidation = deriveStageInvalidation([...existingPauses.values()], nextPauses)
        const updated = await saveStagePauseSettings(tripId, stageId, { stageId, pausePlanMode: 'custom', pauses: withContiguousOrder(nextPauses) })
        if (updated !== null) {
          patchDayDetail(updated, dayId)
          // Re-collapse the panel after save (CDC Jalon B4.3 section 31) —
          // scroll/focus stay put since only the pauses subtree was patched.
          const details = container.querySelector<HTMLDetailsElement>('[data-day-pause-editor]')
          if (details !== null) details.open = false
          if (invalidation.anchorsChanged) void reenrichStagePracticalPlaces(tripId, dayId, updated)
        }
      })()
    } else if (action === 'edit-day-departure-time' && mode.kind === 'day') {
      // The reveal itself is a pure `hidden` toggle (CDC D1.2 section 11) —
      // `wireDepartureTimeInput` (called once per mount/patch) already
      // wired this same `<input>`'s keydown/blur commit/cancel behaviour.
      const displayButton = container.querySelector<HTMLButtonElement>('[data-day-departure-value]')
      const input = container.querySelector<HTMLInputElement>('[data-day-departure-input]')
      if (displayButton === null || input === null) return
      displayButton.hidden = true
      input.hidden = false
      input.focus()
      try { input.showPicker?.() } catch { /* not eligible here — focus() still opens the native control on most mobile platforms */ }
    } else if (action === 'apply-weather-departure-time' && mode.kind === 'day') {
      // R2.1 section 7 (correcting sections 25-26 closeout): "Appliquer"/
      // "Choisir" now applies IMMEDIATELY — no confirmation panel, no modal.
      // The exact same `saveDayDepartureTime` pipeline as the Étape stats
      // editor (no new weather fetch — the coordinator reassociates the
      // already-fetched forecast against the new ETAs; see
      // `tests/weather/generic/coordinator.test.mjs`'s "re-associates a
      // changed ETA without fetching the same signature"). Reverting is
      // simply choosing "Actuel" or another scenario again — never a
      // separate "Annuler".
      const { tripId, dayId } = mode
      const target = button.dataset.departureTime
      if (target === undefined) return
      void (async () => {
        const updated = await saveDayDepartureTime(tripId, dayId, target)
        if (updated !== null) patchDayDetail(updated, dayId)
      })()
    } else if (action === 'save-day-infos' && mode.kind === 'day') {
      const { tripId, dayId } = mode
      const textarea = container.querySelector<HTMLTextAreaElement>('[data-field="day-notes"]')
      const nameField = container.querySelector<HTMLInputElement>('[data-field="lodging-name"]')
      const addressField = container.querySelector<HTMLInputElement>('[data-field="lodging-address"]')
      const mapsField = container.querySelector<HTMLInputElement>('[data-field="lodging-maps-url"]')
      const websiteField = container.querySelector<HTMLInputElement>('[data-field="lodging-website"]')
      const bookingReferenceField = container.querySelector<HTMLInputElement>('[data-field="lodging-booking-reference"]')
      const notes = trimmedOrNull(textarea?.value ?? '')
      const name = trimmedOrNull(nameField?.value ?? '')
      const address = trimmedOrNull(addressField?.value ?? '')
      const mapsUrl = trimmedOrNull(mapsField?.value ?? '')
      const website = trimmedOrNull(websiteField?.value ?? '')
      const bookingReference = trimmedOrNull(bookingReferenceField?.value ?? '')
      // R2/R2.1 sections 2/36-37: only present in the DOM for a transfer
      // day's own Infos edit form — `undefined` (never `null`, TripDay's own
      // optional shape) whenever the field isn't rendered at all (ride/off)
      // or was cleared by the user.
      const transferModeField = container.querySelector<HTMLSelectElement>('[data-field="transfer-mode"]')
      const transferDepartureField = container.querySelector<HTMLInputElement>('[data-field="transfer-departure-time"]')
      const transferArrivalField = container.querySelector<HTMLInputElement>('[data-field="transfer-arrival-time"]')
      const transferOperatorField = container.querySelector<HTMLInputElement>('[data-field="transfer-operator"]')
      const transferLinkField = container.querySelector<HTMLInputElement>('[data-field="transfer-link"]')
      const transferTicketLinkField = container.querySelector<HTMLInputElement>('[data-field="transfer-ticket-link"]')
      const transferMode = transferModeField === null ? undefined : trimmedOrNull(transferModeField.value) ?? undefined
      const transferDepartureTime = transferDepartureField === null ? undefined : trimmedOrNull(transferDepartureField.value) ?? undefined
      const transferArrivalTime = transferArrivalField === null ? undefined : trimmedOrNull(transferArrivalField.value) ?? undefined
      const transferOperator = transferOperatorField === null ? undefined : trimmedOrNull(transferOperatorField.value) ?? undefined
      const transferLink = transferLinkField === null ? undefined : trimmedOrNull(transferLinkField.value) ?? undefined
      const transferTicketLink = transferTicketLinkField === null ? undefined : trimmedOrNull(transferTicketLinkField.value) ?? undefined
      // R2.1 sections 40-41: the manual location-name override — present for
      // OFF (`location-start` only) and transfer (`location-start`/`-end`)
      // days, absent for ride. `null` (never `undefined` — `TripDay`'s own
      // `startLocationName`/`endLocationName` are non-optional) clears it
      // back to "use the automatic one"; absent from the DOM entirely
      // (ride days) leaves the field out of the patch, untouched.
      const locationStartField = container.querySelector<HTMLInputElement>('[data-field="location-start"]')
      const locationEndField = container.querySelector<HTMLInputElement>('[data-field="location-end"]')
      const locationStartName = locationStartField === null ? undefined : trimmedOrNull(locationStartField.value)
      const locationEndName = locationEndField === null ? undefined : trimmedOrNull(locationEndField.value)
      // CDC Jalon B4.3 section 36: clearing every lodging field and saving
      // removes the lodging — no separate "Supprimer" action needed. R2.1
      // section 32: a `before_next` transfer never renders lodging fields
      // at all (see `renderInfosPanel`'s `showLodging`) — its own
      // `accommodationId` (if any legacy value lingers) is left untouched
      // rather than treated as "every field cleared".
      const lodgingFieldsRendered = nameField !== null || mapsField !== null || websiteField !== null || addressField !== null || bookingReferenceField !== null
      const clearLodging = lodgingFieldsRendered && name === null && mapsUrl === null && website === null && address === null && bookingReference === null
      void (async () => {
        const updated = await mutateTripBundle(tripId, (bundle) => {
          const day = bundle.days.find((candidate) => candidate.id === dayId)
          if (day === undefined) return bundle
          // R2.1 sections 33-34: an `after_previous` transfer's notes/
          // lodging are saved onto the previous day it shares them with,
          // never a second, orphaned copy on the transfer day itself — the
          // transfer-specific fields below always stay on `dayId`, even
          // when that differs from the info day.
          const infoDayId = resolveSharedInfoDayId(bundle, day)
          const infoDay = bundle.days.find((candidate) => candidate.id === infoDayId)
          const existingAccommodationId = infoDay?.accommodationId ?? null
          // Transfer mode/heures/opérateur/lien AND the manual location-name
          // override (R2.1 sections 40-41) all belong to `dayId` itself,
          // never `infoDayId` — a shared transfer still has its own journey
          // and its own place.
          const dayOwnPatch = {
            transferMode, transferDepartureTime, transferArrivalTime, transferOperator, transferLink, transferTicketLink,
            ...(locationStartName === undefined ? {} : { startLocationName: locationStartName }),
            ...(locationEndName === undefined ? {} : { endLocationName: locationEndName }),
          }
          if (!lodgingFieldsRendered) {
            return {
              ...bundle,
              days: bundle.days.map((candidate) => {
                const isInfoDay = candidate.id === infoDayId
                const isOwnDay = candidate.id === dayId
                if (!isInfoDay && !isOwnDay) return candidate
                return {
                  ...candidate,
                  ...(isInfoDay ? { notes } : {}),
                  ...(isOwnDay ? dayOwnPatch : {}),
                }
              }),
            }
          }
          if (clearLodging) {
            return {
              ...bundle,
              accommodations: bundle.accommodations.filter((entry) => entry.id !== existingAccommodationId),
              days: bundle.days.map((candidate) => {
                const isInfoDay = candidate.id === infoDayId
                const isOwnDay = candidate.id === dayId
                if (!isInfoDay && !isOwnDay) return candidate
                return {
                  ...candidate,
                  ...(isInfoDay ? { notes, accommodationId: null } : {}),
                  ...(isOwnDay ? dayOwnPatch : {}),
                }
              }),
            }
          }
          const accommodationId = (existingAccommodationId ?? deps.idFactory()) as AccommodationId
          const record = {
            id: accommodationId, name: name ?? 'Hébergement', type: 'hotel' as const, address, latitude: null, longitude: null,
            mapsUrl, website, phone: null, bookingReference, notes: null, confirmed: true,
            provenance: { sourceType: 'user' as const, sourceId: null, fetchedAt: null, engineVersion: 'trips-manager-lodging@1', confidence: null, manuallyOverridden: true },
          }
          const accommodations = existingAccommodationId === null ? [...bundle.accommodations, record] : bundle.accommodations.map((entry) => (entry.id === existingAccommodationId ? record : entry))
          return {
            ...bundle, accommodations,
            days: bundle.days.map((candidate) => {
              const isInfoDay = candidate.id === infoDayId
              const isOwnDay = candidate.id === dayId
              if (!isInfoDay && !isOwnDay) return candidate
              return {
                ...candidate,
                ...(isInfoDay ? { notes, accommodationId } : {}),
                ...(isOwnDay ? dayOwnPatch : {}),
              }
            }),
          }
        })
        if (updated !== null) {
          patchInfosPanel(updated, dayId)
          patchDaySummary(updated, dayId)
        }
      })()
    } else if (action === 'start-choose-location' && mode.kind === 'day') {
      // R3 sections 30-35: opens the shared picker block, mounts a real,
      // synchronous, always-interactive map via `deps.mountLocationPicker`
      // (no polling — see that seam's own doc comment), pre-seeded with
      // whatever this side already resolves to (auto-filled or an existing
      // override) so the initial view is never a fabricated fallback
      // unless genuinely nothing is known yet.
      const target = button.dataset.target
      if (target !== 'start' && target !== 'end') return
      const { tripId, dayId } = mode
      const picker = container.querySelector<HTMLElement>('[data-location-picker]')
      const mapMount = picker?.querySelector<HTMLElement>('[data-location-picker-map]')
      const fallback = picker?.querySelector<HTMLElement>('[data-location-picker-fallback]')
      const confirmButton = picker?.querySelector<HTMLButtonElement>('[data-action="confirm-choose-location"]')
      const labelInput = picker?.querySelector<HTMLInputElement>('[data-location-picker-label]')
      if (picker == null || mapMount == null || confirmButton == null) return
      void (async () => {
        const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
        const day = bundle?.days.find((candidate) => candidate.id === dayId)
        if (bundle === null || bundle === undefined || day === undefined) return
        const initialCoordinates = day.type === 'off'
          ? resolveOffCoordinates(bundle, day)
          : day.type === 'transfer'
            ? (target === 'start' ? resolveTransferCoordinates(bundle, day).origin : resolveTransferCoordinates(bundle, day).destination)
            : null
        const initialName = day.type === 'off'
          ? resolveOffLocation(bundle, day).name
          : (() => {
              const { origin, destination } = resolveTransferLocations(bundle, day)
              return target === 'start' ? origin : destination
            })()
        picker.hidden = false
        confirmButton.disabled = true
        if (fallback !== null && fallback !== undefined) fallback.hidden = true
        if (labelInput !== null && labelInput !== undefined) labelInput.value = initialName ?? ''
        activePickerTarget = target
        activePickerCoordinate = null
        activePickerLabelEditedByVisitor = false
        activePickerLabelInputController?.abort()
        activePickerLabelInputController = new AbortController()
        // RC2 final-closeout sections 51-55: scoped to this one picker
        // session (aborted on confirm/cancel/teardown below), never a
        // permanent top-level listener — this container's own contract is
        // zero stray `input` listeners once nothing needs one.
        if (labelInput !== null && labelInput !== undefined) {
          container.addEventListener('input', (event) => {
            const inputTarget = event.target
            if (inputTarget instanceof HTMLInputElement && inputTarget.dataset.locationPickerLabel !== undefined) {
              activePickerLabelEditedByVisitor = true
            }
          }, { signal: activePickerLabelInputController.signal })
        }
        const handle = deps.mountLocationPicker?.(mapMount, initialCoordinates === null ? null : { latitude: initialCoordinates.latitude, longitude: initialCoordinates.longitude }) ?? null
        activePickerHandle = handle
        if (handle === null) {
          if (fallback !== null && fallback !== undefined) fallback.hidden = false
          return
        }
        // RC2 final-closeout sections 51-55: a lightweight, one-off reverse
        // geocode of the tapped point — never the full Postpass structural
        // pipeline, just the same `GeocodingProvider` endpoint-enrichment
        // already reuses. Coordinates + Confirmer are always available the
        // instant the map reports a tap (never blocked on the network,
        // section 54); the auto-proposed name only ever replaces the label
        // while the visitor hasn't typed into it themselves since the
        // picker opened (`activePickerLabelEditedByVisitor`, section 52:
        // manual entry always stays possible and is never fought over) — a
        // per-open sequence number discards a stale response if the visitor
        // taps a second point before the first reverse geocode resolved.
        let pickerTapSequence = 0
        handle.onMapClick((latitude, longitude) => {
          handle.setTemporaryMarker(latitude, longitude)
          activePickerCoordinate = { latitude, longitude }
          confirmButton.disabled = false
          const geocodingProvider = deps.geocodingProvider
          if (geocodingProvider === undefined || labelInput === null || labelInput === undefined) return
          const sequence = ++pickerTapSequence
          void geocodingProvider.reverse({ latitude, longitude })
            .then((result) => {
              // Stale response (a later tap already superseded this one) or
              // the visitor already typed their own name — never overwrite.
              if (sequence !== pickerTapSequence || activePickerLabelEditedByVisitor || result === null) return
              labelInput.value = result.name
            })
            .catch(() => {
              // Section 54: reverse geocoding failure keeps the coordinates
              // and never blocks anything — the manual label field (already
              // usable right now) is simply left as-is.
            })
        })
      })()
    } else if (action === 'confirm-choose-location' && mode.kind === 'day') {
      const { tripId, dayId } = mode
      const target = activePickerTarget
      const coordinate = activePickerCoordinate
      if (target === null || coordinate === null) return
      const picker = container.querySelector<HTMLElement>('[data-location-picker]')
      const labelInput = picker?.querySelector<HTMLInputElement>('[data-location-picker-label]')
      const label = trimmedOrNull(labelInput?.value ?? '') ?? 'Point choisi sur la carte'
      void (async () => {
        const updated = await mutateTripBundle(tripId, (bundle) => {
          const day = bundle.days.find((candidate) => candidate.id === dayId)
          if (day === undefined) return bundle
          const patch = target === 'start'
            ? { overrideStartLatitude: coordinate.latitude as LatitudeDegrees, overrideStartLongitude: coordinate.longitude as LongitudeDegrees, startLocationName: label }
            : { overrideEndLatitude: coordinate.latitude as LatitudeDegrees, overrideEndLongitude: coordinate.longitude as LongitudeDegrees, endLocationName: label }
          return { ...bundle, days: bundle.days.map((candidate) => (candidate.id === dayId ? { ...candidate, ...patch } : candidate)) }
        })
        activePickerHandle?.onMapClick(null)
        activePickerHandle?.clearTemporaryMarker()
        activePickerHandle = null
        activePickerTarget = null
        activePickerCoordinate = null
        activePickerLabelEditedByVisitor = false
        activePickerLabelInputController?.abort()
        activePickerLabelInputController = null
        if (picker !== null && picker !== undefined) picker.hidden = true
        if (updated !== null) {
          patchInfosPanel(updated, dayId)
          patchDaySummary(updated, dayId)
        }
      })()
    } else if (action === 'cancel-choose-location' && mode.kind === 'day') {
      const picker = container.querySelector<HTMLElement>('[data-location-picker]')
      activePickerHandle?.onMapClick(null)
      activePickerHandle?.clearTemporaryMarker()
      activePickerHandle = null
      activePickerTarget = null
      activePickerCoordinate = null
      activePickerLabelEditedByVisitor = false
      activePickerLabelInputController?.abort()
      activePickerLabelInputController = null
      if (picker !== null) picker.hidden = true
    } else if (action === 'download-stage-gpx' && mode.kind === 'day') {
      const { tripId, dayId } = mode
      void (async () => {
        const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
        if (bundle === null) return
        const day = bundle.days.find((candidate) => candidate.id === dayId)
        const stage = day === undefined || day.stageId === null ? undefined : bundle.stages.find((candidate) => candidate.id === day.stageId)
        const route = stage === undefined ? undefined : bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
        if (route?.sourceFileId === null || route?.sourceFileId === undefined) return
        await downloadRouteGpx(tripId, route.sourceFileId)
      })()
    } else if (action === 'download-trip-gpx' && (mode.kind === 'detail' || mode.kind === 'overview')) {
      const { tripId } = mode
      void (async () => {
        const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
        if (bundle !== null) await downloadTripGpxArchive(tripId, bundle.metadata.name)
      })()
    }

    /** Resolves the stage id backing the currently-open Étape screen — the pause editor's own wrapper carries it via `data-stage-id`. */
    function findCurrentStageId(): RideStageId | undefined {
      const value = container.querySelector<HTMLElement>('[data-day-detail-pauses]')?.dataset.stageId
      return value === undefined ? undefined : (value as RideStageId)
    }
  })

  /** Roving Enter/Space activation for `role="button"` elements that aren't real `<button>`s (trip cards, the Aperçu highlighted-day card) — only when focus is directly on the role=button element itself, never re-triggered for a nested real button (which already handles its own keys natively). */
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'button') return
    event.preventDefault()
    target.click()
  })

  container.addEventListener('change', (event) => {
    const target = event.target
    // Pure client-side reveal (CDC Jalon B4.3 section 31: "Durée uniquement
    // si Pause = oui") — never a save, matches every checked/unchecked row
    // locally until the single "Enregistrer" action reads them all.
    if (target instanceof HTMLInputElement && target.dataset.field === 'pause-active') {
      const row = target.closest<HTMLElement>('.day-pause-editor__row')
      const durationField = row?.querySelector<HTMLElement>('.day-pause-editor__row-duration')
      if (durationField !== null && durationField !== undefined) durationField.hidden = !target.checked
      return
    }
    // R2.1 section 37: a bike transfer leg has no compagnie/opérateur —
    // the field hides on selection, same pure client-side reveal pattern,
    // never a save.
    if (target instanceof HTMLSelectElement && target.dataset.field === 'transfer-mode') {
      const operatorGroup = container.querySelector<HTMLElement>('[data-field-group="transfer-operator"]')
      if (operatorGroup !== null) operatorGroup.hidden = target.value === 'bike'
    }
  })

  void renderList()

  return {
    refresh, goToList, goToOverviewForActiveTrip, goToDetailForActiveTrip,
    isAutomaticEnrichmentInFlight: (tripId) => automaticEnrichmentGuard.isInFlight(tripId),
    waitForWeatherIdle: () => weatherCoordinator.waitForIdle(),
  }
}
