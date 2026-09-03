import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

/**
 * UI-POLISH-01 section 24/39: "Mes voyages" used to show the internal
 * `TripStatus` word raw ("ready") and a raw ISO date range
 * ("2027-05-10 → 2027-05-13") — neither is acceptable user-facing copy.
 * "Supprimer" also used to share the exact same quiet/neutral style as
 * "Modifier", with nothing marking it as the destructive action.
 */

function createFakeContainer() {
  let innerHTMLValue = ''
  const listeners = { click: [], change: [], input: [] }
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value },
    addEventListener(type, listener, options) {
      listeners[type] ??= []
      listeners[type].push(listener)
      options?.signal?.addEventListener?.('abort', () => {
        listeners[type] = listeners[type].filter((candidate) => candidate !== listener)
      })
    },
    dispatch(type, event) { for (const listener of [...(listeners[type] ?? [])]) listener(event) },
    querySelector() { return null },
    querySelectorAll() { return [] },
    contains() { return true },
  }
}

function stubWeatherProvider() {
  return {
    id: 'open-meteo',
    async fetchForecast(request) {
      return { provider: 'open-meteo', requestKey: request.key, fetchedAt: '2027-01-01T00:00:00.000Z', status: 'error', locations: [], datesCovered: [], issues: ['test stub'] }
    },
  }
}

function noopDeps(database, extra = {}) {
  return {
    database, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
    renderMap: () => {}, closeMap: () => {}, weatherProvider: stubWeatherProvider(),
    ...extra,
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

test('Mes voyages never shows a raw ISO date range or a raw TripStatus word — French, human copy instead', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle() // status: 'ready', 2027-05-10 → 2027-05-13
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()

    assert.match(container.innerHTML, /data-trips-list/, 'the list actually rendered')
    assert.doesNotMatch(container.innerHTML, /2027-05-10/, 'no raw ISO start date')
    assert.doesNotMatch(container.innerHTML, /2027-05-13/, 'no raw ISO end date')
    assert.doesNotMatch(container.innerHTML, />ready</, 'no raw internal status word')
    assert.match(container.innerHTML, /10 mai → 13 mai 2027/, 'a short, human date range instead')
  } finally {
    db.close()
  }
})

// R1 section 23 ("silence when healthy"): `ready` is the permanent, never-
// actionable default every dated trip gets at import — no badge at all, not
// even a translated one, since it carries no real business signal.
test('R1: a "ready" trip card shows no status badge at all — that state is the silent default, not a business status', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle() // status: 'ready'
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()

    assert.doesNotMatch(container.innerHTML, /<span class="tag tag--data">/, 'no status badge rendered for a ready trip')
    assert.doesNotMatch(container.innerHTML, />Prêt</)
  } finally {
    db.close()
  }
})

function stubPracticalPlacesProvider() {
  return {
    id: 'stub-practical', sourceType: 'osm', attribution: 'x',
    async findCandidates() {
      return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' }
    },
  }
}

// --- RC2 final-closeout sections 19-20/75: "Mes voyages" own preparation indicator ---

test('RC2 sections 19-20: a trip mid-enrichment shows a discreet, jargon-free indicator with a ready/total count', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    bundle.enrichmentMetadata = {
      providers: [{ provider: 'postpass-practical-places', status: 'partial', lastAttemptedAt: '2027-05-01T08:00:00.000Z', lastSuccessAt: '2027-05-01T08:00:00.000Z', message: null }],
      practicalPlacesStageErrors: ['day-delta'],
    }
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db, { practicalPlacesProvider: stubPracticalPlacesProvider() }))
    await flush()

    assert.match(container.innerHTML, /trip-card__prep/)
    assert.match(container.innerHTML, /Préparation du roadbook · 1\/2/, 'day-alpha ready, day-delta not — a plain ready\/total count')
    assert.doesNotMatch(container.innerHTML, /Postpass|cache|provider|retained/i, 'no technical/network jargon (section 20)')
  } finally {
    db.close()
  }
})

test('RC2 sections 19-20: no indicator at all once every ride day is ready — silence when healthy, even with a provider configured', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    bundle.enrichmentMetadata = {
      providers: [{ provider: 'postpass-practical-places', status: 'success', lastAttemptedAt: '2027-05-01T08:00:00.000Z', lastSuccessAt: '2027-05-01T08:00:00.000Z', message: null }],
    }
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db, { practicalPlacesProvider: stubPracticalPlacesProvider() }))
    await flush()

    assert.doesNotMatch(container.innerHTML, /trip-card__prep/)
    assert.doesNotMatch(container.innerHTML, /Préparation du roadbook/)
  } finally {
    db.close()
  }
})

test('an undated trip shows "Non daté", never null/undefined/an ISO string', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle({ dated: false }) // status: 'draft', no dates
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()

    assert.match(container.innerHTML, /<dd>Non daté<\/dd>/)
    assert.match(container.innerHTML, /<span class="tag tag--data">Brouillon<\/span>/)
    assert.doesNotMatch(container.innerHTML, />draft</)
  } finally {
    db.close()
  }
})

test('"Supprimer" is styled as a discreet destructive action, distinct from "Modifier" — never as prominent as "Créer un voyage"', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()

    assert.match(container.innerHTML, /<button class="button button--quiet" type="button" data-action="edit-trip"[^>]*>Modifier<\/button>/)
    assert.match(container.innerHTML, /<button class="button button--danger" type="button" data-action="delete-trip"[^>]*>Supprimer<\/button>/)
    assert.doesNotMatch(container.innerHTML, /button--primary" type="button" data-action="delete-trip"/, 'delete must never be the primary-styled action')
  } finally {
    db.close()
  }
})
