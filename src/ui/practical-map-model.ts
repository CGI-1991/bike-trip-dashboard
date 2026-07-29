import type { PracticalData, PracticalLayer, PracticalPoint } from '../practical/model.ts'

export interface PracticalLayerViewModel {
  readonly layer: PracticalLayer
  readonly points: readonly PracticalPoint[]
}

export function getPracticalLayersForDay(
  data: PracticalData | null,
  dayId: string,
): readonly PracticalLayerViewModel[] {
  if (data === null) return []
  const pointsByLayer = new Map<string, PracticalPoint[]>()
  for (const point of data.points) {
    if (!point.dayIds.includes(dayId)) continue
    const points = pointsByLayer.get(point.layerId) ?? []
    points.push(point)
    pointsByLayer.set(point.layerId, points)
  }
  return data.layers.flatMap((layer) => {
    const points = pointsByLayer.get(layer.id)
    return points === undefined || points.length === 0 ? [] : [{ layer, points }]
  })
}

export function buildGoogleMapsBicyclingUrl(
  point: Pick<PracticalPoint, 'latitude' | 'longitude'>,
): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${point.latitude},${point.longitude}&travelmode=bicycling`
}
