import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'

installMinimalDOMParser()
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { importGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { enrichStoredTripEndpoints } from '../../src/geocoding/endpoint-enrichment.ts'
import { enrichStoredTripClimbNames } from '../../src/climb-names/enrichment.ts'
import { enrichStoredTripPracticalPlaces, PRACTICAL_PLACES_ENGINE_VERSION } from '../../src/practical-places/enrichment.ts'
import { enrichStoredTripRoute, ROUTE_ENRICHMENT_ENGINE_VERSION } from '../../src/route-enrichment/enrichment.ts'
import { createSourceFileRepository } from '../../src/storage/indexeddb/source-file-repository.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { accommodationId, overrideId, practicalPlaceId } from '../../src/trip-core/index.ts'
import { editGpxTrip, loadTripEditDraft } from '../../src/trips-manager/trip-editor.ts'
import { buildGpxXml, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { createIdFactory, fixedNow, openImportTestDatabase } from '../import/gpx/support/run-import.mjs'

function gpxFile(name, startLat = 45, gainM = 100, step = 0.004) {
  const xml = buildGpxXml({
    tracks: [{ name, segments: [[
      { lat: startLat, lon: 6, ele: 1000 },
      { lat: startLat + step / 2, lon: 6 + step / 2, ele: 1000 + gainM / 2 },
      { lat: startLat + step, lon: 6 + step, ele: 1000 + gainM },
    ]] }],
  })
  return toGpxImportFile(xml, name)
}

async function importTrip(database, files, dayStructure) {
  const result = await importGpxTrip({
    files,
    options: {
      tripId: 'trip-edit',
      slug: 'trip-edit',
      name: 'Voyage à modifier',
      startDate: '2027-06-01',
      timezone: 'Europe/Brussels',
      totalBreakMinutes: 'adaptive',
      importedAt: '2027-01-01T00:00:00.000Z',
      engineVersion: 'test-import@1',
    },
    database,
    idFactory: createIdFactory('original'),
    now: fixedNow('2027-01-01T00:00:00.000Z'),
    dayStructure,
  })
  assert.equal(result.ok, true)
  return result.bundle
}

async function edit(database, slots, prefix = 'edited') {
  return editGpxTrip({
    database,
    tripId: 'trip-edit',
    slots,
    idFactory: createIdFactory(prefix),
    now: fixedNow('2027-02-01T00:00:00.000Z'),
  })
}

async function bytesOf(database, sourceFileId) {
  const payload = await createSourceFileRepository(database).getSourceFilePayload('trip-edit', sourceFileId)
  assert.notEqual(payload, null)
  return Buffer.from(payload.content instanceof ArrayBuffer ? payload.content : await payload.content.arrayBuffer())
}

test('adding a GPX recalculates it and survives a full IndexedDB reload with byte-identical sources', async () => {
  const database = await openImportTestDatabase()
  try {
    const firstFile = gpxFile('first.gpx')
    await importTrip(database, [firstFile])
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const addedFile = gpxFile('added.gpx', 45.02, 180, 0.01)
    const result = await edit(database, [
      ...draft.slots,
      { kind: 'ride', existingDayId: null, existingSourceFileId: null, file: addedFile },
    ])
    assert.equal(result.ok, true)
    assert.equal(result.bundle.stages.length, 2)
    assert.equal(result.bundle.routes.length, 2)
    assert.equal(result.bundle.sourceFiles.length, 2)
    assert.ok(result.bundle.stages[1].distanceKm > result.bundle.stages[0].distanceKm)
    assert.ok(result.bundle.stages[1].movingDurationSeconds > 0)
    assert.ok(result.bundle.routes[1].profile.points.length > 0)

    const reloaded = await createTripRepository(database).loadTripBundle('trip-edit')
    assert.deepEqual(reloaded, result.bundle)
    assert.deepEqual(await bytesOf(database, result.bundle.sourceFiles[0].id), Buffer.from(firstFile.bytes))
    assert.deepEqual(await bytesOf(database, result.bundle.sourceFiles[1].id), Buffer.from(addedFile.bytes))
  } finally {
    database.close()
  }
})

test('replacing a GPX keeps the day but creates a new stage, route and source without retaining the old payload', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('original.gpx')])
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const oldDayId = original.days[0].id
    const oldStageId = original.stages[0].id
    const oldRouteId = original.routes[0].id
    const oldSourceId = original.sourceFiles[0].id
    const replacement = gpxFile('replacement.gpx', 45.1, 250, 0.015)
    const result = await edit(database, [{ ...draft.slots[0], file: replacement, existingSourceFileId: null }])

    assert.equal(result.ok, true)
    assert.equal(result.bundle.days[0].id, oldDayId)
    assert.notEqual(result.bundle.stages[0].id, oldStageId)
    assert.notEqual(result.bundle.routes[0].id, oldRouteId)
    assert.notEqual(result.bundle.sourceFiles[0].id, oldSourceId)
    assert.equal(await createSourceFileRepository(database).getSourceFilePayload('trip-edit', oldSourceId), null)
    assert.deepEqual(await bytesOf(database, result.bundle.sourceFiles[0].id), Buffer.from(replacement.bytes))
    assert.notEqual(result.bundle.stages[0].distanceKm, original.stages[0].distanceKm)
    assert.notEqual(result.bundle.stages[0].elevationGainM, original.stages[0].elevationGainM)
  } finally {
    database.close()
  }
})

