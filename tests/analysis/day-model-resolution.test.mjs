import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveOffCoordinates,
  resolveOffLocation,
  resolveTransferCoordinates,
  resolveTransferLocations,
} from '../../src/analysis/day-location-fill.ts'

/**
 * DER-DES-DER sections 66-92 / tests BU-CN — the logical day model.
 *
 * RIDE = a movement fixed by its GPX. TRANSFER = an explicit movement with
 * two endpoints, each either LINKED to another day or supplied by the
 * traveller. OFF = no movement at all: it inherits wherever the trip already
 * is, and never moves it.
 */

function stage(overrides = {}) {
  return {
    id: 'stage-test', dayId: 'day-test', sourceRouteId: 'route-test', name: null,
    startLocationName: null, endLocationName: null, distanceKm: null, elevationGainM: null,
    elevationLossM: null, minAltitudeM: null, maxAltitudeM: null, movingDurationSeconds: null,
    pauseDurationSeconds: null, totalDurationSeconds: null, estimatedAverageSpeedKph: null,
    validationStatus: 'pending', metricsProvenance: null, climbIds: [], routePointIds: [],
    weatherRecordIds: [], ...overrides,
  }
}

function day(overrides = {}) {
  return {
    id: 'day-test', index: 0, displayNumber: 1, date: null, type: 'off', stageId: null,
    startLocationName: null, endLocationName: null, accommodationId: null, notes: null,
    enrichmentStatus: 'not-started', ...overrides,
  }
}

function route(overrides = {}) {
  return {
    id: 'route-test', sourceFileId: null, segments: [], geometry: { full: null, simplified: null },
    profile: null, parsingStatus: 'parsed', parsingErrors: [],
    provenance: { source: 'gpx', importedAt: '2027-01-01T00:00:00.000Z' }, ...overrides,
  }
}

function geometryFromEndpoints(start, end) {
  return {
    full: [
      { latitude: start[0], longitude: start[1], altitudeM: null },
      { latitude: end[0], longitude: end[1], altitudeM: null },
    ],
    simplified: null,
  }
}

function bundle(days, stages, routes = []) {
  return { days, stages, routes }
}

const RIDE_A = stage({ id: 's-a', startLocationName: 'Genève', endLocationName: 'Briançon' })
const RIDE_B = stage({ id: 's-b', startLocationName: 'Nice', endLocationName: 'Menton' })

const ride = (id, index, stageId) => day({ id, index, type: 'ride', stageId })
const transfer = (id, index, overrides = {}) => day({ id, index, type: 'transfer', ...overrides })
const off = (id, index, overrides = {}) => day({ id, index, type: 'off', ...overrides })

// --- BU-BZ: OFF days --------------------------------------------------------

test('BU: Ride → OFF — the OFF sits at the ride arrival', () => {
  const days = [ride('d0', 0, 's-a'), off('d1', 1)]
  assert.equal(resolveOffLocation(bundle(days, [RIDE_A]), days[1]).name, 'Briançon')
})

test('BV: Ride → OFF → OFF — both OFF days sit at the same arrival, never drifting', () => {
  const days = [ride('d0', 0, 's-a'), off('d1', 1), off('d2', 2)]
  const b = bundle(days, [RIDE_A])
  assert.equal(resolveOffLocation(b, days[1]).name, 'Briançon')
  assert.equal(resolveOffLocation(b, days[2]).name, 'Briançon')
})

test('BW: OFF → Ride1 — an OFF opening the trip takes the first ride departure (section 72)', () => {
  const days = [off('d0', 0), ride('d1', 1, 's-a')]
  assert.equal(resolveOffLocation(bundle(days, [RIDE_A]), days[0]).name, 'Genève')
})

test('BX: OFF → OFF → Ride1 — both take the first ride departure', () => {
  const days = [off('d0', 0), off('d1', 1), ride('d2', 2, 's-a')]
  const b = bundle(days, [RIDE_A])
  assert.equal(resolveOffLocation(b, days[0]).name, 'Genève')
  assert.equal(resolveOffLocation(b, days[1]).name, 'Genève')
})

