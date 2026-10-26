/** Display-only aggregation: original samples, geometry and ETA stay intact. */
export interface DisplayInterval {
  readonly startDistanceKm: number
  readonly endDistanceKm: number
  readonly averageGradientPercent: number | null
}

export function profileBandCount(widthPx: number): number {
  return Math.max(20, Math.min(120, Math.floor((Number.isFinite(widthPx) && widthPx > 0 ? widthPx : 320) / 9)))
}

export function aggregateProfileBands(source: readonly DisplayInterval[], widthPx = 320): readonly DisplayInterval[] {
  if (!source.length) return []
  const start = source[0]!.startDistanceKm, end = source.at(-1)!.endDistanceKm
  if (end <= start) return []
  const count = Math.min(source.length, profileBandCount(widthPx)), step = (end - start) / count
  const result: DisplayInterval[] = []
  let index = 0
  for (let i = 0; i < count; i++) {
    const a = start + i * step, b = i === count - 1 ? end : a + step
    while (index < source.length && source[index]!.endDistanceKm <= a) index++
    let sum = 0, covered = 0
    for (let j = index; j < source.length && source[j]!.startDistanceKm < b; j++) {
      const s = source[j]!, overlap = Math.max(0, Math.min(b, s.endDistanceKm) - Math.max(a, s.startDistanceKm))
      if (s.averageGradientPercent !== null && Number.isFinite(s.averageGradientPercent)) { sum += overlap * s.averageGradientPercent; covered += overlap }
    }
    result.push({ startDistanceKm: a, endDistanceKm: b, averageGradientPercent: covered >= (b - a) * .9 ? sum / covered : null })
  }
  return result
}