test('removing a GPX stage removes its derived entities and source payload', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('one.gpx'), gpxFile('two.gpx', 45.02)])
    const removedSourceId = original.sourceFiles[1].id
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const result = await edit(database, [draft.slots[0]])
    assert.equal(result.ok, true)
    assert.equal(result.bundle.days.length, 1)
    assert.equal(result.bundle.stages.length, 1)
    assert.equal(result.bundle.routes.length, 1)
    assert.equal(await createSourceFileRepository(database).getSourceFilePayload('trip-edit', removedSourceId), null)
  } finally {
    database.close()
  }
})

test('reordering ride days preserves their identities and recomputes dates and display order', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('one.gpx'), gpxFile('two.gpx', 45.02)])
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const result = await edit(database, [draft.slots[1], draft.slots[0]])
    assert.equal(result.ok, true)
    assert.deepEqual(result.bundle.days.map((day) => day.id), [original.days[1].id, original.days[0].id])
    assert.deepEqual(result.bundle.days.map((day) => day.date), ['2027-06-01', '2027-06-02'])
    assert.deepEqual(result.bundle.days.map((day) => day.displayNumber), [1, 2])
    assert.deepEqual(result.bundle.sourceFiles.map((source) => source.id), [original.sourceFiles[1].id, original.sourceFiles[0].id])
  } finally {
    database.close()
  }
})

test('an OFF day can be added and removed with calendar dates recomputed each time', async () => {
  const database = await openImportTestDatabase()
  try {
    await importTrip(database, [gpxFile('one.gpx')])
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const added = await edit(database, [...draft.slots, { kind: 'off', existingDayId: null, notes: 'Repos' }], 'off-add')
    assert.equal(added.ok, true)
    assert.deepEqual(added.bundle.days.map((day) => day.type), ['ride', 'off'])
    assert.equal(added.bundle.days[1].notes, 'Repos')
    assert.equal(added.bundle.metadata.endDate, '2027-06-02')

    const withOff = await loadTripEditDraft(database, 'trip-edit')
    const removed = await edit(database, withOff.slots.filter((slot) => slot.kind !== 'off'), 'off-remove')
    assert.equal(removed.ok, true)
    assert.deepEqual(removed.bundle.days.map((day) => day.type), ['ride'])
    assert.equal(removed.bundle.metadata.endDate, '2027-06-01')
  } finally {
    database.close()
  }
})

test('a transfer can be added and removed without fabricating a ride stage', async () => {
  const database = await openImportTestDatabase()
  try {
    await importTrip(database, [gpxFile('one.gpx'), gpxFile('two.gpx', 45.02)])
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const added = await edit(database, [draft.slots[0], { kind: 'transfer', existingDayId: null, notes: 'Train' }, draft.slots[1]], 'transfer-add')
    assert.equal(added.ok, true)
    assert.deepEqual(added.bundle.days.map((day) => day.type), ['ride', 'transfer', 'ride'])
    assert.equal(added.bundle.days[1].stageId, null)
    assert.equal(added.bundle.stages.length, 2)

    const withTransfer = await loadTripEditDraft(database, 'trip-edit')
    const removed = await edit(database, withTransfer.slots.filter((slot) => slot.kind !== 'transfer'), 'transfer-remove')
    assert.equal(removed.ok, true)
    assert.deepEqual(removed.bundle.days.map((day) => day.type), ['ride', 'ride'])
  } finally {
    database.close()
  }
})

