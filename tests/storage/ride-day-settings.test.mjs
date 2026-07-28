import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyRideDaySettingsToAllDays,
  createDefaultRideDaySettingsDocument,
  createRideDaySettings,
  getRideDaySettings,
  loadRideDaySettings,
  restoreDefaultRideDaySettings,
  rideDaySettingsDayIds,
  rideDaySettingsStorageKey,
  saveRideDaySettings,
  upsertRideDaySettings,
} from '../../src/storage/ride-day-settings.ts'
import { defaultSettings, saveSettings, settingsStorageKey } from '../../src/storage/settings.ts'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  }
}

test('exactly the ten ride days get a configuration — never J5 or J8', () => {
  assert.deepEqual([...rideDaySettingsDayIds].sort(), ['J1', 'J10', 'J11', 'J12', 'J2', 'J3', 'J4', 'J6', 'J7', 'J9'].sort())
  assert.equal(rideDaySettingsDayIds.includes('J5'), false)
  assert.equal(rideDaySettingsDayIds.includes('J8'), false)

  const document = createDefaultRideDaySettingsDocument()
  assert.equal(document.days.length, 10)
  assert.ok(document.days.every((day) => day.dayId !== 'J5' && day.dayId !== 'J8'))
})

test('J1 and J2 can independently carry different speed, departure time and total break', () => {
  let document = createDefaultRideDaySettingsDocument()
  document = upsertRideDaySettings(document, { dayId: 'J1', departureTime: '08:00', averageSpeedKph: 18, totalBreakMinutes: 30 })
  document = upsertRideDaySettings(document, { dayId: 'J2', departureTime: '07:30', averageSpeedKph: 16, totalBreakMinutes: 75 })

  const j1 = getRideDaySettings(document, 'J1')
  const j2 = getRideDaySettings(document, 'J2')
  assert.equal(j1.departureTime, '08:00')
  assert.equal(j1.averageSpeedKph, 18)
  assert.equal(j1.totalBreakMinutes, 30)
  assert.equal(j2.departureTime, '07:30')
  assert.equal(j2.averageSpeedKph, 16)
  assert.equal(j2.totalBreakMinutes, 75)
})

test('upserting J2 never changes J1 or any other day', () => {
  const before = createDefaultRideDaySettingsDocument()
  const after = upsertRideDaySettings(before, { dayId: 'J2', departureTime: '07:00', averageSpeedKph: 15, totalBreakMinutes: 90 })

  for (const dayId of rideDaySettingsDayIds) {
    if (dayId === 'J2') continue
    assert.deepEqual(getRideDaySettings(after, dayId), getRideDaySettings(before, dayId), `${dayId} must stay unchanged`)
  }
  assert.notDeepEqual(getRideDaySettings(after, 'J2'), getRideDaySettings(before, 'J2'))
})

test('migrates the legacy global DashboardSettings into every ride day on first load', () => {
  const storage = memoryStorage()
  saveSettings({ averageSpeedKph: 22, departureTime: '07:15', totalBreakMinutes: 45 }, storage)
  assert.equal(storage.values.has(rideDaySettingsStorageKey), false, 'no ride-day document exists yet')

  const migrated = loadRideDaySettings(storage)
  assert.equal(migrated.days.length, 10)
  for (const dayId of rideDaySettingsDayIds) {
    const day = getRideDaySettings(migrated, dayId)
    assert.equal(day.averageSpeedKph, 22)
    assert.equal(day.departureTime, '07:15')
    assert.equal(day.totalBreakMinutes, 45)
  }
})

test('a valid, already-migrated ride-day-settings.v1 document loads back unchanged', () => {
  const storage = memoryStorage()
  let document = createDefaultRideDaySettingsDocument()
  document = upsertRideDaySettings(document, { dayId: 'J1', departureTime: '08:00', averageSpeedKph: 18, totalBreakMinutes: 30 })
  document = upsertRideDaySettings(document, { dayId: 'J2', departureTime: '07:30', averageSpeedKph: 16, totalBreakMinutes: 75 })
  assert.equal(saveRideDaySettings(document, storage), true)

  const reloaded = loadRideDaySettings(storage)
  assert.deepEqual(reloaded, document)
})

test('falls back to the application defaults when neither document exists', () => {
  const storage = memoryStorage()
  const document = loadRideDaySettings(storage)
  for (const dayId of rideDaySettingsDayIds) {
    assert.deepEqual(getRideDaySettings(document, dayId), createRideDaySettings(dayId, defaultSettings))
  }
})

test('an invalid entry for a single day is restored to its default, the other nine keep their saved values', () => {
  const storage = memoryStorage()
  let document = createDefaultRideDaySettingsDocument()
  document = upsertRideDaySettings(document, { dayId: 'J3', departureTime: '06:45', averageSpeedKph: 20, totalBreakMinutes: 50 })
  assert.equal(saveRideDaySettings(document, storage), true)

  const raw = JSON.parse(storage.getItem(rideDaySettingsStorageKey))
  const corrupted = { ...raw, days: raw.days.map((day) => (day.dayId === 'J1' ? { ...day, averageSpeedKph: 999 } : day)) }
  storage.setItem(rideDaySettingsStorageKey, JSON.stringify(corrupted))

  const recovered = loadRideDaySettings(storage)
  assert.deepEqual(getRideDaySettings(recovered, 'J1'), createRideDaySettings('J1', defaultSettings), 'J1 falls back to defaults')
  assert.equal(getRideDaySettings(recovered, 'J3').departureTime, '06:45', 'J3 keeps its saved value')
  assert.equal(getRideDaySettings(recovered, 'J3').totalBreakMinutes, 50)
})

test('applying one day’s values to all days is an explicit, whole-document action', () => {
  const applied = applyRideDaySettingsToAllDays({ averageSpeedKph: 21, departureTime: '06:30', totalBreakMinutes: 40 })
  assert.equal(applied.days.length, 10)
  for (const dayId of rideDaySettingsDayIds) {
    const day = getRideDaySettings(applied, dayId)
    assert.equal(day.averageSpeedKph, 21)
    assert.equal(day.departureTime, '06:30')
    assert.equal(day.totalBreakMinutes, 40)
  }
})

test('restoring defaults for one day never touches the others', () => {
  let document = createDefaultRideDaySettingsDocument()
  document = upsertRideDaySettings(document, { dayId: 'J4', departureTime: '09:00', averageSpeedKph: 14, totalBreakMinutes: 20 })
  document = upsertRideDaySettings(document, { dayId: 'J6', departureTime: '09:15', averageSpeedKph: 13, totalBreakMinutes: 25 })

  const restored = restoreDefaultRideDaySettings(document, 'J4')
  assert.deepEqual(getRideDaySettings(restored, 'J4'), createRideDaySettings('J4', defaultSettings))
  assert.equal(getRideDaySettings(restored, 'J6').departureTime, '09:15', 'J6 untouched')
})

test('rejects saving an incomplete or out-of-order document', () => {
  const storage = memoryStorage()
  assert.equal(saveRideDaySettings({ version: 1, days: [] }, storage), false)
  assert.equal(storage.values.has(rideDaySettingsStorageKey), false)
})

test('settingsStorageKey and rideDaySettingsStorageKey are distinct, versioned keys', () => {
  assert.notEqual(settingsStorageKey, rideDaySettingsStorageKey)
  assert.match(rideDaySettingsStorageKey, /\.v1$/)
})
