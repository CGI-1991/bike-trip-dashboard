export interface DashboardSettings {
  readonly referenceSpeedKph: number
  readonly departureTime: string
  readonly totalBreakMinutes: number
}

export const settingsStorageKey = 'bike-trip-dashboard.settings.v1'

export const defaultSettings: DashboardSettings = {
  referenceSpeedKph: 18,
  departureTime: '08:00',
  totalBreakMinutes: 60,
}

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseSettings(value: unknown): DashboardSettings | null {
  if (!isRecord(value)) {
    return null
  }

  const referenceSpeedKph = value.referenceSpeedKph ?? value.averageSpeedKph
  const { departureTime, totalBreakMinutes } = value

  if (!(
    typeof referenceSpeedKph === 'number' &&
    Number.isFinite(referenceSpeedKph) &&
    referenceSpeedKph >= 8 &&
    referenceSpeedKph <= 40 &&
    typeof departureTime === 'string' &&
    timePattern.test(departureTime) &&
    typeof totalBreakMinutes === 'number' &&
    Number.isInteger(totalBreakMinutes) &&
    totalBreakMinutes >= 0 &&
    totalBreakMinutes <= 240
  )) return null
  return { referenceSpeedKph, departureTime, totalBreakMinutes }
}

export function loadSettings(storage: Storage = window.localStorage): DashboardSettings {
  try {
    const storedValue = storage.getItem(settingsStorageKey)

    if (storedValue === null) {
      return { ...defaultSettings }
    }

    const parsedValue: unknown = JSON.parse(storedValue)
    return parseSettings(parsedValue) ?? { ...defaultSettings }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(
  settings: DashboardSettings,
  storage: Storage = window.localStorage,
): boolean {
  if (parseSettings(settings) === null) {
    return false
  }

  try {
    storage.setItem(settingsStorageKey, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}