test('manual day data is preserved only on retained days and is not copied to a replacement route or new day', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('one.gpx')])
    const dayId = original.days[0].id
    const lodgingId = accommodationId('manual-lodging')
    const placeId = practicalPlaceId('manual-water')
    const dayOverrideId = overrideId('manual-day-override')
    const stageOverrideId = overrideId('manual-stage-override')
    const userProvenance = { sourceType: 'user', sourceId: null, fetchedAt: null, engineVersion: 'manual@1', confidence: 'high', manuallyOverridden: true }
    const manualBundle = {
      ...original,
      days: original.days.map((day) => ({ ...day, notes: 'Note conservée', accommodationId: lodgingId, enrichmentStatus: 'complete' })),
      accommodations: [{ id: lodgingId, name: 'Gîte manuel', type: 'gite', address: null, latitude: null, longitude: null, mapsUrl: null, website: null, phone: null, bookingReference: 'ABC', notes: 'Arrivée tardive', confirmed: true, provenance: userProvenance }],
      practicalPlaces: [{ id: placeId, category: 'water', name: 'Fontaine manuelle', latitude: 45, longitude: 6, description: null, trackDistanceKm: null, detourKm: null, openingHours: null, hidden: false, pinned: true, dayIds: [dayId], provenance: userProvenance }],
      overrides: [
        { id: dayOverrideId, targetType: 'trip-day', targetId: dayId, field: 'notes', value: 'Note conservée', reason: null, createdAt: '2027-01-02T00:00:00.000Z' },
        { id: stageOverrideId, targetType: 'ride-stage', targetId: original.stages[0].id, field: 'name', value: 'Ancienne route', reason: null, createdAt: '2027-01-02T00:00:00.000Z' },
      ],
    }
    await createTripRepository(database).saveTripBundle(manualBundle)

    const draft = await loadTripEditDraft(database, 'trip-edit')
    const replacement = { ...draft.slots[0], file: gpxFile('replacement.gpx', 45.1, 200, 0.01), existingSourceFileId: null }
    const added = { kind: 'ride', existingDayId: null, existingSourceFileId: null, file: gpxFile('new-day.gpx', 45.2) }
    const result = await edit(database, [replacement, added], 'manual-edit')
    assert.equal(result.ok, true)
    assert.equal(result.bundle.days[0].id, dayId)
    assert.equal(result.bundle.days[0].notes, 'Note conservée')
    assert.equal(result.bundle.days[0].accommodationId, lodgingId)
    assert.equal(result.bundle.days[0].enrichmentStatus, 'complete')
    assert.equal(result.bundle.days[1].notes, null)
    assert.equal(result.bundle.days[1].accommodationId, null)
    assert.deepEqual(result.bundle.accommodations.map((item) => item.id), [lodgingId])
    assert.deepEqual(result.bundle.practicalPlaces[0].dayIds, [dayId])
    assert.ok(result.bundle.overrides.some((item) => item.id === dayOverrideId))
    assert.ok(!result.bundle.overrides.some((item) => item.id === stageOverrideId))
  } finally {
    database.close()
  }
})

test('editing an unchanged GPX stage preserves its geocoded endpoints and readable names', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('one.gpx')])
    const names = ['Lieu départ', 'Lieu arrivée']
    await enrichStoredTripEndpoints({
      database,
      tripId: original.metadata.id,
      provider: {
        id: 'mock-osm',
        sourceType: 'osm',
        attribution: 'Mock OSM',
        async reverse() { return { name: names.shift(), sourceId: 'mock:place' } },
      },
      idFactory: createIdFactory('geocoded'),
      now: fixedNow('2027-01-15T00:00:00.000Z'),
    })

    const draft = await loadTripEditDraft(database, 'trip-edit')
    const result = await edit(database, draft.slots, 'geocoded-edit')
    assert.equal(result.ok, true)
    assert.equal(result.bundle.stages[0].startLocationName, 'Lieu départ')
    assert.equal(result.bundle.stages[0].endLocationName, 'Lieu arrivée')
    assert.equal(result.bundle.days[0].startLocationName, 'Lieu départ')
    assert.equal(result.bundle.days[0].endLocationName, 'Lieu arrivée')
    assert.equal(result.bundle.routePoints.filter((point) => point.provenance.engineVersion === 'endpoint-geocoding@1').length, 2)
  } finally {
    database.close()
  }
})

