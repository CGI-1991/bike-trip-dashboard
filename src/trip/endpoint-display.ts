import type { Accommodation } from './accommodations.ts'
import type { RoadbookRideDay } from './roadbook-types.ts'

/**
 * A single merged label for a route extremity: the technical route-start/
 * route-end waypoint and the roadbook place are always the same card (see
 * `buildRouteDisplayPoints` in `route-engine.ts`) — never "Départ" followed by
 * a separate place card.
 */
export interface EndpointDisplay {
  readonly primaryName: string
  readonly subLabel: string
  readonly merged: boolean
}

/**
 * Explicit, user-confirmed precision for a departure whose roadbook
 * `startName` is a bare locality but whose actual embarkation point has a
 * more precise name. This is an editorial decision (RGA_DASHBOARD_21), not
 * data derived from any external source — extend only on explicit request.
 */
const preciseStartNames: ReadonlyMap<string, string> = new Map([
  ['J1', 'Gare de Thonon-les-Bains'],
])

function normalizeLocality(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * The fusion criterion from RGA_DASHBOARD_21 section G: the accommodation is
 * only merged into the arrival card when its address names the same locality
 * as the roadbook's arrival place — otherwise the fusion would be invented,
 * not confirmed.
 */
function accommodationMatchesLocality(
  accommodation: Accommodation,
  localityName: string,
): boolean {
  const normalizedLocality = normalizeLocality(localityName)
  return (
    normalizedLocality.length > 0 &&
    normalizeLocality(accommodation.address).includes(normalizedLocality)
  )
}

export function resolveDepartureDisplay(day: RoadbookRideDay): EndpointDisplay {
  const precise = preciseStartNames.get(day.id)
  return {
    primaryName: precise ?? day.startName,
    subLabel: `Départ · ${day.startName}`,
    merged: precise !== undefined,
  }
}

export function resolveArrivalDisplay(
  day: RoadbookRideDay,
  accommodation: Accommodation | null,
): EndpointDisplay {
  const merged =
    accommodation !== null && accommodationMatchesLocality(accommodation, day.endName)
  return {
    primaryName: merged ? (accommodation as Accommodation).name : day.endName,
    subLabel: `Arrivée · ${day.endName}`,
    merged,
  }
}
