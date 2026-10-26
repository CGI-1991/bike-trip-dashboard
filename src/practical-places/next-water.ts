import type { PracticalPlaceViewModel } from './view-model.ts'

/** Source tags establish mapped potability, never availability on the ground. */
export function mappedDrinkingWater(point: PracticalPlaceViewModel): boolean {
  const { place, opening } = point
  const tags = place.usefulTags ?? {}
  if (place.category !== 'water' || place.hidden || opening?.status === 'closed'
    || place.trackDistanceKm === null || !Number.isFinite(place.trackDistanceKm)
    || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return false
  if (tags.drinking_water !== undefined && tags.drinking_water !== 'yes') return false
  if (tags.amenity !== 'drinking_water' && tags.drinking_water !== 'yes') return false
  if (tags.access !== undefined && !['yes', 'public', 'permissive', 'designated'].includes(tags.access)) return false
  return true
}

/** Prepare once; profile movement then only searches this ordered water list. */
export function prepareNextWater(points: readonly PracticalPlaceViewModel[], routeLengthKm: number): readonly PracticalPlaceViewModel[] {
  return points.filter(point => mappedDrinkingWater(point) && point.place.trackDistanceKm! >= 0
    && point.place.trackDistanceKm! <= routeLengthKm).sort((a, b) => a.place.trackDistanceKm! - b.place.trackDistanceKm!)
}

export function nextWaterAt(points: readonly PracticalPlaceViewModel[], distanceKm: number): PracticalPlaceViewModel | null {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return null
  let left = 0, right = points.length
  while (left < right) {
    const middle = Math.floor((left + right) / 2)
    if (points[middle]!.place.trackDistanceKm! < distanceKm - 1e-6) left = middle + 1
    else right = middle
  }
  return points[left] ?? null
}
