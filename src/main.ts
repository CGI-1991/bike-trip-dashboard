import './style.css'
import { bindNetworkStatus, registerServiceWorker } from './pwa.ts'
import { loadPracticalData } from './practical/model.ts'
import type { PracticalData } from './practical/model.ts'
import type { GpxAnalysisReport } from './gpx/types.ts'
import {
  getRideDaySettings,
  loadRideDaySettings,
  saveRideDaySettings,
  updateReferenceSpeed,
  upsertRideDaySettings,
} from './storage/ride-day-settings.ts'
import type { RideDaySettings, RideDaySettingsDocument } from './storage/ride-day-settings.ts'
import type { RouteEngineSettings } from './route/types.ts'
import { getDateInTimezone } from './trip/calendar.ts'
import { WeatherCache } from './weather/cache.ts'
import { WeatherCoordinator } from './weather/coordinator.ts'
import { weatherConfig } from './weather/config.ts'
import { buildDocumentedPointWeatherListViewModel } from './weather/documented-point-view-model.ts'
import { isTripDateInPast } from './weather/display-policy.ts'
import { createOpenMeteoProvider } from './weather/open-meteo.ts'
import type { WeatherDayState, WeatherSnapshot } from './weather/types.ts'
import { isTripDayId, rga2026TripPlan } from './trip/plan.ts'
import { getAccommodationForDay, loadAccommodations, renderAccommodation } from './trip/accommodations.ts'
import type { Accommodation } from './trip/accommodations.ts'
import { createContextualPauseAnchors, getPauseDayPlan, loadPausePlan, savePausePlan, upsertPauseDayPlan } from './trip/pause-plan.ts'
import type { PauseDayPlan, PausePlace, PausePlanDocument } from './trip/pause-plan.ts'
import { getRoadbookPointRole } from './trip/point-role.ts'
import { loadRoadbookResources } from './trip/roadbook-loader.ts'
import { buildRoadbookMatchReport } from './trip/roadbook-match.ts'
import type {
  RoadbookDayMatchReport,
  RoadbookMatchReport,
} from './trip/roadbook-match.ts'
import type { RoadbookResources } from './trip/roadbook-types.ts'
import {
  buildTripProfile,
  getTripTimelineDay,
  scheduleTripTimeline,
} from './trip/timeline.ts'
import type {
  RideDayId,
  TripDayTimeline,
  TripDayId,
  TripProfile,
  TripTimeline,
} from './trip/types.ts'
import { initializeGpxAnalysis } from './ui/gpx-analysis.ts'
import { downloadGpx, shareGpx } from './ui/gpx-share.ts'
import type { GpxShareTarget } from './ui/gpx-share.ts'
import { openImageViewer } from './ui/image-viewer.ts'
import { renderDashboard } from './ui/render.ts'
import { renderDayHeader } from './ui/day-header.ts'
import { hashForDay, parseAppHash } from './ui/app-state.ts'
import type { AppView } from './ui/app-state.ts'
import { renderDayInfos, renderDayInfosError, renderDayInfosLoading } from './ui/day-infos.ts'
import {
  renderRoadbookReport,
  renderRoadbookReportError,
  renderRoadbookReportLoading,
} from './ui/roadbook-report.ts'
import {
  renderRouteEngineError,
  renderRouteEngineLoading,
  renderTripDayRouteTimeline,
} from './ui/route-engine.ts'
import { renderElevationProfile } from './ui/elevation-profile.ts'
import { closeExpandedRouteMap, renderCompactRouteMapModel, renderRouteMap } from './ui/route-map.ts'
import { closeExpandedOverviewMap, renderOverviewMap } from './ui/overview-map.ts'
import { buildOverviewViewModel } from './ui/overview-view-model.ts'
import { renderOverviewView } from './ui/overview-view.ts'
import {
  renderTripPlanError,
  renderTripPlanLoading,
  renderTripTimeline,
} from './ui/trip-plan.ts'
import {
  renderWeatherDetail,
  renderWeatherDetailError,
  renderWeatherDetailLoading,
} from './ui/weather-detail.ts'
import {
  renderWeatherSummary,
  renderWeatherSummaryError,
  renderWeatherSummaryLoading,
} from './ui/weather-summary.ts'
import { renderTodayView } from './ui/today-view.ts'

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (element === null) {
    throw new Error(`Élément requis introuvable : ${selector}`)
  }

  return element
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

let currentRideDaySettings: RideDaySettingsDocument = loadRideDaySettings()
let currentPausePlan: PausePlanDocument = loadPausePlan()
let roadbookPlacesHydrated = false
let currentTripProfile: TripProfile | null = null
let currentTripTimeline: TripTimeline | null = null
let currentGpxReport: GpxAnalysisReport | null = null
let currentPracticalData: PracticalData | null = null
let currentRoadbookResources: RoadbookResources | null = null
let currentAccommodations: readonly Accommodation[] = []
let currentRoadbookReport: RoadbookMatchReport | null = null
let currentRoadbookError: unknown = null
let currentGpxError: unknown = null
let currentGpxTarget: GpxShareTarget | null = null
let selectedDayId: TripDayId = 'J1'
let currentWeatherError: unknown = null
let currentWeatherSnapshot: WeatherSnapshot = {
  selectedDayId,
  states: new Map(),
}
const weatherCoordinator = new WeatherCoordinator({
  provider: createOpenMeteoProvider(),
  cache: new WeatherCache(),
})

const app = getRequiredElement<HTMLDivElement>('#app')
app.innerHTML = renderDashboard(currentRideDaySettings, rga2026TripPlan)

