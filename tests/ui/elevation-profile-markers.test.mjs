import assert from 'node:assert/strict'
import test from 'node:test'

import { renderElevationProfile } from '../../src/ui/elevation-profile.ts'

function buildFixture() {
  const points = Array.from({ length: 200 }, (_, index) => ({
    latitude: 46 + index / 10_000,
    longitude: 6,
    elevationM: 400 + index,
  }))
  const gpx = { segments: [{ points }] }
  const timeline = {
    day: { id: 'J1', gpxNumber: 1 },
    route: { pauses: [] },
  }
  const startPoint = { id: 'j01-start', dayId: 'J1', type: 'start', resolution: 'matched', name: 'Thonon-les-Bains', matchedTrackDistanceKm: 0, matchedElevationM: 400 }
  const colPoint = { id: 'j01-col-col-du-feu', dayId: 'J1', type: 'col', resolution: 'matched', name: 'Col du Feu', matchedTrackDistanceKm: 5, matchedElevationM: 500 }
  const passagePoint = { id: 'j01-passage-lullin', dayId: 'J1', type: 'passage', resolution: 'matched', name: 'Lullin', matchedTrackDistanceKm: 10, matchedElevationM: 450 }
  const endPoint = { id: 'j01-end', dayId: 'J1', type: 'end', resolution: 'matched', name: 'Morzine', matchedTrackDistanceKm: 15, matchedElevationM: 550 }
  const report = {
    days: [
      {
        dayId: 'J1',
        type: 'ride',
        roadbook: { id: 'J1', startName: 'Thonon-les-Bains', endName: 'Morzine' },
        points: [startPoint, colPoint, passagePoint, endPoint],
      },
    ],
  }
  const container = { innerHTML: '' }
  renderElevationProfile(container, gpx, timeline, report, { name: 'Hôtel Le Soly', address: '234 Route de la Manche, 74110 Morzine' })
  return container.innerHTML
}

test('the profile draws distinct shapes per category, matching the map (circle/rounded-square/diamond)', () => {
  const html = buildFixture()
  assert.match(html, /profile-marker--start/)
  assert.match(html, /profile-marker--finish/)
  assert.match(html, /profile-marker--col-summit/)
  assert.match(html, /profile-marker--passage/)
  // col-summit is the only category rendered as a rotated (diamond) rect.
  assert.match(html, /profile-marker--col-summit"[^>]*>.*?rotate\(45\)/s)
  // finish is a rounded square (rect, not rotated).
  const finishMarker = html.match(/<g class="profile-marker profile-marker--finish"[^]*?<\/g>/)?.[0] ?? ''
  assert.match(finishMarker, /<rect/)
  assert.doesNotMatch(finishMarker, /rotate\(45\)/)
})

test('the arrival marker title uses the merged accommodation name, just like the map tooltip', () => {
  const html = buildFixture()
  assert.match(html, /Hôtel Le Soly · 15\.0 km/)
})

test('a pause attached to a documented point adds a ring to that same marker — no second position, no separate pause line', () => {
  const points = Array.from({ length: 200 }, (_, index) => ({ latitude: 46 + index / 10_000, longitude: 6, elevationM: 400 + index }))
  const gpx = { segments: [{ points }] }
  const timeline = {
    day: { id: 'J1', gpxNumber: 1 },
    route: { pauses: [{ id: 'pause-1', name: 'Col du Feu', durationMinutes: 20, pointId: 'j01-col-col-du-feu' }] },
  }
  const colPoint = { id: 'j01-col-col-du-feu', dayId: 'J1', type: 'col', resolution: 'matched', name: 'Col du Feu', matchedTrackDistanceKm: 5, matchedElevationM: 500 }
  const report = { days: [{ dayId: 'J1', type: 'ride', roadbook: { id: 'J1', startName: 'A', endName: 'B' }, points: [colPoint] }] }
  const container = { innerHTML: '' }
  renderElevationProfile(container, gpx, timeline, report)
  assert.match(container.innerHTML, /profile-marker--pause/)
  assert.match(container.innerHTML, /Col du Feu · 5\.0 km · Pause 20 min/)
  // Exactly one <g> marker for the col — the pause never creates a second element.
  assert.equal((container.innerHTML.match(/<g class="profile-marker/g) ?? []).length, 1)
  assert.doesNotMatch(container.innerHTML, /class="profile-pause"/)
})

test('an off-route documented point keeps its category shape but renders hollow', () => {
  const points = Array.from({ length: 50 }, (_, index) => ({ latitude: 46 + index / 10_000, longitude: 6, elevationM: 500 }))
  const gpx = { segments: [{ points }] }
  const timeline = { day: { id: 'J3', gpxNumber: 3 }, route: { pauses: [] } }
  const offRoutePassage = { id: 'j03-passage-la-clusaz', dayId: 'J3', type: 'village', resolution: 'informational', name: 'La Clusaz', matchedTrackDistanceKm: 5, matchedElevationM: 1_000 }
  const report = { days: [{ dayId: 'J3', type: 'ride', roadbook: { id: 'J3', startName: 'A', endName: 'B' }, points: [offRoutePassage] }] }
  const container = { innerHTML: '' }
  renderElevationProfile(container, gpx, timeline, report)
  assert.match(container.innerHTML, /profile-marker--off-route/)
  assert.match(container.innerHTML, /profile-marker--passage/)
})
