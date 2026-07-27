import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getRoadbookResolutionEntry,
  resolveRoadbookResolution,
  roadbookResolutionOverrides,
} from '../../src/trip/roadbook-resolutions.ts'
import { deduplicateMatchedWeatherPoints } from '../../src/weather/sample-points.ts'

const VALID_RESOLUTIONS = new Set([
  'matched',
  'informational',
  'excluded',
  'user-decision-required',
])

test('every curated entry is well-formed and uniquely keyed', () => {
  const seenIds = new Set()

  for (const entry of roadbookResolutionOverrides) {
    assert.match(entry.pointId, /^j\d{2}-[a-z0-9-]+$/)
    assert.ok(VALID_RESOLUTIONS.has(entry.resolution), `unknown resolution for ${entry.pointId}`)
    assert.ok(entry.justification.trim().length > 0, `missing justification for ${entry.pointId}`)
    assert.equal(seenIds.has(entry.pointId), false, `duplicate entry for ${entry.pointId}`)
    seenIds.add(entry.pointId)
  }

  assert.equal(roadbookResolutionOverrides.length, 12)
})

test('excludes the Cime de la Bonette option as an unridden loop', () => {
  const entry = getRoadbookResolutionEntry('j10-option-cime-de-la-bonette')
  assert.equal(entry?.resolution, 'excluded')
  assert.match(entry.justification, /non parcourue/)
})

test('excludes Bellevaux and Tignes as localities the track does not actually reach', () => {
  assert.equal(getRoadbookResolutionEntry('j01-passage-bellevaux')?.resolution, 'excluded')
  assert.equal(getRoadbookResolutionEntry('j06-passage-tignes')?.resolution, 'excluded')
})

test('keeps combined pause objects as informational group notes, not unmatched geography', () => {
  const pauseIds = [
    'j02-pause-cluses',
    'j06-pause-tignes-val-d-isere',
    'j07-pause-modane-valloire',
    'j09-pause-guillestre-embrun',
    'j12-pause-sospel',
  ]

  for (const pointId of pauseIds) {
    const entry = getRoadbookResolutionEntry(pointId)
    assert.equal(entry?.resolution, 'informational', `${pointId} should be informational`)
  }
})

test('demotes the four distance-ambiguous needs-review passages to informational', () => {
  const informationalPassageIds = [
    'j03-passage-crest-voland',
    'j04-passage-areches',
    'j04-passage-les-chapieux',
    'j09-passage-chateau-queyras',
  ]

  for (const pointId of informationalPassageIds) {
    const entry = getRoadbookResolutionEntry(pointId)
    assert.equal(entry?.resolution, 'informational', `${pointId} should be informational`)
  }
})

test('leaves the two promoted points (Samoëns, La Clusaz) to the default matched rule', () => {
  assert.equal(getRoadbookResolutionEntry('j02-passage-samoens'), null)
  assert.equal(getRoadbookResolutionEntry('j03-passage-la-clusaz'), null)
  assert.equal(resolveRoadbookResolution('j02-passage-samoens', 'matched'), 'matched')
  assert.equal(resolveRoadbookResolution('j03-passage-la-clusaz', 'matched'), 'matched')
})

test('defaults an unlisted point to matched-or-decision-required, never a silent exclusion', () => {
  assert.equal(resolveRoadbookResolution('unknown-point', 'matched'), 'matched')
  assert.equal(resolveRoadbookResolution('unknown-point', 'needs-review'), 'user-decision-required')
  assert.equal(resolveRoadbookResolution('unknown-point', 'unmatched'), 'user-decision-required')
})

test('excludes informational and excluded points from weather sampling, even with full geometry', () => {
  const basePoint = (id, resolution) => ({
    id,
    dayId: 'J1',
    type: 'passage',
    name: id,
    status: 'matched',
    resolution,
    sourceKind: 'passage-group',
    alternatives: [],
    overrideApplied: true,
    standaloneWaypoint: false,
    matchedLatitude: 45,
    matchedLongitude: 6,
    matchedElevationM: 1_000,
    matchedTrackDistanceKm: 10,
    matchedSegmentIndex: 0,
    matchedPointIndex: 100,
    matchedNextPointIndex: 101,
    matchedSegmentFraction: 0.5,
    eta: { totalMinutesFromDeparture: 120, clockMinutes: 600, dayOffset: 0 },
  })

  const points = [
    basePoint('active', 'matched'),
    basePoint('info-only', 'informational'),
    basePoint('excluded-point', 'excluded'),
    basePoint('decision-required', 'user-decision-required'),
  ]

  const groups = deduplicateMatchedWeatherPoints(points)

  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].members.map(({ id }) => id), ['active'])
})