const networkStatus = getRequiredElement<HTMLElement>('[data-network-status]')
const unbindNetworkStatus = bindNetworkStatus(networkStatus)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void registerServiceWorker(import.meta.env.BASE_URL).catch(() => undefined)
}

const saveStatus = getRequiredElement<HTMLElement>('#save-status')
const dayIndicator = getRequiredElement<HTMLElement>('[data-day-indicator]')
const todayPanel = getRequiredElement<HTMLElement>('[data-today-panel]')
const dayHeaderContainer = getRequiredElement<HTMLElement>('[data-day-header]')
const tripPlanContainer = getRequiredElement<HTMLElement>('[data-trip-plan]')
const routeEngineContainer = getRequiredElement<HTMLElement>('[data-route-engine]')
const roadbookDetailContainer = getRequiredElement<HTMLElement>('[data-day-infos-content]')
const accommodationContainer = getRequiredElement<HTMLElement>('[data-accommodation-card]')
const gpxDownloadButton = getRequiredElement<HTMLButtonElement>('[data-gpx-download]')
const gpxShareDialog = getRequiredElement<HTMLDialogElement>('#gpx-share-dialog')
const gpxShareStatus = getRequiredElement<HTMLElement>('[data-gpx-share-status]')
const routeMapContainer = getRequiredElement<HTMLElement>('[data-route-map]')
const routeMapDialog = getRequiredElement<HTMLDialogElement>('[data-route-map-dialog]')
const overviewMapDialog = getRequiredElement<HTMLDialogElement>('[data-overview-map-dialog]')
const elevationProfileContainer = getRequiredElement<HTMLElement>('[data-elevation-profile]')
const roadbookReportContainer = getRequiredElement<HTMLElement>(
  '[data-roadbook-diagnostics]',
)
const gpxAnalysisContainer = getRequiredElement<HTMLElement>('[data-gpx-analysis]')
const weatherPanel = getRequiredElement<HTMLElement>('[data-weather-panel]')
const weatherRefreshButton = getRequiredElement<HTMLButtonElement>(
  '[data-weather-refresh]',
)
const weatherStatus = getRequiredElement<HTMLElement>('[data-weather-status]')
const weatherUpdatedAt = getRequiredElement<HTMLTimeElement>(
  '[data-weather-updated-at]',
)
const pauseEditor = getRequiredElement<HTMLDialogElement>('#pause-editor')
const pauseEditorList = getRequiredElement<HTMLElement>('[data-pause-editor-list]')
const pauseFeedback = getRequiredElement<HTMLElement>('[data-pause-feedback]')
const pauseIntro = getRequiredElement<HTMLElement>('[data-pause-intro]')
const pauseTotalSummary = getRequiredElement<HTMLElement>('[data-pause-total-summary]')
const dayDepartureTimeInput = getRequiredElement<HTMLInputElement>('[data-day-departure-time]')
const dayTotalBreakInput = getRequiredElement<HTMLInputElement>('[data-day-total-break]')
const referenceSpeedInput = getRequiredElement<HTMLInputElement>('[data-reference-speed]')
const referenceSpeedFeedback = getRequiredElement<HTMLElement>('[data-reference-speed-feedback]')
const automaticBreakField = getRequiredElement<HTMLElement>('[data-automatic-break-field]')
let pauseDraft: PauseDayPlan | null = null
let daySettingsDraft: RideDaySettings | null = null
let returnView: Exclude<AppView, 'day-detail'> = 'today'

function showView(view: AppView): void {
  for (const section of document.querySelectorAll<HTMLElement>('[data-app-view]')) {
    section.hidden = section.dataset.appView !== view
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-nav-view]')) {
    const active = link.dataset.navView === view
    link.classList.toggle('is-active', active)
    if (active) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  window.scrollTo({ top: 0 })
}

function syncHash(): void {
  const route = parseAppHash(window.location.hash, selectedDayId)
  if (route.currentView === 'day-detail') {
    selectedDayId = route.selectedDayId
    weatherCoordinator.selectDay(selectedDayId)
  }
  showView(route.currentView)
  renderCurrentTripSelection()
}

const weatherStateLabels: Record<WeatherDayState['availability'], string> = {
  loading: 'Chargement des prévisions',
  available: 'Prévisions disponibles',
  partial: 'Prévisions partielles',
  'outside-horizon': 'Date hors horizon prévisionnel',
  'stale-cache': 'Dernières prévisions en cache',
  unavailable: 'Prévisions indisponibles',
  error: 'Erreur météo',
}

function renderWeatherChrome(state: WeatherDayState | null): void {
  const isPast =
    state !== null &&
    isTripDateInPast(
      state.tripDate,
      getDateInTimezone(new Date(), weatherConfig.timezone),
    )
  weatherStatus.textContent =
    state === null
      ? 'Prévisions en attente'
      : isPast
        ? 'Journée passée'
        : weatherStateLabels[state.availability]
  weatherRefreshButton.disabled =
    state === null ||
    state.isRefreshing ||
    isPast ||
    state.availability === 'outside-horizon' ||
    state.availability === 'unavailable'
  weatherRefreshButton.setAttribute(
    'aria-disabled',
    String(weatherRefreshButton.disabled),
  )

  if (state?.fetchedAt === null || state === null) {
    weatherUpdatedAt.textContent = 'Aucune actualisation'
    weatherUpdatedAt.removeAttribute('datetime')
    return
  }

  const fetchedAt = new Date(state.fetchedAt)
  weatherUpdatedAt.dateTime = state.fetchedAt
  weatherUpdatedAt.textContent = Number.isNaN(fetchedAt.getTime())
    ? 'Actualisation inconnue'
    : `Mis à jour ${new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Europe/Paris',
      }).format(fetchedAt)}`
}

