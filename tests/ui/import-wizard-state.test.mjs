import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addFilesToState,
  appendNewRideSlots,
  chooseFirstStage,
  createEmptyWizardState,
  insertSlot,
  moveStructureItem,
  removeFileFromState,
  removeSlot,
  removeStructureItem,
  rideFileEntries,
} from '../../src/ui/trips/import-wizard-state.ts'

function rawFile(name, overrides = {}) {
  return { name, size: 1_000, lastModified: 1_700_000_000_000, mimeType: 'application/gpx+xml', bytes: new ArrayBuffer(8), ...overrides }
}

function analysisFor(name, index) {
  return {
    fileName: name,
    sha256: `sha-${name}`,
    status: 'valid',
    errorMessage: null,
    distanceKm: 10,
    elevationGainM: 100,
    elevationLossM: 50,
    startLatitude: 45 + index,
    startLongitude: 6,
    endLatitude: 45 + index + 1,
    endLongitude: 6,
    sampledPoints: [],
  }
}

function idFactory() {
  let counter = 0
  return () => `file-${counter++}`
}

/** Immediate, deterministic fake analyzer — every file valid, ordered by filename's numeric prefix. */
async function instantPreAnalyze(files) {
  return files.map((file, index) => analysisFor(file.name, index))
}

/** A controllable fake analyzer: each call to `preAnalyzeFiles` returns a promise that only settles when the test explicitly resolves it — lets a test interleave two overlapping `addFilesToState` calls and resolve them in an arbitrary order. */
function createControllableAnalyzer() {
  const pending = []
  function preAnalyzeFiles(files) {
    return new Promise((resolve) => {
      pending.push({ files, resolve: () => resolve(files.map((file, index) => analysisFor(file.name, index))) })
    })
  }
  function resolveCallContaining(name) {
    const index = pending.findIndex((entry) => entry.files.some((file) => file.name === name))
    if (index === -1) throw new Error(`No pending analysis call contains ${name}`)
    const [entry] = pending.splice(index, 1)
    entry.resolve()
  }
  return { preAnalyzeFiles, resolveCallContaining, pendingCount: () => pending.length }
}

function activeFileNames(state) {
  return state.files.filter((entry) => !entry.removed).map((entry) => entry.file.name)
}

// A. load A/B/C -> remove B -> only A/C remain.
test('removing one file leaves exactly the others, and only that file\'s structure slot', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx', '3-c.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  const bFileId = state.files.find((entry) => entry.file.name === '2-b.gpx').id

  removeFileFromState(state, bFileId)

  assert.deepEqual(activeFileNames(state).sort(), ['1-a.gpx', '3-c.gpx'])
  assert.deepEqual(rideFileEntries(state).map(({ entry }) => entry.file.name).sort(), ['1-a.gpx', '3-c.gpx'])
  assert.ok(state.structure.every((item) => item.kind !== 'ride' || item.fileId !== bFileId))
})

// A (continued): removing a file never disturbs the OTHER files' own structure entries, order, or an already-inserted OFF slot.
test('removing a file preserves the manual order and any OFF/transfer slots already inserted', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx', '3-c.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  insertSlot(state, 0, 'off')
  moveStructureItem(state, 3, -1) // swap the last ride ("3-c.gpx") up one position
  const beforeRemoval = state.structure.map((item) => ({ kind: item.kind, fileId: item.fileId }))
  const bFileId = state.files.find((entry) => entry.file.name === '2-b.gpx').id

  removeFileFromState(state, bFileId)

  const afterRemoval = state.structure.map((item) => ({ kind: item.kind, fileId: item.fileId }))
  assert.deepEqual(afterRemoval, beforeRemoval.filter((item) => item.fileId !== bFileId))
})

// B. load A/B -> new selection C/D -> result A/B/C/D exactly once.
test('a second, later file selection only adds the newly-picked files, never re-adding or dropping the earlier ones', async () => {
  const state = createEmptyWizardState()
  const factory = idFactory()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx'].map((name) => rawFile(name)), idFactory: factory, preAnalyzeFiles: instantPreAnalyze })
  await addFilesToState(state, { rawFiles: ['3-c.gpx', '4-d.gpx'].map((name) => rawFile(name)), idFactory: factory, preAnalyzeFiles: instantPreAnalyze })

  assert.deepEqual(activeFileNames(state).sort(), ['1-a.gpx', '2-b.gpx', '3-c.gpx', '4-d.gpx'])
  const rideNames = rideFileEntries(state).map(({ entry }) => entry.file.name)
  assert.equal(rideNames.length, 4)
  assert.equal(new Set(rideNames).size, 4)
})

