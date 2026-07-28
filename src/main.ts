import './style.css'
import type { GpxAnalysisReport } from './gpx/types.ts'
import { defaultSettings } from './storage/settings.ts'
import {
  applyRideDaySettingsToAllDays,
  getRideDaySettings,
  loadRideDaySettings,
  saveRideDaySettings,
  upsertRideDaySettings,
} from './storage/ride-day-settings.ts'
import type { RideDaySettings, RideDaySettingsDocument } from './storage/ride-day-settings.ts'
import { getDateInTimezone, getTripDate } from './trip/calendar.ts'
import { WeatherCache } from './weather/cache.ts'
import { WeatherCoordinator } from './weather/coordinator.ts'
import { weatherConfig } from './weather/config.ts'
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
import { renderDashboard } from './ui/render.ts'
import { renderDayHeader } from './ui/day-header.ts'
import { getTripPeriod, hashForDay, parseAppHash } from './ui/app-state.ts'
import type { AppView } from './ui/app-state.ts'
import {
  renderRoadbookDayDetail,
  renderRoadbookDetailError,
  renderRoadbookDetailLoading,
} from './ui/roadbook-detail.ts'
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
import { closeExpandedRouteMap, renderRouteMap } from './ui/route-map.ts'
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
let currentRoadbookResources: RoadbookResources | null = null
let currentAccommodations: readonly Accommodation[] = []
let currentRoadbookReport: RoadbookMatchReport | null = null
let currentRoadbookError: unknown = null
let currentGpxError: unknown = null
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

