import type { TodayViewModel } from './today-view-model.ts'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

/**
 * This is the compact "current/next stage" summary embedded in the Aperçu
 * screen only — the full weather-per-point breakdown and the full
 * accommodation card (address, Maps, website) already live in the day's own
 * detail screen (Parcours/Météo/Infos tabs) and must not be duplicated here.
 * `TodayViewModel` itself keeps that full data (weather.points,
 * accommodation address/website…) for whichever caller needs it; this
 * renderer simply doesn't surface all of it.
 */
export function renderTodayView(container: HTMLElement, model: TodayViewModel): void {
  const status = `<p class="eyebrow today-status">${escapeHtml(model.statusLabel)}</p>`
  const heading = `<header class="today-heading"><h3>${model.dayId} · ${escapeHtml(model.title)}</h3></header>`
  const weatherLine = `<p class="today-weather-compact">${escapeHtml(model.weather.summary)}</p>`
  const alert = model.weather.primaryAlert === null ? '' : `<section class="today-alert today-alert--${model.weather.primaryAlert.level}"><strong>${escapeHtml(model.weather.primaryAlert.title)}</strong></section>`
  const errors = model.errors.map((error) => `<p class="today-local-error" role="status">${escapeHtml(error)}</p>`).join('')

  if (model.type === 'off') {
    container.dataset.todayState = model.period
    container.innerHTML = `${status}${heading}<section class="today-section today-off"><p class="tag tag--data">OFF</p><h4>${escapeHtml(model.locationName)}</h4></section>${weatherLine}${alert}${errors}<div class="today-actions"><a class="button button--primary button--full" href="${model.dayHref}">Voir l’étape</a></div>`
    return
  }

  const stats = model.stats === null ? '' : `<dl class="today-metrics"><div><dt>Distance</dt><dd>${formatNumber(model.stats.distanceKm, 1)} km</dd></div><div><dt>D+</dt><dd>${formatNumber(model.stats.elevationGainM)} m</dd></div><div><dt>Départ</dt><dd>${escapeHtml(model.stats.departureTime)}</dd></div><div><dt>ETA</dt><dd>${escapeHtml(model.stats.arrivalTime)}</dd></div></dl>`
  const map = model.mapModel === null ? '<section class="today-section today-map-fallback"><p>Carte temporairement indisponible</p></section>' : `<section class="today-section today-map-section"><div class="route-map route-map--today" data-today-route-map aria-label="Carte compacte de ${model.dayId}"></div></section>`
  const gpx = model.gpxHref === null ? '' : `<button class="button button--quiet" type="button" data-overview-gpx-trigger data-gpx-url="${escapeHtml(model.gpxHref)}" data-gpx-filename="${escapeHtml(model.gpxDownloadName ?? `${model.dayId}.gpx`)}">GPX</button>`
  container.dataset.todayState = model.period
  container.innerHTML = `${status}${heading}${map}${stats}${weatherLine}${alert}${errors}<div class="today-actions"><a class="button button--primary" href="${model.dayHref}">Voir l’étape</a>${gpx}</div>`
}
