/**
 * Pulls apart map markers that sit on the very same spot, graphically only.
 *
 * The case this exists for: a climb whose summit IS the stage arrival. The
 * model deliberately keeps them as two separate `CanonicalWaypoint`s — two
 * different facts about one place — so two Leaflet markers end up at
 * identical coordinates. Leaflet draws them in order, each icon anchored on
 * its own point, so the last one drawn (the arrival) covered the first (the
 * montée) exactly: one marker visible, one unreachable, and no way to hover
 * or tap the hidden one.
 *
 * The fix stays purely presentational. Nothing here touches a coordinate:
 * the offsets below are applied to Leaflet's `iconAnchor`, which only moves
 * the ICON relative to the geographic point it is pinned to. The markers
 * remain two objects, both hoverable, both tappable, and the underlying
 * positions are untouched — so nothing persisted, exported or measured ever
 * changes.
 *
 * Deterministic by construction: same markers in, same offsets out, with no
 * dependency on zoom, render order beyond the array itself, or any clock.
 */

/** A purely graphical icon displacement, in CSS pixels. `{ x: 0, y: 0 }` for a marker that collides with nothing. */
export interface MarkerIconOffset {
  readonly x: number
  readonly y: number
}

export const NO_MARKER_OFFSET: MarkerIconOffset = { x: 0, y: 0 }

/**
 * How far apart two coincident markers are pushed. Half the smallest
 * structural marker keeps both outlines visible while the pair still reads
 * as one place rather than two separate points.
 */
const COLLISION_SPREAD_PX = 7

/**
 * Coordinate precision at which two markers count as "the same spot": five
 * decimal degrees, about one metre. Deliberately tight — two genuinely
 * distinct places are never a metre apart, so this only ever separates
 * markers that really are coincident (a climb topping out on the arrival
 * line), never two neighbouring points a reader expects to see side by side.
 */
const COINCIDENCE_DECIMALS = 5

function positionKey(coordinate: readonly [number, number]): string {
  return `${coordinate[0].toFixed(COINCIDENCE_DECIMALS)}|${coordinate[1].toFixed(COINCIDENCE_DECIMALS)}`
}

/**
 * One offset per marker, in the order given.
 *
 * A marker alone on its spot gets `{ x: 0, y: 0 }` — the historical
 * behaviour, byte for byte, for every map that has no collision at all. A
 * group of two is split symmetrically along one diagonal, so neither of the
 * pair sits exactly on the point and both read as equals. A larger group is
 * spread evenly around a small circle, in the group's own order.
 */
export function resolveMarkerIconOffsets(markers: readonly { readonly coordinate: readonly [number, number] }[]): readonly MarkerIconOffset[] {
  const groups = new Map<string, number[]>()
  markers.forEach((marker, index) => {
    const key = positionKey(marker.coordinate)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [index])
    else group.push(index)
  })

  const offsets: MarkerIconOffset[] = markers.map(() => NO_MARKER_OFFSET)
  for (const group of groups.values()) {
    if (group.length < 2) continue
    if (group.length === 2) {
      // The common case: a montée and the arrivée it leads to. Split along
      // the ↖/↘ diagonal so neither hides the other and the earlier one (the
      // climb, always first in chronological order) stays on the leading side.
      offsets[group[0] as number] = { x: -COLLISION_SPREAD_PX, y: -COLLISION_SPREAD_PX }
      offsets[group[1] as number] = { x: COLLISION_SPREAD_PX, y: COLLISION_SPREAD_PX }
      continue
    }
    const radius = COLLISION_SPREAD_PX * 1.4
    group.forEach((index, position) => {
      const angle = (2 * Math.PI * position) / group.length - Math.PI / 2
      offsets[index] = {
        x: Math.round(Math.cos(angle) * radius * 100) / 100,
        y: Math.round(Math.sin(angle) * radius * 100) / 100,
      }
    })
  }
  return offsets
}
