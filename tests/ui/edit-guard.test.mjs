import assert from 'node:assert/strict'
import test from 'node:test'

import { createEditGuard } from '../../src/ui/trips/edit-guard.ts'

/**
 * DER-DES-DER sections 55-65 / tests BK-BT — one edit context at a time, and
 * never a silently lost edit.
 */

function fakeContext(id, fields, calls = {}) {
  const record = { saved: 0, closed: 0 }
  return {
    record,
    context: {
      id,
      host: { fields: () => fields },
      save() { record.saved += 1; calls.onSave?.() },
      close() { record.closed += 1; calls.onClose?.() },
    },
  }
}

test('with no panel open at all, leaving is always allowed and nothing is prompted', async () => {
  let prompted = 0
  const guard = createEditGuard(() => { prompted += 1; return 'stay' })
  assert.equal(await guard.requestLeave(), true)
  assert.equal(prompted, 0)
  assert.equal(guard.activeId, null)
})

test('section 56: leaving a panel with NO changes closes it and proceeds — no confirmation at all', async () => {
  let prompted = 0
  const guard = createEditGuard(() => { prompted += 1; return 'stay' })
  const fields = [{ value: 'Riverside' }, { checked: false, value: '30' }]
  const { context, record } = fakeContext('infos', fields)
  guard.open(context)

  assert.equal(guard.isDirty(), false)
  assert.equal(await guard.requestLeave(), true)
  assert.equal(prompted, 0, 'a clean panel is never worth interrupting for')
  assert.equal(record.closed, 1)
  assert.equal(record.saved, 0)
  assert.equal(guard.activeId, null)
})

test('BK/BL/section 63-64: a changed field makes the panel dirty and triggers the confirmation', async () => {
  const prompts = []
  const guard = createEditGuard((context) => { prompts.push(context.id); return 'stay' })
  const fields = [{ value: 'Riverside' }]
  guard.open(fakeContext('infos', fields).context)

  fields[0].value = 'Riverside — arrivée tardive'
  assert.equal(guard.isDirty(), true)
  await guard.requestLeave()
  assert.deepEqual(prompts, ['infos'])
})

test('section 63: a toggled checkbox counts as a change just like a typed value', async () => {
  const guard = createEditGuard(() => 'stay')
  const fields = [{ checked: false, value: '30' }]
  guard.open(fakeContext('pauses', fields).context)
  assert.equal(guard.isDirty(), false)
  fields[0].checked = true
  assert.equal(guard.isDirty(), true)
})

test('section 63: a changed duration counts too — the anchor, the checkbox and the duration are all edits', async () => {
  const guard = createEditGuard(() => 'stay')
  const fields = [{ checked: true, value: '30' }, { value: 'point-village' }]
  guard.open(fakeContext('pauses', fields).context)
  fields[0].value = '45'
  assert.equal(guard.isDirty(), true)
})

test('typing a value and typing it straight back is NOT dirty — the snapshot compares values, not keystrokes', async () => {
  let prompted = 0
  const guard = createEditGuard(() => { prompted += 1; return 'stay' })
  const fields = [{ value: 'Riverside' }]
  guard.open(fakeContext('infos', fields).context)
  fields[0].value = 'Riverside!'
  fields[0].value = 'Riverside'
  assert.equal(guard.isDirty(), false)
  assert.equal(await guard.requestLeave(), true)
  assert.equal(prompted, 0)
})

test('BM/section 58: "Enregistrer" persists, closes, and lets the original action proceed', async () => {
  const order = []
  const guard = createEditGuard(() => 'save')
  const fields = [{ value: 'a' }]
  const { context, record } = fakeContext('infos', fields, {
    onSave: () => order.push('save'),
    onClose: () => order.push('close'),
  })
  guard.open(context)
  fields[0].value = 'b'

  assert.equal(await guard.requestLeave(), true, 'the navigation proceeds')
  assert.equal(record.saved, 1)
  assert.equal(record.closed, 1)
  assert.deepEqual(order, ['save', 'close'], 'saved before closed — never a close that drops the pending write')
  assert.equal(guard.activeId, null)
})

