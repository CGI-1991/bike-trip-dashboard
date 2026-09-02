import assert from 'node:assert/strict'
import test from 'node:test'

import { computeStagePracticalPlaceAnchors } from '../../src/practical-places/anchors.ts'

const stage = {
  id: 'stage-1', dayId: 'day-1', sourceRouteId: 'route-1',
  name: 'Test stage', startLocationName: 'Départ', endLocationName: 'Arrivée',
  distanceKm: 40, elevationGainM: 800, elevationLossM: 200, minAltitudeM: 200, maxAltitudeM: 1200,
  movingDurationSeconds: 7_200, pauseDurationSeconds: 0, totalDurationSeconds: 7_200, estimatedAverageSpeedKph: 20,
  validationStatus: 'valid', metricsProvenance: null,
  climbIds: [], routePointIds: ['point-col'], weatherRecordIds: [],
}

const route = {
  id: 'route-1', sourceFileId: null,
  segments: [{ index: 0, name: 'Test stage', distanceKm: 40, elevationGainM: 800, elevationLossM: 200 }],
  geometry: {
    full: null,
    simplified: [
      { latitude: 45, longitude: 6, altitudeM: 200 },
      { latitude: 45.2, longitude: 6, altitudeM: 1200 },
      { latitude: 45.4, longitude: 6, altitudeM: 400 },
    ],
  },
  profile: null, parsingStatus: 'success', parsingErrors: [], provenance: null,
}

const col = {
  id: 'point-col', routeId: 'route-1', type: 'summit', name: 'Col Test',
  latitude: 45.2, longitude: 6, elevationM: 1200, trackDistanceKm: 22.26,
  osmFeatureType: 'mountain-pass', provenance: null,
}

function bundle({ settings: settingsOverrides, ...overrides } = {}) {
  return {
    days: [{ id: 'day-1', stageId: 'stage-1' }],
    stages: [stage],
    routePoints: [col],
    climbs: [],
    settings: {
      global: { referenceSpeedKph: 20, pausePlanMode: 'automatic', mountainMode: false },
      days: [{ dayId: 'day-1', departureTime: '08:00', totalBreakSeconds: 0 }],
      stages: [],
      ...settingsOverrides,
    },
    ...overrides,
  }
}

test('start and end are always anchors', () => {
  const anchors = computeStagePracticalPlaceAnchors(bundle(), stage, route)
  assert.ok(anchors.some((anchor) => anchor.latitude === 45 && anchor.longitude === 6), 'départ')
  assert.ok(anchors.some((anchor) => anchor.latitude === 45.4 && anchor.longitude === 6), 'arrivée')
})

test('V: a col with no pause never becomes an anchor of its own — it never creates a commerce search zone', () => {
  const anchors = computeStagePracticalPlaceAnchors(bundle(), stage, route)
  assert.equal(anchors.some((anchor) => anchor.latitude === 45.2), false)
  // Only départ + arrivée in this no-pause scenario.
  assert.equal(anchors.length, 2)
})

test('a col that DOES carry a manual pause becomes an anchor — a genuine stop, not a bare landmark', () => {
  const withPause = bundle({
    settings: {
      stages: [{
        stageId: 'stage-1', pausePlanMode: 'custom',
        pauses: [{ id: 'pause-1', active: true, routePointId: 'point-col', durationSeconds: 600, order: 0, origin: 'manual' }],
      }],
    },
  })
  const anchors = computeStagePracticalPlaceAnchors(withPause, stage, route)
  assert.ok(anchors.some((anchor) => anchor.latitude === 45.2 && anchor.longitude === 6), 'the paused col is now an anchor')
  assert.equal(anchors.length, 3)
})

test('a stage with no route points at all still yields the two endpoint anchors', () => {
  const bare = bundle()
  bare.routePoints = []
  const anchors = computeStagePracticalPlaceAnchors(bare, { ...stage, routePointIds: [] }, route)
  assert.equal(anchors.length, 2)
})
