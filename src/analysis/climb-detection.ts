/**
 * Generic climb/col detection from a local terrain profile only (CDC section
 * 13) — source 1 of section 13.2 ("profil altimétrique GPX"); waypoints
 * (source 2) may only ever *name* an already-detected climb, never invent
 * one, and OSM/override sources (13.2's 3-4) are out of scope for this
 * phase. Purely computed: every `Climb` this produces carries
 * `provenance.sourceType === 'generated'`.
 *
 * Method (CDC 13.3, adapted to a single forward pass instead of literally
 * walking backward from a pre-known summit list, since no waypoint/OSM
 * summit candidates are available here): reduce the terrain profile to its
 * alternating valley/peak turning points, then merge a peak into the next
 * climb whenever the dip after it is shallow and short enough to tolerate
 * (CDC 13.4/13.5 — short intermediate descents, short flats, staircases and
 * false summits all fall out of this same merge rule), and finally validate
 * each surviving valley→peak span against the length/D+/grade thresholds.
 */

import { calculateHaversineDistanceKm } from '../gpx/parser.ts'
import type { Climb, ClimbConfidence, ClimbDetectionSensitivity, ClimbId, ConfidenceLevel, RouteId } from '../trip-core/index.ts'
import { climbId, DEFAULT_CLIMB_DETECTION_SENSITIVITY } from '../trip-core/index.ts'
import type { TerrainProfilePoint } from '../route/types.ts'
import { deriveTerrainLabelFromElevationGainPerKm } from './terrain-context.ts'
import type { TripTerrainLabel } from './terrain-context.ts'

/** CDC section 13.4 — "règles initiales". */
export interface ClimbSignificanceMetrics {
  readonly lengthKm: number
  readonly elevationGainM: number
  readonly averageGradientPercent: number
}

interface ClimbSignificanceProfile {
  readonly terrain: 'long' | 'intermediate' | 'short-steep' | 'relief-adaptive'
  readonly minLengthKm: number
  readonly minElevationGainM: number
  readonly minAverageGradientPercent: number
}

/** Initial multi-terrain calibration: satisfying any one complete profile qualifies the candidate. */
export const CLIMB_SIGNIFICANCE_PROFILES = [
  { terrain: 'long', minLengthKm: 1.5, minElevationGainM: 100, minAverageGradientPercent: 2 },
  { terrain: 'intermediate', minLengthKm: 1, minElevationGainM: 60, minAverageGradientPercent: 3 },
  { terrain: 'short-steep', minLengthKm: 0.5, minElevationGainM: 40, minAverageGradientPercent: 4 },
] as const satisfies readonly ClimbSignificanceProfile[]

function satisfiesProfile(metrics: ClimbSignificanceMetrics, profile: ClimbSignificanceProfile): boolean {
  return metrics.lengthKm >= profile.minLengthKm
    && metrics.elevationGainM >= profile.minElevationGainM
    && metrics.averageGradientPercent >= profile.minAverageGradientPercent
}

/** Pure final qualification, deliberately independent from pivot extraction and tolerant-dip merging. `sensitivity` defaults to the historical calibration. */
export function isSignificantClimb(metrics: ClimbSignificanceMetrics, sensitivity: ClimbDetectionSensitivity = DEFAULT_CLIMB_DETECTION_SENSITIVITY): boolean {
  return climbSignificanceProfilesFor(sensitivity).some((profile) => satisfiesProfile(metrics, profile))
}

/**
 * Polish-final section 4-11 — adaptive detection, never a global threshold
 * cut. A `'mountain'`-relief stage keeps the ORIGINAL calibration byte for
 * byte (`toleratedLossM`/`maxFlatKm` identical to the historical constants,
 * `extraProfile: null`) — Galibier/Bonette/Télégraphe/Joux Plane and every
 * other genuinely alpine stage never see a single behavioural change (CDC
 * section 11: non-régression RGA).
 *
 * Only a stage whose OWN relief (not the trip's aggregate — one stage can be
 * far hillier or flatter than the trip average) is genuinely below the
 * mountain cutoff gets two adjustments, both scaled to that same relief
 * reading:
 *  - a tighter dip-merge tolerance, so several real, comparably-scaled
 *    rollers stop collapsing into one grade-diluted blob (root cause of a
 *    rolling stage reporting `0` despite meaningful D+: `mergeTolerantDips`
 *    pins the merged span's start to the very first valley in the chain,
 *    and a long merged span's NET valley-to-peak grade washes out on
 *    terrain whose ups and downs are roughly symmetric);
 *  - one additional, deliberately modest qualification profile, sized to
 *    the stage's own relief tier rather than to alpine cols. It is checked
 *    only as a fallback once the original three profiles have already
 *    failed, and only against a stage-scale minimum (25-30 m / 0.4-0.6 km) a
 *    genuine micro-undulation (a handful of meters, per CDC section 59)
 *    still never reaches — this is what keeps a flat/rolling route free of
 *    fabricated climbs (CDC section 7: never invent one just to avoid `0`).
 */
