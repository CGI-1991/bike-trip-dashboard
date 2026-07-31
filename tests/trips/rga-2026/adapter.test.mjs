import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../../src/trip-core/index.ts'
import { createRgaLegacyTripBundle } from '../../../src/trips/rga-2026/load-rga-legacy-trip.ts'
import { FAKE_PUBLIC_BASE_URL, createFakePublicFetch } from '../../support/fake-public-fetch.mjs'
import { loadRgaLegacySnapshotFromDisk } from './support/load-snapshot.mjs'

test('createRgaLegacyTripBundle returns a TripBundle that validateTripBundle accepts', async () => {
  const { snapshot } = await loadRgaLegacySnapshotFromDisk()
  const bundle = createRgaLegacyTripBundle(snapshot)
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, true)
})

test('the same snapshot always produces a deeply identical bundle (deterministic construction)', async () => {
  const { snapshot } = await loadRgaLegacySnapshotFromDisk()
  const first = createRgaLegacyTripBundle(snapshot)
  const second = createRgaLegacyTripBundle(snapshot)
  assert.deepEqual(first, second)
})

test('construction never mutates the input snapshot', async () => {
  const { snapshot } = await loadRgaLegacySnapshotFromDisk()
  const before = structuredClone(snapshot)
  createRgaLegacyTripBundle(snapshot)
  assert.deepEqual(snapshot, before)
})

test('the adapter never reads the current time — timestamps are the fixed migration constant', async () => {
  const { snapshot } = await loadRgaLegacySnapshotFromDisk()
  const bundle = createRgaLegacyTripBundle(snapshot)
  const { RGA_MIGRATION_TIMESTAMP } = await import('../../../src/trips/rga-2026/rga-legacy-constants.ts')
  assert.equal(bundle.metadata.createdAt, RGA_MIGRATION_TIMESTAMP)
  assert.equal(bundle.metadata.updatedAt, RGA_MIGRATION_TIMESTAMP)
  for (const sourceFile of bundle.sourceFiles) assert.equal(sourceFile.importedAt, RGA_MIGRATION_TIMESTAMP)
})

test('an invalid snapshot (e.g. a duplicated day number) is rejected with a precise error, never returned silently', async () => {
  const { snapshot } = await loadRgaLegacySnapshotFromDisk()
  const broken = {
    ...snapshot,
    roadbook: {
      ...snapshot.roadbook,
      // Collide day 2's number with day 1's, so both map to the same generic TripDayId.
      days: snapshot.roadbook.days.map((day, index) => (index === 1 ? { ...day, dayNumber: snapshot.roadbook.days[0].dayNumber } : day)),
    },
  }
  assert.throws(() => createRgaLegacyTripBundle(broken), /TripBundle RGA 2026 invalide/)
})

test('a practical place referencing an unknown historical day fails fast with a precise error', async () => {
  const { snapshot } = await loadRgaLegacySnapshotFromDisk()
  const broken = {
    ...snapshot,
    practicalData: {
      ...snapshot.practicalData,
      points: [{ ...snapshot.practicalData.points[0], dayIds: ['J-does-not-exist'] }, ...snapshot.practicalData.points.slice(1)],
    },
  }
  assert.throws(() => createRgaLegacyTripBundle(broken), /Journée historique inconnue/)
})

// `loadRgaLegacyTrip` defaults to resolving paths through Vite's
// `import.meta.env.BASE_URL`, which plain `node --test` does not provide
// (confirmed: it is `undefined` outside a Vite build/dev server — the reason
// every other fetch-based loader in this codebase, e.g. `src/gpx/load.ts`'s
// `loadGpxSources`, has historically gone untested directly). Passing an
// explicit `publicBaseUrl` (via `createFakePublicFetch`) sidesteps that
// global entirely, so the function can be exercised for real here, fetch and
// all — see `tests/support/fake-public-fetch.mjs`.

test('loadRgaLegacyTrip fetches the canonical package (via an injected fetch and base URL) and matches the pure constructor', async () => {
  const projectRoot = new URL('../../../', import.meta.url)
  const { loadRgaLegacyTrip } = await import('../../../src/trips/rga-2026/load-rga-legacy-trip.ts')
  const bundle = await loadRgaLegacyTrip(createFakePublicFetch(projectRoot), FAKE_PUBLIC_BASE_URL)

  const { snapshot } = await loadRgaLegacySnapshotFromDisk()
  const expected = createRgaLegacyTripBundle(snapshot)
  assert.deepEqual(bundle, expected)
})

test('loadRgaLegacyTrip surfaces a precise error when a resource is unreachable', async () => {
  const { loadRgaLegacyTrip } = await import('../../../src/trips/rga-2026/load-rga-legacy-trip.ts')
  const alwaysFails = async () => ({ ok: false, status: 404, json: async () => { throw new Error('unused') } })
  await assert.rejects(() => loadRgaLegacyTrip(alwaysFails, FAKE_PUBLIC_BASE_URL), /inaccessible \(HTTP 404\)/)
})

test('two loadRgaLegacyTrip calls against the same resources produce deeply identical bundles', async () => {
  const projectRoot = new URL('../../../', import.meta.url)
  const { loadRgaLegacyTrip } = await import('../../../src/trips/rga-2026/load-rga-legacy-trip.ts')
  const first = await loadRgaLegacyTrip(createFakePublicFetch(projectRoot), FAKE_PUBLIC_BASE_URL)
  const second = await loadRgaLegacyTrip(createFakePublicFetch(projectRoot), FAKE_PUBLIC_BASE_URL)
  assert.deepEqual(first, second)
})
