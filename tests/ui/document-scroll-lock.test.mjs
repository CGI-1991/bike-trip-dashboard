import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isDocumentScrollLocked,
  lockDocumentScroll,
} from '../../src/ui/document-scroll-lock.ts'

class FakeClassList {
  values = new Set()
  add(value) { this.values.add(value) }
  remove(value) { this.values.delete(value) }
  contains(value) { return this.values.has(value) }
}

class FakeStyle {
  values = new Map()
  setProperty(name, value) { this.values.set(name, value) }
  removeProperty(name) { this.values.delete(name) }
  getPropertyValue(name) { return this.values.get(name) ?? '' }
}

function createHarness() {
  const document = {
    documentElement: { classList: new FakeClassList() },
    body: { classList: new FakeClassList(), style: new FakeStyle() },
  }
  const restored = []
  const viewport = {
    scrollX: 14,
    scrollY: 237,
    scrollTo: (x, y) => restored.push([x, y]),
  }
  return { document, viewport, restored }
}

test('the local map lock freezes both document roots and restores the exact scroll position', () => {
  const { document, viewport, restored } = createHarness()
  const unlock = lockDocumentScroll(document, viewport)

  assert.equal(isDocumentScrollLocked(document), true)
  assert.equal(document.documentElement.classList.contains('map-scroll-locked'), true)
  assert.equal(document.body.classList.contains('map-scroll-locked'), true)
  assert.equal(document.body.style.getPropertyValue('--map-scroll-lock-x'), '-14px')
  assert.equal(document.body.style.getPropertyValue('--map-scroll-lock-y'), '-237px')

  unlock()
  assert.equal(isDocumentScrollLocked(document), false)
  assert.equal(document.documentElement.classList.contains('map-scroll-locked'), false)
  assert.equal(document.body.classList.contains('map-scroll-locked'), false)
  assert.deepEqual(restored, [[14, 237]])
})

test('nested and repeated releases cannot unlock the document too early', () => {
  const { document, viewport, restored } = createHarness()
  const firstUnlock = lockDocumentScroll(document, viewport)
  const secondUnlock = lockDocumentScroll(document, viewport)

  firstUnlock()
  firstUnlock()
  assert.equal(isDocumentScrollLocked(document), true)
  assert.deepEqual(restored, [])

  secondUnlock()
  secondUnlock()
  assert.equal(isDocumentScrollLocked(document), false)
  assert.deepEqual(restored, [[14, 237]])
})
