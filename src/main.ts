import './style.css'
import type { GpxAnalysisReport } from './gpx/types.ts'
import { loadSettings, saveSettings } from './storage/settings.ts'
import type { DashboardSettings } from './storage/settings.ts'
import { getDateInTimezone } from './trip/calendar.ts'
import { WeatherCache } from './weather/cache.ts'
import { WeatherCoordinator } from './weather/coordinator.ts'
import { weatherConfig } from './weather/config.ts'
import { isTripDateInPast } from './weather/display-policy.ts'
import { createOpenMeteoProvider } from './weather/open-meteo.ts'
import type { WeatherDayState, WeatherSnapshot } from './weather/types.ts'
import { isTripDayId, rga2026TripPlan } from './trip/plan.ts'
import { loadRoadbookResources } from './trip/roadbook-loader.ts'
import {
  applyRoadbookPauseMatches,
  buildRoadbookMatchReport,
} from './trip/roadbook-match.ts'
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
  TripDayTimeline,
  TripDayId,
  TripProfile,
  TripTimeline,
} from './trip/types.ts'
import { initializeGpxAnalysis } from './ui/gpx-analysis.ts'
import { renderDashboard } from './ui/render.ts'
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

let currentSettings = loadSettings()
let currentTripProfile: TripProfile | null = null
let currentTripTimeline: TripTimeline | null = null
let currentGpxReport: GpxAnalysisReport | null = null
let currentRoadbookResources: RoadbookResources | null = null
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
app.innerHTML = renderDashboard(currentSettings, rga2026TripPlan)

const settingsButton = getRequiredElement<HTMLButtonElement>('[data-open-settings]')
const closeSettingsButton = getRequiredElement<HTMLButtonElement>('[data-close-settings]')
const settingsDialog = getRequiredElement<HTMLDialogElement>('#settings-dialog')
const settingsForm = getRequiredElement<HTMLFormElement>('#settings-form')
const averageSpeedInput = getRequiredElement<HTMLInputElement>('#average-speed')
const departureTimeInput = getRequiredElement<HTMLInputElement>('#departure-time')
const breakDurationInput = getRequiredElement<HTMLInputElement>('#break-duration')
const saveStatus = getRequiredElement<HTMLElement>('#save-status')
const settingsFeedback = getRequiredElement<HTMLElement>('#settings-feedback')
const dayIndicator = getRequiredElement<HTMLElement>('[data-day-indicator]')
const tripPlanContainer = getRequiredElement<HTMLElement>('[data-trip-plan]')
const routeEngineContainer = getRequiredElement<HTMLElement>('[data-route-engine]')
const roadbookDetailContainer = getRequiredElement<HTMLElement>('[data-roadbook-detail]')
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
  } catch (error) {
    currentWeatherError = error
    renderWeatherSummaryError(tripPlanContainer, error)
    renderWeatherDetailError(weatherPanel, error)
    renderWeatherChrome(null)
  }
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
  renderTripDayRouteTimeline(routeEngineContainer, selectedDay, currentRoadbookReport)
  renderCurrentRoadbookSelection(selectedDay)
  renderCurrentWeatherSelection()
  dayIndicator.textContent = `${selectedDay.day.id} sur ${rga2026TripPlan.totalDays} · ${
    selectedDay.type === 'off' ? 'OFF' : 'Roulé'
  }`

  if (restoreFocus) {
    focusSelectedTripDay()
  }
}

function applyMatchedRoadbookPauses(
  timeline: TripTimeline,
  report: RoadbookMatchReport,
): TripTimeline {
  const matchesByDayId = new Map(report.days.map((day) => [day.dayId, day]))
  let changed = false
  const days = timeline.days.map((dayTimeline): TripDayTimeline => {
    if (dayTimeline.type !== 'ride' || dayTimeline.status !== 'ready') {
      return dayTimeline
    }

    const dayMatch = matchesByDayId.get(dayTimeline.day.id)

    if (dayMatch?.type !== 'ride' || dayMatch.status !== 'ready') {
      return dayTimeline
    }

    const route = applyRoadbookPauseMatches(dayTimeline.route, dayMatch.points)

    if (route === dayTimeline.route) {
      return dayTimeline
    }

    changed = true
    return { ...dayTimeline, route }
  })

  return changed ? { ...timeline, days } : timeline
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
    let report = buildRoadbookMatchReport(
      roadbook,
      overrides,
      rga2026TripPlan,
      currentGpxReport.files,
      currentTripTimeline,
    )
    const integratedTimeline = applyMatchedRoadbookPauses(
      currentTripTimeline,
      report,
    )

    if (integratedTimeline !== currentTripTimeline) {
      currentTripTimeline = integratedTimeline
      report = buildRoadbookMatchReport(
        roadbook,
        overrides,
        rga2026TripPlan,
        currentGpxReport.files,
        integratedTimeline,
      )
    }

    currentRoadbookReport = report
    currentRoadbookError = null
    currentWeatherError = null
    weatherCoordinator.setContext(
      rga2026TripPlan,
      currentTripTimeline,
      report,
      selectedDayId,
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

function refreshTripTimeline(): void {
  if (currentTripProfile === null) {
    return
  }

  try {
    currentTripTimeline = scheduleTripTimeline(currentTripProfile, currentSettings)
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

function populateSettingsForm(settings: DashboardSettings): void {
  averageSpeedInput.value = String(settings.averageSpeedKph)
  departureTimeInput.value = settings.departureTime
  breakDurationInput.value = String(settings.totalBreakMinutes)
}

function readSettingsForm(): DashboardSettings {
  return {
    averageSpeedKph: averageSpeedInput.valueAsNumber,
    departureTime: departureTimeInput.value,
    totalBreakMinutes: breakDurationInput.valueAsNumber,
  }
}

function openSettings(): void {
  populateSettingsForm(currentSettings)
  settingsFeedback.textContent = ''
  settingsDialog.showModal()
  averageSpeedInput.focus()
}

function closeSettings(): void {
  settingsDialog.close()
}

settingsButton.addEventListener('click', openSettings)
closeSettingsButton.addEventListener('click', closeSettings)

settingsDialog.addEventListener('click', (event) => {
  if (event.target === settingsDialog) {
    closeSettings()
  }
})

settingsDialog.addEventListener('close', () => {
  settingsButton.focus()
})

settingsForm.addEventListener('submit', (event) => {
  event.preventDefault()

  if (!settingsForm.reportValidity()) {
    return
  }

  const nextSettings = readSettingsForm()

  if (!saveSettings(nextSettings)) {
    settingsFeedback.textContent = 'Enregistrement impossible dans ce navigateur.'
    return
  }

  currentSettings = nextSettings
  refreshTripTimeline()
  saveStatus.textContent = 'Réglages enregistrés et chronologies recalculées.'
  closeSettings()
})

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
  renderCurrentTripSelection(true)
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

const unsubscribeWeather = weatherCoordinator.subscribe((snapshot) => {
  currentWeatherSnapshot = snapshot
  currentWeatherError = null
  renderCurrentWeatherSelection()
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