test('BY: RideN → OFF — a closing OFF takes the last ride arrival (section 73)', () => {
  const days = [ride('d0', 0, 's-a'), off('d1', 1)]
  assert.equal(resolveOffLocation(bundle(days, [RIDE_A]), days[1]).name, 'Briançon')
})

test('BZ: an OFF never moves the trip — Ride A → Transfer → OFF puts the OFF at the TRANSFER destination, not back at Ride A', () => {
  const days = [ride('d0', 0, 's-a'), transfer('d1', 1), off('d2', 2), ride('d3', 3, 's-b')]
  assert.equal(
    resolveOffLocation(bundle(days, [RIDE_A, RIDE_B]), days[2]).name,
    'Nice',
    'the transfer already moved the trip; the OFF stays where it landed',
  )
})

// --- CA-CE: simple transfers ------------------------------------------------

test('CA: Ride A → Transfer → Ride B — both endpoints are linked and non-editable', () => {
  const days = [ride('d0', 0, 's-a'), transfer('d1', 1), ride('d2', 2, 's-b')]
  const result = resolveTransferLocations(bundle(days, [RIDE_A, RIDE_B]), days[1])
  assert.equal(result.origin, 'Briançon')
  assert.equal(result.destination, 'Nice')
  assert.equal(result.originLinked, true)
  assert.equal(result.destinationLinked, true)
  assert.equal(result.originLinkHint, 'Lié à l’étape précédente')
  assert.equal(result.destinationLinkHint, 'Lié à l’étape suivante')
})

test('CB: Transfer → Ride1 — destination is linked, origin is the traveller own input (section 77)', () => {
  const days = [transfer('d0', 0), ride('d1', 1, 's-a')]
  const result = resolveTransferLocations(bundle(days, [RIDE_A]), days[0])
  assert.equal(result.destination, 'Genève')
  assert.equal(result.destinationLinked, true)
  assert.equal(result.origin, null)
  assert.equal(result.originLinked, false, 'nothing in the trip can infer where the traveller comes from')
})

test('CC: RideN → Transfer — origin is linked, destination is manual (section 78)', () => {
  const days = [ride('d0', 0, 's-a'), transfer('d1', 1)]
  const result = resolveTransferLocations(bundle(days, [RIDE_A]), days[1])
  assert.equal(result.origin, 'Briançon')
  assert.equal(result.originLinked, true)
  assert.equal(result.destination, null)
  assert.equal(result.destinationLinked, false)
})

test('CD/section 89: a transfer between two rides has linked endpoints whatever its transferTiming — geography is not the lodging rule', () => {
  for (const transferTiming of ['independent', 'dedicated', 'before_next', 'after_previous']) {
    const days = [ride('d0', 0, 's-a'), transfer('d1', 1, { transferTiming }), ride('d2', 2, 's-b')]
    const result = resolveTransferLocations(bundle(days, [RIDE_A, RIDE_B]), days[1])
    assert.equal(result.origin, 'Briançon', `timing ${transferTiming}`)
    assert.equal(result.destination, 'Nice', `timing ${transferTiming}`)
    assert.equal(result.originLinked, true, `timing ${transferTiming}`)
    assert.equal(result.destinationLinked, true, `timing ${transferTiming}`)
  }
})

test('a manual override always wins over the linked value, and marks that side editable again', () => {
  const days = [ride('d0', 0, 's-a'), transfer('d1', 1, { startLocationName: 'Chez un ami' }), ride('d2', 2, 's-b')]
  const result = resolveTransferLocations(bundle(days, [RIDE_A, RIDE_B]), days[1])
  assert.equal(result.origin, 'Chez un ami')
  assert.equal(result.originLinked, false)
  assert.equal(result.originLinkHint, null)
})

// --- CF-CI: OFF days interleaved with transfers -----------------------------