function renderCurrentWeatherSelection(): void {
  try {
    renderWeatherSummary(tripPlanContainer, currentWeatherSnapshot)
    const state = currentWeatherSnapshot.states.get(selectedDayId) ?? null

    if (state === null) {
      if (currentWeatherError === null) {
        renderWeatherDetailLoading(weatherPanel)
      } else {
        renderWeatherDetailError(weatherPanel, currentWeatherError)
      }
    } else {
      renderWeatherDetail(weatherPanel, state)
    }

    renderWeatherChrome(state)
    renderSelectedDayHeader()
  } catch (error) {
    currentWeatherError = error
    renderWeatherSummaryError(tripPlanContainer, error)
    renderWeatherDetailError(weatherPanel, error)
    renderWeatherChrome(null)
  }
}

function getDisplayedRiskLevel(): 'green' | 'orange' | 'red' | 'unknown' {
  const level = weatherPanel.querySelector<HTMLElement>('[data-weather-risk-level]')?.dataset.weatherRiskLevel
  return level === 'green' || level === 'orange' || level === 'red' ? level : 'unknown'
}

function renderSelectedDayHeader(): void {
  const day = currentTripTimeline === null ? null : getTripTimelineDay(currentTripTimeline, selectedDayId)
  renderDayHeader(dayHeaderContainer, day, getDisplayedRiskLevel())
}

function getPausePlaces(dayId: TripDayId): readonly PausePlace[] {
  const places = new Map<string, PausePlace>()
  const dayReport = getRoadbookDayMatch(dayId)
  if (dayReport?.type === 'ride') {
    for (const point of dayReport.points) {
      const role = getRoadbookPointRole(point)
      const eligibleType = point.type === 'village' || point.type === 'resupply' || point.type === 'col' || point.type === 'summit' || point.type === 'passage' || point.type === 'pause'
      if (point.matchedTrackDistanceKm === undefined || !(eligibleType || point.isPauseCandidate || point.isResupplyCandidate)) continue
      places.set(point.id, { id: point.id, name: point.name, trackDistanceKm: point.matchedTrackDistanceKm, offRoute: role !== 'route-point' })
    }
  }
  return [...places.values()].sort((a, b) => a.trackDistanceKm - b.trackDistanceKm)
}

function getPausePlacesByDay(): Readonly<Record<string, readonly PausePlace[]>> {
  return Object.fromEntries(rga2026TripPlan.days.filter((day) => day.type === 'ride').map(({ id }) => [id, getPausePlaces(id)]))
}

function focusSelectedTripDay(): void {
  tripPlanContainer
    .querySelector<HTMLButtonElement>(
      `[data-trip-day-select=${selectedDayId}]`,
    )
    ?.focus()
}

function updatePendingTripSelection(): void {
  for (const item of tripPlanContainer.querySelectorAll<HTMLElement>('[data-trip-day]')) {
    const isSelected = item.dataset.tripDay === selectedDayId
    item.classList.toggle('trip-day--selected', isSelected)
    item
      .querySelector<HTMLElement>('[data-trip-day-select]')
      ?.setAttribute('aria-pressed', String(isSelected))
  }

  const selectedDay = rga2026TripPlan.days.find(({ id }) => id === selectedDayId)

  if (selectedDay !== undefined) {
    dayIndicator.textContent = `${selectedDay.id} sur ${rga2026TripPlan.totalDays} · ${
      selectedDay.type === 'off' ? 'OFF' : 'Roulé'
    }`
  }
}

function getRoadbookDayMatch(dayId: TripDayId): RoadbookDayMatchReport | null {
  return currentRoadbookReport?.days.find(({ dayId: candidate }) => candidate === dayId) ?? null
}

function renderCurrentRoadbookSelection(
  _timelineDay: TripDayTimeline | null,
): void {
  if (currentRoadbookReport === null) {
    if (currentRoadbookError === null) {
      renderDayInfosLoading(roadbookDetailContainer)
    } else {
      renderDayInfosError(roadbookDetailContainer, currentRoadbookError)
    }
    return
  }

  const dayMatch = getRoadbookDayMatch(selectedDayId)

  if (dayMatch === null) {
    renderDayInfosError(
      roadbookDetailContainer,
      new Error(`Journée roadbook introuvable : ${selectedDayId}`),
    )
    return
  }

  renderDayInfos(roadbookDetailContainer, dayMatch)
}

function renderSelectedRouteTimeline(
  selectedDay: TripDayTimeline,
  accommodation: Accommodation | null,
): void {
  const state = currentWeatherSnapshot.states.get(selectedDay.day.id) ?? null
  const documentedPoints = currentRoadbookReport?.allPointMatches.filter(
    ({ dayId }) => dayId === selectedDay.day.id,
  ) ?? []
  const weather = buildDocumentedPointWeatherListViewModel(
    state,
    documentedPoints,
    getDateInTimezone(new Date(), weatherConfig.timezone),
  )
  renderTripDayRouteTimeline(
    routeEngineContainer,
    selectedDay,
    currentRoadbookReport,
    accommodation,
    weather,
  )
}

