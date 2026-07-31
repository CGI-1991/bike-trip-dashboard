import assert from 'node:assert/strict'
import test from 'node:test'

import { createRgaLegacyTripBundle } from '../../../src/trips/rga-2026/load-rga-legacy-trip.ts'
import { loadRgaLegacySnapshotFromDisk } from './support/load-snapshot.mjs'

const { snapshot } = await loadRgaLegacySnapshotFromDisk()
const bundle = createRgaLegacyTripBundle(snapshot)

test('exactly 12 days, 10 ride, 2 off', () => {
  assert.equal(bundle.days.length, 12)
  assert.equal(bundle.days.filter((day) => day.type === 'ride').length, 10)
  assert.equal(bundle.days.filter((day) => day.type === 'off').length, 2)
  assert.equal(bundle.days.filter((day) => day.type === 'transfer').length, 0)
})

test('exactly 10 stages, 10 routes, 10 source files', () => {
  assert.equal(bundle.stages.length, 10)
  assert.equal(bundle.routes.length, 10)
  assert.equal(bundle.sourceFiles.length, 10)
})

test('every ride day has exactly one stage, and no stage is orphaned', () => {
  const rideDays = bundle.days.filter((day) => day.type === 'ride')
  for (const day of rideDays) {
    assert.notEqual(day.stageId, null)
    const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
    assert.ok(stage, `day ${day.id} should resolve to a stage`)
    assert.equal(stage.dayId, day.id)
  }
  const referencedStageIds = new Set(rideDays.map((day) => day.stageId))
  for (const stage of bundle.stages) assert.ok(referencedStageIds.has(stage.id), `stage ${stage.id} must not be orphaned`)
})

test('every stage resolves to a route, and every route references a source file', () => {
  for (const stage of bundle.stages) {
    const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
    assert.ok(route, `stage ${stage.id} should resolve to a route`)
    assert.notEqual(route.sourceFileId, null)
    const sourceFile = bundle.sourceFiles.find((candidate) => candidate.id === route.sourceFileId)
    assert.ok(sourceFile, `route ${route.id} should resolve to a source file`)
  }
})

test('day index 4 (the fifth day) and day index 7 (the eighth) are the two OFF days', () => {
  const sorted = [...bundle.days].sort((left, right) => left.index - right.index)
  assert.equal(sorted[4].type, 'off')
  assert.equal(sorted[4].displayNumber, 5)
  assert.equal(sorted[7].type, 'off')
  assert.equal(sorted[7].displayNumber, 8)
})

test('the two OFF days are at Bourg-Saint-Maurice and Briançon', () => {
  const sorted = [...bundle.days].sort((left, right) => left.index - right.index)
  assert.equal(sorted[4].startLocationName, 'Bourg-Saint-Maurice')
  assert.equal(sorted[4].endLocationName, 'Bourg-Saint-Maurice')
  assert.equal(sorted[7].startLocationName, 'Briançon')
  assert.equal(sorted[7].endLocationName, 'Briançon')
})

test('day order is preserved: displayNumber is 1..12 in ascending index order', () => {
  const sorted = [...bundle.days].sort((left, right) => left.index - right.index)
  assert.deepEqual(sorted.map((day) => day.displayNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  assert.deepEqual(sorted.map((day) => day.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
})

test('the final destination is preserved: the last day ends in Nice', () => {
  const sorted = [...bundle.days].sort((left, right) => left.index - right.index)
  const lastDay = sorted.at(-1)
  assert.equal(lastDay.type, 'ride')
  assert.equal(lastDay.endLocationName, 'Nice')
})

test('the first day starts at Thonon-les-Bains', () => {
  const sorted = [...bundle.days].sort((left, right) => left.index - right.index)
  assert.equal(sorted[0].startLocationName, 'Thonon-les-Bains')
})

test('ten distinct, exact GPX source file names are preserved', () => {
  const names = bundle.sourceFiles.map((file) => file.originalName)
  assert.equal(new Set(names).size, 10)
  assert.ok(names.every((name) => name.endsWith('.gpx')))
  assert.deepEqual(
    [...names].sort(),
    snapshot.gpxManifest.map((entry) => entry.fileName).sort(),
  )
})

test('every stage carries the roadbook editorial statistics exactly, with a matching provenance', () => {
  const rideDaysInOrder = snapshot.roadbook.days.filter((day) => day.type === 'ride')
  assert.equal(rideDaysInOrder.length, 10)
  for (const legacyDay of rideDaysInOrder) {
    const day = bundle.days.find((candidate) => candidate.displayNumber === legacyDay.dayNumber)
    const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
    assert.equal(stage.distanceKm, legacyDay.editorialStats.distanceKm)
    assert.equal(stage.elevationGainM, legacyDay.editorialStats.elevationGainM)
    assert.equal(stage.elevationLossM, legacyDay.editorialStats.elevationLossM)
    assert.notEqual(stage.metricsProvenance, null)
    assert.equal(stage.metricsProvenance.sourceType, 'migrated')
    assert.equal(stage.metricsProvenance.confidence, 'medium')
    assert.equal(stage.metricsProvenance.manuallyOverridden, false)
    assert.match(stage.metricsProvenance.sourceId, new RegExp(`\\[${legacyDay.id}\\]`))
  }
})

test('stage measures still left null (durations, ETA, min/max altitude) have no metricsProvenance requirement bypassed', () => {
  for (const stage of bundle.stages) {
    assert.equal(stage.minAltitudeM, null)
    assert.equal(stage.maxAltitudeM, null)
    assert.equal(stage.movingDurationSeconds, null)
    assert.equal(stage.pauseDurationSeconds, null)
    assert.equal(stage.totalDurationSeconds, null)
    assert.equal(stage.estimatedAverageSpeedKph, null)
  }
})

test('a variant label is folded into the stage name, when the historical day had one', () => {
  const bonetteDay = bundle.days.find((day) => day.displayNumber === 10)
  const stage = bundle.stages.find((candidate) => candidate.id === bonetteDay.stageId)
  assert.match(stage.name, /Bonette/)
})
