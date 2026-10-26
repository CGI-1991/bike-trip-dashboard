import test from 'node:test'
import assert from 'node:assert/strict'
import { installProfileExploration } from '../../src/ui/profile-exploration.ts'

class Plot extends EventTarget {
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 130 } }
  setPointerCapture() {}
  releasePointerCapture() {}
  emit(type, props = {}) { this.dispatchEvent(Object.assign(new Event(type), props)) }
}

function fixture() {
  const plot = new Plot()
  let visible = false, shows = 0
  const show = () => { visible = true; shows++ }
  const clear = () => { visible = false }
  installProfileExploration(plot, show, clear)
  return { plot, show, clear, get visible() { return visible }, get shows() { return shows } }
}
const touch = { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 50 }

test('finger contact shows a reading; release clears it without needing a leave event', () => {
  const f = fixture()
  f.plot.emit('pointerdown', touch)
  assert.equal(f.visible, true)
  f.plot.emit('pointerup', touch)
  assert.equal(f.visible, false)
  f.plot.emit('pointermove', touch)
  assert.equal(f.visible, false, 'a stale touch move cannot resurrect a released selection')
})

test('a captured finger dragged outside the plot clears the reading and can return inside', () => {
  const f = fixture()
  f.plot.emit('pointerdown', touch)
  f.plot.emit('pointermove', { ...touch, clientY: 200 })
  assert.equal(f.visible, false)
  f.plot.emit('pointermove', touch)
  assert.equal(f.visible, true)
})

test('scroll cancellation, lost capture, focus loss and Escape all clear a mini-profile reading', () => {
  for (const type of ['pointercancel', 'lostpointercapture', 'blur', 'keydown']) {
    const f = fixture()
    f.plot.emit('pointerdown', touch)
    f.plot.emit(type, { ...touch, key: 'Escape' })
    assert.equal(f.visible, false, type)
  }
})

test('mouse exploration stays visible on mouseup while hovering, and clears on leave', () => {
  const f = fixture(), mouse = { ...touch, pointerType: 'mouse' }
  f.plot.emit('pointermove', mouse)
  f.plot.emit('pointerup', mouse)
  assert.equal(f.visible, true)
  f.plot.emit('pointerleave', mouse)
  assert.equal(f.visible, false)
})

test('remounting the shared interaction disposes old listeners', () => {
  const f = fixture()
  installProfileExploration(f.plot, f.show, f.clear)
  f.plot.emit('pointerdown', touch)
  assert.equal(f.shows, 1)
})
