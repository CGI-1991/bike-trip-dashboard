import { defaultSettings, loadSettings, settingsStorageKey } from './settings.ts'
import type { DashboardSettings } from './settings.ts'
import type { RideDayId } from '../trip/types.ts'

export interface RideDaySettings {
  readonly dayId: RideDayId
  readonly departureTime: string
  readonly totalBreakMinutes: number
}

export interface RideDaySettingsDocument {
  readonly version: 2
  readonly referenceSpeedKph: number
  readonly days: readonly RideDaySettings[]
}

export const rideDaySettingsStorageKey = 'rga-2026-dashboard.ride-day-settings.v2'
export const legacyRideDaySettingsStorageKey = 'rga-2026-dashboard.ride-day-settings.v1'

/** Every ride day gets exactly one entry; OFF days J5 and J8 never do. */
export const rideDaySettingsDayIds: readonly RideDayId[] = [
  'J1', 'J2', 'J3', 'J4', 'J6', 'J7', 'J9', 'J10', 'J11', 'J12',
]

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValidReferenceSpeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 8 && value <= 40
}

function parseDayValues(value: unknown, dayId: RideDayId, fallback: DashboardSettings): RideDaySettings {
  if (!isRecord(value) || value.dayId !== dayId) return createRideDaySettings(dayId, fallback)
  const departureTime = typeof value.departureTime === 'string' && timePattern.test(value.departureTime)
    ? value.departureTime
    : fallback.departureTime
  const totalBreakMinutes = typeof value.totalBreakMinutes === 'number' && Number.isInteger(value.totalBreakMinutes) && value.totalBreakMinutes >= 0 && value.totalBreakMinutes <= 240
    ? value.totalBreakMinutes
    : fallback.totalBreakMinutes
  return { dayId, departureTime, totalBreakMinutes }
}

export function createRideDaySettings(dayId: RideDayId, base: DashboardSettings = defaultSettings): RideDaySettings {
  return { dayId, departureTime: base.departureTime, totalBreakMinutes: base.totalBreakMinutes }
}

export function createDefaultRideDaySettingsDocument(base: DashboardSettings = defaultSettings): RideDaySettingsDocument {
  return {
    version: 2,
    referenceSpeedKph: base.referenceSpeedKph,
    days: rideDaySettingsDayIds.map((dayId) => createRideDaySettings(dayId, base)),
  }
}

export function getRideDaySettings(document: RideDaySettingsDocument, dayId: RideDayId): RideDaySettings {
  return document.days.find((day) => day.dayId === dayId) ?? createRideDaySettings(dayId)
}

export function upsertRideDaySettings(document: RideDaySettingsDocument, settings: RideDaySettings): RideDaySettingsDocument {
  return {
    ...document,
    days: rideDaySettingsDayIds.map((dayId) => dayId === settings.dayId ? settings : getRideDaySettings(document, dayId)),
  }
}

export function updateReferenceSpeed(document: RideDaySettingsDocument, referenceSpeedKph: number): RideDaySettingsDocument {
  return isValidReferenceSpeed(referenceSpeedKph) ? { ...document, referenceSpeedKph } : document
}

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : sorted[middle] as number
}

function parseDocument(value: unknown, fallback: DashboardSettings): RideDaySettingsDocument | null {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.days)) return null
  const byDayId = new Map<string, unknown>()
  for (const raw of value.days) if (isRecord(raw) && typeof raw.dayId === 'string') byDayId.set(raw.dayId, raw)
  return {
    version: 2,
    referenceSpeedKph: isValidReferenceSpeed(value.referenceSpeedKph) ? value.referenceSpeedKph : fallback.referenceSpeedKph,
    days: rideDaySettingsDayIds.map((dayId) => parseDayValues(byDayId.get(dayId), dayId, fallback)),
  }
}

function migrateLegacyDocument(value: unknown, fallback: DashboardSettings, preferGlobalSpeed: boolean): RideDaySettingsDocument {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.days)) return createDefaultRideDaySettingsDocument(fallback)
  const byDayId = new Map<string, unknown>()
  const legacySpeeds: number[] = []
  for (const raw of value.days) {
    if (!isRecord(raw) || typeof raw.dayId !== 'string') continue
    byDayId.set(raw.dayId, raw)
    if (isValidReferenceSpeed(raw.averageSpeedKph)) legacySpeeds.push(raw.averageSpeedKph)
    else if (isValidReferenceSpeed(raw.referenceSpeedKph)) legacySpeeds.push(raw.referenceSpeedKph)
  }
  return {
    version: 2,
    referenceSpeedKph: preferGlobalSpeed ? fallback.referenceSpeedKph : (median(legacySpeeds) ?? fallback.referenceSpeedKph),
    days: rideDaySettingsDayIds.map((dayId) => parseDayValues(byDayId.get(dayId), dayId, fallback)),
  }
}

export function loadRideDaySettings(storage: Storage = window.localStorage): RideDaySettingsDocument {
  try {
    const fallback = loadSettings(storage)
    const storedValue = storage.getItem(rideDaySettingsStorageKey)
    if (storedValue !== null) return parseDocument(JSON.parse(storedValue), fallback) ?? createDefaultRideDaySettingsDocument(fallback)
    const legacyValue = storage.getItem(legacyRideDaySettingsStorageKey)
    if (legacyValue !== null) return migrateLegacyDocument(JSON.parse(legacyValue), fallback, storage.getItem(settingsStorageKey) !== null)
    return createDefaultRideDaySettingsDocument(fallback)
  } catch {
    return createDefaultRideDaySettingsDocument(defaultSettings)
  }
}

export function saveRideDaySettings(document: RideDaySettingsDocument, storage: Storage = window.localStorage): boolean {
  if (
    document.version !== 2 ||
    !isValidReferenceSpeed(document.referenceSpeedKph) ||
    document.days.length !== rideDaySettingsDayIds.length ||
    !rideDaySettingsDayIds.every((dayId, index) => document.days[index]?.dayId === dayId) ||
    !document.days.every((day) => parseDayValues(day, day.dayId, defaultSettings).departureTime === day.departureTime && parseDayValues(day, day.dayId, defaultSettings).totalBreakMinutes === day.totalBreakMinutes)
  ) return false
  try {
    storage.setItem(rideDaySettingsStorageKey, JSON.stringify(document))
    return true
  } catch {
    return false
  }
}
