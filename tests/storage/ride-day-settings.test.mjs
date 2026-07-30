import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDefaultRideDaySettingsDocument,
  createRideDaySettings,
  getRideDaySettings,
  legacyRideDaySettingsStorageKey,
  loadRideDaySettings,
  rideDaySettingsDayIds,
  rideDaySettingsStorageKey,
  saveRideDaySettings,
  updateReferenceSpeed,
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
  assert.equal(document.version, 2)
  assert.equal(document.days.length, 10)
  assert.ok(document.days.every((day) => day.dayId !== 'J5' && day.dayId !== 'J8'))
})

test('the reference speed is a single document-level value shared by every ride day', () => {
  const document = createDefaultRideDaySettingsDocument()
  assert.equal(document.referenceSpeedKph, defaultSettings.referenceSpeedKph)
  for (const dayId of rideDaySettingsDayIds) {
    assert.equal('referenceSpeedKph' in getRideDaySettings(document, dayId), false, `${dayId} settings must not carry a per-day speed`)
  }
})

test('J1 and J2 can independently carry different departure time and total break, under the same reference speed', () => {
  let document = createDefaultRideDaySettingsDocument()
  document = upsertRideDaySettings(document, { dayId: 'J1', departureTime: '08:00', totalBreakMinutes: 30 })
  document = upsertRideDaySettings(document, { dayId: 'J2', departureTime: '07:30', totalBreakMinutes: 75 })

  const j1 = getRideDaySettings(document, 'J1')
  const j2 = getRideDaySettings(document, 'J2')
  assert.equal(j1.departureTime, '08:00')
  assert.equal(j1.totalBreakMinutes, 30)
  assert.equal(j2.departureTime, '07:30')
  assert.equal(j2.totalBreakMinutes, 75)
  assert.equal(document.referenceSpeedKph, defaultSettings.referenceSpeedKph, 'upserting a day never changes the shared reference speed')
})

test('upserting J2 never changes J1 or any other day', () => {
  const before = createDefaultRideDaySettingsDocument()
  const after = upsertRideDaySettings(before, { dayId: 'J2', departureTime: '07:00', totalBreakMinutes: 90 })

  for (const dayId of rideDaySettingsDayIds) {
    if (dayId === 'J2') continue
    assert.deepEqual(getRideDaySettings(after, dayId), getRideDaySettings(before, dayId), `${dayId} must stay unchanged`)
  }
  assert.notDeepEqual(getRideDaySettings(after, 'J2'), getRideDaySettings(before, 'J2'))
})

test('updateReferenceSpeed changes the shared value for all ten days at once and rejects an out-of-range value', () => {
  const before = createDefaultRideDaySettingsDocument()
  const after = updateReferenceSpeed(before, 21)
  assert.equal(after.referenceSpeedKph, 21)
  for (const dayId of rideDaySettingsDayIds) {
    assert.deepEqual(getRideDaySettings(after, dayId), getRideDaySettings(before, dayId), `${dayId}'s own departure/break settings are untouched`)
  }

  const rejected = updateReferenceSpeed(before, 999)
  assert.equal(rejected, before, 'an invalid reference speed is rejected and the document is returned unchanged')
})

test('migrates the legacy global DashboardSettings into every ride day on first load (departure time and breaks)', () => {
  const storage = memoryStorage()
  saveSettings({ referenceSpeedKph: 22, departureTime: '07:15', totalBreakMinutes: 45 }, storage)
  assert.equal(storage.values.has(rideDaySettingsStorageKey), false, 'no ride-day document exists yet')

  const migrated = loadRideDaySettings(storage)
  assert.equal(migrated.version, 2)
  assert.equal(migrated.referenceSpeedKph, 22)
  assert.equal(migrated.days.length, 10)
  for (const dayId of rideDaySettingsDayIds) {
    const day = getRideDaySettings(migrated, dayId)
    assert.equal(day.departureTime, '07:15')
    assert.equal(day.totalBreakMinutes, 45)
  }
})