test('editing an unchanged route preserves its OSM-enriched climb names', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('climb.gpx', 45, 250, 0.01)])
    assert.ok(original.climbs.length > 0)
    await enrichStoredTripClimbNames({
      database,
      tripId: original.metadata.id,
      provider: {
        id: 'mock-climb-provider',
        sourceType: 'osm',
        attribution: 'Mock OSM',
        async findCandidates(search) {
          return [{ name: 'Col conservé', featureType: 'mountain-pass', sourceId: 'overpass-osm:mountain-pass:node:1', coordinates: search.coordinates, elevationM: search.elevationM }]
        },
      },
      now: fixedNow('2027-01-20T00:00:00.000Z'),
    })

    const draft = await loadTripEditDraft(database, 'trip-edit')
    const result = await edit(database, draft.slots, 'climb-name-edit')
    assert.equal(result.ok, true)
    assert.ok(result.bundle.climbs.some((climb) => climb.name === 'Col conservé' && climb.provenance.sourceType === 'osm'))
  } finally {
    database.close()
  }
})

test('replacing a route invalidates its previous OSM climb names', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('climb.gpx', 45, 250, 0.01)])
    assert.ok(original.climbs.length > 0)
    await enrichStoredTripClimbNames({
      database,
      tripId: original.metadata.id,
      provider: {
        id: 'mock-climb-provider',
        sourceType: 'osm',
        attribution: 'Mock OSM',
        async findCandidates(search) {
          return [{ name: 'Ancien col', featureType: 'mountain-pass', sourceId: 'overpass-osm:mountain-pass:node:2', coordinates: search.coordinates, elevationM: search.elevationM }]
        },
      },
      now: fixedNow('2027-01-20T00:00:00.000Z'),
    })

    const draft = await loadTripEditDraft(database, 'trip-edit')
    const replacement = { ...draft.slots[0], file: gpxFile('replacement-climb.gpx', 46, 300, 0.012), existingSourceFileId: null }
    const result = await edit(database, [replacement], 'climb-name-replace')
    assert.equal(result.ok, true)
    assert.ok(result.bundle.climbs.length > 0)
    assert.ok(result.bundle.climbs.every((climb) => climb.name !== 'Ancien col' && climb.provenance.engineVersion !== 'climb-name-enrichment@1'))
  } finally {
    database.close()
  }
})

function practicalProvider(osmId) {
  return {
    id: 'mock-practical-provider',
    sourceType: 'osm',
    attribution: 'Mock OSM',
    async findCandidates(search) {
      const point = search.geometry[Math.min(1, search.geometry.length - 1)]
      return [{
        osmType: 'node', osmId, category: 'water', name: null,
        latitude: point.latitude, longitude: point.longitude,
        usefulTags: { amenity: 'drinking_water' },
      }]
    },
  }
}

test('editing an unchanged route preserves its persisted OSM practical places', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('places.gpx')])
    await enrichStoredTripPracticalPlaces({
      database,
      tripId: original.metadata.id,
      provider: practicalProvider('kept-place'),
      now: fixedNow('2027-01-20T00:00:00.000Z'),
    })
    const enriched = await createTripRepository(database).loadTripBundle('trip-edit')
    const originalPlace = enriched.practicalPlaces.find((place) => place.provenance.engineVersion === PRACTICAL_PLACES_ENGINE_VERSION)
    assert.ok(originalPlace)

    const draft = await loadTripEditDraft(database, 'trip-edit')
    const result = await edit(database, draft.slots, 'practical-place-edit')
    assert.equal(result.ok, true)
    assert.ok(result.bundle.practicalPlaces.some((place) => place.id === originalPlace.id && place.stageId === result.bundle.stages[0].id))
  } finally {
    database.close()
  }
})

test('replacing a GPX invalidates practical places derived from that route', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('places.gpx')])
    await enrichStoredTripPracticalPlaces({
      database,
      tripId: original.metadata.id,
      provider: practicalProvider('obsolete-place'),
      now: fixedNow('2027-01-20T00:00:00.000Z'),
    })
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const replacement = { ...draft.slots[0], file: gpxFile('replacement-places.gpx', 46, 180, 0.012), existingSourceFileId: null }
    const result = await edit(database, [replacement], 'practical-place-replace')
    assert.equal(result.ok, true)
    assert.ok(result.bundle.practicalPlaces.every((place) => place.provenance.engineVersion !== PRACTICAL_PLACES_ENGINE_VERSION))
  } finally {
    database.close()
  }
})