interface ReliefTuning {
  readonly toleratedLossM: number
  readonly maxFlatKm: number
  readonly extraProfile: ClimbSignificanceProfile | null
}

/** CDC section 13.4 — "valeurs à calibrer" (picked at the middle of each given range); also the exact `'mountain'`-relief tuning below, unchanged. */
export const CLIMB_TOLERATED_LOSS_M = 25
export const CLIMB_MAX_FLAT_KM = 1

const RELIEF_TUNING: Readonly<Record<TripTerrainLabel, ReliefTuning>> = {
  mountain: { toleratedLossM: CLIMB_TOLERATED_LOSS_M, maxFlatKm: CLIMB_MAX_FLAT_KM, extraProfile: null },
  mixed: {
    toleratedLossM: 15,
    maxFlatKm: 0.6,
    extraProfile: { terrain: 'relief-adaptive', minLengthKm: 0.6, minElevationGainM: 30, minAverageGradientPercent: 2.2 },
  },
  rolling: {
    toleratedLossM: 10,
    maxFlatKm: 0.4,
    extraProfile: { terrain: 'relief-adaptive', minLengthKm: 0.4, minElevationGainM: 25, minAverageGradientPercent: 2.2 },
  },
}

/** Elevation delta below which a point-to-point change is treated as noise, not a real direction reversal (the `'standard'` sensitivity's own value; see `CLIMB_SENSITIVITY_TUNINGS`). */
const PIVOT_NOISE_EPSILON_M = 1

/**
 * Trip-wide detection sensitivity — the 5-step "Montagne → Pays plat"
 * slider, resolved into concrete multipliers over the calibration above.
 * ONE table, because a step has to act on the detection itself (not on a
 * display filter), and three different knobs decide what a climb is:
 *
 *  - `thresholdScale` scales the minimum length and D+ of every
 *    qualification profile — the "how big must it be" knob;
 *  - `gradientScale` scales their minimum average gradient — the "how steep
 *    must it be" knob, deliberately moved less than size, because a gentle
 *    3 km drag and a sharp 300 m ramp are both real climbs and only the
 *    first one gets lost when sizes grow;
 *  - `mergeScale` scales the tolerated dip between two ascents: a high
 *    value welds a staircase into one big col (what a mountain reading
 *    wants), a low one keeps successive rollers separate (what a flat
 *    country reading wants);
 *  - `pivotNoiseEpsilonM` is the noise floor of the turning-point
 *    extraction. It RISES with sensitivity, not falls: as qualification
 *    gets more permissive, the profile itself must be read more coarsely,
 *    or GPS/barometric ripple would start manufacturing climbs. This is
 *    what keeps the most sensitive step honest.
 *  - `reliefAdaptive` keeps the existing per-stage relief adaptation (a
 *    rolling stage gets tighter merging and one extra modest profile).
 *    Both selective steps switch it off and read every stage with the
 *    alpine calibration, which is exactly what "only the significant
 *    climbs" means. `extraProfileOnMountainRelief` does the opposite at the
 *    sensitive end: even a genuinely alpine stage then also gets the modest
 *    extra profile, so its small intermediate ramps stop being invisible.
 *
 * `'standard'` is all-1 / relief-adaptive / epsilon 1 — i.e. the historical
 * calibration, byte for byte. It is what an absent setting resolves to, so
 * every already-saved trip detects exactly what it detects today.
 */
