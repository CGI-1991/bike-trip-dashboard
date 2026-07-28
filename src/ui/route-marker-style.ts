/**
 * Single graphic language for route markers, shared verbatim between the
 * Leaflet map (`route-map.ts`) and the elevation profile (`elevation-profile.ts`)
 * so a category always looks the same regardless of surface. Colors reuse the
 * app's existing tokens (forest green, warning orange, danger red) rather than
 * introducing a new palette.
 */
export type RouteMarkerCategory = 'start' | 'finish' | 'col-summit' | 'passage'

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
}

export function getRouteMarkerStyle(category: RouteMarkerCategory): RouteMarkerStyle {
  return CATEGORY_STYLES[category]
}

export const routeMarkerCategoryOrder: readonly RouteMarkerCategory[] = [
  'start',
  'finish',
  'col-summit',
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

const CATEGORY_LEGEND_SYMBOL: Record<RouteMarkerCategory, string> = {
  start: 'D',
  finish: 'A',
  'col-summit': '◆',
  passage: '●',
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