function routeEnrichmentProvider() {
  return {
    id: 'mock-route-enrichment', sourceType: 'osm', attribution: 'Mock OSM',
    async findStructuralCandidates(search) {
      const point = search.geometry[Math.min(1, search.geometry.length - 1)]
      const candidates = [{
        osmType: 'node', osmId: 'city-kept', featureType: 'city', name: 'Ville test',
        latitude: point.latitude, longitude: point.longitude, elevationM: point.altitudeM, usefulTags: { place: 'city' },
      }]
      return {
        candidates, durationMs: 1, rawCandidateCount: 1, httpStatus: 200, payloadBytes: 10,
        startedAt: '2027-01-20T00:00:00.000Z', finishedAt: '2027-01-20T00:00:00.001Z',
      }
    },
  }
}

test('editing an unchanged route preserves its route localities', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('localities.gpx')])
    await enrichStoredTripRoute({
      database, tripId: original.metadata.id, provider: routeEnrichmentProvider(),
      idFactory: createIdFactory('locality'), now: fixedNow('2027-01-20T00:00:00.000Z'),
    })
    const enriched = await createTripRepository(database).loadTripBundle('trip-edit')
    const locality = enriched.routePoints.find((point) => point.provenance.engineVersion === ROUTE_ENRICHMENT_ENGINE_VERSION)
    assert.ok(locality)
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const result = await edit(database, draft.slots, 'locality-edit')
    assert.equal(result.ok, true)
    assert.ok(result.bundle.routePoints.some((point) => point.provenance.sourceId === locality.provenance.sourceId))
  } finally {
    database.close()
  }
})

test('replacing a GPX invalidates its route localities and landmarks', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('localities.gpx')])
    await enrichStoredTripRoute({
      database, tripId: original.metadata.id, provider: routeEnrichmentProvider(),
      idFactory: createIdFactory('locality'), now: fixedNow('2027-01-20T00:00:00.000Z'),
    })
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const replacement = { ...draft.slots[0], file: gpxFile('replacement-localities.gpx', 46, 180, 0.012), existingSourceFileId: null }
    const result = await edit(database, [replacement], 'locality-replace')
    assert.equal(result.ok, true)
    assert.ok(result.bundle.routePoints.every((point) => point.provenance.engineVersion !== ROUTE_ENRICHMENT_ENGINE_VERSION))
  } finally {
    database.close()
  }
})

test('an IndexedDB write failure rolls back the complete edit and leaves the existing trip intact', async () => {
  const database = await openImportTestDatabase()
  try {
    const original = await importTrip(database, [gpxFile('one.gpx')])
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const failingDatabase = Object.create(database)
    failingDatabase.transaction = (storeNames, mode) => {
      const transaction = database.transaction(storeNames, mode)
      if (mode === 'readwrite') queueMicrotask(() => transaction.abort())
      return transaction
    }
    const result = await editGpxTrip({
      database: failingDatabase,
      tripId: 'trip-edit',
      slots: [...draft.slots, { kind: 'ride', existingDayId: null, existingSourceFileId: null, file: gpxFile('added.gpx', 45.2) }],
      idFactory: createIdFactory('failed-edit'),
      now: fixedNow('2027-02-01T00:00:00.000Z'),
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'storage-error')
    assert.deepEqual(await createTripRepository(database).loadTripBundle('trip-edit'), original)
  } finally {
    database.close()
  }
})

test('a strict byte duplicate blocks the edit before storage changes', async () => {
  const database = await openImportTestDatabase()
  try {
    const originalFile = gpxFile('one.gpx')
    const original = await importTrip(database, [originalFile])
    const draft = await loadTripEditDraft(database, 'trip-edit')
    const duplicate = { ...originalFile, name: 'copy.gpx' }
    const result = await edit(database, [...draft.slots, { kind: 'ride', existingDayId: null, existingSourceFileId: null, file: duplicate }], 'duplicate-edit')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'analysis-error')
    assert.deepEqual(await createTripRepository(database).loadTripBundle('trip-edit'), original)
  } finally {
    database.close()
  }
})