interface ClimbSensitivityTuning {
  readonly thresholdScale: number
  readonly gradientScale: number
  readonly mergeScale: number
  readonly pivotNoiseEpsilonM: number
  readonly reliefAdaptive: boolean
  readonly extraProfileOnMountainRelief: boolean
}

export const CLIMB_SENSITIVITY_TUNINGS: Readonly<Record<ClimbDetectionSensitivity, ClimbSensitivityTuning>> = {
  mountain: { thresholdScale: 2.2, gradientScale: 1.25, mergeScale: 1.3, pivotNoiseEpsilonM: 1, reliefAdaptive: false, extraProfileOnMountainRelief: false },
  hilly: { thresholdScale: 1.5, gradientScale: 1.1, mergeScale: 1.15, pivotNoiseEpsilonM: 1, reliefAdaptive: false, extraProfileOnMountainRelief: false },
  standard: { thresholdScale: 1, gradientScale: 1, mergeScale: 1, pivotNoiseEpsilonM: PIVOT_NOISE_EPSILON_M, reliefAdaptive: true, extraProfileOnMountainRelief: false },
  rolling: { thresholdScale: 0.7, gradientScale: 0.88, mergeScale: 0.8, pivotNoiseEpsilonM: 1.5, reliefAdaptive: true, extraProfileOnMountainRelief: true },
  flat: { thresholdScale: 0.5, gradientScale: 0.78, mergeScale: 0.65, pivotNoiseEpsilonM: 2, reliefAdaptive: true, extraProfileOnMountainRelief: true },
}

/**
 * Absolute floors no sensitivity may go under — the second half of the
 * noise guard (the first being `pivotNoiseEpsilonM` above). 20 m of gain
 * over at least 250 m at 1.5 % is a small hill someone actually feels; a
 * GPS/barometric wobble is an order of magnitude below all three at once.
 * Every `'standard'` threshold already sits comfortably above these, so
 * they change nothing until a sensitive step scales a value down into them.
 */
const MIN_CLIMB_LENGTH_KM = 0.25
const MIN_CLIMB_ELEVATION_GAIN_M = 20
const MIN_CLIMB_AVERAGE_GRADIENT_PERCENT = 1.5

function scaleProfile(profile: ClimbSignificanceProfile, tuning: ClimbSensitivityTuning): ClimbSignificanceProfile {
  return {
    terrain: profile.terrain,
    minLengthKm: Math.max(MIN_CLIMB_LENGTH_KM, profile.minLengthKm * tuning.thresholdScale),
    minElevationGainM: Math.max(MIN_CLIMB_ELEVATION_GAIN_M, profile.minElevationGainM * tuning.thresholdScale),
    minAverageGradientPercent: Math.max(MIN_CLIMB_AVERAGE_GRADIENT_PERCENT, profile.minAverageGradientPercent * tuning.gradientScale),
  }
}

/** The qualification profiles actually used at one sensitivity — identical to `CLIMB_SIGNIFICANCE_PROFILES` at `'standard'`. */
export function climbSignificanceProfilesFor(sensitivity: ClimbDetectionSensitivity): readonly ClimbSignificanceProfile[] {
  const tuning = CLIMB_SENSITIVITY_TUNINGS[sensitivity]
  return CLIMB_SIGNIFICANCE_PROFILES.map((profile) => scaleProfile(profile, tuning))
}

/** The dip-merge/extra-profile tuning actually used for one stage's relief at one sensitivity — identical to `RELIEF_TUNING[label]` at `'standard'`. */
function reliefTuningFor(label: TripTerrainLabel, sensitivity: ClimbDetectionSensitivity): ReliefTuning {
  const tuning = CLIMB_SENSITIVITY_TUNINGS[sensitivity]
  const base = tuning.reliefAdaptive ? RELIEF_TUNING[label] : RELIEF_TUNING.mountain
  const extraProfile = base.extraProfile !== null
    ? base.extraProfile
    : tuning.extraProfileOnMountainRelief
      // A sensitive reading of an alpine stage still wants its modest ramps:
      // the mixed tier's own extra profile is the closest honest sizing —
      // never a brand-new calibration invented for this one case.
      ? RELIEF_TUNING.mixed.extraProfile
      : null
  return {
    toleratedLossM: base.toleratedLossM * tuning.mergeScale,
    maxFlatKm: base.maxFlatKm * tuning.mergeScale,
    extraProfile: extraProfile === null ? null : scaleProfile(extraProfile, tuning),
  }
}

