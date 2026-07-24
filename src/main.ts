import './style.css'
import { demoStages } from './data/demo.ts'
import { loadSettings, saveSettings } from './storage/settings.ts'
import type { DashboardSettings } from './storage/settings.ts'
import { initializeGpxAnalysis } from './ui/gpx-analysis.ts'
import { renderDashboard } from './ui/render.ts'

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (element === null) {
    throw new Error(`Élément requis introuvable : ${selector}`)
  }

  return element
}

let currentSettings = loadSettings()

const app = getRequiredElement<HTMLDivElement>('#app')
app.innerHTML = renderDashboard(currentSettings)

const settingsButton = getRequiredElement<HTMLButtonElement>('[data-open-settings]')
const closeSettingsButton = getRequiredElement<HTMLButtonElement>('[data-close-settings]')
const settingsDialog = getRequiredElement<HTMLDialogElement>('#settings-dialog')
const settingsForm = getRequiredElement<HTMLFormElement>('#settings-form')
const averageSpeedInput = getRequiredElement<HTMLInputElement>('#average-speed')
const departureTimeInput = getRequiredElement<HTMLInputElement>('#departure-time')
const breakDurationInput = getRequiredElement<HTMLInputElement>('#break-duration')
const departureDisplay = getRequiredElement<HTMLElement>('[data-departure-display]')
const saveStatus = getRequiredElement<HTMLElement>('#save-status')
const settingsFeedback = getRequiredElement<HTMLElement>('#settings-feedback')

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
  departureDisplay.textContent = currentSettings.departureTime
  saveStatus.textContent = 'Réglages enregistrés.'
  closeSettings()
})

const gpxAnalysisContainer = getRequiredElement<HTMLElement>('[data-gpx-analysis]')
void initializeGpxAnalysis(gpxAnalysisContainer, demoStages.length)
