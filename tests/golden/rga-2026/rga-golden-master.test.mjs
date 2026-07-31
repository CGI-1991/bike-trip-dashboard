import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildRgaGolden } from '../../../scripts/generate-rga-golden.mjs'
import { buildParityMatrix } from './compare-rga-snapshots.mjs'

const projectRoot = new URL('../../../', import.meta.url)
const goldenPath = new URL('rga-2026-golden.json', import.meta.url)
const generatorScriptPath = fileURLToPath(new URL('../../../scripts/generate-rga-golden.mjs', import.meta.url))
const projectRootPath = fileURLToPath(projectRoot)

const golden = await buildRgaGolden()
const committedRaw = await readFile(goldenPath, 'utf8')
const committed = JSON.parse(committedRaw)

function matrixEntry(matrix, domainId) {
  const entry = matrix.find((candidate) => candidate.domain === domainId)
  assert.ok(entry, `expected a parity matrix entry for domain "${domainId}"`)
  return entry
}

test('the freshly rebuilt golden master is byte-identical to the committed file — no silent drift', () => {
  const freshSerialized = `${JSON.stringify(golden, null, 2)}\n`
  assert.equal(freshSerialized, committedRaw)
})

test('building the golden master twice in a row produces byte-identical results (deterministic)', async () => {
  const again = await buildRgaGolden()
  assert.deepEqual(again, golden)
  assert.equal(JSON.stringify(again), JSON.stringify(golden))
})

// --- independent, hardcoded assertions per required-exact domain ---------
// These do not merely compare against the committed golden.json (which could
// itself be updated to mask a regression) — they assert the actual semantic
// invariant directly, so a domain silently downgrading from `exact` fails
// here regardless of what's committed.

test('metadata_and_calendar, days, stages, source_files, canonical_package, documented_points, practical_places, accommodations, settings and offline_resources are all exact', () => {
  const requiredExact = [
    'metadata_and_calendar',
    'days',
    'stages',
    'source_files',
    'canonical_package',
    'documented_points',
    'practical_places',
    'accommodations',
    'settings',
    'offline_resources',
  ]
  for (const domainId of requiredExact) {
    const entry = matrixEntry(golden.parityMatrix, domainId)
    assert.equal(entry.status, 'exact', `domain "${domainId}" must be exact, was "${entry.status}"`)
  }
})

test('weather is classified dynamic-excluded, never exact/deferred/mismatch', () => {
  assert.equal(matrixEntry(golden.parityMatrix, 'weather').status, 'dynamic-excluded')
})

test('roadbook_editorial_source_preserved is classified source-preserved, never exact', () => {
  assert.equal(matrixEntry(golden.parityMatrix, 'roadbook_editorial_source_preserved').status, 'source-preserved')
})

test('route_geometry_and_stage_timings is classified deferred, never presented as exact parity', () => {
  assert.equal(matrixEntry(golden.parityMatrix, 'route_geometry_and_stage_timings').status, 'deferred')
})

test('every parity matrix entry has one of the five known statuses — no unclassified divergence', () => {
  const known = new Set(['exact', 'source-preserved', 'dynamic-excluded', 'deferred', 'mismatch'])
  for (const entry of golden.parityMatrix) assert.ok(known.has(entry.status), `unknown status for ${entry.domain}: ${entry.status}`)
  assert.equal(golden.parityMatrix.filter((entry) => entry.status === 'mismatch').length, 0)
})

// --- explicit numeric relations (CDC phase 4 section 6 "points documentés") ---

test('53 documented point candidates = 46 matched + 4 needs-review + 3 unmatched overrides', () => {
  const pc = golden.legacy.roadbook.pointCounts
  assert.equal(pc.documentedPointCandidates, 53)
  assert.equal(pc.roadbookOverrides, 53)
  assert.equal(pc.matchedOverrides, 46)
  assert.equal(pc.needsReviewOverrides, 4)
  assert.equal(pc.unmatchedOverrides, 3)
  assert.equal(pc.roadbookOverrides, pc.matchedOverrides + pc.needsReviewOverrides + pc.unmatchedOverrides)
})