/** How close (great-circle) a named GPX waypoint must be to a detected peak to be trusted as its name (CDC section 5: "si la correspondance géométrique est suffisamment fiable"). */
export const CLIMB_WAYPOINT_MATCH_TOLERANCE_KM = 0.2

export interface NamedWaypointCandidate {
  readonly name: string | null
  readonly latitude: number
  readonly longitude: number
}

interface Pivot {
  readonly index: number
  readonly role: 'valley' | 'peak'
}

interface ValleyPeakRange {
  readonly valleyIndex: number
  readonly peakIndex: number
}

/**
 * Turning points of the profile, via the standard "zigzag" technique:
 * compare each new point against the running extremum since the last
 * *confirmed* pivot (never against just the immediately preceding point) so
 * a long, gradual retracement is caught exactly like an abrupt one — a
 * point-to-point comparison would treat a shallow-but-real multi-hundred-
 * meter descent as noise forever, since no single step exceeds the epsilon.
 * Index 0 and the last index are always included, whether or not a genuine
 * reversal happens there.
 */
function extractPivotIndices(profile: readonly TerrainProfilePoint[], noiseEpsilonM: number = PIVOT_NOISE_EPSILON_M): readonly number[] {
  const pivots: number[] = [0]
  let direction: -1 | 0 | 1 = 0
  let extremumIndex = 0

  for (let index = 1; index < profile.length; index++) {
    const elevationM = profile[index]?.elevationM ?? 0
    const extremumElevationM = profile[extremumIndex]?.elevationM ?? 0

    if (direction === 0) {
      const delta = elevationM - (profile[0]?.elevationM ?? 0)
      if (Math.abs(delta) >= noiseEpsilonM) {
        direction = delta > 0 ? 1 : -1
        extremumIndex = index
      }
      continue
    }

    if (direction === 1) {
      if (elevationM > extremumElevationM) {
        extremumIndex = index
      } else if (extremumElevationM - elevationM >= noiseEpsilonM) {
        pivots.push(extremumIndex)
        direction = -1
        extremumIndex = index
      }
    } else {
      if (elevationM < extremumElevationM) {
        extremumIndex = index
      } else if (elevationM - extremumElevationM >= noiseEpsilonM) {
        pivots.push(extremumIndex)
        direction = 1
        extremumIndex = index
      }
    }
  }

  if (direction !== 0) pivots.push(extremumIndex)
  const lastIndex = profile.length - 1
  if (pivots[pivots.length - 1] !== lastIndex) pivots.push(lastIndex)
  return pivots
}

/** Classifies each pivot as a local valley or peak. Turning points strictly alternate by construction — only the very first pivot's role needs to be inferred from its neighbor. */
function classifyPivots(profile: readonly TerrainProfilePoint[], pivotIndices: readonly number[]): readonly Pivot[] {
  if (pivotIndices.length < 2) return pivotIndices.map((index) => ({ index, role: 'valley' }))

  const first = profile[pivotIndices[0] ?? 0]?.elevationM ?? 0
  const second = profile[pivotIndices[1] ?? 0]?.elevationM ?? 0
  const ascendingFirst = second >= first

  return pivotIndices.map((index, position) => {
    const isEvenPosition = position % 2 === 0
    const role: Pivot['role'] = isEvenPosition === ascendingFirst ? 'valley' : 'peak'
    return { index, role }
  })
}

/** Every adjacent valley→peak pivot pair — a raw, unmerged ascent candidate. */
function buildRawAscentPairs(pivots: readonly Pivot[]): readonly ValleyPeakRange[] {
  const pairs: ValleyPeakRange[] = []
  for (let index = 0; index < pivots.length - 1; index++) {
    const current = pivots[index]
    const next = pivots[index + 1]
    if (current?.role === 'valley' && next?.role === 'peak') {
      pairs.push({ valleyIndex: current.index, peakIndex: next.index })
    }
  }
  return pairs
}