function renderCurrentTripSelection(restoreFocus = false): void {
  if (currentTripTimeline === null) {
    updatePendingTripSelection()
    renderCurrentRoadbookSelection(null)
    renderCurrentWeatherSelection()

    if (restoreFocus) {
      focusSelectedTripDay()
    }

    return
  }

  const selectedDay = getTripTimelineDay(currentTripTimeline, selectedDayId)

  if (selectedDay === null) {
    const error = new Error(`Journée sélectionnée introuvable : ${selectedDayId}`)
    renderTripPlanError(tripPlanContainer, rga2026TripPlan, selectedDayId, error)
    renderRouteEngineError(routeEngineContainer, error)
    renderDayInfosError(roadbookDetailContainer, error)
    renderWeatherDetailError(weatherPanel, error)
    return
  }

  renderTripTimeline(tripPlanContainer, currentTripTimeline, selectedDayId)
  const accommodation = getAccommodationForDay(currentAccommodations, selectedDayId)
  renderSelectedRouteTimeline(selectedDay, accommodation)
  renderAccommodation(accommodationContainer, accommodation)
  if (selectedDay.type === 'ride' && selectedDay.status === 'ready') {
    const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
    currentGpxTarget = {
      url: `${base}data/gpx/${encodeURIComponent(selectedDay.day.gpxFile)}`,
      filename: `${selectedDay.day.id}-${selectedDay.day.startName}-${selectedDay.day.endName}.gpx`,
    }
    gpxDownloadButton.hidden = false
    const gpx = currentGpxReport?.files.find((file) => file.status === 'success' && file.source.fileName === selectedDay.day.gpxFile)
    const successfulGpx = gpx?.status === 'success' ? gpx : null
    renderRouteMap(routeMapContainer, routeMapDialog, successfulGpx, selectedDay, currentRoadbookReport, accommodation, currentPracticalData)
    renderElevationProfile(elevationProfileContainer, successfulGpx, selectedDay, currentRoadbookReport, accommodation)
  } else {
    currentGpxTarget = null
    gpxDownloadButton.hidden = true
    // The day's type (ride/off) comes only from the calendar/trip plan, never
    // from whether a timeline could be built — a ride day whose GPX/pauses
    // temporarily failed must never read as a genuine OFF day.
    if (selectedDay.type === 'off') {
      routeMapContainer.innerHTML = '<p>Pas de carte cycliste pour une journée OFF.</p>'
      elevationProfileContainer.innerHTML = '<p>Pas de profil cycliste pour une journée OFF.</p>'
    } else {
      const cause = selectedDay.status === 'unavailable' ? escapeHtml(selectedDay.message) : ''
      routeMapContainer.innerHTML = `<p>Carte temporairement indisponible.${cause === '' ? '' : ` ${cause}`}</p>`
      elevationProfileContainer.innerHTML = `<p>Profil temporairement indisponible.${cause === '' ? '' : ` ${cause}`}</p>`
    }
  }
  renderCurrentRoadbookSelection(selectedDay)
  renderCurrentWeatherSelection()
  renderToday()
  dayIndicator.textContent = `${selectedDay.day.id} sur ${rga2026TripPlan.totalDays} · ${
    selectedDay.type === 'off' ? 'OFF' : 'Roulé'
  }`

  if (restoreFocus) {
    focusSelectedTripDay()
  }
}

function renderToday(): void {
  const now = new Date()
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
  const model = buildOverviewViewModel({
    now,
    plan: rga2026TripPlan,
    timeline: currentTripTimeline,
    roadbookReport: currentRoadbookReport,
    roadbookError: currentRoadbookError,
    accommodations: currentAccommodations,
    weatherSnapshot: currentWeatherSnapshot,
    gpxReport: currentGpxReport,
    publicBaseUrl: base,
    isOffline: !navigator.onLine,
  })
  renderOverviewView(todayPanel, model)

  const stageContainer = todayPanel.querySelector<HTMLElement>('[data-overview-stage]')
  if (stageContainer !== null) {
    renderTodayView(stageContainer, model.stage)
    const mapContainer = stageContainer.querySelector<HTMLElement>('[data-today-route-map]')
    if (mapContainer !== null && model.stage.type === 'ride') renderCompactRouteMapModel(mapContainer, model.stage.mapModel)
  }

  const overviewMapContainer = todayPanel.querySelector<HTMLElement>('[data-overview-map]')
  const overviewExploreButton = todayPanel.querySelector<HTMLButtonElement>('[data-overview-explore-map]')
  if (overviewMapContainer !== null) renderOverviewMap(overviewMapContainer, overviewMapDialog, model.mapModel, overviewExploreButton)
}

function refreshRoadbookIntegration(): void {
  if (
    currentTripTimeline === null ||
    currentGpxReport === null ||
    currentRoadbookResources === null
  ) {
    currentRoadbookReport = null

    if (currentGpxError !== null) {
      currentRoadbookError = currentGpxError
      renderRoadbookReportError(roadbookReportContainer, currentGpxError)
    }

    renderCurrentTripSelection()
    return
  }

  try {
    const { roadbook, overrides } = currentRoadbookResources
    const report = buildRoadbookMatchReport(
      roadbook,
      overrides,
      rga2026TripPlan,
      currentGpxReport.files,
      currentTripTimeline,
    )

    currentRoadbookReport = report
    currentRoadbookError = null
    currentWeatherError = null
    // Automatic and custom pauses are both resolved against real documented
    // points (see pause-plan.ts), which only exist once the roadbook report
    // above has run at least once — the very first scheduling pass (before
    // that report exists) has no places to anchor pauses to. Re-schedule once
    // this happens so every day's pauses land on their intended points.
    if (!roadbookPlacesHydrated && currentTripProfile !== null) {
      roadbookPlacesHydrated = true
      currentTripTimeline = scheduleTripTimeline(currentTripProfile, getDaySettings, currentPausePlan, getPausePlacesByDay())
      refreshRoadbookIntegration()
      return
    }
    weatherCoordinator.setContext(
      rga2026TripPlan,
      currentTripTimeline,
      report,
      selectedDayId,
      new Set(currentPausePlan.days.flatMap(({ pauses }) => pauses.filter(({ active }) => active).map(({ placeId }) => placeId))),
    )
    renderRoadbookReport(roadbookReportContainer, report)
    renderCurrentTripSelection()
  } catch (error) {
    currentRoadbookReport = null
    currentRoadbookError = error
    currentWeatherError = error
    renderRoadbookReportError(roadbookReportContainer, error)
    renderCurrentTripSelection()
  }
}

