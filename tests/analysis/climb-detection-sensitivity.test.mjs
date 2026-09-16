import assert from 'node:assert/strict'
import test from 'node:test'

import { CLIMB_SENSITIVITY_TUNINGS, CLIMB_SIGNIFICANCE_PROFILES, climbSignificanceProfilesFor, detectClimbs } from '../../src/analysis/climb-detection.ts'
import { CLIMB_DETECTION_SENSITIVITIES } from '../../src/trip-core/index.ts'

const SAMPLE_SPACING_KM = 0.05

/**
 * Builds a terrain profile from a list of `{ lengthKm, gradientPercent }`
 * sections, sampled at the same 50 m step the real pipeline resamples to.
 * `smoothedGradePercent` is each sample's own section gradient — the only
 * thing detection reads it for is a climb's max gradient.
 */
function profileFromSections(sections) {
  const points = [{ distanceKm: 0, elevationM: 100, smoothedGradePercent: 0, latitude: 45, longitude: 6 }]
  let distanceKm = 0
  let elevationM = 100
  for (const section of sections) {
    const steps = Math.round(section.lengthKm / SAMPLE_SPACING_KM)
    for (let step = 0; step < steps; step++) {
      distanceKm += SAMPLE_SPACING_KM
      elevationM += (section.gradientPercent / 100) * SAMPLE_SPACING_KM * 1_000
      points.push({ distanceKm, elevationM, smoothedGradePercent: section.gradientPercent, latitude: 45, longitude: 6 + distanceKm / 78.7 })
    }
  }
  return points
}

/** A deterministic, altitude-noisy flat ride: ±`amplitudeM` ripple, no real climb anywhere. */
function noisyFlatProfile({ lengthKm = 20, amplitudeM = 1.5, periodKm = 0.4 } = {}) {
  const points = []
  const steps = Math.round(lengthKm / SAMPLE_SPACING_KM)
  for (let step = 0; step <= steps; step++) {
    const distanceKm = step * SAMPLE_SPACING_KM
    points.push({
      distanceKm,
      elevationM: 100 + amplitudeM * Math.sin((distanceKm / periodKm) * Math.PI * 2),
      smoothedGradePercent: 0,
      latitude: 45,
      longitude: 6 + distanceKm / 78.7,
    })
  }
  return points
}

function detect(profile, sensitivity) {
  let counter = 0
  return detectClimbs(profile, [], 'route-test', () => `climb-${counter++}`, 'test-engine', sensitivity)
}

// --- non-regression ----------------------------------------------------------

test("'standard' is the historical calibration, byte for byte", () => {
  assert.deepEqual(
    climbSignificanceProfilesFor('standard').map((entry) => [entry.minLengthKm, entry.minElevationGainM, entry.minAverageGradientPercent]),
    CLIMB_SIGNIFICANCE_PROFILES.map((entry) => [entry.minLengthKm, entry.minElevationGainM, entry.minAverageGradientPercent]),
  )
  const tuning = CLIMB_SENSITIVITY_TUNINGS.standard
  assert.equal(tuning.thresholdScale, 1)
  assert.equal(tuning.gradientScale, 1)
  assert.equal(tuning.mergeScale, 1)
  assert.equal(tuning.reliefAdaptive, true)
})

test('detectClimbs called without a sensitivity behaves exactly like the standard level', () => {
  const profile = profileFromSections([{ lengthKm: 2, gradientPercent: 0 }, { lengthKm: 8, gradientPercent: 6 }, { lengthKm: 5, gradientPercent: -5 }])
  const implicit = detect(profile, undefined)
  const explicit = detect(profile, 'standard')
  assert.deepEqual(
    implicit.map((climb) => [climb.startDistanceKm, climb.endDistanceKm]),
    explicit.map((climb) => [climb.startDistanceKm, climb.endDistanceKm]),
  )
})

// --- a long climb ------------------------------------------------------------

test('a long climb (8 km at 6 %) is detected at every sensitivity, including the most selective one', () => {
  const profile = profileFromSections([{ lengthKm: 2, gradientPercent: 0 }, { lengthKm: 8, gradientPercent: 6 }, { lengthKm: 6, gradientPercent: -5 }])
  for (const sensitivity of CLIMB_DETECTION_SENSITIVITIES) {
    const climbs = detect(profile, sensitivity)
    assert.equal(climbs.length, 1, `${sensitivity}: exactly one climb`)
    assert.ok(climbs[0].elevationGainM > 400, `${sensitivity}: its D+ is the real one`)
  }
})