test('BN/section 59: "Abandonner" closes without saving, and the original action still proceeds', async () => {
  const guard = createEditGuard(() => 'discard')
  const fields = [{ value: 'a' }]
  const { context, record } = fakeContext('infos', fields)
  guard.open(context)
  fields[0].value = 'b'

  assert.equal(await guard.requestLeave(), true)
  assert.equal(record.saved, 0, 'nothing persisted')
  assert.equal(record.closed, 1)
  assert.equal(guard.activeId, null)
})

test('BO/section 60: "Rester" cancels the navigation, keeps the panel open AND keeps everything typed', async () => {
  const guard = createEditGuard(() => 'stay')
  const fields = [{ value: 'a' }]
  const { context, record } = fakeContext('infos', fields)
  guard.open(context)
  fields[0].value = 'travail en cours'

  assert.equal(await guard.requestLeave(), false, 'the navigation is cancelled')
  assert.equal(record.saved, 0)
  assert.equal(record.closed, 0, 'the panel stays open')
  assert.equal(guard.activeId, 'infos', 'and stays the active context')
  assert.equal(fields[0].value, 'travail en cours', 'the typed value is untouched')
  assert.equal(guard.isDirty(), true, 'and is still pending')
})

test('after "Rester", a second attempt prompts again — the decision is per-attempt, never remembered', async () => {
  let prompted = 0
  let answer = 'stay'
  const guard = createEditGuard(() => { prompted += 1; return answer })
  const fields = [{ value: 'a' }]
  guard.open(fakeContext('infos', fields).context)
  fields[0].value = 'b'

  assert.equal(await guard.requestLeave(), false)
  answer = 'discard'
  assert.equal(await guard.requestLeave(), true)
  assert.equal(prompted, 2)
})

test('BT/section 55: only one context is ever active — opening a second replaces the first', () => {
  const guard = createEditGuard(() => 'stay')
  guard.open(fakeContext('infos', [{ value: 'a' }]).context)
  assert.equal(guard.activeId, 'infos')
  guard.open(fakeContext('pauses', [{ value: 'b' }]).context)
  assert.equal(guard.activeId, 'pauses')
})

test('opening a second panel re-baselines against ITS own fields — the first panel\'s values never leak into its dirty check', () => {
  const guard = createEditGuard(() => 'stay')
  guard.open(fakeContext('infos', [{ value: 'a' }, { value: 'b' }]).context)
  guard.open(fakeContext('pauses', [{ checked: true, value: '30' }]).context)
  assert.equal(guard.isDirty(), false)
})

test('BQ/BR/BS: a panel that saved or cancelled itself clears the guard — no stale prompt afterwards', async () => {
  let prompted = 0
  const guard = createEditGuard(() => { prompted += 1; return 'stay' })
  const fields = [{ value: 'a' }]
  guard.open(fakeContext('infos', fields).context)
  fields[0].value = 'b'
  guard.clear()

  assert.equal(guard.activeId, null)
  assert.equal(guard.isDirty(), false)
  assert.equal(await guard.requestLeave(), true)
  assert.equal(prompted, 0)
})

test('section 62: a read-only panel (Météo — no fields to change) is never dirty, so leaving it just closes it', async () => {
  let prompted = 0
  const guard = createEditGuard(() => { prompted += 1; return 'stay' })
  const { context, record } = fakeContext('weather', [])
  guard.open(context)
  assert.equal(guard.isDirty(), false)
  assert.equal(await guard.requestLeave(), true)
  assert.equal(prompted, 0)
  assert.equal(record.closed, 1)
})

test('a field appearing or disappearing counts as a change — a panel that grew a row is genuinely different', () => {
  const guard = createEditGuard(() => 'stay')
  const fields = [{ value: 'a' }]
  guard.open({ id: 'pauses', host: { fields: () => fields }, save() {}, close() {} })
  fields.push({ value: 'b' })
  assert.equal(guard.isDirty(), true)
})

test('an async prompt is awaited — a real dialog resolves later than a synchronous stub', async () => {
  const guard = createEditGuard(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1))
    return 'discard'
  })
  const fields = [{ value: 'a' }]
  const { context, record } = fakeContext('infos', fields)
  guard.open(context)
  fields[0].value = 'b'
  assert.equal(await guard.requestLeave(), true)
  assert.equal(record.closed, 1)
})