function getDaySettings(dayId: RideDayId): RouteEngineSettings {
  const daySettings = getRideDaySettings(currentRideDaySettings, dayId)
  return { ...daySettings, referenceSpeedKph: currentRideDaySettings.referenceSpeedKph }
}

function refreshTripTimeline(): void {
  if (currentTripProfile === null) {
    return
  }

  try {
    currentTripTimeline = scheduleTripTimeline(currentTripProfile, getDaySettings, currentPausePlan, getPausePlacesByDay())
    refreshRoadbookIntegration()
  } catch (error) {
    currentTripTimeline = null
    renderTripPlanError(tripPlanContainer, rga2026TripPlan, selectedDayId, error)
    renderRouteEngineError(routeEngineContainer, error)
    renderDayInfosError(roadbookDetailContainer, error)
    currentWeatherError = error
    renderCurrentWeatherSelection()
  }
}

function updateStageSummaries(): void {
  for (const stage of document.querySelectorAll<HTMLElement>('[data-pause-stage]')) {
    const dayId = stage.dataset.pauseStage
    if (dayId === undefined || !isTripDayId(dayId) || dayId === 'J5' || dayId === 'J8') continue
    const settings = getRideDaySettings(currentRideDaySettings, dayId as RideDayId)
    const plan = getPauseDayPlan(currentPausePlan, dayId as RideDayId)
    const departure = stage.querySelector<HTMLElement>('[data-stage-departure]')
    const breaks = stage.querySelector<HTMLElement>('[data-stage-breaks]')
    const planLabel = stage.querySelector<HTMLElement>('[data-stage-plan]')
    if (departure !== null) departure.textContent = settings.departureTime
    if (breaks !== null) breaks.textContent = `${settings.totalBreakMinutes} min`
    if (planLabel !== null) planLabel.textContent = plan?.mode === 'custom' ? 'Personnalisé' : 'Automatique'
  }
}

getRequiredElement<HTMLButtonElement>('[data-settings-back]').addEventListener('click', () => history.back())
getRequiredElement<HTMLButtonElement>('[data-detail-back]').addEventListener('click', () => {
  window.location.hash = returnView === 'trip' ? '#/trip' : '#/today'
})

function moveDay(offset: -1 | 1): void {
  const index = rga2026TripPlan.days.findIndex(({ id }) => id === selectedDayId)
  const next = rga2026TripPlan.days[index + offset]
  if (next !== undefined) window.location.hash = hashForDay(next.id)
}

function getReadySelectedRide(): Extract<TripDayTimeline, { type: 'ride'; status: 'ready' }> | null {
  const day = currentTripTimeline === null ? null : getTripTimelineDay(currentTripTimeline, selectedDayId)
  return day?.type === 'ride' && day.status === 'ready' ? day : null
}

function createAutomaticPauseDraft(dayId: RideDayId, settings: RideDaySettings): PauseDayPlan | null {
  const profileDay = currentTripProfile?.days.find(({ day: candidate }) => candidate.id === dayId)
  if (profileDay?.type !== 'ride' || profileDay.status !== 'ready') return null
  const anchors = createContextualPauseAnchors(profileDay.routeProfile, currentRideDaySettings.referenceSpeedKph, getPausePlaces(dayId))
  const durations: number[] = []
  let allocated = 0
  anchors.forEach((anchor, index) => {
    const duration = index === anchors.length - 1 ? settings.totalBreakMinutes - allocated : Math.floor(settings.totalBreakMinutes * anchor.durationShare)
    durations.push(duration)
    allocated += duration
  })
  return {
    dayId,
    mode: 'automatic',
    // Every anchor now resolves to a real documented point (see pause-plan.ts);
    // `placeId` is that point's own roadbook id, never a synthetic position.
    pauses: anchors.map((anchor, order) => ({ id: anchor.id, active: true, placeId: anchor.pointId ?? anchor.id, placeName: anchor.name, durationMinutes: durations[order] ?? 0, order, origin: 'automatic' })),
  }
}

function readDaySettingsFromForm(dayId: RideDayId): RideDaySettings {
  return {
    dayId,
    departureTime: dayDepartureTimeInput.value,
    totalBreakMinutes: dayTotalBreakInput.valueAsNumber,
  }
}

function readPauseDraftFromForm(): PauseDayPlan | null {
  if (pauseDraft === null) return null
  const mode = getRequiredElement<HTMLInputElement>('input[name="pause-mode"]:checked').value
  if (mode === 'automatic') return createAutomaticPauseDraft(pauseDraft.dayId, readDaySettingsFromForm(pauseDraft.dayId))
  const pauses = [...pauseEditorList.querySelectorAll<HTMLElement>('[data-pause-item]')].map((item, order) => {
    const select = item.querySelector<HTMLSelectElement>('select')
    const duration = item.querySelector<HTMLInputElement>('input[type="number"]')
    const active = item.querySelector<HTMLInputElement>('input[type="checkbox"]')
    const option = select?.selectedOptions[0]
    return { id: item.dataset.pauseItem ?? `custom-${order + 1}`, active: active?.checked ?? false, placeId: select?.value ?? '', placeName: option?.dataset.placeName ?? option?.textContent ?? '', durationMinutes: duration?.valueAsNumber ?? 0, order, origin: 'custom' as const }
  })
  return { dayId: pauseDraft.dayId, mode: 'custom', pauses }
}

