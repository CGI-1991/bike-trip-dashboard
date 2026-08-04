import assert from 'node:assert/strict'
import test from 'node:test'

import { renderGenericElevationProfile, sampleElevationProfileFromGeometry } from '../../src/ui/elevation-profile.ts'

function geometry() {
  return Array.from({ length: 200 }, (_, index) => ({ latitude: 46 + index / 10_000, longitude: 6, altitudeM: 400 + index }))
}

function waypoint(overrides = {}) {
  return {
    id: 'wp', kind: 'city', importance: 'major', visibleByDefault: true, name: 'Ville',
    trackDistanceKm: 5, latitude: 46.005, longitude: 6, elevationM: 450, climbId: null,
    pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
    ...overrides,
  }
}

test('sampleElevationProfileFromGeometry preserves the geometry endpoints and starts at distance 0', () => {
  const samples = sampleElevationProfileFromGeometry(geometry())
  assert.equal(samples[0].distanceKm, 0)
  assert.ok(samples.at(-1).distanceKm > 0)
})

test('shows a fallback message when there is no usable geometry', () => {
  const container = { innerHTML: '' }
  renderGenericElevationProfile(container, null, [], 'Étape 1')
  assert.match(container.innerHTML, /Profil indisponible/)

  const short = { innerHTML: '' }
  renderGenericElevationProfile(short, [{ latitude: 45, longitude: 6, altitudeM: 100 }], [], 'Étape 1')
  assert.match(short.innerHTML, /Profil indisponible/)
})

test('renders one profile marker per waypoint, classified via the shared generic category mapping', () => {
  const container = { innerHTML: '' }
  renderGenericElevationProfile(container, geometry(), [
    waypoint({ id: 'city1', kind: 'city' }),
    waypoint({ id: 'village1', kind: 'village', trackDistanceKm: 8 }),
  ], 'Étape 1')
  assert.match(container.innerHTML, /profile-marker--locality-major/)
  assert.match(container.innerHTML, /profile-marker--locality-minor/)
})

test('a pause duration on a waypoint renders the pause ring/class exactly like the RGA profile', () => {
  const container = { innerHTML: '' }
  renderGenericElevationProfile(container, geometry(), [waypoint({ pauseDurationMinutes: 15 })], 'Étape 1')
  assert.match(container.innerHTML, /profile-marker--pause/)
  assert.match(container.innerHTML, /Pause 15 min/)
})

test('includes the stage label in the accessible title', () => {
  const container = { innerHTML: '' }
  renderGenericElevationProfile(container, geometry(), [], 'J3 — Clisson → Nantes')
  assert.match(container.innerHTML, /J3 — Clisson → Nantes/)
})
