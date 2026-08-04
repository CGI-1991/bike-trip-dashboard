/**
 * Single graphic language for route markers, shared verbatim between the
 * Leaflet map (`route-map.ts`) and the elevation profile (`elevation-profile.ts`)
 * so a category always looks the same regardless of surface. Colors reuse the
 * app's existing tokens (forest green, warning orange, danger red) rather than
 * introducing a new palette.
 */
import type { CanonicalWaypointKind } from '../analysis/canonical-waypoints.ts'

export type RouteMarkerCategory = 'start' | 'finish' | 'col-summit' | 'passage' | 'locality-major' | 'locality-minor'

export type RouteMarkerShape = 'circle' | 'rounded-square' | 'diamond'

export interface RouteMarkerStyle {
  readonly category: RouteMarkerCategory
  readonly shape: RouteMarkerShape
  /** Fill color — reused from the app's existing tokens, not a new palette. */
  readonly colorHex: string
  /** Letter or glyph rendered inside the marker; empty for the plain passage dot. */
  readonly symbol: string
  /** Base marker size in pixels, before any pause/selection accent. */
  readonly sizePx: number
  /** Accessible category label, e.g. for aria-label / legend text. */
  readonly label: string
}

/** Secondary accent for an active pause — never changes the marker's own category/shape. */
export const PAUSE_ACCENT_COLOR_HEX = '#7c3aed'

const CATEGORY_STYLES: Record<RouteMarkerCategory, RouteMarkerStyle> = {
  start: {
    category: 'start',
    shape: 'circle',
    colorHex: '#166534',
    symbol: 'D',
    sizePx: 18,
    label: 'Départ',
  },
  finish: {
    category: 'finish',
    shape: 'rounded-square',
    colorHex: '#991b1b',
    symbol: 'A',
    sizePx: 18,
    label: 'Arrivée',
  },
  'col-summit': {
    category: 'col-summit',
    shape: 'diamond',
    colorHex: '#d67a35',
    symbol: '',
    sizePx: 14,
    label: 'Col ou sommet',
  },
  passage: {
    category: 'passage',
    shape: 'circle',
    colorHex: '#3f5a72',
    symbol: '',
    sizePx: 9,
    label: 'Lieu de passage',
  },
  'locality-major': {
    category: 'locality-major',
    shape: 'circle',
    colorHex: '#1d4e73',
    symbol: '',
    sizePx: 14,
    label: 'Ville ou bourg',
  },
  'locality-minor': {
    category: 'locality-minor',
    shape: 'circle',
    colorHex: '#3f5a72',
    symbol: '',
    sizePx: 10,
    label: 'Village',
  },
}

export function getRouteMarkerStyle(category: RouteMarkerCategory): RouteMarkerStyle {
  return CATEGORY_STYLES[category]
}

/**
 * Legend order for the RGA map (`route-map.ts::renderRouteMap`) only — kept
 * to exactly its 4 historical categories on purpose. The generic map
 * (`renderGenericRouteMap`) builds its own dynamic legend from whichever
 * categories are actually present in its model, rather than sharing this
 * fixed list, so RGA's legend never grows extra, unused entries.
 */
export const routeMarkerCategoryOrder: readonly RouteMarkerCategory[] = [
  'start',
  'finish',
  'col-summit',
  'passage',
]

/** Every `RouteMarkerCategory` value, in a stable display order — used by the generic map/profile's own dynamic legend. */
export const allRouteMarkerCategories: readonly RouteMarkerCategory[] = [
  'start',
  'finish',
  'col-summit',
  'locality-major',
  'locality-minor',
  'passage',
]

/**
 * Classifies a roadbook point into one of the four route-marker categories.
 * A documented col/summit is only `col-summit` when actually matched on the
 * ridden track (`resolution === 'matched'`) — an informational/off-route
 * mention of a col falls back to `passage`, the generic documented-point
 * category, per the "a documented col outranks a nearby automatic high point"
 * priority rule.
 */
export function getRouteMarkerCategory(point: {
  readonly type: string
  readonly resolution: string
}): RouteMarkerCategory {
  if (point.type === 'start') return 'start'
  if (point.type === 'end') return 'finish'
  if ((point.type === 'col' || point.type === 'summit') && point.resolution === 'matched') {
    return 'col-summit'
  }
  return 'passage'
}

const GENERIC_KIND_TO_MARKER_CATEGORY: Readonly<Record<CanonicalWaypointKind, RouteMarkerCategory>> = {
  start: 'start',
  end: 'finish',
  city: 'locality-major',
  town: 'locality-major',
  village: 'locality-minor',
  'mountain-pass': 'col-summit',
  saddle: 'col-summit',
  climb: 'col-summit',
  pause: 'passage',
}

/**
 * Classifies a `CanonicalWaypoint` (the generic TripBundle pipeline's
 * points, `analysis/canonical-waypoints.ts`) into a `RouteMarkerCategory` —
 * the generic counterpart of `getRouteMarkerCategory`, single source of
 * truth shared by the generic map model builder and the generic elevation
 * profile so a kind always looks the same on both surfaces.
 */
export function getGenericRouteMarkerCategory(kind: CanonicalWaypointKind): RouteMarkerCategory {
  return GENERIC_KIND_TO_MARKER_CATEGORY[kind]
}

const CATEGORY_LEGEND_SYMBOL: Record<RouteMarkerCategory, string> = {
  start: 'D',
  finish: 'A',
  'col-summit': '◆',
  passage: '●',
  'locality-major': '●',
  'locality-minor': '●',
}

/**
 * The same compact glyph used in the legend, for prefixing a category inline
 * (e.g. a small symbol before the point type in the Parcours list) without
 * repeating the full marker shape as a big badge.
 */
export function getRouteMarkerLegendSymbol(category: RouteMarkerCategory): string {
  return CATEGORY_LEGEND_SYMBOL[category]
}

/** Compact accessible legend text, one entry per category in display order. */
export function getRouteMarkerLegendEntries(): readonly { readonly symbol: string; readonly label: string }[] {
  return routeMarkerCategoryOrder.map((category) => ({
    symbol: CATEGORY_LEGEND_SYMBOL[category],
    label: getRouteMarkerStyle(category).label,
  }))
}