function renderPauseEditor(): void {
  if (pauseDraft === null || daySettingsDraft === null) return
  const places = getPausePlaces(pauseDraft.dayId)
  const isAutomatic = pauseDraft.mode === 'automatic'
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="pause-mode"]')) radio.checked = radio.value === pauseDraft.mode
  dayDepartureTimeInput.value = daySettingsDraft.departureTime
  const activeDurationSum = pauseDraft.pauses.filter(({ active }) => active).reduce((total, pause) => total + pause.durationMinutes, 0)
  dayTotalBreakInput.disabled = !isAutomatic
  dayTotalBreakInput.value = String(isAutomatic ? daySettingsDraft.totalBreakMinutes : activeDurationSum)
  automaticBreakField.classList.toggle('is-derived', !isAutomatic)
  pauseIntro.textContent = isAutomatic ? `${pauseDraft.pauses.length} pause(s) proposées selon le temps de roulage.` : 'Activez les pauses utiles, choisissez un lieu existant et ajustez leur durée.'
  pauseTotalSummary.textContent = isAutomatic ? '' : `Total des pauses actives : ${activeDurationSum} min (devient le temps total de pause de l’étape à l’enregistrement).`
  if (isAutomatic) {
    pauseEditorList.innerHTML = pauseDraft.pauses.map((pause) => `<article class="pause-editor__item"><strong>${pause.placeName}</strong><span>${pause.durationMinutes} min</span></article>`).join('')
    return
  }
  pauseEditorList.innerHTML = `${pauseDraft.pauses.map((pause) => `<article class="pause-editor__item" data-pause-item="${pause.id}"><label class="pause-active"><input type="checkbox" ${pause.active ? 'checked' : ''}> Active</label><label>Lieu<select>${places.map((place) => `<option value="${place.id}" data-place-name="${place.name}" ${place.id === pause.placeId ? 'selected' : ''}>${place.name}${place.offRoute ? ' — hors parcours, aucun détour ajouté' : ''}</option>`).join('')}</select></label><label>Durée<input type="number" min="0" max="120" step="5" value="${pause.durationMinutes}"> min</label><button class="button button--quiet" type="button" data-remove-pause>Supprimer</button></article>`).join('')}<button class="button button--quiet button--full" type="button" data-add-pause ${pauseDraft.pauses.length >= 6 ? 'disabled' : ''}>Ajouter une pause</button>`
}

function openPauseEditor(): void {
  const day = getReadySelectedRide()
  if (day === null) return
  const dayId = day.day.id
  daySettingsDraft = getRideDaySettings(currentRideDaySettings, dayId)
  const automatic = createAutomaticPauseDraft(dayId, daySettingsDraft)
  if (automatic === null) return
  pauseDraft = getPauseDayPlan(currentPausePlan, dayId) ?? automatic
  pauseFeedback.textContent = ''
  renderPauseEditor()
  pauseEditor.showModal()
}

