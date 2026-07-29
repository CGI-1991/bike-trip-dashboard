import type { TodayAccommodationViewModel, TodayViewModel, TodayWeatherPointViewModel } from './today-view-model.ts'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function renderAccommodation(accommodation: TodayAccommodationViewModel | null): string {
  if (accommodation === null) return '<section class="today-section today-accommodation"><h4>Hébergement</h4><p>Hébergement à confirmer</p></section>'
  const website = accommodation.website === null ? '' : `<a class="button button--quiet" href="${escapeHtml(accommodation.website)}" target="_blank" rel="noopener noreferrer" aria-label="Voir le site de ${escapeHtml(accommodation.name)}">Voir le site</a>`
  return `<section class="today-section today-accommodation" data-today-accommodation="${escapeHtml(accommodation.id)}"><p class="eyebrow">Hébergement confirmé</p><h4>${escapeHtml(accommodation.name)}</h4><p>${escapeHtml(accommodation.locality)}</p><address>${escapeHtml(accommodation.address)}</address><div class="today-actions today-actions--secondary"><a class="button button--quiet" href="${escapeHtml(accommodation.mapsUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir dans Maps</a>${website}</div></section>`
}

function renderWeatherPoint(point: TodayWeatherPointViewModel): string {
  const metrics = [
    point.eta === null ? null : `<span>${escapeHtml(point.eta)}</span>`,
    point.altitudeM === null ? null : `<span>${formatNumber(point.altitudeM)} m</span>`,
    point.temperature === null ? null : `<span>${escapeHtml(point.temperature)}</span>`,
    point.precipitation === null ? null : `<span>${escapeHtml(point.precipitation)}</span>`,
    point.wind === null ? null : `<span>${escapeHtml(point.wind)}</span>`,
  ].filter((value): value is string => value !== null).join('')
  const risk = point.riskLevel === null || point.riskLevel === 'green' ? '' : `<span class="tag tag--risk-${point.riskLevel}">${point.riskLevel === 'red' ? 'Rouge' : point.riskLevel === 'orange' ? 'Orange' : 'Indéterminé'}</span>`
  return `<li class="today-weather-point" data-today-weather-point="${point.role}"><strong>${escapeHtml(point.name)}</strong><div>${metrics}${risk}</div></li>`
}

export function renderTodayView(container: HTMLElement, model: TodayViewModel): void {
  const status = `<p class="eyebrow today-status">${escapeHtml(model.statusLabel)}</p>`
  const heading = `<header class="today-heading"><div><h3>${model.dayId} · <time datetime="${model.date}">${escapeHtml(model.dateLabel)}</time></h3><p class="today-route">${escapeHtml(model.title)}</p></div></header>`
  const weatherPoints = model.weather.points.length === 0 ? '' : `<ol class="today-weather-points">${model.weather.points.map(renderWeatherPoint).join('')}</ol>`
  const weather = `<section class="today-section today-weather"><div><p class="eyebrow">Météo</p><strong>${escapeHtml(model.weather.summary)}</strong><small>${escapeHtml(model.weather.context ?? model.weather.status)}</small></div>${weatherPoints}</section>`
  const alert = model.weather.primaryAlert === null ? '' : `<section class="today-alert today-alert--${model.weather.primaryAlert.level}"><strong>${escapeHtml(model.weather.primaryAlert.title)}</strong><span>${escapeHtml([model.weather.primaryAlert.summary, model.weather.primaryAlert.place, model.weather.primaryAlert.time].filter(Boolean).join(' · '))}</span></section>`
  const errors = model.errors.map((error) => `<p class="today-local-error" role="status">${escapeHtml(error)}</p>`).join('')
  if (model.type === 'off') {
    const recovery = model.recoveryText.length === 0 ? '<p>Informations de récupération temporairement indisponibles.</p>' : `<ul>${model.recoveryText.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`
    container.dataset.todayState = model.period
    container.innerHTML = `${status}${heading}<section class="today-section today-off"><p class="tag tag--data">OFF</p><h4>${escapeHtml(model.locationName)}</h4>${recovery}</section>${weather}${alert}${renderAccommodation(model.accommodation)}${errors}<div class="today-actions"><a class="button button--primary button--full" href="${model.dayHref}">Voir la journée</a></div>`
    return
  }
  const stats = model.stats === null ? '' : `<dl class="today-metrics"><div><dt>Distance</dt><dd>${formatNumber(model.stats.distanceKm, 1)} km</dd></div><div><dt>D+</dt><dd>${formatNumber(model.stats.elevationGainM)} m</dd></div><div><dt>Départ</dt><dd>${escapeHtml(model.stats.departureTime)}</dd></div><div><dt>Arrivée prévue</dt><dd>${escapeHtml(model.stats.arrivalTime)}</dd></div><div><dt>Vitesse moyenne en mouvement</dt><dd>${formatNumber(model.stats.averageSpeedKph, 1)} km/h</dd></div><div><dt>Temps total de pause</dt><dd>${formatNumber(model.stats.totalBreakMinutes)} min</dd></div></dl>`
  const map = model.mapModel === null ? '<section class="today-section today-map-fallback"><p>Carte temporairement indisponible</p></section>' : `<section class="today-section today-map-section"><div class="route-map route-map--today" data-today-route-map aria-label="Carte compacte de ${model.dayId}"></div><a class="today-map-link" href="${model.dayHref}">Voir le détail de la journée</a></section>`
  const gpx = model.gpxHref === null ? '' : `<a class="button button--quiet" href="${escapeHtml(model.gpxHref)}" download="${escapeHtml(model.gpxDownloadName ?? `${model.dayId}.gpx`)}">Télécharger le GPX</a>`
  container.dataset.todayState = model.period
  container.innerHTML = `${status}${heading}${map}${stats}${weather}${alert}${renderAccommodation(model.accommodation)}${errors}<div class="today-actions"><a class="button button--primary" href="${model.dayHref}">Voir la journée</a>${gpx}</div>`
}
