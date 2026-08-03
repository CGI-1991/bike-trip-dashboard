import assert from 'node:assert/strict'
import test from 'node:test'

import { buildClimbProfile, classifyClimbGrade } from '../../src/analysis/climb-profile.ts'
import { climbId, routeId } from '../../src/trip-core/index.ts'

function geometryPoint(latitude, longitude, altitudeM) {
  return { latitude, longitude, altitudeM }
}

function makeClimb(overrides = {}) {
  return {
    id: climbId('climb-1'),
    routeId: routeId('route-1'),
    name: 'Test Climb',
    startDistanceKm: 0,
    endDistanceKm: 2,
    elevationGainM: 200,
    averageGradientPercent: 10,
    maxGradientPercent: 12,
    startAltitudeM: 1000,
    endAltitudeM: 1200,
    confidence: 'probable',
    provenance: { sourceType: 'generated', sourceId: null, fetchedAt: null, engineVersion: 'test@1', confidence: 'medium', manuallyOverridden: false },
    ...overrides,
  }
}

function buildStraightGeometry(lengthKm, gainM, pointCount = 200) {
  const points = []
  for (let i = 0; i <= pointCount; i++) {
    const ratio = i / pointCount
    points.push(geometryPoint(45 + ratio * (lengthKm / 111), 6, 1000 + ratio * gainM))
  }
  return points
}

test('classifyClimbGrade maps every CDC section 14.3 band correctly', () => {
  assert.equal(classifyClimbGrade(0.5), 'climb-0-1')
  assert.equal(classifyClimbGrade(2), 'climb-1-4')
  assert.equal(classifyClimbGrade(6), 'climb-4-8')
  assert.equal(classifyClimbGrade(10), 'climb-8-12')
  assert.equal(classifyClimbGrade(15), 'climb-12-plus')
  assert.equal(classifyClimbGrade(-3), 'descent-0-7')
  assert.equal(classifyClimbGrade(-10), 'descent-7-plus')
})

test('classifyClimbGrade boundary values', () => {
  assert.equal(classifyClimbGrade(1), 'climb-1-4')
  assert.equal(classifyClimbGrade(4), 'climb-4-8')
  assert.equal(classifyClimbGrade(8), 'climb-8-12')
  assert.equal(classifyClimbGrade(12), 'climb-12-plus')
  assert.equal(classifyClimbGrade(0), 'climb-0-1')
  assert.equal(classifyClimbGrade(-7), 'descent-0-7')
})

test('builds segments of exactly the requested length, covering the climb start to end', () => {
  const geometry = buildStraightGeometry(2, 200)
  const climb = makeClimb({ startDistanceKm: 0, endDistanceKm: 2 })
  const profile = buildClimbProfile(geometry, climb, 500)
  assert.equal(profile.climbId, climb.id)
  assert.equal(profile.segmentLengthMeters, 500)
  assert.equal(profile.segments.length, 4)
  assert.equal(profile.segments[0].startDistanceKm, 0)
  assert.equal(Math.round(profile.segments[3].endDistanceKm * 1000) / 1000, 2)
})

test('the last segment is shorter when the climb length is not an exact multiple of the segment length', () => {
  const geometry = buildStraightGeometry(2.2, 220)
  const climb = makeClimb({ startDistanceKm: 0, endDistanceKm: 2.2 })
  const profile = buildClimbProfile(geometry, climb, 500)
  assert.equal(profile.segments.length, 5)
  const last = profile.segments[profile.segments.length - 1]
  const lastLengthKm = last.endDistanceKm - last.startDistanceKm
  assert.ok(lastLengthKm > 0 && lastLengthKm < 0.5)
})

test('segments carry start/end altitude and a consistent average gradient', () => {
  const geometry = buildStraightGeometry(1, 100)
  const climb = makeClimb({ startDistanceKm: 0, endDistanceKm: 1, elevationGainM: 100 })
  const profile = buildClimbProfile(geometry, climb, 500)
  assert.equal(profile.segments.length, 2)
  for (const segment of profile.segments) {
    assert.ok(segment.startAltitudeM !== null)
    assert.ok(segment.endAltitudeM !== null)
    assert.ok(segment.endAltitudeM > segment.startAltitudeM)
    assert.ok(segment.averageGradientPercent > 0)
    assert.equal(segment.gradeClass, classifyClimbGrade(segment.averageGradientPercent))
  }
})

test('segment indices are ordered deterministically from 0', () => {
  const geometry = buildStraightGeometry(2.5, 250)
  const climb = makeClimb({ startDistanceKm: 0, endDistanceKm: 2.5 })
  const profile = buildClimbProfile(geometry, climb, 500)
  assert.deepEqual(
    profile.segments.map((segment) => segment.index),
    profile.segments.map((_, index) => index),
  )
})

test('never mutates the source route geometry', () => {
  const geometry = buildStraightGeometry(2, 200)
  const snapshot = JSON.parse(JSON.stringify(geometry))
  const climb = makeClimb({ startDistanceKm: 0, endDistanceKm: 2 })
  buildClimbProfile(geometry, climb, 500)
  assert.deepEqual(geometry, snapshot)
})

test('a climb located mid-route (not starting at distance 0) still slices the correct window', () => {
  const geometry = buildStraightGeometry(10, 500)
  // The climb is somewhere in the middle of a 10 km route.
  const climb = makeClimb({ startDistanceKm: 4, endDistanceKm: 6, elevationGainM: 100 })
  const profile = buildClimbProfile(geometry, climb, 500)
  assert.equal(profile.segments.length, 4)
  assert.equal(profile.segments[0].startDistanceKm, 4)
  assert.equal(Math.round(profile.segments[profile.segments.length - 1].endDistanceKm * 1000) / 1000, 6)
})

test('an empty or single-point geometry yields no segments rather than throwing', () => {
  const climb = makeClimb({ startDistanceKm: 0, endDistanceKm: 2 })
  assert.deepEqual(buildClimbProfile([], climb, 500).segments, [])
  assert.deepEqual(buildClimbProfile([geometryPoint(45, 6, 1000)], climb, 500).segments, [])
})