test('CF/CG: Transfer → OFF → Ride1 — the transfer destination is Ride1 start, and the OFF sits there too (section 79)', () => {
  const days = [transfer('d0', 0), off('d1', 1), ride('d2', 2, 's-a')]
  const b = bundle(days, [RIDE_A])
  const result = resolveTransferLocations(b, days[0])
  assert.equal(result.destination, 'Genève', 'the intervening OFF is transparent — it never moves the trip')
  assert.equal(result.destinationLinked, true)
  assert.equal(resolveOffLocation(b, days[1]).name, 'Genève')
})

test('CH: Ride A → Transfer → OFF → Ride B — origin and destination are both correct across the OFF (section 80)', () => {
  const days = [ride('d0', 0, 's-a'), transfer('d1', 1), off('d2', 2), ride('d3', 3, 's-b')]
  const result = resolveTransferLocations(bundle(days, [RIDE_A, RIDE_B]), days[1])
  assert.equal(result.origin, 'Briançon')
  assert.equal(result.destination, 'Nice')
})

test('CI: Ride A → OFF → Transfer → Ride B — the transfer still starts at Ride A arrival (section 81)', () => {
  const days = [ride('d0', 0, 's-a'), off('d1', 1), transfer('d2', 2), ride('d3', 3, 's-b')]
  const b = bundle(days, [RIDE_A, RIDE_B])
  const result = resolveTransferLocations(b, days[2])
  assert.equal(result.origin, 'Briançon')
  assert.equal(result.destination, 'Nice')
  assert.equal(resolveOffLocation(b, days[1]).name, 'Briançon', 'the OFF is still at Ride A arrival — the transfer happens the day after')
})

// --- chains of transfers (sections 82-88) -----------------------------------

test('sections 83-84: Transfer 1 → Transfer 2 → Ride1 — T1 origin AND destination are manual; T2 is linked to Ride1', () => {
  const days = [transfer('d0', 0), transfer('d1', 1), ride('d2', 2, 's-a')]
  const b = bundle(days, [RIDE_A])
  const first = resolveTransferLocations(b, days[0])
  assert.equal(first.origin, null, 'Maison — only the traveller knows')
  assert.equal(first.originLinked, false)
  assert.equal(first.destination, null, 'chez un ami — the intermediate point, also only the traveller knows')
  assert.equal(first.destinationLinked, false, 'never silently jumps past T2 to Ride1 start')

  const second = resolveTransferLocations(b, days[1])
  assert.equal(second.destination, 'Genève')
  assert.equal(second.destinationLinked, true)
})

test('section 85: the handoff point has ONE source of truth — T1 destination, which T2 origin then mirrors read-only', () => {
  const days = [transfer('d0', 0, { endLocationName: 'Chez un ami' }), transfer('d1', 1), ride('d2', 2, 's-a')]
  const b = bundle(days, [RIDE_A])
  assert.equal(resolveTransferLocations(b, days[0]).destination, 'Chez un ami')
  const second = resolveTransferLocations(b, days[1])
  assert.equal(second.origin, 'Chez un ami')
  assert.equal(second.originLinked, true)
  assert.equal(second.originLinkHint, 'Lié au trajet précédent')
})

test('section 86: Ride A → T1 → T2 → Ride B — the outer endpoints are fixed, the middle one is the single manual point', () => {
  const days = [ride('d0', 0, 's-a'), transfer('d1', 1), transfer('d2', 2), ride('d3', 3, 's-b')]
  const b = bundle(days, [RIDE_A, RIDE_B])
  const first = resolveTransferLocations(b, days[1])
  const second = resolveTransferLocations(b, days[2])
  assert.equal(first.origin, 'Briançon')
  assert.equal(first.originLinked, true)
  assert.equal(first.destination, null, 'the intermediate point is manual')
  assert.equal(second.origin, null, 'and mirrors T1 destination, still unset here')
  assert.equal(second.destination, 'Nice')
  assert.equal(second.destinationLinked, true)
})

