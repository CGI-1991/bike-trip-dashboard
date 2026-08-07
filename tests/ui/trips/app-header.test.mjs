import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { GENERIC_APP_HEADER_NO_ACTIVE_TRIP, GENERIC_APP_TITLE, buildGenericAppHeader } from '../../../src/ui/trips/app-header.ts'
import { createGenericTripBundle } from '../../trip-core/support/generic-trip-fixture.mjs'

// Bug 48B closeout: the app-shell header used to be permanently hardcoded to
// "RGA 2026" / "Route des Grandes Alpes" / "J1 sur 12" regardless of which
// generic trip was actually active. `createGenericTripBundle()` — name
// "Sample Loop 01", 4 days, ride/off/transfer/ride — is exactly the kind of
// second, differently-named/differently-sized trip that must produce its own
// header, never the RGA literals.

test('Aperçu/Voyage (no active day): trip name only, no subtitle', () => {
  const bundle = createGenericTripBundle()
  const state = buildGenericAppHeader(bundle, null)
  assert.equal(state.tripName, 'Sample Loop 01')
  assert.equal(state.subtitle, null)
})

test('a ride day: "Jx sur N · Roulé" — N from bundle.days.length, never a hardcoded total', () => {
  const bundle = createGenericTripBundle()
  const rideDay = bundle.days[0]
  const state = buildGenericAppHeader(bundle, rideDay)
  assert.equal(state.tripName, 'Sample Loop 01')
  assert.equal(state.subtitle, 'J1 sur 4 · Roulé')
})

test('an OFF day: "Jx sur N · OFF"', () => {
  const bundle = createGenericTripBundle()
  const offDay = bundle.days[1]
  const state = buildGenericAppHeader(bundle, offDay)
  assert.equal(state.subtitle, 'J2 sur 4 · OFF')
})

test('a transfer day: "Jx sur N · Transfert"', () => {
  const bundle = createGenericTripBundle()
  const transferDay = bundle.days[2]
  const state = buildGenericAppHeader(bundle, transferDay)
  assert.equal(state.subtitle, 'J3 sur 4 · Transfert')
})

test('the last ride day still reports the true total, not a coincidental match with a hardcoded 12', () => {
  const bundle = createGenericTripBundle()
  const lastDay = bundle.days[3]
  const state = buildGenericAppHeader(bundle, lastDay)
  assert.equal(state.subtitle, 'J4 sur 4 · Roulé')
})

test('Mes voyages / wizard / editor / confirmation: no active-trip context at all — never the last active trip\'s name', () => {
  assert.equal(GENERIC_APP_HEADER_NO_ACTIVE_TRIP.tripName, null)
  assert.equal(GENERIC_APP_HEADER_NO_ACTIVE_TRIP.subtitle, null)
})

test('the generic app title matches the manifest — no second, invented app name', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../public/manifest.webmanifest', import.meta.url), 'utf8'))
  assert.equal(GENERIC_APP_TITLE, manifest.name)
})

test('non-regression guard: the generic header module never hardcodes the RGA trip name/subtitle as a runtime value (comments may still explain the historical bug)', () => {
  const source = readFileSync(new URL('../../../src/ui/trips/app-header.ts', import.meta.url), 'utf8')
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(withoutComments, /RGA 2026|Route des Grandes Alpes/)
})

test('a differently-named, differently-sized second trip produces its own header — never leaks the first trip\'s name/day-count', () => {
  const tripA = createGenericTripBundle()
  const tripB = { ...createGenericTripBundle(), metadata: { ...createGenericTripBundle().metadata, name: 'Tour de Belgique' }, days: createGenericTripBundle().days.slice(0, 3) }
  const stateA = buildGenericAppHeader(tripA, tripA.days[0])
  const stateB = buildGenericAppHeader(tripB, tripB.days[0])
  assert.equal(stateA.tripName, 'Sample Loop 01')
  assert.equal(stateA.subtitle, 'J1 sur 4 · Roulé')
  assert.equal(stateB.tripName, 'Tour de Belgique')
  assert.equal(stateB.subtitle, 'J1 sur 3 · Roulé')
  assert.notEqual(stateA.tripName, stateB.tripName)
})
