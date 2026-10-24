import type { RaceSegmentFields, RouteGeometryPoint } from '../trip-core/index.ts'
import { isValidRaceSegmentFields } from '../trip-core/validation/race-segment.ts'
import { sha256Hex } from '../import/gpx/hash.ts'
import { indexRouteGeometry } from '../route-enrichment/segment-geometry.ts'
import { validRaceOffsets } from '../analysis/race-bounds.ts'

export const RACE_GPX_NAMESPACE = 'https://cgi-1991.github.io/bike-trip-dashboard/gpx/race/1'
export interface EnrichedRaceData {
  readonly version: 1
  readonly geometrySha256: string
  readonly customName: string | null
  readonly bounds: { readonly startOffsetM: number; readonly finishOffsetM: number } | null
  readonly segments: readonly (RaceSegmentFields & { readonly id: string })[]
}
export class EnrichedRaceError extends Error {}
const children = (element: Element, name: string) => Array.from(element.children).filter(child => child.localName === name)
const own = (element: Element, name: string) => children(element, name).filter(child => child.namespaceURI === RACE_GPX_NAMESPACE)
export function xmlText(value: string): string {
  return Array.from(value).map(char => { const c = char.codePointAt(0)!; return c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000 ? char : '�' }).join('')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}
export function isGeneratedRaceWaypoint(element: Element): boolean {
  return own(element, 'marker').length > 0 || children(element, 'extensions').some(extension => own(extension, 'marker').length > 0)
}
export function readEnrichedRace(root: Element): unknown | undefined {
  const entries = [root, ...children(root, 'extensions')].flatMap(extension => children(extension, 'race').filter(child => child.namespaceURI?.startsWith(RACE_GPX_NAMESPACE.slice(0, -1))))
  if (!entries.length) return undefined
  if (entries.length !== 1 || entries[0]!.namespaceURI !== RACE_GPX_NAMESPACE || entries[0]!.getAttribute('version') !== '1') throw new EnrichedRaceError('Version GPX enrichie non prise en charge ou métadonnées de course dupliquées.')
  const data = own(entries[0]!, 'data')
  if (data.length !== 1) throw new EnrichedRaceError('Métadonnées de course manquantes ou dupliquées.')
  try { return JSON.parse(data[0]!.textContent ?? '') as unknown }
  catch { throw new EnrichedRaceError('Métadonnées du GPX enrichi illisibles.') }
}
export async function geometrySha256(geometry: readonly RouteGeometryPoint[]): Promise<string> {
  // Identical numeric geometry after parsing: independent from XML formatting,
  // source-file hashes/ids, namespace prefixes, names and generated waypoints.
  const values = geometry.map(point => [point.latitude, point.longitude, point.altitudeM])
  return sha256Hex(new TextEncoder().encode(JSON.stringify(values)).buffer)
}
export async function validateEnrichedRace(value: unknown, geometry: readonly RouteGeometryPoint[]): Promise<EnrichedRaceData> {
  const fail = (): never => { throw new EnrichedRaceError('Configuration de course invalide dans le GPX enrichi. Aucun paramètre n’a été importé.') }
  if (value === null || typeof value !== 'object') return fail()
  const data = value as EnrichedRaceData
  if (data.version !== 1 || typeof data.geometrySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.geometrySha256)
    || (data.customName !== null && typeof data.customName !== 'string') || !Array.isArray(data.segments)) return fail()
  const length = indexRouteGeometry(geometry).lengthKm
  if (data.bounds !== null && (typeof data.bounds !== 'object' || !validRaceOffsets(data.bounds, length))) return fail()
  const ids = new Set<string>()
  for (const segment of data.segments) {
    const segmentId: unknown = segment?.id
    if (!isValidRaceSegmentFields(segment) || typeof segmentId !== 'string' || !segmentId.trim() || ids.has(segmentId)
      || segment.endOffsetM > length * 1000 + .001
      || (data.bounds !== null && (segment.startOffsetM < data.bounds.startOffsetM || segment.endOffsetM > data.bounds.finishOffsetM))) return fail()
    ids.add(segmentId as string)
  }
  if (await geometrySha256(geometry) !== data.geometrySha256) throw new EnrichedRaceError('La trace du GPX enrichi a changé : ses limites et segments doivent être replacés. Importez la trace d’origine ou un nouvel export valide.')
  // Copy only the supported fields, never arbitrary properties from a file.
  return { version: 1, geometrySha256: data.geometrySha256, customName: data.customName,
    bounds: data.bounds === null ? null : { startOffsetM: data.bounds.startOffsetM, finishOffsetM: data.bounds.finishOffsetM },
    segments: data.segments.map(segment => ({ id: segment.id, type: segment.type, name: segment.name, startOffsetM: segment.startOffsetM, endOffsetM: segment.endOffsetM,
      alerts: { beforeEnabled: segment.alerts.beforeEnabled, beforeM: segment.alerts.beforeM, atStart: segment.alerts.atStart, atEnd: segment.alerts.atEnd } })) }
}