test('section 87: the handoff chains through three transfers — T1.destination → T2.origin, T2.destination → T3.origin', () => {
  const days = [
    transfer('d0', 0, { endLocationName: 'Gare de Lyon' }),
    transfer('d1', 1, { endLocationName: 'Chambéry' }),
    transfer('d2', 2),
    ride('d3', 3, 's-a'),
  ]
  const b = bundle(days, [RIDE_A])
  assert.equal(resolveTransferLocations(b, days[1]).origin, 'Gare de Lyon')
  assert.equal(resolveTransferLocations(b, days[2]).origin, 'Chambéry')
  assert.equal(resolveTransferLocations(b, days[2]).destination, 'Genève')
})

test('section 88: a transfer with no geographic context at all leaves BOTH sides manual — never a fake auto-deduction', () => {
  const days = [transfer('d0', 0)]
  const result = resolveTransferLocations(bundle(days, []), days[0])
  assert.deepEqual(
    { origin: result.origin, destination: result.destination, originLinked: result.originLinked, destinationLinked: result.destinationLinked },
    { origin: null, destination: null, originLinked: false, destinationLinked: false },
  )
})

// --- section 98: coordinates follow the exact same chronology ---------------

test('section 98: a transfer coordinates come from the same days its names do, so the Maps itinerary uses real endpoints', () => {
  const routes = [
    route({ id: 'r-a', geometry: geometryFromEndpoints([46.2, 6.1], [44.9, 6.6]) }),
    route({ id: 'r-b', geometry: geometryFromEndpoints([43.7, 7.3], [43.8, 7.5]) }),
  ]
  const stages = [
    stage({ id: 's-a', sourceRouteId: 'r-a', startLocationName: 'Genève', endLocationName: 'Briançon' }),
    stage({ id: 's-b', sourceRouteId: 'r-b', startLocationName: 'Nice', endLocationName: 'Menton' }),
  ]
  const days = [ride('d0', 0, 's-a'), transfer('d1', 1), ride('d2', 2, 's-b')]
  const { origin, destination } = resolveTransferCoordinates(bundle(days, stages, routes), days[1])
  assert.deepEqual({ latitude: origin.latitude, longitude: origin.longitude }, { latitude: 44.9, longitude: 6.6 })
  assert.deepEqual({ latitude: destination.latitude, longitude: destination.longitude }, { latitude: 43.7, longitude: 7.3 })
})

test('section 85: a chained transfer origin coordinates mirror the previous transfer own destination override', () => {
  const routes = [route({ id: 'r-a', geometry: geometryFromEndpoints([46.2, 6.1], [44.9, 6.6]) })]
  const stages = [stage({ id: 's-a', sourceRouteId: 'r-a', startLocationName: 'Genève', endLocationName: 'Briançon' })]
  const days = [
    transfer('d0', 0, { overrideEndLatitude: 50.85, overrideEndLongitude: 4.35 }),
    transfer('d1', 1),
    ride('d2', 2, 's-a'),
  ]
  const { origin } = resolveTransferCoordinates(bundle(days, stages, routes), days[1])
  assert.deepEqual({ latitude: origin.latitude, longitude: origin.longitude }, { latitude: 50.85, longitude: 4.35 })
  assert.equal(origin.autoFilled, true, 'derived, not this transfer own override')
})

test('section 91: an OFF day after a transfer takes the transfer destination coordinates', () => {
  const routes = [route({ id: 'r-a', geometry: geometryFromEndpoints([46.2, 6.1], [44.9, 6.6]) })]
  const stages = [stage({ id: 's-a', sourceRouteId: 'r-a', startLocationName: 'Genève' })]
  const days = [
    transfer('d0', 0, { overrideEndLatitude: 45.9, overrideEndLongitude: 6.13 }),
    off('d1', 1),
    ride('d2', 2, 's-a'),
  ]
  const resolved = resolveOffCoordinates(bundle(days, stages, routes), days[1])
  assert.deepEqual({ latitude: resolved.latitude, longitude: resolved.longitude }, { latitude: 45.9, longitude: 6.13 })
})
