import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOverviewMapModel } from '../../src/ui/overview-map-model.ts'
import { rga2026TripPlan } from '../../src/trip/plan.ts'

function gpxFile(fileName, coordinates) {
  return {
    status: 'success',
    source: { fileName },
    segments: [{ points: coordinates.map(([latitude, longitude]) => ({ latitude, longitude, elevationM: 500 })) }],
  }
}

function reportFromDays(dayIds) {
  const files = dayIds.map((dayId, index) => {
    const day = rga2026TripPlan.days.find(({ id }) => id === dayId)
    return gpxFile(day.gpxFile, [[46 + index / 10, 6], [46 + index / 10 + 0.01, 6.1]])
  })
  return { status: 'success', detectedFileCount: files.length, successfulFileCount: files.length, failedFileCount: 0, configuredStageCount: files.length, files }
}

const rideDayIds = rga2026TripPlan.days.filter((day) => day.type === 'ride').map((day) => day.id)

test('merges every successfully-parsed ride day into its own track, in trip order', () => {
  const report = reportFromDays(rideDayIds)
  const model = buildOverviewMapModel(rga2026TripPlan, report, 'J1', null)
  assert.equal(model.tracks.length, 10)
  assert.deepEqual(model.tracks.map((track) => track.dayId), rideDayIds)
})

test('a day whose GPX failed to parse is simply absent — never a fabricated straight line', () => {
  const report = reportFromDays(rideDayIds.filter((id) => id !== 'J6'))
  const model = buildOverviewMapModel(rga2026TripPlan, report, 'J1', null)
  assert.equal(model.tracks.length, 9)
  assert.ok(!model.tracks.some((track) => track.dayId === 'J6'))
})

test('marks the current day distinctly from past and future days', () => {
  const report = reportFromDays(rideDayIds)
  const model = buildOverviewMapModel(rga2026TripPlan, report, 'J4', null)
  const byId = new Map(model.tracks.map((track) => [track.dayId, track.state]))
  assert.equal(byId.get('J1'), 'past')
  assert.equal(byId.get('J2'), 'past')
  assert.equal(byId.get('J3'), 'past')
  assert.equal(byId.get('J4'), 'current')
  assert.equal(byId.get('J6'), 'future')
  assert.equal(byId.get('J12'), 'future')
})

test('marks a general departure at Thonon (J1 start), one finish marker per ride day, and a final arrival at Nice', () => {
  const report = reportFromDays(rideDayIds)
  const model = buildOverviewMapModel(rga2026TripPlan, report, 'J1', null)
  const start = model.markers.find((marker) => marker.kind === 'start')
  assert.ok(start)
  assert.match(start.name, /Thonon-les-Bains/)
  const finishMarkers = model.markers.filter((marker) => marker.kind === 'finish')
  assert.equal(finishMarkers.length, 10)
  const finalArrival = finishMarkers.find((marker) => marker.id === 'overview-finish-J12')
  assert.ok(finalArrival)
  assert.match(finalArrival.name, /Nice/)
  assert.equal(model.markers.filter((marker) => marker.kind === 'start').length, 1, 'only one general departure marker, not one per day')
})

test('a null theoretical position adds no position marker; a real one adds exactly one', () => {
  const report = reportFromDays(rideDayIds)
  const withoutPosition = buildOverviewMapModel(rga2026TripPlan, report, 'J1', null)
  assert.equal(withoutPosition.markers.some((marker) => marker.kind === 'position'), false)

  const withPosition = buildOverviewMapModel(rga2026TripPlan, report, 'J4', { latitude: 45.5, longitude: 6.5, altitudeM: 1_000, distanceKm: 10, elevationGainM: 300, elevationLossM: 50, dayProgress: 0.3, isPaused: false })
  const positionMarkers = withPosition.markers.filter((marker) => marker.kind === 'position')
  assert.equal(positionMarkers.length, 1)
  assert.deepEqual(positionMarkers[0].coordinate, [45.5, 6.5])
})

test('never includes practical/KML layers or full roadbook point sets — only tracks and the minimal markers', () => {
  const report = reportFromDays(rideDayIds)
  const model = buildOverviewMapModel(rga2026TripPlan, report, 'J1', null)
  assert.equal(model.markers.length, 1 + 10, 'exactly one departure marker plus one finish marker per ride day')
})

test('with no GPX report at all, the model is empty rather than throwing', () => {
  const model = buildOverviewMapModel(rga2026TripPlan, null, 'J1', null)
  assert.deepEqual(model.tracks, [])
  assert.deepEqual(model.markers, [])
})
