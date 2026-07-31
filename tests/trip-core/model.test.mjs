import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

test('a fully populated, dated generic bundle validates with no issues', () => {
  const result = validateTripBundle(createGenericTripBundle({ dated: true }))
  assert.equal(result.ok, true)
})

test('a dateless generic bundle (no calendar yet) also validates', () => {
  const result = validateTripBundle(createGenericTripBundle({ dated: false }))
  assert.equal(result.ok, true)
})

test('optional collections may be empty', () => {
  const bundle = createGenericTripBundle({ dated: false })
  bundle.climbs = []
  bundle.practicalPlaces = []
  bundle.accommodations = []
  bundle.overrides = []
  bundle.weather = []
  bundle.stages = bundle.stages.map((stage) => ({ ...stage, climbIds: [], weatherRecordIds: [] }))
  bundle.days = bundle.days.map((day) => ({ ...day, accommodationId: null }))
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, true)
})

test('a fully populated provenance passes validation', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, true)
  assert.equal(bundle.routes[0].provenance.confidence, 'high')
})

test('a minimal (all-null) provenance is still accepted', () => {
  const bundle = createGenericTripBundle({ dated: true })
  bundle.routes[1].provenance = {
    sourceType: 'generated',
    sourceId: null,
    fetchedAt: null,
    engineVersion: 'x',
    confidence: null,
    manuallyOverridden: false,
  }
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, true)
})
