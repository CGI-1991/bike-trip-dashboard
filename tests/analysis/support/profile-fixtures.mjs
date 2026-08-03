// Small, composable synthetic terrain-profile builders for phase 6B tests —
// never a copy of a real GPX file.

/** A ramp of `n+1` points from 0 to `gainM` (negative for a descent), `stepKm` apart. */
export function rampElevations(lengthKm, gainM, stepKm = 0.05) {
  const n = Math.max(1, Math.round(lengthKm / stepKm))
  const elevations = []
  for (let i = 0; i <= n; i++) elevations.push((gainM * i) / n)
  return elevations
}

/** A flat run of `n+1` points, all at elevation 0. */
export function flatElevations(lengthKm, stepKm = 0.05) {
  return rampElevations(lengthKm, 0, stepKm)
}

/** Concatenates elevation segments end-to-end, offsetting each by the previous segment's final value and dropping the shared boundary point. */
export function concatElevations(...segments) {
  let result = [...(segments[0] ?? [])]
  for (let index = 1; index < segments.length; index++) {
    const base = result[result.length - 1] ?? 0
    const segment = (segments[index] ?? []).slice(1).map((value) => value + base)
    result = result.concat(segment)
  }
  return result
}

/** Turns a flat elevation array into a full `TerrainProfilePoint[]`-shaped fixture, `stepKm` apart, with a simple centered-difference grade. */
export function buildTerrainProfile(elevations, stepKm = 0.05, gradeWindowKm = 0.5) {
  const points = elevations.map((elevationM, index) => ({ distanceKm: index * stepKm, elevationM, latitude: 45, longitude: 6 }))
  const halfWindowSteps = Math.max(1, Math.round(gradeWindowKm / 2 / stepKm))

  return points.map((point, index) => {
    const leftIndex = Math.max(0, index - halfWindowSteps)
    const rightIndex = Math.min(points.length - 1, index + halfWindowSteps)
    const left = points[leftIndex]
    const right = points[rightIndex]
    const deltaKm = right.distanceKm - left.distanceKm
    const smoothedGradePercent = deltaKm > 0 ? ((right.elevationM - left.elevationM) / (deltaKm * 1000)) * 100 : 0
    return { ...point, smoothedGradePercent }
  })
}