// C. load A/B -> select A again -> no silent duplicate.
test('re-selecting the exact same browser file is silently ignored, not added as a second entry', async () => {
  const state = createEmptyWizardState()
  const factory = idFactory()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx'].map((name) => rawFile(name)), idFactory: factory, preAnalyzeFiles: instantPreAnalyze })
  await addFilesToState(state, { rawFiles: [rawFile('1-a.gpx')], idFactory: factory, preAnalyzeFiles: instantPreAnalyze })

  assert.deepEqual(activeFileNames(state).sort(), ['1-a.gpx', '2-b.gpx'])
  assert.match(state.duplicateSelectionNotice, /1-a\.gpx/)
})

test('the same file re-selected with a different name/size/lastModified is treated as a genuinely different file (pre-SHA signature)', async () => {
  const state = createEmptyWizardState()
  const factory = idFactory()
  await addFilesToState(state, { rawFiles: [rawFile('1-a.gpx', { size: 1_000 })], idFactory: factory, preAnalyzeFiles: instantPreAnalyze })
  await addFilesToState(state, { rawFiles: [rawFile('1-a.gpx', { size: 2_000 })], idFactory: factory, preAnalyzeFiles: instantPreAnalyze })

  assert.equal(activeFileNames(state).length, 2)
  assert.equal(state.duplicateSelectionNotice, null)
})

// D. analysis A/B in flight -> add C -> finish analyses in a different order -> each result stays associated with the correct file.
test('overlapping add-files calls resolving out of order each write their analysis to the correct file', async () => {
  const state = createEmptyWizardState()
  const factory = idFactory()
  const analyzer = createControllableAnalyzer()

  const firstCall = addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx'].map((name) => rawFile(name)), idFactory: factory, preAnalyzeFiles: analyzer.preAnalyzeFiles })
  const secondCall = addFilesToState(state, { rawFiles: [rawFile('3-c.gpx')], idFactory: factory, preAnalyzeFiles: analyzer.preAnalyzeFiles })
  assert.equal(analyzer.pendingCount(), 2)

  // Resolve the SECOND (later) call's analysis first — the historical
  // `startIndex + offset` positional write would have misattributed this.
  analyzer.resolveCallContaining('3-c.gpx')
  await secondCall
  analyzer.resolveCallContaining('1-a.gpx')
  await firstCall

  for (const name of ['1-a.gpx', '2-b.gpx', '3-c.gpx']) {
    const entry = state.files.find((candidate) => candidate.file.name === name)
    assert.equal(entry.preAnalysis.fileName, name, `${name} must carry its own analysis, not another file's`)
  }
})

// E. remove a file -> move up/down -> no undefined.
test('after removing a file, move up/down never introduces an undefined structure entry', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx', '3-c.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  const bFileId = state.files.find((entry) => entry.file.name === '2-b.gpx').id
  removeFileFromState(state, bFileId)

  moveStructureItem(state, 0, 1)
  moveStructureItem(state, 1, -1)
  moveStructureItem(state, 5, -1) // out of range — must be a no-op, never corrupt the array
  moveStructureItem(state, -1, 1) // out of range — must be a no-op

  assert.equal(state.structure.length, 2)
  assert.ok(state.structure.every((item) => item !== undefined))
})

// F. enchaîner plusieurs move up/down -> structure valide.
test('chaining many move operations always leaves a valid, dense structure with the same set of items', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx', '3-c.gpx', '4-d.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  const originalKeys = state.structure.map((item) => item.key).sort()

  for (let i = 0; i < 20; i++) {
    moveStructureItem(state, i % state.structure.length, i % 2 === 0 ? 1 : -1)
  }

  assert.equal(state.structure.length, 4)
  assert.ok(state.structure.every((item) => item !== undefined))
  assert.deepEqual(state.structure.map((item) => item.key).sort(), originalKeys)
})

