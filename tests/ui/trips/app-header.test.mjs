import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { GENERIC_APP_HEADER_NO_ACTIVE_TRIP, GENERIC_APP_TITLE, buildGenericAppHeader } from '../../../src/ui/trips/app-header.ts'
import { createGenericTripBundle } from '../../trip-core/support/generic-trip-fixture.mjs'

// Bug 48B closeout: the app-shell header used to be permanently hardcoded to
// "RGA 2026" / "Route des Grandes Alpes" / "J1 sur 12" regardless of which
// generic trip was actually active. `createGenericTripBundle()` — name
// "Sample Loop 01", 4 days (ride/off/transfer/ride), dated 2027-05-10 →
// 2027-05-13 — is exactly the kind of second, differently-named/differently-
// sized trip that must produce its own header, never the RGA literals.
//
// CDC D1.2 section 1: the header is now the sole general trip identity —
// each screen gets its own contextual subtitle instead of a bare `null`.

test('B: the header always reports the active trip\'s own name', () => {
  const bundle = createGenericTripBundle()
  assert.equal(buildGenericAppHeader(bundle, { view: 'overview' }).tripName, 'Sample Loop 01')
  assert.equal(buildGenericAppHeader(bundle, { view: 'trip', now: null }).tripName, 'Sample Loop 01')
  assert.equal(buildGenericAppHeader(bundle, { view: 'day', day: bundle.days[0] }).tripName, 'Sample Loop 01')
})

// --- Aperçu: date span + total day count -----------------------------------

test('C: Aperçu reports the trip\'s date span and total day count', () => {
  const bundle = createGenericTripBundle()
  const state = buildGenericAppHeader(bundle, { view: 'overview' })
  assert.equal(state.subtitle, '10 mai → 13 mai · 4 jours')
})

test('Aperçu with a single-day trip shows one date, no arrow, singular "jour"', () => {
  const bundle = createGenericTripBundle()
  bundle.days = [bundle.days[0]]
  bundle.metadata.endDate = bundle.metadata.startDate
  const state = buildGenericAppHeader(bundle, { view: 'overview' })
  assert.equal(state.subtitle, '10 mai · 1 jour')
})

test('Aperçu with an undated trip still reports the day count, no dangling date text', () => {
  const bundle = createGenericTripBundle({ dated: false })
  const state = buildGenericAppHeader(bundle, { view: 'overview' })
  assert.equal(state.subtitle, '4 jours')
})

// --- Voyage: the priority day (D1's own completion rule) + days remaining --

test('the Voyage subtitle uses the SAME priority-day rule as Aperçu/Voyage highlighting (deriveTripTemporalState) — never a second heuristic', () => {
  const bundle = createGenericTripBundle()
  // Before the trip starts: day 1 is priority, 3 days remain after it.
  const state = buildGenericAppHeader(bundle, { view: 'trip', now: '2027-05-01T00:00:00.000Z' })
  assert.equal(state.subtitle, 'J1 sur 4 · 3 jours à venir')
})

test('once day 1 is completed (past its ETA), the Voyage subtitle advances to day 2', () => {
  const bundle = createGenericTripBundle()
  const state = buildGenericAppHeader(bundle, { view: 'trip', now: '2027-05-11T00:00:00.000Z' })
  assert.equal(state.subtitle, 'J2 sur 4 · 2 jours à venir')
})

test('the last day reports "Dernier jour" instead of "0 jours à venir"', () => {
  const bundle = createGenericTripBundle()
  // Midday local on day 4 (America/Denver, the fixture's own timezone) —
  // days 1-3 are past their own date, day 4 has no route geometry so it
  // never auto-completes mid-day (D1's own fallback rule), leaving it the
  // priority day with nothing left after it.
  const state = buildGenericAppHeader(bundle, { view: 'trip', now: '2027-05-13T12:00:00-06:00' })
  assert.equal(state.subtitle, 'J4 sur 4 · Dernier jour')
})

test('once the whole trip is finished, the Voyage subtitle is null — nothing left to be "up next"', () => {
  const bundle = createGenericTripBundle()
  const state = buildGenericAppHeader(bundle, { view: 'trip', now: '2028-01-01T00:00:00.000Z' })
  assert.equal(state.subtitle, null)
})

// --- Étape/Journée: day position + type (K/AB in the day-detail tests cover the header bandeau itself) ---

test('a ride day: "Jx sur N · Étape" — N from bundle.days.length, never a hardcoded total, never "Roulé" (D1.1 wording)', () => {
  const bundle = createGenericTripBundle()
  const rideDay = bundle.days[0]
  const state = buildGenericAppHeader(bundle, { view: 'day', day: rideDay })
  assert.equal(state.tripName, 'Sample Loop 01')
  assert.equal(state.subtitle, 'J1 sur 4 · Étape')
})

test('an OFF day: "Jx sur N · OFF"', () => {
  const bundle = createGenericTripBundle()
  const offDay = bundle.days[1]
  const state = buildGenericAppHeader(bundle, { view: 'day', day: offDay })
  assert.equal(state.subtitle, 'J2 sur 4 · OFF')
})

test('a transfer day: "Jx sur N · Transfert"', () => {
  const bundle = createGenericTripBundle()
  const transferDay = bundle.days[2]
  const state = buildGenericAppHeader(bundle, { view: 'day', day: transferDay })
  assert.equal(state.subtitle, 'J3 sur 4 · Transfert')
})

test('the last ride day still reports the true total, not a coincidental match with a hardcoded 12', () => {
  const bundle = createGenericTripBundle()
  const lastDay = bundle.days[3]
  const state = buildGenericAppHeader(bundle, { view: 'day', day: lastDay })
  assert.equal(state.subtitle, 'J4 sur 4 · Étape')
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
  const stateA = buildGenericAppHeader(tripA, { view: 'day', day: tripA.days[0] })
  const stateB = buildGenericAppHeader(tripB, { view: 'day', day: tripB.days[0] })
  assert.equal(stateA.tripName, 'Sample Loop 01')
  assert.equal(stateA.subtitle, 'J1 sur 4 · Étape')
  assert.equal(stateB.tripName, 'Tour de Belgique')
  assert.equal(stateB.subtitle, 'J1 sur 3 · Étape')
  assert.notEqual(stateA.tripName, stateB.tripName)
})