getRequiredElement<HTMLButtonElement>('[data-day-previous]').addEventListener('click', () => moveDay(-1))
getRequiredElement<HTMLButtonElement>('[data-day-next]').addEventListener('click', () => moveDay(1))
window.addEventListener('hashchange', syncHash)

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-pause-editor]')) button.addEventListener('click', () => {
  const requestedDay = button.dataset.pauseDay
  if (requestedDay !== undefined && isTripDayId(requestedDay)) selectedDayId = requestedDay
  openPauseEditor()
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pause-cancel]')) button.addEventListener('click', () => pauseEditor.close())
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="pause-mode"]')) radio.addEventListener('change', () => {
  if (pauseDraft === null || daySettingsDraft === null) return
  const settings = readDaySettingsFromForm(pauseDraft.dayId)
  const automatic = createAutomaticPauseDraft(pauseDraft.dayId, settings)
  if (automatic === null) return
  pauseDraft = radio.value === 'automatic' ? automatic : { ...automatic, mode: 'custom', pauses: automatic.pauses.map((pause) => ({ ...pause, origin: 'custom' })) }
  renderPauseEditor()
})
for (const input of [dayDepartureTimeInput, dayTotalBreakInput]) input.addEventListener('input', () => {
  if (pauseDraft === null || pauseDraft.mode !== 'automatic') return
  const automatic = createAutomaticPauseDraft(pauseDraft.dayId, readDaySettingsFromForm(pauseDraft.dayId))
  if (automatic === null) return
  pauseDraft = automatic
  renderPauseEditor()
})
pauseEditorList.addEventListener('click', (event) => {
  if (!(event.target instanceof Element) || pauseDraft === null || pauseDraft.mode !== 'custom') return
  pauseDraft = readPauseDraftFromForm() ?? pauseDraft
  const remove = event.target.closest<HTMLElement>('[data-remove-pause]')?.closest<HTMLElement>('[data-pause-item]')
  if (remove !== null && remove !== undefined) pauseDraft = { ...pauseDraft, pauses: pauseDraft.pauses.filter(({ id }) => id !== remove.dataset.pauseItem) }
  else if (event.target.closest('[data-add-pause]') !== null) {
    const place = getPausePlaces(pauseDraft.dayId)[0]
    if (place !== undefined && pauseDraft.pauses.length < 6) pauseDraft = { ...pauseDraft, pauses: [...pauseDraft.pauses, { id: `custom-${Date.now()}`, active: true, placeId: place.id, placeName: place.name, durationMinutes: 10, order: pauseDraft.pauses.length, origin: 'custom' }] }
  } else return
  renderPauseEditor()
})
getRequiredElement<HTMLButtonElement>('[data-pause-restore]').addEventListener('click', () => {
  if (pauseDraft === null || daySettingsDraft === null) return
  pauseDraft = createAutomaticPauseDraft(pauseDraft.dayId, readDaySettingsFromForm(pauseDraft.dayId)) ?? pauseDraft
  renderPauseEditor()
})
getRequiredElement<HTMLButtonElement>('[data-save-reference-speed]').addEventListener('click', () => {
  const next = updateReferenceSpeed(currentRideDaySettings, referenceSpeedInput.valueAsNumber)
  if (next.referenceSpeedKph !== referenceSpeedInput.valueAsNumber) {
    referenceSpeedFeedback.textContent = 'Vitesse invalide : plage acceptée 8 à 40 km/h.'
    return
  }
  if (!saveRideDaySettings(next)) {
    referenceSpeedFeedback.textContent = 'Enregistrement impossible dans ce navigateur.'
    return
  }
  currentRideDaySettings = next
  refreshTripTimeline()
  updateStageSummaries()
  referenceSpeedFeedback.textContent = 'Vitesse de référence enregistrée et ETA recalculées pour les dix étapes.'
})
getRequiredElement<HTMLButtonElement>('[data-pause-save]').addEventListener('click', () => {
  const plan = readPauseDraftFromForm()
  if (plan === null) return
  const formSettings = readDaySettingsFromForm(plan.dayId)
  const effectiveSettings: RideDaySettings =
    plan.mode === 'automatic'
      ? formSettings
      : { ...formSettings, totalBreakMinutes: plan.pauses.filter(({ active }) => active).reduce((total, pause) => total + pause.durationMinutes, 0) }
  const nextRideDaySettings = upsertRideDaySettings(currentRideDaySettings, effectiveSettings)
  if (!saveRideDaySettings(nextRideDaySettings)) { pauseFeedback.textContent = 'Enregistrement impossible dans ce navigateur.'; return }
  const nextPausePlan = upsertPauseDayPlan(currentPausePlan, plan)
  if (!savePausePlan(nextPausePlan)) { pauseFeedback.textContent = 'Enregistrement impossible dans ce navigateur.'; return }
  currentRideDaySettings = nextRideDaySettings
  currentPausePlan = nextPausePlan
  refreshTripTimeline()
  updateStageSummaries()
  pauseEditor.close()
  saveStatus.textContent = `Réglages de ${plan.dayId} enregistrés et ETA recalculées.`
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-close-map]')) button.addEventListener('click', () => closeExpandedRouteMap(routeMapDialog))
routeMapDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeExpandedRouteMap(routeMapDialog) })

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-overview-close-map]')) button.addEventListener('click', () => closeExpandedOverviewMap(overviewMapDialog))
overviewMapDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeExpandedOverviewMap(overviewMapDialog) })

let currentGpxShareTarget: GpxShareTarget | null = null

function openGpxShareDialog(target: GpxShareTarget | null): void {
  if (target === null) return
  currentGpxShareTarget = target
  gpxShareStatus.textContent = ''
  gpxShareDialog.showModal()
}

gpxDownloadButton.addEventListener('click', () => openGpxShareDialog(currentGpxTarget))
dayHeaderContainer.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('[data-gpx-quick-access]') !== null) openGpxShareDialog(currentGpxTarget)
})
todayPanel.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return
  const trigger = event.target.closest<HTMLElement>('[data-overview-gpx-trigger]')
  if (trigger === null) return
  const { gpxUrl, gpxFilename } = trigger.dataset
  if (gpxUrl === undefined || gpxFilename === undefined) return
  openGpxShareDialog({ url: gpxUrl, filename: gpxFilename })
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-gpx-share-close]')) button.addEventListener('click', () => gpxShareDialog.close())
gpxShareDialog.addEventListener('cancel', (event) => { event.preventDefault(); gpxShareDialog.close() })
getRequiredElement<HTMLButtonElement>('[data-gpx-share-action]').addEventListener('click', () => {
  if (currentGpxShareTarget === null) return
  const target = currentGpxShareTarget
  gpxShareStatus.textContent = 'Préparation du fichier…'
  void shareGpx(target)
    .then((result) => {
      if (result === 'cancelled') { gpxShareStatus.textContent = ''; return }
      gpxShareStatus.textContent = result === 'shared' ? 'Partagé.' : 'Téléchargement lancé.'
      gpxShareDialog.close()
    })
    .catch((error: unknown) => {
      gpxShareStatus.textContent = error instanceof Error ? error.message : 'Partage impossible. Vérifiez votre connexion.'
    })
})
getRequiredElement<HTMLButtonElement>('[data-gpx-direct-download]').addEventListener('click', () => {
  if (currentGpxShareTarget === null) return
  const target = currentGpxShareTarget
  gpxShareStatus.textContent = 'Préparation du téléchargement…'
  void downloadGpx(target)
    .then(() => { gpxShareStatus.textContent = 'Téléchargement lancé.'; gpxShareDialog.close() })
    .catch((error: unknown) => {
      gpxShareStatus.textContent = error instanceof Error ? error.message : 'Téléchargement impossible. Vérifiez votre connexion.'
    })
})