test('7 suppressed = 4 needs-review + 3 unmatched', () => {
  const pc = golden.legacy.roadbook.pointCounts
  assert.equal(pc.suppressed, 7)
  assert.equal(pc.suppressed, pc.needsReviewOverrides + pc.unmatchedOverrides)
  assert.equal(golden.legacy.roadbook.suppressedPointIds.length, 7)
})

test('71 operational = 78 documented − 7 suppressed, cross-checked against the live matching pipeline', () => {
  const pc = golden.legacy.roadbook.pointCounts
  assert.equal(pc.documentedObjectCount, 78)
  assert.equal(pc.operationalObjectCount, 71)
  assert.equal(pc.operationalObjectCount, pc.documentedObjectCount - pc.suppressed)
  assert.equal(golden.legacy.roadbookMatchSummary.pointCount, 71, 'buildRoadbookMatchReport().summary.pointCount must agree with the hand-derived 71')
})

test('the 46 TripBundle RoutePoint correspond exactly to the 46 matched overrides — never a needs-review or unmatched one', () => {
  assert.equal(golden.tripBundle.routePoints.length, 46)
  assert.equal(golden.tripBundle.routePoints.length, golden.legacy.roadbook.pointCounts.matchedOverrides)
  for (const point of golden.tripBundle.routePoints) {
    assert.equal(point.confidence, 'high')
    assert.equal(point.manuallyOverridden, true)
  }
})

test('documented candidate, operational historical object, and TripBundle RoutePoint are three distinct counts, never conflated', () => {
  const pc = golden.legacy.roadbook.pointCounts
  const distinctValues = new Set([pc.documentedPointCandidates, pc.operationalObjectCount, golden.tripBundle.routePoints.length])
  // documentedPointCandidates (53) and operationalObjectCount (71) and RoutePoint count (46) are pairwise different —
  // if a future change accidentally collapses two of these concepts, this guards against silently treating them as one.
  assert.equal(distinctValues.size, 3)
})

// --- practical places -----------------------------------------------------

test('1,705 practical places across exactly 8 categories, 449 multi-day, identical between legacy and TripBundle', () => {
  assert.equal(golden.legacy.practicalPlaces.totalCount, 1705)
  assert.equal(golden.tripBundle.practicalPlaces.totalCount, 1705)
  assert.equal(Object.keys(golden.legacy.practicalPlaces.byCategory).length, 8)
  assert.equal(Object.keys(golden.tripBundle.practicalPlaces.byCategory).length, 8)
  assert.equal(golden.legacy.practicalPlaces.multiDayCount, 449)
  assert.equal(golden.tripBundle.practicalPlaces.multiDayCount, 449)
  assert.equal(golden.legacy.practicalPlaces.dayIdShapeHash, golden.tripBundle.practicalPlaces.dayIdShapeHash)
})

// --- offline resources — real, computed counts, not a hardcoded assumption ---

test('the offline resource inventory is computed, not assumed: historical + canonical package, no duplicates, no absolute URL, no Windows path', () => {
  const offline = golden.legacy.offline
  assert.equal(offline.tripPackageResourceCount, golden.canonical.fileCount)
  assert.equal(offline.tripPackageResourceCount, 16)
  assert.equal(offline.duplicateCount, 0)
  assert.equal(offline.hasAbsoluteUrl, false)
  assert.equal(offline.hasWindowsPath, false)
  assert.equal(offline.combinedResourceCount, offline.historicalResourceCount + offline.tripPackageResourceCount)
  // Documented discrepancy vs. the CDC's assumed "30 total precached resources": the
  // real, current count is historicalResourceCount(20) + tripPackageResourceCount(16)
  // = 36. Asserting the actual computed value here, per this phase's own "never
  // assume a number" rule — see docs/rga-trip-bundle-parity.md.
  assert.equal(offline.historicalResourceCount, 20)
  assert.equal(offline.combinedResourceCount, 36)
})

