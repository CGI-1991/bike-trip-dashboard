/**
 * Which GPX waypoints may lend their name to a detected climb.
 *
 * A route file often carries far more `<wpt>` elements than places: Strava
 * and similar planners export a marker at every segment boundary — "Début
 * grimpeur"/"Fin grimpeur", "Début Sprint"/"Fin Sprint", "Arrivée Bleu",
 * "Last 5 km", "Ultimo Kilometro". Those are annotations about the ROUTE,
 * not names of places on it.
 *
 * Letting them name a climb caused two visible failures:
 *
 *  1. a climb finishing at the stage arrival adopted the arrival's own
 *     marker ("Arrivée Bleu", 5 m from the last track point), so the montée
 *     block read as the arrival and the two looked merged;
 *  2. a climb named this way is no longer "generic", and
 *     `route-enrichment/enrichment.ts::enrichClimbs` only ever renames a
 *     GENERIC climb from a nearby OSM col. The climb kept its marker name,
 *     the col kept its own, the name-based merge in
 *     `canonical-waypoints.ts` could never match them, and the col was
 *     dropped entirely — so those stages contributed no named col at all to
 *     the Aperçu "Détail" layer while other stages did.
 *
 * The rule below is deliberately based on what the file itself declares
 * rather than on guesswork, with a name-shape fallback for the (older, or
 * type-less) files that declare nothing.
 */

/**
 * GPX marker types that describe a position along the route rather than a
 * place. Compared case-insensitively against `<type>` (falling back to
 * `<sym>`), which is where Strava and most planners put this.
 *
 * `Summit`, `Generic`, `Water`, `Food`… are deliberately NOT here: a
 * waypoint the author placed as a real point on the ground may perfectly
 * well name the climb it sits on.
 */
const ROUTE_ANNOTATION_MARKER_TYPES: ReadonlySet<string> = new Set([
  'segment start',
  'segment end',
  'alert',
  'meeting spot',
  'control',
  'sprint',
  'category climb',
])

/**
 * Words a segment-boundary label starts with. Used only when the file
 * declares no usable marker type — a name that opens with "début"/"fin"/
 * "arrivée"/"départ"/"start"/"end"/"finish" is describing a boundary, not
 * naming a place ("Col du Platzerwasel" never does).
 */
const BOUNDARY_NAME_PREFIXES: readonly string[] = [
  'debut', 'fin', 'depart', 'arrivee', 'start', 'end', 'finish',
]

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .trim()
}

/**
 * `true` when this waypoint marks a segment boundary or a route alert, and
 * therefore must never be used as a climb's name. `markerType` is the GPX
 * `<type>`/`<sym>` when the file provides one.
 */
export function isRouteAnnotationMarker(name: string | null, markerType: string | null | undefined): boolean {
  if (markerType !== null && markerType !== undefined && markerType.trim() !== '') {
    return ROUTE_ANNOTATION_MARKER_TYPES.has(normalize(markerType))
  }
  if (name === null) return false
  const normalized = normalize(name)
  return BOUNDARY_NAME_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `))
}

/**
 * `true` when a climb's stored name is one this rule would never have
 * assigned — i.e. it came from a segment boundary marker. Used to repair
 * trips imported before the rule existed, and to stop
 * `climb-sensitivity.ts` from carrying such a name across a recomputation.
 *
 * Name-shape only: a stored climb carries no marker type of its own.
 */
export function isSegmentMarkerClimbName(name: string | null): boolean {
  return isRouteAnnotationMarker(name, null)
}
