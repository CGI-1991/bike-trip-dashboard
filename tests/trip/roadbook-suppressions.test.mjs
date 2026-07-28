import assert from 'node:assert/strict'
import test from 'node:test'

import { readFile } from 'node:fs/promises'

import { applyPointResolution, createSourcePoints } from '../../src/trip/roadbook-match.ts'
import {
  isSuppressedDocumentedPoint,
  roadbookSuppressions,
  suppressedDocumentedPointIds,
} from '../../src/trip/roadbook-suppressions.ts'

const root = new URL('../../', import.meta.url)
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))

const EXPECTED_SUPPRESSED_IDS = [
  'j01-passage-bellevaux',
  'j03-passage-crest-voland',
  'j04-passage-areches',
  'j04-passage-les-chapieux',
  'j06-passage-tignes',
  'j09-passage-chateau-queyras',
  'j10-option-cime-de-la-bonette',
]

const baseDay = (overrides) => ({
  id: 'J1',
  dayNumber: 1,
  type: 'ride',
  title: 'Étape',
  startName: 'Départ',
  endName: 'Arrivée',
  ambiance: '',
  editorialStats: { distanceKm: 0, elevationGainM: 0, elevationLossM: 0 },
  cols: [],
  resupplyPassages: [],
  explicitPauses: [],
  notes: [],
  variant: null,
  options: [],
  lodgings: [],
  ...overrides,
})

test('the curated suppression list has exactly the seven expected entries, well-formed', () => {
  assert.equal(roadbookSuppressions.length, 7)

  const seenIds = new Set()
  for (const entry of roadbookSuppressions) {
    assert.match(entry.pointId, /^j\d{2}-[a-z0-9-]+$/)
    assert.equal(entry.status, 'suppressed')
    assert.equal(entry.origin, 'user-confirmed')
    assert.ok(entry.justification.trim().length > 0, `missing justification for ${entry.pointId}`)
    assert.ok(entry.decidedOn.trim().length > 0, `missing decidedOn for ${entry.pointId}`)
    assert.ok(entry.name.trim().length > 0, `missing name for ${entry.pointId}`)
    assert.equal(seenIds.has(entry.pointId), false, `duplicate entry for ${entry.pointId}`)
    seenIds.add(entry.pointId)
  }

  assert.deepEqual([...suppressedDocumentedPointIds].sort(), [...EXPECTED_SUPPRESSED_IDS].sort())
})

test('isSuppressedDocumentedPoint recognizes exactly the seven ids and nothing else', () => {
  for (const id of EXPECTED_SUPPRESSED_IDS) {
    assert.equal(isSuppressedDocumentedPoint(id), true, `${id} should be suppressed`)
  }
  assert.equal(isSuppressedDocumentedPoint('j01-col-col-du-feu'), false)
  assert.equal(isSuppressedDocumentedPoint('j06-passage-val-d-isere'), false)
})

test('createSourcePoints filters a suppressed passage before any GPX matching, keeps its siblings', () => {
  const day = baseDay({
    id: 'J1',
    dayNumber: 1,
    startName: 'Thonon-les-Bains',
    endName: 'Morzine',
    cols: [
      {
        id: 'j01-col-col-du-feu',
        name: 'Col du Feu',
        elevationM: 1_200,
        distanceKm: 10,
        elevationGainM: 500,
        averageGradientPercent: 5,
      },
    ],
    resupplyPassages: [
      { id: 'j01-passage-lullin', label: 'Lullin' },
      { id: 'j01-passage-bellevaux', label: 'Bellevaux' },
      { id: 'j01-passage-saint-jean-daulps', label: 'Saint-Jean-d’Aulps' },
    ],
  })

  const ids = createSourcePoints(day).map(({ point }) => point.id)

  assert.equal(ids.includes('j01-passage-bellevaux'), false)
  assert.deepEqual(ids, [
    'j01-start',
    'j01-col-col-du-feu',
    'j01-passage-lullin',
    'j01-passage-saint-jean-daulps',
    'j01-end',
  ])
})

test('a day made only of a suppressed option keeps only its start/end endpoints', () => {
  const day = baseDay({
    id: 'J10',
    dayNumber: 10,
    startName: 'Départ J10',
    endName: 'Arrivée J10',
    options: [
      { id: 'j10-option-cime-de-la-bonette', title: 'Cime de la Bonette', elevationM: 2_802 },
    ],
  })

  const ids = createSourcePoints(day).map(({ point }) => point.id)

  assert.deepEqual(ids, ['j10-start', 'j10-end'])
})

test('a suppressed point never reduces to zero without leaving its non-suppressed siblings intact (J4, two suppressions)', () => {
  const day = baseDay({
    id: 'J4',
    dayNumber: 4,
    startName: 'Départ J4',
    endName: 'Arrivée J4',
    resupplyPassages: [
      { id: 'j04-passage-areches', label: 'Arêches' },
      { id: 'j04-passage-beaufort', label: 'Beaufort' },
      { id: 'j04-passage-les-chapieux', label: 'Les Chapieux' },
    ],
  })

  const ids = createSourcePoints(day).map(({ point }) => point.id)

  assert.equal(ids.includes('j04-passage-areches'), false)
  assert.equal(ids.includes('j04-passage-les-chapieux'), false)
  assert.deepEqual(ids, ['j04-start', 'j04-passage-beaufort', 'j04-end'])
})

test('applyPointResolution renames the Tignes / Val d’Isère pause to Val-d’Isère, mentioning Tignes nowhere', () => {
  const rawPausePoint = {
    id: 'j06-pause-tignes-val-d-isere',
    dayId: 'J6',
    type: 'pause',
    name: 'Tignes / Val d’Isère',
    status: 'unmatched',
    sourceKind: 'pause',
    alternatives: [],
    overrideApplied: false,
    standaloneWaypoint: false,
    resolution: 'user-decision-required',
  }

  const resolved = applyPointResolution(rawPausePoint)

  assert.equal(resolved.name, 'Val-d’Isère')
  assert.equal(resolved.resolution, 'informational')
  assert.doesNotMatch(resolved.name, /Tignes/)
})

test('on the real production data, none of the seven suppressed points survive createSourcePoints for J1, J3, J4, J6, J9 or J10', async () => {
  const roadbook = await readJson('public/data/trip/roadbook.json')
  const checkedDayIds = ['J1', 'J3', 'J4', 'J6', 'J9', 'J10']

  for (const dayId of checkedDayIds) {
    const day = roadbook.days.find((candidate) => candidate.id === dayId)
    assert.ok(day, `${dayId} should exist in roadbook.json`)
    const ids = createSourcePoints(day).map(({ point }) => point.id)
    const leaked = ids.filter((id) => suppressedDocumentedPointIds.has(id))
    assert.deepEqual(leaked, [], `${dayId} must not carry any suppressed point through createSourcePoints`)
  }
})

test('on the real production data, J6 mentions Val-d’Isère but never Tignes once resolution is applied', async () => {
  const roadbook = await readJson('public/data/trip/roadbook.json')
  const day = roadbook.days.find((candidate) => candidate.id === 'J6')

  const names = createSourcePoints(day)
    .map(({ point }) => applyPointResolution(point))
    .map((point) => point.name)

  assert.ok(names.some((name) => name.includes('Val') && name.includes('Isère')), 'Val-d’Isère should still be mentioned')
  assert.ok(names.every((name) => !name.includes('Tignes')), `no point name should mention Tignes, got: ${names.join(', ')}`)
})
