import type { RideStage, TripBundle } from '../trip-core/index.ts'
import { selectOrganizationCapabilities, selectRaceMode } from '../trip-core/index.ts'
import { buildRaceCourse } from '../analysis/race-bounds.ts'
import { analyzeRaceSegment, raceSegmentStatus } from '../analysis/race-segments.ts'
import { analyzeGpxDocument } from '../import/gpx/analyze-gpx.ts'
import { parseGpxXml } from '../import/gpx/gpx-xml.ts'
import { geometrySha256, isGeneratedRaceWaypoint, RACE_GPX_NAMESPACE, validateEnrichedRace, xmlText } from '../gpx/enriched-race-format.ts'
import type { EnrichedRaceData } from '../gpx/enriched-race-format.ts'

export function enrichedGpxUnavailableReason(bundle: TripBundle, stage: RideStage): string | null {
  if (!selectRaceMode(bundle)) return 'Choisissez League ou Tour pour exporter une course enrichie.'
  const course = buildRaceCourse(bundle, stage)
  if (course === null) return 'La trace complète est indisponible.'
  if (course.status === 'stale') return 'Redéfinissez les limites de course sur la trace actuelle.'
  if (selectOrganizationCapabilities(bundle).explicitRaceBounds && course.status !== 'bounded') return 'Définissez le départ et l’arrivée réels avant l’export.'
  if ((stage.raceSegments ?? []).some(segment => raceSegmentStatus(course, segment) !== 'ready')) return 'Replacez les segments signalés ou ajustez les limites de course avant l’export.'
  return null
}

/** Preserve original tracks, routes, timestamps, source waypoints and vendor
 * extensions. Only our previous generated annotations are replaced. */
export async function buildEnrichedGpx(bundle: TripBundle, stage: RideStage, sourceXml: string): Promise<{ readonly xml: string; readonly warnings: readonly string[] }> {
  const reason = enrichedGpxUnavailableReason(bundle, stage)
  if (reason !== null) throw new Error(reason)
  const course = buildRaceCourse(bundle, stage)!
  // Do not trust a mismatched source payload or silently serialize a simplified trace.
  const source = analyzeGpxDocument(parseGpxXml(sourceXml), 'GPX source')
  const sourceGeometry = source.points.map(point => ({ latitude: point.latitude, longitude: point.longitude, altitudeM: point.elevationM }))
  const digest = await geometrySha256(course.indexed.points)
  if (await geometrySha256(sourceGeometry) !== digest) throw new Error('La source GPX ne correspond plus à la trace affichée. Export annulé.')
  const data: EnrichedRaceData = await validateEnrichedRace({ version: 1, geometrySha256: digest, customName: stage.customName ?? null,
    bounds: course.bounds === null ? null : { startOffsetM: course.bounds.startOffsetM, finishOffsetM: course.bounds.finishOffsetM },
    segments: (stage.raceSegments ?? []).map(({ id, type, name, startOffsetM, endOffsetM, alerts }) => ({ id, type, name, startOffsetM, endOffsetM, alerts })) }, course.indexed.points)
  const root = new DOMParser().parseFromString(sourceXml, 'application/xml').documentElement
  const serializer = new XMLSerializer()
  const serialize = (element: Element) => serializer.serializeToString(element)
  const shell = (element: Element) => serialize(element.cloneNode(false) as Element).replace(/\/>$/, '>')
  const prefix = root.prefix === null ? '' : `${root.prefix}:`
  // GPX 1.0 uses foreign-namespace extension elements directly; 1.1 wraps them.
  const legacy = root.getAttribute('version') === '1.0'
  const wrapExtensions = (content: string) => legacy ? content : `<${prefix}extensions>${content}</${prefix}extensions>`
  const warnings: string[] = [], waypoints: string[] = []
  const waypoint = (name: string, description: string, point: { latitude: number; longitude: number; altitudeM: number | null }, role: string) => {
    waypoints.push(`<${prefix}wpt lat="${point.latitude}" lon="${point.longitude}">${point.altitudeM === null ? '' : `<${prefix}ele>${point.altitudeM}</${prefix}ele>`}<${prefix}name>${xmlText(name)}</${prefix}name><${prefix}desc>${xmlText(description)}</${prefix}desc><${prefix}type>${xmlText(role)}</${prefix}type>${wrapExtensions(`<tp:marker xmlns:tp="${RACE_GPX_NAMESPACE}"/>`)}</${prefix}wpt>`)
  }
  if (course.bounds !== null && course.geometry !== null) {
    waypoint('RACE_START', 'Départ réel de course', course.geometry[0]!, 'Start')
    waypoint('RACE_FINISH', 'Arrivée réelle de course', course.geometry.at(-1)!, 'Finish')
  }
  const numbers = { sprint: 0, climb: 0, flandrien: 0 }
  for (const segment of stage.raceSegments ?? []) {
    const analysis = analyzeRaceSegment(course, segment), geometry = analysis.geometry!
    const label = `${segment.type.toUpperCase()}_${String(++numbers[segment.type]).padStart(2, '0')}`
    waypoint(`${label}_START`, segment.name, geometry[0]!, 'Segment Start')
    waypoint(`${label}_END`, segment.name, geometry.at(-1)!, 'Segment End')
    const before = analysis.alertPoints.find(point => point.kind === 'before')
    if (before !== undefined) waypoint(`${label}_ALERT`, `${segment.name} · ${segment.alerts.beforeM} m avant`, before.point, 'Alert')
    if (analysis.beforeOmitted) warnings.push(`${segment.name} : alerte préalable omise, départ de course trop proche.`)
  }
  const body: string[] = [], extensions: string[] = []
  let inserted = false, extensionShell: Element | undefined
  for (const child of Array.from(root.children)) {
    if (child.namespaceURI === RACE_GPX_NAMESPACE && child.localName === 'race') continue
    if (child.localName === 'extensions') {
      extensionShell ??= child
      extensions.push(...Array.from(child.children).filter(element => element.namespaceURI !== RACE_GPX_NAMESPACE || element.localName !== 'race').map(serialize))
      continue
    }
    if (child.localName === 'wpt' && isGeneratedRaceWaypoint(child)) continue
    if (!inserted && (child.localName === 'trk' || child.localName === 'rte')) { body.push(...waypoints); inserted = true }
    body.push(serialize(child))
  }
  if (!inserted) body.push(...waypoints)
  const raceExtension = `<tp:race xmlns:tp="${RACE_GPX_NAMESPACE}" version="1"><tp:data>${xmlText(JSON.stringify(data))}</tp:data></tp:race>`
  if (legacy) {
    const preserved = extensionShell === undefined ? '' : `${shell(extensionShell)}${extensions.join('')}</${extensionShell.tagName}>`
    return { xml: `<?xml version="1.0" encoding="UTF-8"?>${shell(root)}${body.join('')}${preserved}${raceExtension}</${root.tagName}>`, warnings }
  }
  extensions.push(raceExtension)
  const extensionOpen = extensionShell === undefined ? `<${prefix}extensions>` : shell(extensionShell)
  const extensionClose = extensionShell === undefined ? `</${prefix}extensions>` : `</${extensionShell.tagName}>`
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>${shell(root)}${body.join('')}${extensionOpen}${extensions.join('')}${extensionClose}</${root.tagName}>`, warnings }
}