// --- weather: dynamic-excluded contract -------------------------------------

test('weather: the TripBundle canonical snapshot never freezes a real forecast or a dynamic fetch timestamp', () => {
  assert.deepEqual(golden.tripBundle.weatherCount, 0)
})

test('weather: no real forecast payload or dynamic date is present anywhere in the canonical package or the golden file', async () => {
  const canonicalWeatherLike = JSON.stringify(golden.canonical).match(/temperatureC|precipitationProbability|weatherCode/g)
  assert.equal(canonicalWeatherLike, null)
  const goldenText = JSON.stringify(golden)
  assert.doesNotMatch(goldenText, /open-meteo\.com/)
})

// --- protection against automatic/accidental rewrites -----------------------

test('running the CLI in --check mode writes nothing to the golden file', async () => {
  const before = await readFile(goldenPath, 'utf8')
  const output = execFileSync(process.execPath, [generatorScriptPath, '--check'], { cwd: projectRootPath, encoding: 'utf8' })
  assert.match(output, /conforme/)
  const after = await readFile(goldenPath, 'utf8')
  assert.equal(after, before)
})

test('running the CLI in --check mode writes nothing under public/trips/rga-2026/ or public/data/', async () => {
  const manifestPath = new URL('public/trips/rga-2026/manifest.json', projectRoot)
  const roadbookPath = new URL('public/data/trip/roadbook.json', projectRoot)
  const [manifestBefore, roadbookBefore] = await Promise.all([readFile(manifestPath), readFile(roadbookPath)])
  execFileSync(process.execPath, [generatorScriptPath, '--check'], { cwd: projectRootPath, encoding: 'utf8' })
  const [manifestAfter, roadbookAfter] = await Promise.all([readFile(manifestPath), readFile(roadbookPath)])
  assert.ok(manifestBefore.equals(manifestAfter))
  assert.ok(roadbookBefore.equals(roadbookAfter))
})

test('the comparator itself catches a real regression: a genuinely broken TripBundle snapshot downgrades days/stages to mismatch', () => {
  const brokenTripBundle = JSON.parse(JSON.stringify(golden.tripBundle))
  brokenTripBundle.counts.offDays = 0 // simulate an off day silently turning into a ride day
  brokenTripBundle.days = brokenTripBundle.days.map((day) => (day.type === 'off' ? { ...day, type: 'ride' } : day))
  const brokenMatrix = buildParityMatrix(golden.legacy, golden.canonical, brokenTripBundle)
  assert.equal(brokenMatrix.find((entry) => entry.domain === 'days').status, 'mismatch')
})

test('the comparator catches a stage editorial statistic silently drifting from the roadbook', () => {
  const brokenTripBundle = JSON.parse(JSON.stringify(golden.tripBundle))
  brokenTripBundle.stages[0].distanceKm += 1
  const brokenMatrix = buildParityMatrix(golden.legacy, golden.canonical, brokenTripBundle)
  assert.equal(brokenMatrix.find((entry) => entry.domain === 'stages').status, 'mismatch')
})

test('the comparator catches a deferred domain quietly becoming non-null without reclassification', () => {
  const brokenTripBundle = JSON.parse(JSON.stringify(golden.tripBundle))
  brokenTripBundle.stages[0].minAltitudeM = 210 // e.g. someone starts populating this without updating the domain's status
  const brokenMatrix = buildParityMatrix(golden.legacy, golden.canonical, brokenTripBundle)
  assert.equal(brokenMatrix.find((entry) => entry.domain === 'route_geometry_and_stage_timings').status, 'mismatch')
})

test('this does not fail merely because a domain that is officially still deferred remains deferred', () => {
  // Rebuilding from the exact same (unmodified) snapshots must NOT report a mismatch —
  // the golden master only fails on an actual change, never on the steady state.
  const matrix = buildParityMatrix(golden.legacy, golden.canonical, golden.tripBundle)
  assert.equal(matrix.find((entry) => entry.domain === 'route_geometry_and_stage_timings').status, 'deferred')
})
