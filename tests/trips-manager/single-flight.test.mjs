import assert from 'node:assert/strict'
import test from 'node:test'

import { createSingleFlightGuard } from '../../src/trips-manager/single-flight.ts'

test('two calls issued back-to-back (no await between them) only run fn once', async () => {
  const guard = createSingleFlightGuard()
  let running = 0
  let maxConcurrent = 0
  let calls = 0

  async function job() {
    calls++
    running++
    maxConcurrent = Math.max(maxConcurrent, running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    running--
  }

  const first = guard.run('trip-a', job)
  const second = guard.run('trip-a', job) // issued synchronously, before `first` has claimed anything visible to the caller
  await Promise.all([first, second])

  assert.equal(calls, 1)
  assert.equal(maxConcurrent, 1)
})

test('isInFlight reports true only while a call for that key is running', async () => {
  const guard = createSingleFlightGuard()
  assert.equal(guard.isInFlight('trip-a'), false)

  let resolveJob
  const promise = guard.run('trip-a', () => new Promise((resolve) => { resolveJob = resolve }))
  assert.equal(guard.isInFlight('trip-a'), true)

  resolveJob()
  await promise
  assert.equal(guard.isInFlight('trip-a'), false)
})

test('different keys never block each other', async () => {
  const guard = createSingleFlightGuard()
  let concurrentCount = 0
  let maxConcurrent = 0

  async function job() {
    concurrentCount++
    maxConcurrent = Math.max(maxConcurrent, concurrentCount)
    await new Promise((resolve) => setTimeout(resolve, 5))
    concurrentCount--
  }

  await Promise.all([guard.run('trip-a', job), guard.run('trip-b', job), guard.run('trip-c', job)])
  assert.equal(maxConcurrent, 3)
})

test('a call for a key runs again once the previous call for that same key has finished', async () => {
  const guard = createSingleFlightGuard()
  let calls = 0
  const job = async () => { calls++ }

  await guard.run('trip-a', job)
  await guard.run('trip-a', job)

  assert.equal(calls, 2)
})

test('an error inside fn still releases the guard for that key', async () => {
  const guard = createSingleFlightGuard()
  await assert.rejects(guard.run('trip-a', async () => { throw new Error('boom') }))
  assert.equal(guard.isInFlight('trip-a'), false)
  let ranAgain = false
  await guard.run('trip-a', async () => { ranAgain = true })
  assert.equal(ranAgain, true)
})

test('three overlapping calls for the same key: only the first runs, the other two are no-ops', async () => {
  const guard = createSingleFlightGuard()
  let calls = 0
  const job = async () => {
    calls++
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  await Promise.all([guard.run('trip-a', job), guard.run('trip-a', job), guard.run('trip-a', job)])
  assert.equal(calls, 1)
})
