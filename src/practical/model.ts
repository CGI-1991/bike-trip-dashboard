export const practicalIconKeys = [
  'shelter',
  'bakery',
  'cafe',
  'water',
  'food',
  'bicycle',
  'grocery',
  'toilet',
  'generic',
] as const

export type PracticalIconKey = (typeof practicalIconKeys)[number]

export interface PracticalLayer {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly iconKey: PracticalIconKey
  readonly pointCount: number
  readonly sourceStyleIds: readonly string[]
}

export interface PracticalPoint {
  readonly id: string
  readonly name: string
  readonly layerId: string
  readonly latitude: number
  readonly longitude: number
  readonly description?: string
  readonly dayIds: readonly string[]
}

export interface PracticalData {
  readonly schemaVersion: 1
  readonly distanceLimitKm: 6
  readonly layers: readonly PracticalLayer[]
  readonly points: readonly PracticalPoint[]
  readonly dayPointCounts: Readonly<Record<string, number>>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  )
}

function parseLayer(value: unknown): PracticalLayer {
  if (!isObject(value)) throw new Error('Calque pratique invalide.')
  const { id, name, color, iconKey, pointCount, sourceStyleIds } = value
  if (
    typeof id !== 'string' ||
    id.trim() === '' ||
    typeof name !== 'string' ||
    name.trim() === '' ||
    typeof color !== 'string' ||
    !/^#[\dA-F]{6}$/i.test(color) ||
    typeof iconKey !== 'string' ||
    !practicalIconKeys.includes(iconKey as PracticalIconKey) ||
    !Number.isInteger(pointCount) ||
    (pointCount as number) < 0 ||
    !isStringArray(sourceStyleIds)
  ) throw new Error(`Calque pratique invalide : ${String(id)}.`)
  return {
    id,
    name,
    color,
    iconKey: iconKey as PracticalIconKey,
    pointCount: pointCount as number,
    sourceStyleIds,
  }
}

function parsePoint(value: unknown, layerIds: ReadonlySet<string>): PracticalPoint {
  if (!isObject(value)) throw new Error('Point pratique invalide.')
  const { id, name, layerId, latitude, longitude, description, dayIds } = value
  if (
    typeof id !== 'string' ||
    id.trim() === '' ||
    typeof name !== 'string' ||
    name.trim() === '' ||
    typeof layerId !== 'string' ||
    !layerIds.has(layerId) ||
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !isValidCoordinate(latitude, longitude) ||
    (description !== undefined && (typeof description !== 'string' || description.trim() === '')) ||
    !isStringArray(dayIds)
  ) throw new Error(`Point pratique invalide : ${String(id)}.`)
  return {
    id,
    name,
    layerId,
    latitude,
    longitude,
    ...(description === undefined ? {} : { description }),
    dayIds,
  }
}

export function validatePracticalData(value: unknown): PracticalData {
  if (!isObject(value)) throw new Error('Document de données pratiques invalide.')
  if (value.schemaVersion !== 1) throw new Error('Version des données pratiques non prise en charge.')
  if (value.distanceLimitKm !== 6) throw new Error('Le filtre pratique doit rester fixé à 6 km.')
  if (!Array.isArray(value.layers) || !Array.isArray(value.points)) {
    throw new Error('Calques ou points pratiques absents.')
  }
  const layers = value.layers.map(parseLayer)
  const layerIds = new Set(layers.map(({ id }) => id))
  if (layerIds.size !== layers.length) throw new Error('Identifiants de calques pratiques dupliqués.')
  const points = value.points.map((point) => parsePoint(point, layerIds))
  if (new Set(points.map(({ id }) => id)).size !== points.length) {
    throw new Error('Identifiants de points pratiques dupliqués.')
  }
  if (!isObject(value.dayPointCounts)) throw new Error('Compteurs pratiques par journée absents.')
  const dayPointCounts = Object.fromEntries(
    Object.entries(value.dayPointCounts).map(([dayId, count]) => {
      if (!Number.isInteger(count) || (count as number) < 0) {
        throw new Error(`Compteur pratique invalide pour ${dayId}.`)
      }
      return [dayId, count as number]
    }),
  )
  return { schemaVersion: 1, distanceLimitKm: 6, layers, points, dayPointCounts }
}

export async function loadPracticalData(
  publicBaseUrl: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<PracticalData> {
  const base = publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`
  const response = await fetchImplementation(`${base}data/practical/practical-points.json`)
  if (!response.ok) {
    throw new Error(`Données pratiques indisponibles (${response.status}).`)
  }
  return validatePracticalData(await response.json())
}
