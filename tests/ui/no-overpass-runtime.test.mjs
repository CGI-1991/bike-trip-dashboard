import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Architectural guard (stability hardening 2026-08-04): climb naming for the
 * generic pipeline is now sourced exclusively from Postpass structural data
 * (`route-enrichment/enrichment.ts::enrichClimbs`, already wired through
 * `runStoredTripAutomaticEnrichment`). The historical Overpass-based manual
 * climb-name provider/button must never be reachable from the generic
 * runtime — normal `TripsManager` usage must make zero requests to
 * `overpass-api.de`. `src/climb-names/overpass-provider.ts` itself may stay
 * in the repo (non-regression/history), it just must never be imported or
 * injected from the live app.
 */

const rootUrl = new URL('../../', import.meta.url)

function source(relativePath) {
  return readFileSync(new URL(relativePath, rootUrl), 'utf8')
}

test('main.ts never imports or injects the Overpass climb-name provider', () => {
  const main = source('src/main.ts')
  assert.doesNotMatch(main, /createOverpassClimbNameProvider/)
  assert.doesNotMatch(main, /climb-names\/overpass-provider/)
  assert.doesNotMatch(main, /climbNameProvider\s*:/)
})

test('the generic trips-manager screen controller has no climb-name-provider wiring left', () => {
  const trips = source('src/ui/trips/trips-manager.ts')
  assert.doesNotMatch(trips, /climbNameProvider/)
  assert.doesNotMatch(trips, /climbNamingInFlight|climbNamingErrors/)
  assert.doesNotMatch(trips, /enrichStoredTripClimbNames/)
  assert.doesNotMatch(trips, /enrich-trip-climb-names/)
  assert.doesNotMatch(trips, /climb-names\//)
})

test('the trip detail view has no manual "search climb names via Overpass" action left', () => {
  const detail = source('src/ui/trips/trip-detail-view.ts')
  assert.doesNotMatch(detail, /canEnrichClimbNames|climbNamingPending|climbNamingError/)
  assert.doesNotMatch(detail, /Rechercher les noms des montées/)
  assert.doesNotMatch(detail, /enrich-trip-climb-names/)
})

test('the Overpass climb-name provider module itself may remain in the repo, unwired', () => {
  // Kept for history/non-regression per the hardening brief — this test
  // only documents that decision, it does not assert the file's absence.
  assert.doesNotThrow(() => source('src/climb-names/overpass-provider.ts'))
})
