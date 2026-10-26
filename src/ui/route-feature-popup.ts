const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
const number = (value: number | null, decimals = 0) => value === null || !Number.isFinite(value) ? '—' : value.toFixed(decimals).replace('.', ',')

export function renderRouteFeaturePopup(name: string, type: string, distanceKm: number | null, gainM: number | null, gradient: number | null, partialAltitude = false): string {
  return `<section class="route-feature-popup" data-route-feature-popup><p>${escape(type)}</p><strong>${escape(name)}</strong><dl><div><dt>Longueur</dt><dd>${number(distanceKm, 1)} km</dd></div><div><dt>D+</dt><dd>${number(gainM)} m</dd></div><div><dt>Pente</dt><dd>${number(gradient, 1)} %</dd></div></dl>${partialAltitude ? '<p>Altitude incomplète</p>' : ''}</section>`
}
