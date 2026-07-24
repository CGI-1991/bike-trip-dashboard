export interface DashboardSettings {
  readonly averageSpeedKph: number
  readonly departureTime: string
  readonly totalBreakMinutes: number
}

export const settingsStorageKey = 'rga-2026-dashboard.settings.v1'

export const defaultSettings: DashboardSettings = {
  averageSpeedKph: 18,
  departureTime: '08:00',
  totalBreakMinutes: 60,
}

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValidSettings(value: unknown): value is DashboardSettings {
  if (!isRecord(value)) {
    return false
  }

  const { averageSpeedKph, departureTime, totalBreakMinutes } = value

  return (
    typeof averageSpeedKph === 'number' &&
    Number.isFinite(averageSpeedKph) &&
    averageSpeedKph >= 8 &&
    averageSpeedKph <= 40 &&
    typeof departureTime === 'string' &&
    timePattern.test(departureTime) &&
    typeof totalBreakMinutes === 'number' &&
    Number.isInteger(totalBreakMinutes) &&
    totalBreakMinutes >= 0 &&
    totalBreakMinutes <= 240
  )
}

export function loadSettings(storage: Storage = window.localStorage): DashboardSettings {
  try {
    const storedValue = storage.getItem(settingsStorageKey)

    if (storedValue === null) {
      return { ...defaultSettings }
    }

    const parsedValue: unknown = JSON.parse(storedValue)
    return isValidSettings(parsedValue) ? parsedValue : { ...defaultSettings }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(
  settings: DashboardSettings,
  storage: Storage = window.localStorage,
): boolean {
  if (!isValidSettings(settings)) {
    return false
  }

  try {
    storage.setItem(settingsStorageKey, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}
