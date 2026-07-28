import { defaultSettings, loadSettings } from './settings.ts'
import type { DashboardSettings } from './settings.ts'
import type { RideDayId } from '../trip/types.ts'

export interface RideDaySettings {
  readonly dayId: RideDayId
  readonly averageSpeedKph: number
  readonly departureTime: string
  readonly totalBreakMinutes: number
}

export interface RideDaySettingsDocument {
  readonly version: 1
  readonly days: readonly RideDaySettings[]
}

export const rideDaySettingsStorageKey = 'rga-2026-dashboard.ride-day-settings.v1'

/** Every ride day gets exactly one entry — the two OFF days (J5, J8) never have one. */
export const rideDaySettingsDayIds: readonly RideDayId[] = [
  'J1', 'J2', 'J3', 'J4', 'J6', 'J7', 'J9', 'J10', 'J11', 'J12',
]

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValidRideDaySettingsValues(value: unknown): value is Omit<RideDaySettings, 'dayId'> {
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

function isValidRideDaySettings(value: unknown, dayId: RideDayId): value is RideDaySettings {
  return isRecord(value) && value.dayId === dayId && isValidRideDaySettingsValues(value)
}

export function createRideDaySettings(
  dayId: RideDayId,
  base: DashboardSettings = defaultSettings,
): RideDaySettings {
  return { dayId, ...base }
}

export function createDefaultRideDaySettingsDocument(
  base: DashboardSettings = defaultSettings,
): RideDaySettingsDocument {
  return {
    version: 1,
    days: rideDaySettingsDayIds.map((dayId) => createRideDaySettings(dayId, base)),
  }
}

export function getRideDaySettings(
  document: RideDaySettingsDocument,
  dayId: RideDayId,
): RideDaySettings {
  return document.days.find((day) => day.dayId === dayId) ?? createRideDaySettings(dayId)
}

export function upsertRideDaySettings(
  document: RideDaySettingsDocument,
  settings: RideDaySettings,
): RideDaySettingsDocument {
  const days = rideDaySettingsDayIds.map((dayId) =>
    dayId === settings.dayId ? settings : getRideDaySettings(document, dayId),
  )
  return { version: 1, days }
}

/**
 * "Appliquer ces valeurs à toutes les étapes" — an explicit, user-triggered
 * action only. Never applied automatically when a single day is edited.
 */
export function applyRideDaySettingsToAllDays(
  values: Omit<RideDaySettings, 'dayId'>,
): RideDaySettingsDocument {
  return {
    version: 1,
    days: rideDaySettingsDayIds.map((dayId) => ({ dayId, ...values })),
  }
}

export function restoreDefaultRideDaySettings(
  document: RideDaySettingsDocument,
  dayId: RideDayId,
  base: DashboardSettings = defaultSettings,
): RideDaySettingsDocument {
  return upsertRideDaySettings(document, createRideDaySettings(dayId, base))
}

/**
 * Tolerant parsing: an invalid entry for one day falls back to the default for
 * that day only — the other nine days are never wiped out by one bad value.
 */
function parseRideDaySettingsDocument(
  value: unknown,
  base: DashboardSettings,
): RideDaySettingsDocument | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.days)) {
    return null
  }

  const byDayId = new Map<string, unknown>()
  for (const raw of value.days) {
    if (isRecord(raw) && typeof raw.dayId === 'string') {
      byDayId.set(raw.dayId, raw)
    }
  }

  const days = rideDaySettingsDayIds.map((dayId) => {
    const raw = byDayId.get(dayId)
    return isValidRideDaySettings(raw, dayId) ? raw : createRideDaySettings(dayId, base)
  })

  return { version: 1, days }
}

/**
 * First load after this update: no `ride-day-settings.v1` entry yet exists, so
 * the legacy global `DashboardSettings` (`settings.v1`) becomes the initial
 * value for every ride day — the user's prior preferences are never lost.
 */
export function loadRideDaySettings(
  storage: Storage = window.localStorage,
): RideDaySettingsDocument {
  try {
    const storedValue = storage.getItem(rideDaySettingsStorageKey)

    if (storedValue === null) {
      return createDefaultRideDaySettingsDocument(loadSettings(storage))
    }

    const parsedValue: unknown = JSON.parse(storedValue)
    return (
      parseRideDaySettingsDocument(parsedValue, loadSettings(storage)) ??
      createDefaultRideDaySettingsDocument(loadSettings(storage))
    )
  } catch {
    return createDefaultRideDaySettingsDocument(defaultSettings)
  }
}

export function saveRideDaySettings(
  document: RideDaySettingsDocument,
  storage: Storage = window.localStorage,
): boolean {
  if (
    document.version !== 1 ||
    document.days.length !== rideDaySettingsDayIds.length ||
    !rideDaySettingsDayIds.every((dayId, index) => document.days[index]?.dayId === dayId) ||
    !document.days.every((day) => isValidRideDaySettingsValues(day))
  ) {
    return false
  }

  try {
    storage.setItem(rideDaySettingsStorageKey, JSON.stringify(document))
    return true
  } catch {
    return false
  }
}