// G. OFF/transfert insérés -> retrait GPX -> slots non concernés cohérents.
test('OFF/transfer slots survive a GPX removal untouched, in their original relative position', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx', '3-c.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  insertSlot(state, 0, 'off') // after "1-a.gpx"
  insertSlot(state, 2, 'transfer') // after "2-b.gpx" (now at position 2)
  const offKey = state.structure.find((item) => item.kind === 'off').key
  const transferKey = state.structure.find((item) => item.kind === 'transfer').key

  const cFileId = state.files.find((entry) => entry.file.name === '3-c.gpx').id
  removeFileFromState(state, cFileId)

  assert.deepEqual(state.structure.map((item) => item.kind), ['ride', 'off', 'ride', 'transfer'])
  assert.equal(state.structure.find((item) => item.kind === 'off').key, offKey)
  assert.equal(state.structure.find((item) => item.kind === 'transfer').key, transferKey)
})

test('removeSlot never removes a ride item, and is a no-op out of range', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  insertSlot(state, 0, 'off')
  const before = state.structure.length

  removeSlot(state, 0) // the ride item — must be rejected
  assert.equal(state.structure.length, before)
  assert.equal(state.structure[0].kind, 'ride')

  removeSlot(state, 99) // out of range — no-op
  assert.equal(state.structure.length, before)

  removeSlot(state, 1) // the OFF slot — allowed
  assert.equal(state.structure.length, before - 1)
})

// --- removeStructureItem (CDC Jalon B4.4 sections 19-21): the unified
// timeline's single "Retirer" entry point, regardless of row kind — no more
// separate `remove-file`/`remove-slot` DOM actions needing to know which
// underlying removal applies. ------------------------------------------

test('removeStructureItem removes a ride row by removing its underlying file (never rejected, unlike removeSlot)', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  const rideFileId = state.structure[0].fileId

  removeStructureItem(state, 0)

  assert.equal(state.structure.length, 1)
  assert.equal(state.structure[0].fileId, state.files.find((entry) => entry.file.name === '2-b.gpx').id)
  assert.equal(state.files.find((entry) => entry.id === rideFileId).removed, true, 'the file itself is marked removed, not just detached from structure')
})

test('removeStructureItem removes an OFF/transfer row exactly like removeSlot', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  insertSlot(state, 0, 'off')
  assert.equal(state.structure.length, 2)

  removeStructureItem(state, 1)

  assert.equal(state.structure.length, 1)
  assert.equal(state.structure[0].kind, 'ride')
})

test('removeStructureItem is a no-op out of range', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  removeStructureItem(state, 99)
  assert.equal(state.structure.length, 1)
})

// H. no way to ever call renderStructureRow(undefined) — the state itself never holds a hole.
test('the structure array is always dense: no operation can ever leave a hole for a renderer to read as undefined', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  insertSlot(state, 5, 'off') // out-of-range afterPosition — must clamp, not corrupt
  moveStructureItem(state, 10, 1) // out of range — no-op
  removeSlot(state, -3) // out of range — no-op

  assert.ok(state.structure.every((item) => item !== undefined && typeof item.kind === 'string'))
})

test('appendNewRideSlots never touches an already-existing structure item', async () => {
  const state = createEmptyWizardState()
  const factory = idFactory()
  await addFilesToState(state, { rawFiles: ['1-a.gpx'].map((name) => rawFile(name)), idFactory: factory, preAnalyzeFiles: instantPreAnalyze })
  insertSlot(state, 0, 'off')
  const before = [...state.structure]

  appendNewRideSlots(state, [])
  assert.deepEqual(state.structure.slice(0, before.length), before)
})

test('chooseFirstStage rotates the loop using consistent, aligned candidate/order arrays', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx', '3-c.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  const cFileId = state.files.find((entry) => entry.file.name === '3-c.gpx').id

  chooseFirstStage(state, cFileId)

  assert.equal(state.structure.length, 3)
  assert.equal(state.structure[0].fileId, cFileId)
  assert.ok(state.structure.every((item) => item.kind === 'ride' && item.fileId !== undefined))
})

test('chooseFirstStage is a no-op for an unknown file id', async () => {
  const state = createEmptyWizardState()
  await addFilesToState(state, { rawFiles: ['1-a.gpx', '2-b.gpx'].map((name) => rawFile(name)), idFactory: idFactory(), preAnalyzeFiles: instantPreAnalyze })
  const before = [...state.structure]

  chooseFirstStage(state, 'does-not-exist')

  assert.deepEqual(state.structure, before)
})
