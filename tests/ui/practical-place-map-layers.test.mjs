import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildPracticalPlaceMapLayers } from '../../src/ui/practical-place-map-layers.ts'

function viewModel(overrides = {}) {
  return {
    place: {
      id: 'place-1', category: 'water', name: 'Fontaine', latitude: 45.1, longitude: 6.2,
      description: null, trackDistanceKm: 10, detourKm: 0.1, openingHours: null, usefulTags: {},
      hidden: false, pinned: false, dayIds: ['day-1'],
      provenance: { sourceType: 'osm', sourceId: 'x', fetchedAt: null, engineVersion: 'practical-places-postpass@1', confidence: 'high', manuallyOverridden: false },
    },
    category: 'water', categoryLabel: 'Eau', displayName: 'Fontaine', passageClockTimeLabel: '10:30',
    opening: null,
    ...overrides,
  }
}

// --- AK/AL: six layers, all hidden by default -------------------------------

test('AK: exactly the six UX categories are always present as layers, in the CDC\'s own order — even with zero POI', () => {
  const layers = buildPracticalPlaceMapLayers([])
  assert.deepEqual(layers.map((layer) => layer.id), ['practical-bike-service', 'practical-supermarket', 'practical-bakery', 'practical-water', 'practical-shelter', 'practical-toilet'])
  assert.deepEqual(layers.map((layer) => layer.label), ['Vélo', 'Supermarché', 'Boulangerie', 'Eau', 'Abris', 'Toilette'])
})

test('AL: every practical layer starts hidden (defaultVisible: false), whatever it contains', () => {
  const layers = buildPracticalPlaceMapLayers([viewModel({ category: 'water', categoryLabel: 'Eau' })])
  for (const layer of layers) assert.equal(layer.defaultVisible, false)
})

// --- AM/AN: each layer only ever carries its own category -------------------

test('AM/AN: a layer only ever contains markers of its own category — Eau never leaks into Boulangerie, activating one never surfaces another', () => {
  const layers = buildPracticalPlaceMapLayers([
    viewModel({ category: 'water', categoryLabel: 'Eau', place: { ...viewModel().place, id: 'w1', category: 'water' } }),
    viewModel({ category: 'bakery', categoryLabel: 'Boulangerie', place: { ...viewModel().place, id: 'b1', category: 'bakery' } }),
  ])
  const water = layers.find((layer) => layer.id === 'practical-water')
  const bakery = layers.find((layer) => layer.id === 'practical-bakery')
  assert.equal(water.markers.length, 1)
  assert.equal(bakery.markers.length, 1)
  assert.equal(water.markers[0].category, 'practical-water')
  assert.equal(bakery.markers[0].category, 'practical-bakery')
  for (const layer of layers) if (layer.id !== 'practical-water' && layer.id !== 'practical-bakery') assert.equal(layer.markers.length, 0)
})

test('markers within a layer are ordered by track distance then detour — never alphabetical', () => {
  const far = viewModel({ place: { ...viewModel().place, id: 'far', trackDistanceKm: 30 } })
  const near = viewModel({ place: { ...viewModel().place, id: 'near', trackDistanceKm: 5 } })
  const layers = buildPracticalPlaceMapLayers([far, near])
  const water = layers.find((layer) => layer.id === 'practical-water')
  assert.deepEqual(water.markers.map((marker) => marker.id), ['near', 'far'])
})

// --- Popup content (CDC section 19) -----------------------------------------

test('the popup shows name, category, position/détour, ETA and opening status — never a raw tag dump', () => {
  const model = viewModel({
    place: { ...viewModel().place, name: 'Boulangerie du Col', trackDistanceKm: 48.2, detourKm: 0.32 },
    displayName: 'Boulangerie du Col', passageClockTimeLabel: '12:41',
    opening: { status: 'open', passageLocalTime: '12:41', rawOpeningHours: '07:00-18:30' },
  })
  const [layer] = buildPracticalPlaceMapLayers([model]).filter((candidate) => candidate.markers.length > 0)
  const popup = layer.markers[0].popupHtml
  assert.match(popup, /Boulangerie du Col/)
  assert.match(popup, /km 48,2/)
  assert.match(popup, /détour ~320 m/)
  assert.match(popup, /Passage estimé 12:41/)
  assert.match(popup, /Ouvert à votre passage/)
  assert.match(popup, /07:00-18:30/)
})

test('an unknown opening status shows the discreet "à vérifier" wording, never "closed"', () => {
  const model = viewModel({ opening: { status: 'unknown', passageLocalTime: '12:41', rawOpeningHours: 'Mo-Fr 08:00-18:00; PH off' } })
  const [layer] = buildPracticalPlaceMapLayers([model]).filter((candidate) => candidate.markers.length > 0)
  assert.match(layer.markers[0].popupHtml, /Horaires à vérifier/)
  assert.doesNotMatch(layer.markers[0].popupHtml, /Fermé à votre passage/)
})

test('never a raw tag dump — only website/phone/access/fee are ever surfaced, formatted', () => {
  const model = viewModel({
    place: { ...viewModel().place, category: 'toilet', usefulTags: { access: 'yes', fee: 'no', website: 'https://example.test', phone: '+33 1 23 45 67 89', wheelchair: 'yes', operator: 'Commune' } },
    category: 'toilet', categoryLabel: 'Toilette',
  })
  const [layer] = buildPracticalPlaceMapLayers([model]).filter((candidate) => candidate.markers.length > 0)
  const popup = layer.markers[0].popupHtml
  assert.match(popup, /Accès : yes/)
  assert.match(popup, /Payant : non/)
  assert.match(popup, /Site/)
  assert.doesNotMatch(popup, /wheelchair/)
  assert.doesNotMatch(popup, /operator/)
})

// --- AH/AI/AJ: never leaks outside the Étape fullscreen map -----------------

test('AH/AI/AJ: the practical-place layer builder is wired ONLY into the Étape fullscreen map, never Aperçu (compact or fullscreen) or the compact Étape preview', () => {
  const tripsManager = readFileSync(new URL('../../src/ui/trips/trips-manager.ts', import.meta.url), 'utf8')
  const overview = readFileSync(new URL('../../src/ui/trips/trip-overview-view.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(overview, /practical-place-map-layers|buildPracticalPlaceMapLayers/)
  const mountOverviewMapStart = tripsManager.indexOf('function mountOverviewMap')
  const mountOverviewMapEnd = tripsManager.indexOf('\n  async function renderOverview', mountOverviewMapStart)
  assert.doesNotMatch(tripsManager.slice(mountOverviewMapStart, mountOverviewMapEnd), /practicalPlaceLayers|buildPracticalPlaceMapLayers/)
  assert.match(tripsManager, /function practicalPlaceLayers\(/)
  assert.match(tripsManager, /deps\.renderMap\(mapContainer, mapDialog, model, \[\.\.\.villagesLayer\(detail\.villageWaypoints\), \.\.\.practicalPlaceLayers\(bundle, detail, dayId\)\]\)/)
})