const imageViewerDialog = getRequiredElement<HTMLDialogElement>('#image-viewer-dialog')
imageViewerDialog.addEventListener('click', (event) => {
  if (event.target === imageViewerDialog) imageViewerDialog.close()
})
for (const button of imageViewerDialog.querySelectorAll<HTMLButtonElement>('[data-image-viewer-close]')) button.addEventListener('click', () => imageViewerDialog.close())
imageViewerDialog.addEventListener('cancel', (event) => { event.preventDefault(); imageViewerDialog.close() })
roadbookDetailContainer.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return
  const trigger = event.target.closest<HTMLElement>('[data-col-image-trigger]')
  if (trigger === null) return
  const { colName, colImageUrl, colImageSource } = trigger.dataset
  if (colName === undefined || colImageUrl === undefined || colImageSource === undefined) return
  openImageViewer(imageViewerDialog, { title: colName, imageUrl: colImageUrl, sourceLabel: colImageSource })
})

for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-day-tab]')) {
  tab.addEventListener('click', () => {
    const requested = tab.dataset.dayTab
    for (const panel of document.querySelectorAll<HTMLElement>('[data-day-panel]')) {
      panel.hidden = panel.dataset.dayPanel !== requested
    }
    for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-day-tab]')) {
      candidate.setAttribute('aria-selected', String(candidate === tab))
      candidate.tabIndex = candidate === tab ? 0 : -1
    }
  })
}

tripPlanContainer.addEventListener('click', (event) => {
  const target = event.target

  if (!(target instanceof Element)) {
    return
  }

  const button = target.closest<HTMLElement>('[data-trip-day-select]')
  const requestedDayId = button?.dataset.tripDaySelect

  if (requestedDayId === undefined || !isTripDayId(requestedDayId)) {
    return
  }

  selectedDayId = requestedDayId
  weatherCoordinator.selectDay(requestedDayId)
  returnView = 'trip'
  window.location.hash = hashForDay(requestedDayId)
})

weatherRefreshButton.addEventListener('click', () => {
  void weatherCoordinator.refreshSelected().catch((error: unknown) => {
    currentWeatherError = error
    renderCurrentWeatherSelection()
  })
})

renderTripPlanLoading(tripPlanContainer, rga2026TripPlan, selectedDayId)
renderRouteEngineLoading(routeEngineContainer)
renderDayInfosLoading(roadbookDetailContainer)
renderRoadbookReportLoading(roadbookReportContainer)
renderWeatherSummaryLoading(tripPlanContainer)
renderWeatherDetailLoading(weatherPanel)
renderToday()
updateStageSummaries()
if (window.location.hash === '') window.location.replace('#/today')
else syncHash()

const unsubscribeWeather = weatherCoordinator.subscribe((snapshot) => {
  currentWeatherSnapshot = snapshot
  currentWeatherError = null
  renderCurrentWeatherSelection()
  if (currentTripTimeline !== null) {
    const selectedDay = getTripTimelineDay(currentTripTimeline, selectedDayId)
    if (selectedDay !== null) {
      renderSelectedRouteTimeline(
        selectedDay,
        getAccommodationForDay(currentAccommodations, selectedDayId),
      )
    }
  }
  renderToday()
})

window.addEventListener('beforeunload', () => {
  unbindNetworkStatus()
  unsubscribeWeather()
  weatherCoordinator.dispose()
})

void loadRoadbookResources()
  .then((resources) => {
    currentRoadbookResources = resources
    currentRoadbookError = currentGpxError
    refreshRoadbookIntegration()
  })
  .catch((error: unknown) => {
    currentRoadbookResources = null
    currentRoadbookReport = null
    currentRoadbookError = error
    currentWeatherError = error
    renderDayInfosError(roadbookDetailContainer, error)
    renderRoadbookReportError(roadbookReportContainer, error)
    renderCurrentWeatherSelection()
  })

void loadAccommodations()
  .then((accommodations) => {
    currentAccommodations = accommodations
    renderAccommodation(accommodationContainer, getAccommodationForDay(accommodations, selectedDayId))
    renderToday()
  })
  .catch(() => {
    currentAccommodations = []
    renderAccommodation(accommodationContainer, null)
    renderToday()
  })

void loadPracticalData(import.meta.env.BASE_URL)
  .then((data) => {
    currentPracticalData = data
    if (currentTripTimeline !== null) renderCurrentTripSelection()
  })
  .catch(() => {
    currentPracticalData = null
  })

void initializeGpxAnalysis(gpxAnalysisContainer, rga2026TripPlan.rideDays).then((report) => {
  if (report === null) {
    const error = new Error('L’analyse GPX doit réussir avant de calculer les journées roulées.')
    currentGpxError = error
    renderTripPlanError(tripPlanContainer, rga2026TripPlan, selectedDayId, error)
    renderRouteEngineError(routeEngineContainer, error)
    renderDayInfosError(roadbookDetailContainer, error)
    renderRoadbookReportError(roadbookReportContainer, error)
    currentWeatherError = error
    renderCurrentWeatherSelection()
    return
  }

  try {
    currentGpxReport = report
    currentGpxError = null
    currentTripProfile = buildTripProfile(rga2026TripPlan, report.files)
    refreshTripTimeline()
  } catch (error) {
    currentGpxError = error
    renderTripPlanError(tripPlanContainer, rga2026TripPlan, selectedDayId, error)
    renderRouteEngineError(routeEngineContainer, error)
    renderDayInfosError(roadbookDetailContainer, error)
    renderRoadbookReportError(roadbookReportContainer, error)
    currentWeatherError = error
    renderCurrentWeatherSelection()
  }
})