test('migrates a legacy v1 per-day-speed document into the v2 global reference speed, preferring an already-saved global setting', () => {
  const storage = memoryStorage()
  storage.setItem(legacyRideDaySettingsStorageKey, JSON.stringify({
    version: 1,
    days: [
      { dayId: 'J1', departureTime: '08:00', averageSpeedKph: 18, totalBreakMinutes: 30 },
      { dayId: 'J2', departureTime: '07:30', averageSpeedKph: 16, totalBreakMinutes: 75 },
    ],
  }))
  saveSettings({ referenceSpeedKph: 20, departureTime: '08:00', totalBreakMinutes: 60 }, storage)

  const migrated = loadRideDaySettings(storage)
  assert.equal(migrated.version, 2)
  assert.equal(migrated.referenceSpeedKph, 20, 'an already-saved global DashboardSettings speed takes priority over the legacy per-day median')
  assert.equal(getRideDaySettings(migrated, 'J1').departureTime, '08:00')
  assert.equal(getRideDaySettings(migrated, 'J2').totalBreakMinutes, 75)
})

test('migrates a legacy v1 document to the median of its per-day speeds when no global setting was ever saved', () => {
  const storage = memoryStorage()
  storage.setItem(legacyRideDaySettingsStorageKey, JSON.stringify({
    version: 1,
    days: [
      { dayId: 'J1', departureTime: '08:00', averageSpeedKph: 14, totalBreakMinutes: 30 },
      { dayId: 'J2', departureTime: '07:30', averageSpeedKph: 18, totalBreakMinutes: 75 },
      { dayId: 'J3', departureTime: '08:00', averageSpeedKph: 22, totalBreakMinutes: 60 },
    ],
  }))

  const migrated = loadRideDaySettings(storage)
  assert.equal(migrated.referenceSpeedKph, 18, 'the median of 14/18/22 is 18, robust to outliers, unlike a mean')
})

test('a valid, already-migrated ride-day-settings.v2 document loads back unchanged', () => {
  const storage = memoryStorage()
  let document = createDefaultRideDaySettingsDocument()
  document = upsertRideDaySettings(document, { dayId: 'J1', departureTime: '08:00', totalBreakMinutes: 30 })
  document = upsertRideDaySettings(document, { dayId: 'J2', departureTime: '07:30', totalBreakMinutes: 75 })
  document = updateReferenceSpeed(document, 19)
  assert.equal(saveRideDaySettings(document, storage), true)

  const reloaded = loadRideDaySettings(storage)
  assert.deepEqual(reloaded, document)
})

test('falls back to the application defaults when neither document exists', () => {
  const storage = memoryStorage()
  const document = loadRideDaySettings(storage)
  assert.equal(document.referenceSpeedKph, defaultSettings.referenceSpeedKph)
  for (const dayId of rideDaySettingsDayIds) {
    assert.deepEqual(getRideDaySettings(document, dayId), createRideDaySettings(dayId, defaultSettings))
  }
})

test('an invalid entry for a single day is restored to its default, the other nine keep their saved values, and the shared speed is untouched', () => {
  const storage = memoryStorage()
  let document = createDefaultRideDaySettingsDocument()
  document = upsertRideDaySettings(document, { dayId: 'J3', departureTime: '06:45', totalBreakMinutes: 50 })
  assert.equal(saveRideDaySettings(document, storage), true)

  const raw = JSON.parse(storage.getItem(rideDaySettingsStorageKey))
  const corrupted = { ...raw, days: raw.days.map((day) => (day.dayId === 'J1' ? { ...day, totalBreakMinutes: 9_999 } : day)) }
  storage.setItem(rideDaySettingsStorageKey, JSON.stringify(corrupted))

  const recovered = loadRideDaySettings(storage)
  assert.deepEqual(getRideDaySettings(recovered, 'J1'), createRideDaySettings('J1', defaultSettings), 'J1 falls back to defaults')
  assert.equal(getRideDaySettings(recovered, 'J3').departureTime, '06:45', 'J3 keeps its saved value')
  assert.equal(getRideDaySettings(recovered, 'J3').totalBreakMinutes, 50)
  assert.equal(recovered.referenceSpeedKph, document.referenceSpeedKph, 'a corrupted per-day entry never resets the shared reference speed')
})

test('rejects saving an incomplete or out-of-order document', () => {
  const storage = memoryStorage()
  assert.equal(saveRideDaySettings({ version: 1, days: [] }, storage), false)
  assert.equal(storage.values.has(rideDaySettingsStorageKey), false)
})

test('settingsStorageKey and rideDaySettingsStorageKey are distinct, versioned keys', () => {
  assert.notEqual(settingsStorageKey, rideDaySettingsStorageKey)
  assert.match(rideDaySettingsStorageKey, /\.v2$/)
  assert.match(legacyRideDaySettingsStorageKey, /\.v1$/)
})