/**
 * Merges a raw ascent into the next one whenever the dip between them is
 * shallow and short enough to tolerate (CDC 13.4/13.5). The merged range's
 * peak is always whichever end is actually highest — an absorbed bump that
 * fails to reach as high as the current peak (a false summit before the
 * real one) never moves the recorded peak backward.
 */
function mergeTolerantDips(
  profile: readonly TerrainProfilePoint[],
  rawPairs: readonly ValleyPeakRange[],
  toleratedLossM: number,
  maxFlatKm: number,
): readonly ValleyPeakRange[] {
  if (rawPairs.length === 0) return []

  const merged: ValleyPeakRange[] = []
  let current = rawPairs[0] as ValleyPeakRange

  for (let index = 1; index < rawPairs.length; index++) {
    const next = rawPairs[index] as ValleyPeakRange
    const currentPeakElevationM = profile[current.peakIndex]?.elevationM ?? 0
    const nextValleyElevationM = profile[next.valleyIndex]?.elevationM ?? 0
    const dipLossM = currentPeakElevationM - nextValleyElevationM
    const dipDistanceKm = (profile[next.valleyIndex]?.distanceKm ?? 0) - (profile[current.peakIndex]?.distanceKm ?? 0)

    if (dipLossM <= toleratedLossM && dipDistanceKm <= maxFlatKm) {
      const nextPeakElevationM = profile[next.peakIndex]?.elevationM ?? 0
      current = { valleyIndex: current.valleyIndex, peakIndex: nextPeakElevationM > currentPeakElevationM ? next.peakIndex : current.peakIndex }
    } else {
      merged.push(current)
      current = next
    }
  }

  merged.push(current)
  return merged
}

/** Cumulative D+ over a range — the same additive convention as `calculateSegmentMetrics` (never the plain peak-valley difference, which would ignore staircase dips). */
function cumulativeElevationGainM(profile: readonly TerrainProfilePoint[], startIndex: number, endIndex: number): number {
  let gainM = 0
  for (let index = startIndex + 1; index <= endIndex; index++) {
    const delta = (profile[index]?.elevationM ?? 0) - (profile[index - 1]?.elevationM ?? 0)
    if (delta > 0) gainM += delta
  }
  return gainM
}

/**
 * This stage's own relief tier (never the trip's aggregate — see the
 * `RELIEF_TUNING` doc comment) from the same profile detection itself
 * receives, no second pass over `Route`/`TripBundle`. Reuses the exact
 * rolling/mixed/mountain vocabulary and thresholds already shown to the
 * traveller elsewhere (`terrain-context.ts`), so "this stage is rolling"
 * means the same thing everywhere in the app.
 */
function computeStageReliefLabel(profile: readonly TerrainProfilePoint[]): TripTerrainLabel {
  const totalDistanceKm = (profile[profile.length - 1]?.distanceKm ?? 0) - (profile[0]?.distanceKm ?? 0)
  if (!(totalDistanceKm > 0)) return 'mountain' // Degenerate profile: never relax anything.
  const totalElevationGainM = cumulativeElevationGainM(profile, 0, profile.length - 1)
  return deriveTerrainLabelFromElevationGainPerKm(totalElevationGainM / totalDistanceKm)
}

function maxSmoothedGradePercent(profile: readonly TerrainProfilePoint[], startIndex: number, endIndex: number): number {
  let maximum = Number.NEGATIVE_INFINITY
  for (let index = startIndex; index <= endIndex; index++) {
    const grade = profile[index]?.smoothedGradePercent ?? Number.NEGATIVE_INFINITY
    if (grade > maximum) maximum = grade
  }
  return Number.isFinite(maximum) ? maximum : 0
}

function findNamedWaypointNear(
  waypoints: readonly NamedWaypointCandidate[],
  latitude: number,
  longitude: number,
  toleranceKm: number,
): string | null {
  let bestName: string | null = null
  let bestDistanceKm = Number.POSITIVE_INFINITY

  for (const waypoint of waypoints) {
    if (waypoint.name === null || waypoint.name.trim().length === 0) continue
    const distanceKm = calculateHaversineDistanceKm({ latitude, longitude, elevationM: null }, { latitude: waypoint.latitude, longitude: waypoint.longitude, elevationM: null })
    if (distanceKm <= toleranceKm && distanceKm < bestDistanceKm) {
      bestDistanceKm = distanceKm
      bestName = waypoint.name
    }
  }

  return bestName
}

