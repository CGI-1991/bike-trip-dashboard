import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { rideDaySettingsStorageKey, legacyRideDaySettingsStorageKey } from '../../src/storage/ride-day-settings.ts'
import { settingsStorageKey } from '../../src/storage/settings.ts'
import { pausePlanStorageKey } from '../../src/trip/pause-plan.ts'
import { weatherConfig } from '../../src/weather/config.ts'

const rootUrl = new URL('../../', import.meta.url)

function projectFile(relativePath) {
  return new URL(relativePath, rootUrl)
}

const storageKeys = [
  settingsStorageKey,
  rideDaySettingsStorageKey,
  legacyRideDaySettingsStorageKey,
  pausePlanStorageKey,
  weatherConfig.cacheKey,
]

test('every browser storage key belongs to the bike-trip-dashboard namespace, never the legacy RGA one', () => {
  for (const key of storageKeys) {
    assert.match(key, /^bike-trip-dashboard\./, `${key} must use the bike-trip-dashboard namespace`)
    assert.doesNotMatch(key, /^rga-2026-dashboard\./, `${key} must not collide with the legacy rga-2026-dashboard namespace`)
  }
})

test('storage keys are pairwise distinct', () => {
  assert.equal(new Set(storageKeys).size, storageKeys.length)
})

test('the service worker cache prefix belongs to the bike-trip-dashboard namespace and cannot collide with the legacy RGA cache prefix', () => {
  const source = readFileSync(projectFile('scripts/service-worker.template.js'), 'utf8')
  const [, cachePrefix] = source.match(/CACHE_PREFIX = '([^']+)'/) ?? []
  assert.equal(cachePrefix, 'bike-trip-dashboard-')
  assert.notEqual(cachePrefix, 'rga-2026-')
  assert.ok(!'rga-2026-some-version'.startsWith(cachePrefix))
  assert.ok(!cachePrefix.startsWith('rga-2026-'))
})
