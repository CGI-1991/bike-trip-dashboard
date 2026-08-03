import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGpxXml, toGpxImportFile } from './support/fixtures.mjs'
import { runImport } from './support/run-import.mjs'

function climbFile(name, startLat) {
  const xml = buildGpxXml({
    tracks: [{ segments: [[{ lat: startLat, lon: 6, ele: 1000 }, { lat: startLat + 0.002, lon: 6.002, ele: 1050 }]] }],
  })
  return toGpxImportFile(xml, name)
}

test('a fixed startDate produces one consecutive civil day per stage, deterministically', async () => {
  const files = [climbFile('stage-1.gpx', 45), climbFile('stage-2.gpx', 46), climbFile('stage-3.gpx', 47)]
  const { result, database } = await runImport(files, { startDate: '2027-06-01', timezone: 'Europe/Paris' })
  try {
    assert.equal(result.ok, true)
    const { bundle } = result

    assert.equal(bundle.calendar.startDate, '2027-06-01')
    assert.equal(bundle.calendar.endDate, '2027-06-03')
    assert.equal(bundle.calendar.timezone, 'Europe/Paris')
    assert.equal(bundle.metadata.status, 'ready')
    assert.deepEqual(
      bundle.days.map((day) => day.date),
      ['2027-06-01', '2027-06-02', '2027-06-03'],
    )
  } finally {
    database.close()
  }
})

test('the same input produces byte-for-byte the same dates on every run — no dependency on the host clock', async () => {
  const files = [climbFile('stage-1.gpx', 45), climbFile('stage-2.gpx', 46)]
  const runA = await runImport(files, { startDate: '2027-06-01', timezone: 'Europe/Paris' })
  const runB = await runImport(files, { startDate: '2027-06-01', timezone: 'Europe/Paris' })
  try {
    assert.deepEqual(
      runA.result.bundle.days.map((day) => day.date),
      runB.result.bundle.days.map((day) => day.date),
    )
  } finally {
    runA.database.close()
    runB.database.close()
  }
})

test('startDate without an explicit timezone is refused — no implicit device-timezone detection', async () => {
  const { result, database } = await runImport([climbFile('stage-1.gpx', 45)], { startDate: '2027-06-01' })
  try {
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'validation-error')
  } finally {
    database.close()
  }
})
