import assert from 'node:assert/strict'
import test from 'node:test'

import { createCurrentLocationService } from '../../src/ui/current-location.ts'

function fakeGeolocation({ shouldFail = false, errorCode = 2 } = {}) {
  let watchId = 0
  let cleared = []
  let successCallback = null
  let errorCallback = null
  return {
    watchPosition(onSuccess, onError) {
      successCallback = onSuccess
      errorCallback = onError
      watchId += 1
      if (shouldFail) onError({ code: errorCode })
      return watchId
    },
    clearWatch(id) { cleared.push(id) },
    emit(position) { successCallback?.(position) },
    emitError(error) { errorCallback?.(error) },
    get clearedIds() { return cleared },
  }
}

test('AD: a successful fix moves the status to "active" and carries the position', () => {
  const geo = fakeGeolocation()
  const service = createCurrentLocationService(geo)
  service.start()
  geo.emit({ coords: { latitude: 45.1, longitude: 6.2, accuracy: 12 } })
  const state = service.getState()
  assert.equal(state.status, 'active')
  assert.deepEqual(state.position, { latitude: 45.1, longitude: 6.2, accuracyMeters: 12 })
})

test('AE: subscribing never triggers a request on its own — only start() does', () => {
  let watchCalls = 0
  const geo = { watchPosition: () => { watchCalls++; return 1 }, clearWatch: () => {} }
  const service = createCurrentLocationService(geo)
  service.subscribe(() => {})
  assert.equal(watchCalls, 0)
})

test('AF: an explicit start() call triggers exactly one watchPosition request', () => {
  let watchCalls = 0
  const geo = { watchPosition: () => { watchCalls++; return 1 }, clearWatch: () => {} }
  const service = createCurrentLocationService(geo)
  service.start()
  assert.equal(watchCalls, 1)
})

test('AG: a denied permission never throws — the state becomes "denied"', () => {
  const geo = fakeGeolocation({ shouldFail: true, errorCode: 1 })
  const service = createCurrentLocationService(geo)
  assert.doesNotThrow(() => service.start())
  assert.equal(service.getState().status, 'denied')
})

test('a non-permission failure (timeout, unavailable) never throws — the state becomes "unavailable"', () => {
  const geo = fakeGeolocation({ shouldFail: true, errorCode: 3 })
  const service = createCurrentLocationService(geo)
  service.start()
  assert.equal(service.getState().status, 'unavailable')
})

test('no navigator.geolocation at all resolves to "unavailable", never a crash', () => {
  const service = createCurrentLocationService(null)
  assert.doesNotThrow(() => service.start())
  assert.equal(service.getState().status, 'unavailable')
})

test('AH: stop() clears the underlying watch and resets to idle with no position', () => {
  const geo = fakeGeolocation()
  const service = createCurrentLocationService(geo)
  service.start()
  geo.emit({ coords: { latitude: 45, longitude: 6, accuracy: null } })
  service.stop()
  assert.equal(service.getState().status, 'idle')
  assert.equal(service.getState().position, null)
  assert.deepEqual(geo.clearedIds, [1])
})

test('AI: a single watcher — calling start() again while already active never requests a second watchPosition', () => {
  let watchCalls = 0
  const geo = fakeGeolocation()
  const wrapped = { ...geo, watchPosition: (...args) => { watchCalls++; return geo.watchPosition(...args) } }
  const service = createCurrentLocationService(wrapped)
  service.start()
  geo.emit({ coords: { latitude: 45, longitude: 6, accuracy: 5 } })
  service.start()
  service.start()
  assert.equal(watchCalls, 1)
})

test('AJ: a position update never carries any pan/zoom/fitBounds instruction — it is pure data', () => {
  const geo = fakeGeolocation()
  const service = createCurrentLocationService(geo)
  const seen = []
  service.subscribe((state) => seen.push(state))
  service.start()
  geo.emit({ coords: { latitude: 45, longitude: 6, accuracy: 5 } })
  for (const state of seen) {
    assert.ok(!('pan' in state) && !('zoom' in state) && !('fitBounds' in state))
  }
})

test('subscribe() calls the listener immediately with the current state, then again on every change', () => {
  const geo = fakeGeolocation()
  const service = createCurrentLocationService(geo)
  const seenStatuses = []
  service.subscribe((state) => seenStatuses.push(state.status))
  service.start()
  geo.emit({ coords: { latitude: 45, longitude: 6, accuracy: 5 } })
  assert.deepEqual(seenStatuses, ['idle', 'requesting', 'active'])
})

test('unsubscribing stops further notifications', () => {
  const geo = fakeGeolocation()
  const service = createCurrentLocationService(geo)
  const seen = []
  const unsubscribe = service.subscribe((state) => seen.push(state.status))
  unsubscribe()
  service.start()
  geo.emit({ coords: { latitude: 45, longitude: 6, accuracy: 5 } })
  assert.deepEqual(seen, ['idle'])
})
