import './style.css'
import { loadSettings, saveSettings } from './storage/settings.ts'
import type { DashboardSettings } from './storage/settings.ts'
import { isTripDayId, rga2026TripPlan } from './trip/plan.ts'
import {
  buildTripProfile,
  getTripTimelineDay,
  scheduleTripTimeline,
} from './trip/timeline.ts'
import type {
  TripDayId,
  TripProfile,
  TripTimeline,
} from './trip/types.ts'
import { initializeGpxAnalysis } from './ui/gpx-analysis.ts'
import { renderDashboard } from './ui/render.ts'
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
let selectedDayId: TripDayId = 'J1'

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
const gpxAnalysisContainer = getRequiredElement<HTMLElement>('[data-gpx-analysis]')

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

function renderCurrentTripSelection(restoreFocus = false): void {
  if (currentTripTimeline === null) {
    updatePendingTripSelection()

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
    return
  }

  renderTripTimeline(tripPlanContainer, currentTripTimeline, selectedDayId)
  renderTripDayRouteTimeline(routeEngineContainer, selectedDay)
  dayIndicator.textContent = `${selectedDay.day.id} sur ${rga2026TripPlan.totalDays} · ${
    selectedDay.type === 'off' ? 'OFF' : 'Roulé'
  }`

  if (restoreFocus) {
    focusSelectedTripDay()
  }
}

function refreshTripTimeline(): void {
  if (currentTripProfile === null) {
    return
  }

  try {
    currentTripTimeline = scheduleTripTimeline(currentTripProfile, currentSettings)
    renderCurrentTripSelection()
  } catch (error) {
    currentTripTimeline = null
    renderTripPlanError(tripPlanContainer, rga2026TripPlan, selectedDayId, error)
    renderRouteEngineError(routeEngineContainer, error)
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
  renderCurrentTripSelection(true)
})

renderTripPlanLoading(tripPlanContainer, rga2026TripPlan, selectedDayId)
renderRouteEngineLoading(routeEngineContainer)

void initializeGpxAnalysis(gpxAnalysisContainer, rga2026TripPlan.rideDays).then((report) => {
  if (report === null) {
    const error = new Error('L’analyse GPX doit réussir avant de calculer les journées roulées.')
    renderTripPlanError(tripPlanContainer, rga2026TripPlan, selectedDayId, error)
    renderRouteEngineError(routeEngineContainer, error)
    return
  }

  try {
    currentTripProfile = buildTripProfile(rga2026TripPlan, report.files)
    refreshTripTimeline()
  } catch (error) {
    renderTripPlanError(tripPlanContainer, rga2026TripPlan, selectedDayId, error)
    renderRouteEngineError(routeEngineContainer, error)
  }
})
