import assert from 'node:assert/strict'
import test from 'node:test'

import { renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

test('trip detail displays start to end independently from the GPX stage name and exposes optional enrichment', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle, { canEnrichEndpoints: true })
  assert.match(html, /Riverside → Hilltown/)
  assert.match(html, /Identifier les lieux de départ et d’arrivée/)
})

test('trip detail attributes OSM endpoint names when present', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints[0].provenance.sourceType = 'osm'
  const html = renderTripDetail(bundle)
  assert.match(html, /© OpenStreetMap contributors/)
})