/**
 * Detects every climb meeting CDC section 13.4's thresholds along one
 * route's terrain profile. Returns `[]` (never throws) when the profile is
 * too short to evaluate — an insufficiently-altituded file never reaches
 * this function at all (see `terrain-profile.ts`/the import pipeline).
 */
export function detectClimbs(
  profile: readonly TerrainProfilePoint[],
  waypoints: readonly NamedWaypointCandidate[],
  routeId: RouteId,
  idFactory: () => string,
  engineVersion: string,
  sensitivity: ClimbDetectionSensitivity = DEFAULT_CLIMB_DETECTION_SENSITIVITY,
): readonly Climb[] {
  if (profile.length < 2) return []

  const tuning = reliefTuningFor(computeStageReliefLabel(profile), sensitivity)
  const pivotIndices = extractPivotIndices(profile, CLIMB_SENSITIVITY_TUNINGS[sensitivity].pivotNoiseEpsilonM)
  const pivots = classifyPivots(profile, pivotIndices)
  const rawPairs = buildRawAscentPairs(pivots)
  const mergedRanges = mergeTolerantDips(profile, rawPairs, tuning.toleratedLossM, tuning.maxFlatKm)

  const climbs: Climb[] = []
  let sequenceNumber = 0

  for (const range of mergedRanges) {
    const start = profile[range.valleyIndex]
    const end = profile[range.peakIndex]
    if (start === undefined || end === undefined || range.peakIndex <= range.valleyIndex) continue

    const lengthKm = end.distanceKm - start.distanceKm
    const elevationGainM = cumulativeElevationGainM(profile, range.valleyIndex, range.peakIndex)
    // Average grade intentionally uses net valley-to-peak elevation change,
    // not cumulative D+. After tolerated dips are merged, D+/distance would
    // count re-ascents without accounting for their losses and overstate the
    // sustained gradient. D+ remains the separate effort/qualification metric.
    const averageGradientPercent = lengthKm > 0 ? ((end.elevationM - start.elevationM) / (lengthKm * 1000)) * 100 : 0

    let qualifies = isSignificantClimb({ lengthKm, elevationGainM, averageGradientPercent }, sensitivity)
    if (!qualifies && tuning.extraProfile !== null) {
      // Polish-final section 6-9: on non-mountain relief only, cumulative D+
      // ("effort" grade) is checked too, alongside the net valley-to-peak
      // grade above. A rolling climb legitimately absorbs a brief tolerated
      // dip mid-slope without that dip erasing the climbing effort it took —
      // unlike the net grade, which is exactly what a long alpine false-flat
      // needs the ORIGINAL three profiles to stay guarded against, so this
      // second check only ever widens what qualifies, never what the fixed
      // profiles already accepted.
      const effortGradientPercent = lengthKm > 0 ? (elevationGainM / (lengthKm * 1000)) * 100 : 0
      qualifies = satisfiesProfile({ lengthKm, elevationGainM, averageGradientPercent: effortGradientPercent }, tuning.extraProfile)
    }
    if (!qualifies) continue

    sequenceNumber++
    const matchedName = findNamedWaypointNear(waypoints, end.latitude, end.longitude, CLIMB_WAYPOINT_MATCH_TOLERANCE_KM)
    const confidence: ClimbConfidence = matchedName !== null ? 'confirmed' : 'probable'
    const dataConfidence: ConfidenceLevel = matchedName !== null ? 'high' : 'medium'

    climbs.push({
      id: climbId(idFactory()),
      routeId,
      name: matchedName ?? `Montée ${sequenceNumber}`,
      startDistanceKm: start.distanceKm,
      endDistanceKm: end.distanceKm,
      elevationGainM,
      averageGradientPercent,
      maxGradientPercent: maxSmoothedGradePercent(profile, range.valleyIndex, range.peakIndex),
      startAltitudeM: start.elevationM,
      endAltitudeM: end.elevationM,
      confidence,
      provenance: {
        sourceType: 'generated',
        sourceId: null,
        fetchedAt: null,
        engineVersion,
        confidence: dataConfidence,
        manuallyOverridden: false,
      },
    })
  }

  return climbs
}

export type { ClimbId }
