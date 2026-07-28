import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))

test('audits all 78 documented objects across ten final GPX files', async () => {
  const [audit, manifest] = await Promise.all([
    readJson('docs/point-data-audit-2026-07-28.json'),
    readJson('public/data/gpx/manifest.json'),
  ])
  assert.equal(audit.points.length, 78)
  assert.equal(new Set(audit.points.map(({ id }) => id)).size, 78)
  assert.equal(manifest.files.length, 10)
  assert.equal(audit.summary.rideDayCount, 10)
  assert.equal(audit.summary.offDayCount, 2)
})

test('rebuilt overrides preserve anchors and regenerate segment projections', async () => {
  const overrides = await readJson('public/data/trip/roadbook-overrides.json')
  assert.equal(overrides.overrides.length, 53)
  for (const override of overrides.overrides) {
    assert.ok(Number.isFinite(override.sourceAnchor.latitude))
    assert.ok(Number.isFinite(override.sourceAnchor.longitude))
    assert.ok(Number.isInteger(override.gpxProjection.segmentIndex))
    assert.ok(Number.isInteger(override.gpxProjection.pointIndex))
    assert.ok(Number.isInteger(override.gpxProjection.nextPointIndex))
    assert.ok(override.gpxProjection.segmentFraction >= 0 && override.gpxProjection.segmentFraction <= 1)
    assert.ok(Number.isFinite(override.gpxProjection.trackDistanceKm))
    assert.equal(override.matchMethod, 'manual-anchor-reprojected-current-gpx')
  }
})

test('no documented location falls back implicitly to the stage start', async () => {
  const audit = await readJson('docs/point-data-audit-2026-07-28.json')
  const geographic = audit.points.filter(({ geometricStatus }) => geometricStatus !== 'editorial-group')
  assert.equal(geographic.every(({ projection }) => projection !== null), true)
  assert.equal(audit.summary.unresolvedGeographicCount, 0)
  assert.equal(
    audit.points.some(({ type, trackDistanceKm, etaReference }) =>
      !['start'].includes(type) && trackDistanceKm === 0 && etaReference === '08:00'),
    false,
  )
})

test('off-route references keep real coordinates and an independent GPX reference', async () => {
  const audit = await readJson('docs/point-data-audit-2026-07-28.json')
  const references = audit.points.filter(({ role }) => role === 'weather-reference')
  assert.deepEqual(references.map(({ id }) => id).sort(), [
    'j01-passage-bellevaux',
    'j03-passage-crest-voland',
    'j04-passage-areches',
    'j04-passage-les-chapieux',
    'j06-passage-tignes',
    'j09-passage-chateau-queyras',
  ])
  for (const point of references) {
    assert.equal(point.sourceCoordinates.length, 2)
    assert.ok(point.projection)
    assert.ok(point.distanceToTrackM > 0)
    assert.equal(point.riskPolicy, 'excluded')
  }
})

test('editorial pause groups do not become extra geographic places', async () => {
  const audit = await readJson('docs/point-data-audit-2026-07-28.json')
  const groups = audit.points.filter(({ type }) => type === 'pause')
  assert.equal(groups.length, 5)
  assert.equal(groups.every(({ role, projection }) => role === 'information' && projection === null), true)
  const bonette = audit.points.find(({ id }) => id === 'j10-option-cime-de-la-bonette')
  assert.equal(bonette.role, 'not-ridden-option')
  assert.equal(bonette.riskPolicy, 'excluded')
})

test('the audit distinguishes historical, operational and suppressed counts, recalculated rather than hard-coded', async () => {
  const audit = await readJson('docs/point-data-audit-2026-07-28.json')
  const { summary } = audit

  const suppressedIds = [
    'j01-passage-bellevaux',
    'j03-passage-crest-voland',
    'j04-passage-areches',
    'j04-passage-les-chapieux',
    'j06-passage-tignes',
    'j09-passage-chateau-queyras',
    'j10-option-cime-de-la-bonette',
  ]

  // Historical: the source (roadbook.json / roadbook-rga-2026.md) is never edited.
  assert.equal(summary.documentedObjectCount, 78)
  // Operational + suppressed must recompute to the historical total, never hard-coded.
  assert.equal(summary.operationalObjectCount + summary.suppressedObjectCount, summary.documentedObjectCount)
  assert.equal(summary.suppressedObjectCount, 7)
  assert.equal(summary.operationalObjectCount, 71)
  assert.deepEqual([...summary.suppressedPointIds].sort(), [...suppressedIds].sort())

  const suppressedPoints = audit.points.filter(({ id }) => suppressedIds.includes(id))
  assert.equal(suppressedPoints.length, 7)
  assert.ok(suppressedPoints.every(({ operationalStatus }) => operationalStatus === 'suppressed'))
  assert.ok(suppressedPoints.every(({ displayPolicy }) => displayPolicy === 'hidden-suppressed'))
  assert.ok(suppressedPoints.every(({ weatherAvailable }) => weatherAvailable === false))
  assert.ok(suppressedPoints.every(({ riskPolicy }) => riskPolicy === 'excluded'))

  const operationalPoints = audit.points.filter(({ id }) => !suppressedIds.includes(id))
  assert.equal(operationalPoints.length, 71)
  assert.ok(operationalPoints.every(({ operationalStatus }) => operationalStatus === 'operational'))
})