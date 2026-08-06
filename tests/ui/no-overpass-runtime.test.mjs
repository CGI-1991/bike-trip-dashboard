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

/**
 * Jalon B4.2 section 27: the guard above only ever covered the climb-names
 * Overpass provider. Two other legacy Overpass providers exist in the repo
 * (`practical-places/overpass-provider.ts`, `route-enrichment/
 * overpass-provider.ts`, both built on `route-enrichment/overpass-bbox.ts`)
 * — neither is currently wired into generic runtime code, but nothing said
 * so explicitly. These tests make "normal generic navigation never calls
 * overpass-api.de" a single, exhaustive, named guarantee instead of an
 * implicit consequence of import-graph tracing. Source-text guard, not
 * execution — consistent with the rest of this file.
 */
test('the generic runtime entry point never imports any Overpass provider, structural or practical-places', () => {
  const main = source('src/main.ts')
  assert.doesNotMatch(main, /practical-places\/overpass-provider/)
  assert.doesNotMatch(main, /route-enrichment\/overpass-provider/)
  assert.doesNotMatch(main, /createOverpassRouteEnrichmentProvider/)
  assert.doesNotMatch(main, /createOverpassPracticalPlacesProvider/)
})

test('the generic trips-manager, trip editor, and import wizard never reference an Overpass provider', () => {
  for (const path of ['src/ui/trips/trips-manager.ts', 'src/ui/trips/trip-editor.ts', 'src/ui/trips/import-wizard.ts']) {
    const contents = source(path)
    assert.doesNotMatch(contents, /overpass-provider/, `${path} must not import an Overpass provider`)
    assert.doesNotMatch(contents, /overpass-api\.de/, `${path} must not hardcode the Overpass endpoint`)
  }
})

test('automatic route enrichment is wired to Postpass only, never to an Overpass provider', () => {
  const automaticEnrichment = source('src/route-enrichment/automatic-enrichment.ts')
  assert.doesNotMatch(automaticEnrichment, /overpass-provider/)
  assert.doesNotMatch(automaticEnrichment, /overpass-api\.de/)
})

test('the practical-places and route-enrichment Overpass provider modules may remain in the repo, unwired (legacy/tests only)', () => {
  // Same policy as the climb-names provider above: kept for non-regression
  // and their own unit tests, never imported from generic runtime code.
  assert.doesNotThrow(() => source('src/practical-places/overpass-provider.ts'))
  assert.doesNotThrow(() => source('src/route-enrichment/overpass-provider.ts'))
})
