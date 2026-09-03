import assert from 'node:assert/strict'
import test from 'node:test'

import { googleMapsTravelMode, resolveMapsDirectionsUrl, resolveMapsSearchUrl } from '../../src/ui/maps-link.ts'

// --- RC2 final-closeout sections 45-50/80: Maps link priority hierarchy ---

test('AI: an explicit Maps URL is always used first, regardless of address/coordinates', () => {
  const url = resolveMapsSearchUrl({
    explicitUrl: 'https://maps.app.goo.gl/custom-link',
    address: '12 rue du Test, Paris',
    coordinates: { latitude: 45.5, longitude: 6.7 },
  })
  assert.equal(url, 'https://maps.app.goo.gl/custom-link')
})

test('AJ: falls back to a text address as a Maps search query when no explicit URL is set', () => {
  const url = resolveMapsSearchUrl({ explicitUrl: null, address: '12 rue du Test, Paris', coordinates: { latitude: 45.5, longitude: 6.7 } })
  assert.equal(url, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('12 rue du Test, Paris')}`)
})

test('AK: falls back to coordinates when neither an explicit URL nor an address is known', () => {
  const url = resolveMapsSearchUrl({ explicitUrl: null, address: null, coordinates: { latitude: 45.5, longitude: 6.7 } })
  assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=45.500000%2C6.700000')
})

test('AL: no field at all resolves to null — never an empty/dead button', () => {
  assert.equal(resolveMapsSearchUrl({}), null)
  assert.equal(resolveMapsSearchUrl({ explicitUrl: null, address: null, coordinates: null }), null)
})

test('a blank/whitespace-only explicit URL or address is treated as absent, never used verbatim', () => {
  assert.equal(resolveMapsSearchUrl({ explicitUrl: '   ', address: '12 rue du Test' }), 'https://www.google.com/maps/search/?api=1&query=12%20rue%20du%20Test')
  assert.equal(resolveMapsSearchUrl({ explicitUrl: null, address: '   ', coordinates: { latitude: 1, longitude: 2 } }), 'https://www.google.com/maps/search/?api=1&query=1.000000%2C2.000000')
})

test('resolveMapsDirectionsUrl builds an origin+destination link with no travelmode forced when no mode is given', () => {
  const url = resolveMapsDirectionsUrl({ latitude: 45.5, longitude: 6.7 }, { latitude: 46.1, longitude: 7.2 })
  assert.equal(url, 'https://www.google.com/maps/dir/?api=1&origin=45.500000%2C6.700000&destination=46.100000%2C7.200000')
  assert.doesNotMatch(url, /travelmode/)
})

// --- DER-DES-DER section 99: the transfer mode drives Google's travelmode ---

test('section 99: train and bus map to transit', () => {
  assert.equal(googleMapsTravelMode('train'), 'transit')
  assert.equal(googleMapsTravelMode('bus'), 'transit')
})

test('section 99: car and taxi/navette map to driving', () => {
  assert.equal(googleMapsTravelMode('car'), 'driving')
  assert.equal(googleMapsTravelMode('taxi'), 'driving')
})

test('section 99: bike maps to bicycling', () => {
  assert.equal(googleMapsTravelMode('bike'), 'bicycling')
})

test('section 99: ferry forces NO travelmode — Google works the crossing out itself rather than being told a mode that is not the one being taken', () => {
  assert.equal(googleMapsTravelMode('ferry'), null)
  const url = resolveMapsDirectionsUrl({ latitude: 45.5, longitude: 6.7 }, { latitude: 46.1, longitude: 7.2 }, 'ferry')
  assert.doesNotMatch(url, /travelmode/)
})

test('section 99: "other", an unknown free-text mode, and no mode at all all force nothing', () => {
  assert.equal(googleMapsTravelMode('other'), null)
  assert.equal(googleMapsTravelMode('hélicoptère'), null)
  assert.equal(googleMapsTravelMode(null), null)
  assert.equal(googleMapsTravelMode(undefined), null)
})

test('section 100: changing the mode changes the link immediately — it is built from the current mode, never stored', () => {
  const origin = { latitude: 45.5, longitude: 6.7 }
  const destination = { latitude: 46.1, longitude: 7.2 }
  assert.match(resolveMapsDirectionsUrl(origin, destination, 'train'), /travelmode=transit/)
  assert.match(resolveMapsDirectionsUrl(origin, destination, 'car'), /travelmode=driving/)
})

test('section 98: the itinerary uses the exact coordinates of both endpoints, never their text names', () => {
  const url = resolveMapsDirectionsUrl({ latitude: 45.5, longitude: 6.7 }, { latitude: 46.1, longitude: 7.2 }, 'car')
  assert.match(url, /origin=45\.500000%2C6\.700000/)
  assert.match(url, /destination=46\.100000%2C7\.200000/)
})

test('section 101: an unresolved side still yields no link at all, whatever the mode', () => {
  assert.equal(resolveMapsDirectionsUrl(null, { latitude: 46.1, longitude: 7.2 }, 'train'), null)
  assert.equal(resolveMapsDirectionsUrl({ latitude: 45.5, longitude: 6.7 }, null, 'car'), null)
})

test('resolveMapsDirectionsUrl is null when either side is unresolved — never a one-sided/fabricated route', () => {
  assert.equal(resolveMapsDirectionsUrl(null, { latitude: 46.1, longitude: 7.2 }), null)
  assert.equal(resolveMapsDirectionsUrl({ latitude: 45.5, longitude: 6.7 }, null), null)
  assert.equal(resolveMapsDirectionsUrl(null, null), null)
})