const saveStatus = getRequiredElement<HTMLElement>('#save-status')
const dayIndicator = getRequiredElement<HTMLElement>('[data-day-indicator]')
const todayPanel = getRequiredElement<HTMLElement>('[data-today-panel]')
const dayHeaderContainer = getRequiredElement<HTMLElement>('[data-day-header]')
const tripPlanContainer = getRequiredElement<HTMLElement>('[data-trip-plan]')
const routeEngineContainer = getRequiredElement<HTMLElement>('[data-route-engine]')
const roadbookDetailContainer = getRequiredElement<HTMLElement>('[data-roadbook-detail]')
const accommodationContainer = getRequiredElement<HTMLElement>('[data-accommodation-card]')
const gpxDownload = getRequiredElement<HTMLAnchorElement>('[data-gpx-download]')
const routeMapContainer = getRequiredElement<HTMLElement>('[data-route-map]')
const routeMapDialog = getRequiredElement<HTMLDialogElement>('[data-route-map-dialog]')
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
const dayAverageSpeedInput = getRequiredElement<HTMLInputElement>('[data-day-average-speed]')
const dayTotalBreakInput = getRequiredElement<HTMLInputElement>('[data-day-total-break]')
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
  timelineDay: TripDayTimeline | null,
): void {
  if (currentRoadbookReport === null) {
    if (currentRoadbookError === null) {
      renderRoadbookDetailLoading(roadbookDetailContainer)
    } else {
      renderRoadbookDetailError(roadbookDetailContainer, currentRoadbookError)
    }
    return
  }

  const dayMatch = getRoadbookDayMatch(selectedDayId)

  if (dayMatch === null) {
    renderRoadbookDetailError(
      roadbookDetailContainer,
      new Error(`Journée roadbook introuvable : ${selectedDayId}`),
    )
    return
  }

  renderRoadbookDayDetail(roadbookDetailContainer, dayMatch, timelineDay)
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
    renderRoadbookDetailError(roadbookDetailContainer, error)
    renderWeatherDetailError(weatherPanel, error)
    return
  }

  renderTripTimeline(tripPlanContainer, currentTripTimeline, selectedDayId)
  const accommodation = getAccommodationForDay(currentAccommodations, selectedDayId)
  renderTripDayRouteTimeline(routeEngineContainer, selectedDay, currentRoadbookReport, accommodation)
  renderAccommodation(accommodationContainer, accommodation)
  if (selectedDay.type === 'ride' && selectedDay.status === 'ready') {
    const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
    gpxDownload.href = `${base}data/gpx/${encodeURIComponent(selectedDay.day.gpxFile)}`
    gpxDownload.download = `${selectedDay.day.id}-${selectedDay.day.startName}-${selectedDay.day.endName}.gpx`
    gpxDownload.hidden = false
    const gpx = currentGpxReport?.files.find((file) => file.status === 'success' && file.source.fileName === selectedDay.day.gpxFile)
    const successfulGpx = gpx?.status === 'success' ? gpx : null
    renderRouteMap(routeMapContainer, routeMapDialog, successfulGpx, selectedDay, currentRoadbookReport, accommodation)
    renderElevationProfile(elevationProfileContainer, successfulGpx, selectedDay, currentRoadbookReport, accommodation)
  } else {
    gpxDownload.hidden = true
    gpxDownload.removeAttribute('href')
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
  const period = getTripPeriod(new Date())
  const dayId = period.dayId
  const timelineDay = currentTripTimeline === null ? null : getTripTimelineDay(currentTripTimeline, dayId)
  const day = rga2026TripPlan.days.find(({ id }) => id === dayId) ?? rga2026TripPlan.days[0]
  const date = getTripDate(day.dayNumber)
  const intro = period.kind === 'before' ? `${period.daysUntilStart} jours avant le départ` : period.kind === 'after' ? 'Voyage terminé' : 'Étape du jour'
  const route = day.type === 'ride' ? `${day.startName} → ${day.endName}` : `${day.title} · ${day.locationName}`
  let metrics = ''
  if (timelineDay?.type === 'ride' && timelineDay.status === 'ready') {
    const arrivalMinutes = timelineDay.arrivalTime.clockMinutes
    const arrival = `${String(Math.floor(arrivalMinutes / 60)).padStart(2, '0')}:${String(arrivalMinutes % 60).padStart(2, '0')}`
    metrics = `<dl class="today-metrics"><div><dt>Distance</dt><dd>${timelineDay.route.summary.distanceKm.toFixed(1)} km</dd></div><div><dt>D+</dt><dd>${Math.round(timelineDay.route.summary.elevationGainM)} m</dd></div><div><dt>Départ</dt><dd>${timelineDay.startTime}</dd></div><div><dt>ETA</dt><dd>${timelineDay.arrivalTime.dayOffset === 0 ? '' : `J+${timelineDay.arrivalTime.dayOffset} `}${arrival}</dd></div></dl>`
  }
  const weather = currentWeatherSnapshot.states.get(dayId)
  const availability = weather === undefined ? 'Prévision en attente' : weatherStateLabels[weather.availability]
  const weatherSlot = tripPlanContainer.querySelector<HTMLElement>(
    `[data-trip-day-weather="${dayId}"]`,
  )
  const weatherLines = weatherSlot === null
    ? []
    : [...weatherSlot.querySelectorAll<HTMLElement>('.trip-day__weather-line')]
        .map(({ textContent }) => textContent?.trim() ?? '')
        .filter((line) => line.length > 0)
  const riskLevel = weatherSlot?.dataset.weatherRiskLevel
  const riskLabel =
    riskLevel === 'green'
      ? 'Vert'
      : riskLevel === 'orange'
        ? 'Orange'
        : riskLevel === 'red'
          ? 'Rouge'
          : availability
  const primaryAlert =
    (riskLevel === 'orange' || riskLevel === 'red') && weatherLines[0] !== undefined
      ? `<p class="today-alert"><strong>Alerte principale</strong><span>${weatherLines[0]}</span></p>`
      : ''
  const recommendation =
    weatherLines[2] === undefined
      ? ''
      : `<p class="today-recommendation"><strong>Recommandation</strong><span>${weatherLines[2]}</span></p>`
  const nextWaypoint =
    selectedDayId === dayId
      ? weatherPanel.querySelector<HTMLElement>('.weather-waypoint--next')?.textContent?.trim()
      : undefined
  const nextPoint =
    nextWaypoint === undefined || nextWaypoint.length === 0
      ? ''
      : `<p class="today-next-point"><strong>Prochain point théorique</strong><span>${nextWaypoint}</span></p>`
  todayPanel.dataset.todayState = period.kind
  todayPanel.innerHTML = `<p class="eyebrow">${intro}</p><h3>${day.id} · <time datetime="${date}">${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: rga2026TripPlan.timezone }).format(new Date(`${date}T12:00:00Z`))}</time></h3><p class="today-route">${route}</p>${metrics}<div class="today-weather"><strong>Météo</strong><span>${riskLabel}</span><small>Mode météo selon l’horizon${period.kind === 'before' && weather?.availability === 'outside-horizon' ? ' · Aujourd’hui sur le parcours, pas la prévision du voyage' : ''}</small></div>${primaryAlert}${recommendation}${nextPoint}<a class="button button--primary button--full" href="${hashForDay(day.id)}">Voir la journée</a>`
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

function getDaySettings(dayId: RideDayId): RideDaySettings {
  return getRideDaySettings(currentRideDaySettings, dayId)
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
    renderRoadbookDetailError(roadbookDetailContainer, error)
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
    const speed = stage.querySelector<HTMLElement>('[data-stage-speed]')
    const breaks = stage.querySelector<HTMLElement>('[data-stage-breaks]')
    const planLabel = stage.querySelector<HTMLElement>('[data-stage-plan]')
    if (departure !== null) departure.textContent = settings.departureTime
    if (speed !== null) speed.textContent = `${settings.averageSpeedKph} km/h`
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
  const anchors = createContextualPauseAnchors(profileDay.routeProfile, settings.averageSpeedKph, getPausePlaces(dayId))
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
    averageSpeedKph: dayAverageSpeedInput.valueAsNumber,
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
  dayAverageSpeedInput.value = String(daySettingsDraft.averageSpeedKph)
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
for (const input of [dayDepartureTimeInput, dayAverageSpeedInput, dayTotalBreakInput]) input.addEventListener('input', () => {
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
getRequiredElement<HTMLButtonElement>('[data-restore-day-settings]').addEventListener('click', () => {
  if (pauseDraft === null) return
  daySettingsDraft = { dayId: pauseDraft.dayId, ...defaultSettings }
  if (pauseDraft.mode === 'automatic') {
    pauseDraft = createAutomaticPauseDraft(pauseDraft.dayId, daySettingsDraft) ?? pauseDraft
  }
  renderPauseEditor()
  pauseFeedback.textContent = 'Valeurs par défaut restaurées dans le formulaire. Enregistrez pour confirmer.'
})
getRequiredElement<HTMLButtonElement>('[data-apply-all-days]').addEventListener('click', () => {
  if (pauseDraft === null) return
  const settings = readDaySettingsFromForm(pauseDraft.dayId)
  const next = applyRideDaySettingsToAllDays({ averageSpeedKph: settings.averageSpeedKph, departureTime: settings.departureTime, totalBreakMinutes: settings.totalBreakMinutes })
  if (!saveRideDaySettings(next)) { pauseFeedback.textContent = 'Enregistrement impossible dans ce navigateur.'; return }
  currentRideDaySettings = next
  refreshTripTimeline()
  updateStageSummaries()
  pauseFeedback.textContent = 'Valeurs appliquées à toutes les étapes et ETA recalculées.'
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

for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-day-tab]')) {
  tab.addEventListener('click', () => {
    const requested = tab.dataset.dayTab
    for (const panel of document.querySelectorAll<HTMLElement>('[data-day-panel]')) {
      panel.hidden = panel.dataset.dayPanel !== requested
    }
    for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-day-tab]')) {
      candidate.setAttribute('aria-selected', String(candidate === tab))
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
renderRoadbookDetailLoading(roadbookDetailContainer)
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
  renderToday()
})

window.addEventListener('beforeunload', () => {
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
    renderRoadbookDetailError(roadbookDetailContainer, error)
    renderRoadbookReportError(roadbookReportContainer, error)
    renderCurrentWeatherSelection()
  })

void loadAccommodations()
  .then((accommodations) => {
    currentAccommodations = accommodations
    renderAccommodation(accommodationContainer, getAccommodationForDay(accommodations, selectedDayId))
  })
  .catch(() => {
    currentAccommodations = []
    renderAccommodation(accommodationContainer, null)
  })

void initializeGpxAnalysis(gpxAnalysisContainer, rga2026TripPlan.rideDays).then((report) => {
  if (report === null) {
    const error = new Error('L’analyse GPX doit réussir avant de calculer les journées roulées.')
    currentGpxError = error
    renderTripPlanError(tripPlanContainer, rga2026TripPlan, selectedDayId, error)
    renderRouteEngineError(routeEngineContainer, error)
    renderRoadbookDetailError(roadbookDetailContainer, error)
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
    renderRoadbookDetailError(roadbookDetailContainer, error)
    renderRoadbookReportError(roadbookReportContainer, error)
    currentWeatherError = error
    renderCurrentWeatherSelection()
  }
})