// --- a short côte ------------------------------------------------------------

test('a short côte (0.8 km at 5 %) is ignored in Montagne and found in Pays plat', () => {
  // The approach descends gently rather than being perfectly flat, so the
  // côte starts from a real valley — a dead-flat run-up would be folded into
  // the ascent by the turning-point extraction and dilute its gradient, which
  // is the algorithm's own behaviour and not what this test is about.
  const profile = profileFromSections([
    { lengthKm: 4, gradientPercent: -0.5 },
    { lengthKm: 0.8, gradientPercent: 5 },
    { lengthKm: 4, gradientPercent: -1 },
  ])
  assert.equal(detect(profile, 'mountain').length, 0, 'Montagne keeps only the significant ascents')
  assert.equal(detect(profile, 'flat').length, 1, 'Pays plat counts it')
})

// --- altimetric noise --------------------------------------------------------

test('a noisy but genuinely flat ride produces no climb at ANY level — the most sensitive one included', () => {
  const profile = noisyFlatProfile()
  for (const sensitivity of CLIMB_DETECTION_SENSITIVITIES) {
    assert.equal(detect(profile, sensitivity).length, 0, `${sensitivity}: GPS ripple is never a climb`)
  }
})

test('the most sensitive level keeps a real noise floor: a coarser turning-point epsilon than the historical one', () => {
  assert.ok(CLIMB_SENSITIVITY_TUNINGS.flat.pivotNoiseEpsilonM > CLIMB_SENSITIVITY_TUNINGS.standard.pivotNoiseEpsilonM)
  assert.ok(CLIMB_SENSITIVITY_TUNINGS.rolling.pivotNoiseEpsilonM >= CLIMB_SENSITIVITY_TUNINGS.standard.pivotNoiseEpsilonM)
})

test('no level ever scales a threshold below the absolute floor a real small hill still clears', () => {
  for (const sensitivity of CLIMB_DETECTION_SENSITIVITIES) {
    for (const profile of climbSignificanceProfilesFor(sensitivity)) {
      assert.ok(profile.minLengthKm >= 0.25, `${sensitivity}: length floor`)
      assert.ok(profile.minElevationGainM >= 20, `${sensitivity}: D+ floor`)
      assert.ok(profile.minAverageGradientPercent >= 1.5, `${sensitivity}: gradient floor`)
    }
  }
})

// --- coherence across levels -------------------------------------------------

test('sensitivity is monotonic: from Montagne to Pays plat, a rolling ride never loses a climb it already had', () => {
  const profile = profileFromSections([
    { lengthKm: 1, gradientPercent: 0 },
    { lengthKm: 5, gradientPercent: 5 },
    { lengthKm: 4, gradientPercent: -5 },
    { lengthKm: 1.2, gradientPercent: 4 },
    { lengthKm: 2, gradientPercent: -3 },
    { lengthKm: 0.6, gradientPercent: 5 },
    { lengthKm: 3, gradientPercent: -2 },
  ])
  const counts = CLIMB_DETECTION_SENSITIVITIES.map((sensitivity) => detect(profile, sensitivity).length)
  for (let index = 1; index < counts.length; index++) {
    assert.ok(counts[index] >= counts[index - 1], `${CLIMB_DETECTION_SENSITIVITIES[index]} (${counts[index]}) must not detect fewer than ${CLIMB_DETECTION_SENSITIVITIES[index - 1]} (${counts[index - 1]})`)
  }
  assert.ok(counts[counts.length - 1] > counts[0], 'the two ends of the slider genuinely differ')
})

test('the thresholds themselves are ordered from the most selective to the most sensitive', () => {
  const longProfile = (sensitivity) => climbSignificanceProfilesFor(sensitivity)[0]
  for (let index = 1; index < CLIMB_DETECTION_SENSITIVITIES.length; index++) {
    const stricter = longProfile(CLIMB_DETECTION_SENSITIVITIES[index - 1])
    const looser = longProfile(CLIMB_DETECTION_SENSITIVITIES[index])
    assert.ok(looser.minLengthKm <= stricter.minLengthKm)
    assert.ok(looser.minElevationGainM <= stricter.minElevationGainM)
    assert.ok(looser.minAverageGradientPercent <= stricter.minAverageGradientPercent)
  }
})
