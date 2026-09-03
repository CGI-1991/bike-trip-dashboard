import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyEnrichmentFailure,
  EnrichmentHttpError,
  EnrichmentTimeoutError,
} from '../../src/route-enrichment/enrichment-failure.ts'

/**
 * Splitting a request answers "too expensive". It answers nothing at all
 * about "no signal", where halving would only turn one failure into sixteen.
 * These two must never be confused.
 */

test('a timeout means the request asked for too much — split it', () => {
  assert.equal(classifyEnrichmentFailure(new EnrichmentTimeoutError(30_000)), 'too-heavy')
})

test('an unrecognised error is treated as too heavy — subdividing is the recoverable guess', () => {
  assert.equal(classifyEnrichmentFailure(new Error('something odd')), 'too-heavy')
})

test('a 4xx is treated as too heavy — an over-large query is the usual cause', () => {
  assert.equal(classifyEnrichmentFailure(new EnrichmentHttpError(400)), 'too-heavy')
  assert.equal(classifyEnrichmentFailure(new EnrichmentHttpError(413)), 'too-heavy')
})

test('a failed fetch is a network failure, whatever the engine calls it', () => {
  for (const message of ['Failed to fetch', 'NetworkError when attempting to fetch resource', 'Load failed']) {
    const error = new TypeError(message)
    assert.equal(classifyEnrichmentFailure(error), 'unavailable', message)
  }
})

test('a confirmed-offline device explains every failure — never subdivide in that state', () => {
  assert.equal(classifyEnrichmentFailure(new EnrichmentTimeoutError(30_000), { online: false }), 'unavailable')
  assert.equal(classifyEnrichmentFailure(new Error('anything'), { online: false }), 'unavailable')
})

test('an unknown connectivity state does not by itself mean offline', () => {
  assert.equal(classifyEnrichmentFailure(new EnrichmentTimeoutError(30_000), { online: undefined }), 'too-heavy')
})

test('429 and 5xx mean "not for you right now" — suspend rather than pile on', () => {
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(classifyEnrichmentFailure(new EnrichmentHttpError(status)), 'unavailable', `HTTP ${status}`)
  }
})

test('a TypeError unrelated to the network is not mistaken for one', () => {
  assert.equal(classifyEnrichmentFailure(new TypeError('x.map is not a function')), 'too-heavy')
})
