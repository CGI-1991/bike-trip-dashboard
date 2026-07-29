import assert from 'node:assert/strict'
import test from 'node:test'

import { createMapOverlayHistory } from '../../src/ui/map-overlay-history.ts'

class FakeHistory {
  #entries = [{ base: true }]
  #index = 0
  constructor(target) { this.target = target }
  get state() { return this.#entries[this.#index] }
  get index() { return this.#index }
  get length() { return this.#entries.length }
  pushState(state) {
    this.#entries.splice(this.#index + 1, Number.POSITIVE_INFINITY, state)
    this.#index += 1
  }
  back() { this.go(-1) }
  go(delta) {
    const next = Math.max(0, Math.min(this.#entries.length - 1, this.#index + delta))
    if (next === this.#index) return
    this.#index = next
    this.target.dispatchEvent(new Event('popstate'))
  }
}

function createHarness() {
  const target = new EventTarget()
  const history = new FakeHistory(target)
  const state = { mapOpen: true, panelOpen: false, popupOpen: false }
  const actions = []
  const controller = createMapOverlayHistory({
    history,
    eventTarget: target,
    token: 'test-map',
    isMapOpen: () => state.mapOpen,
    isPanelOpen: () => state.panelOpen,
    closePopup: () => {
      if (!state.popupOpen) return false
      state.popupOpen = false
      actions.push('popup')
      return true
    },
    closePanelFromHistory: () => {
      state.panelOpen = false
      actions.push('panel')
    },
    closeMapFromHistory: () => {
      state.mapOpen = false
      actions.push('map')
    },
  })
  return { actions, controller, history, state }
}

test('browser Back closes layers, then the full-screen map, before normal navigation', () => {
  const { actions, controller, history, state } = createHarness()
  controller.startMap()
  state.panelOpen = true
  controller.panelOpened()

  history.back()
  assert.deepEqual(actions, ['panel'])
  assert.equal(state.mapOpen, true)
  assert.equal(history.index, 1)

  history.back()
  assert.deepEqual(actions, ['panel', 'map'])
  assert.equal(history.index, 0)

  state.mapOpen = true
  const reopened = createMapOverlayHistory({
    history,
    eventTarget: history.target,
    token: 'reopened-map',
    isMapOpen: () => state.mapOpen,
    isPanelOpen: () => false,
    closePopup: () => false,
    closePanelFromHistory: () => {},
    closeMapFromHistory: () => { state.mapOpen = false },
  })
  reopened.startMap()
  assert.equal(history.index, 1)
  state.mapOpen = false
  reopened.mapClosedNormally()
  assert.equal(history.index, 0)
  assert.equal(history.length, 2)
})

test('an open Leaflet popup has priority and preserves the current panel level', () => {
  const { actions, controller, history, state } = createHarness()
  controller.startMap()
  state.panelOpen = true
  controller.panelOpened()
  state.popupOpen = true

  history.back()
  assert.deepEqual(actions, ['popup'])
  assert.equal(state.panelOpen, true)
  assert.equal(history.state.rgaMapOverlay.level, 'layers')

  history.back()
  history.back()
  assert.deepEqual(actions, ['popup', 'panel', 'map'])
})

test('visible close controls consume their own entries and repeated opens do not reopen overlays', () => {
  const first = createHarness()
  first.controller.startMap()
  first.state.panelOpen = true
  first.controller.panelOpened()
  first.state.panelOpen = false
  first.controller.panelClosedNormally()
  assert.equal(first.history.state.rgaMapOverlay.level, 'map')

  first.state.mapOpen = false
  first.controller.mapClosedNormally()
  assert.equal(first.history.index, 0)

  const secondState = { mapOpen: true, panelOpen: false }
  const secondController = createMapOverlayHistory({
    history: first.history,
    eventTarget: first.history.target,
    token: 'second-map',
    isMapOpen: () => secondState.mapOpen,
    isPanelOpen: () => secondState.panelOpen,
    closePopup: () => false,
    closePanelFromHistory: () => { secondState.panelOpen = false },
    closeMapFromHistory: () => { secondState.mapOpen = false },
  })
  secondController.startMap()
  assert.equal(first.history.index, 1)
  secondState.mapOpen = false
  secondController.mapClosedNormally()
  assert.equal(first.history.index, 0)
})
