/**
 * Generic weather rendering (CDC Jalon C1 sections 19-22) — the three
 * screens (Étape/Aperçu/Voyage) all read from the same
 * `GenericDayWeatherViewModel`/`GenericTransferWeatherViewModel` (see
 * `weather/generic/view-model.ts`/`coordinator.ts`) and simply choose how
 * much of it to show; none of them re-derives weather independently.
 * Reuses the already-generic formatters from `weather-summary.ts`
 * (`formatTemperatureRange`/`formatPrecipitation`/`formatWind`) rather than
 * a second, parallel formatting layer.
 */

import type { GenericTransferWeatherViewModel } from '../weather/generic/coordinator.ts'
import type { GenericDayWeatherViewModel, GenericWeatherPointViewModel } from '../weather/generic/view-model.ts'
import type { WeatherAvailability } from '../weather/types.ts'
import type { WeatherRiskLevel } from '../weather/alerts/types.ts'
import { formatPrecipitation, formatTemperatureRange, formatWind } from './weather-summary.ts'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const RISK_LABELS: Readonly<Record<WeatherRiskLevel, string>> = { green: 'Faible', orange: 'Modéré', red: 'Élevé', unknown: 'Indéterminé' }

function summaryLine(summary: GenericDayWeatherViewModel['summary']): readonly string[] {
  if (summary === null) return []
  return [
    formatTemperatureRange(summary.temperatureMinC, summary.temperatureMaxC),
    formatPrecipitation(summary.precipitationProbabilityMaxPct, summary.precipitationMaxMm),
    formatWind(summary.windSpeedMaxKph, summary.windGustsMaxKph),
  ].filter((value): value is string => value !== null)
}

/** Honest status text for a non-available day (CDC section 19-20: never a fake value, never silently blank). `null` once real data is showable. */
function availabilityMessage(model: GenericDayWeatherViewModel): string | null {
  const byAvailability: Partial<Record<WeatherAvailability, string>> = {
    loading: 'Chargement des prévisions…',
    unavailable: model.message ?? 'Météo non disponible pour le moment.',
    'outside-horizon': 'Hors de l’horizon de prévision (au-delà de 16 jours).',
    error: model.message ?? 'Erreur météo.',
  }
  const message = byAvailability[model.availability]
  if (message !== undefined) return message
  if (model.summary === null) return 'Météo non disponible pour le moment.'
  return null
}

function formatFetchedAt(fetchedAt: string): string {
  const parsed = new Date(fetchedAt)
  return Number.isNaN(parsed.getTime())
    ? 'récemment'
    : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(parsed)
}

function renderSynthesis(model: GenericDayWeatherViewModel): string {
  const parts = summaryLine(model.summary)
  const worst = model.summary?.worstWeatherLabel ?? null
  return `<div class="weather-synthesis" data-weather-synthesis>
    <p class="weather-synthesis__line">${parts.length === 0 ? 'Données insuffisantes.' : escapeHtml(parts.join(' · '))}</p>
    ${worst === null ? '' : `<p class="weather-synthesis__code">${escapeHtml(worst)}</p>`}
    <p class="weather-risk weather-risk--${model.riskLevel}">Risque météo : ${RISK_LABELS[model.riskLevel]}</p>
    ${model.fetchedAt === null ? '' : `<p class="weather-synthesis__meta">Mis à jour ${escapeHtml(formatFetchedAt(model.fetchedAt))}${model.isRefreshing ? ' · actualisation en cours' : ''}</p>`}
  </div>`
}

function renderPointRow(point: GenericWeatherPointViewModel): string {
  const parts = [
    formatTemperatureRange(point.temperatureC, null),
    formatPrecipitation(point.precipitationProbabilityPct, point.precipitationMm),
    formatWind(point.windSpeedKph, point.windGustsKph),
  ].filter((value): value is string => value !== null)
  return `<li class="weather-point weather-point--${point.riskLevel}">
    <div class="weather-point__header">
      <span class="weather-point__role">${escapeHtml(point.role)}</span>
      <strong class="weather-point__name">${escapeHtml(point.name)}</strong>
      ${point.etaLabel === null ? '' : `<span class="weather-point__eta">${escapeHtml(point.etaLabel)}</span>`}
    </div>
    <p class="weather-point__metrics">${parts.length === 0 ? 'Prévision indisponible.' : escapeHtml(parts.join(' · '))}</p>
  </li>`
}

function renderDaySection(label: string, model: GenericDayWeatherViewModel): string {
  const message = availabilityMessage(model)
  const points = model.points.length === 0 ? '' : `<section class="weather-points-block" data-weather-points>
    <p class="eyebrow">Points significatifs</p>
    <ol class="weather-points-list">${model.points.map(renderPointRow).join('')}</ol>
  </section>`
  return `<section class="weather-summary-block" data-weather-summary>
    <p class="eyebrow">${escapeHtml(label)}</p>
    ${message !== null ? `<p class="weather-message">${escapeHtml(message)}</p>` : renderSynthesis(model)}
  </section>${points}`
}

/**
 * The Étape/Journée Météo tab (CDC Jalon C1 section 19, inspired by
 * `docs/ux-reference/rga/08_rga_stage_weather.png`): a synthesis then the
 * significant points in chronological order (already the order
 * `sample-points.ts` produced them in, itself the same order Parcours
 * shows). A transfer day renders its origin/destination as two independent
 * sections (CDC section 13: minimal, no invented waypoint along the way).
 */
export function renderGenericStageWeatherPanel(container: HTMLElement, model: GenericDayWeatherViewModel | GenericTransferWeatherViewModel | null, isLoading: boolean): void {
  if (isLoading) { container.innerHTML = '<p role="status">Chargement des prévisions…</p>'; return }
  if (model === null) { container.innerHTML = '<p>Météo non disponible pour le moment.</p>'; return }
  if ('origin' in model) {
    const side = (label: string, side: GenericDayWeatherViewModel | null): string => side === null
      ? `<section class="weather-summary-block" data-weather-summary><p class="eyebrow">${escapeHtml(label)}</p><p class="weather-message">Météo non disponible pour le moment.</p></section>`
      : renderDaySection(label, side)
    container.innerHTML = `${side('Origine', model.origin)}${side('Destination', model.destination)}`
    return
  }
  container.innerHTML = renderDaySection('Synthèse', model)
}

/**
 * Aperçu's highlighted-day weather (CDC Jalon C1 section 20): compact
 * temperature/pluie/vent line, plus the day's own risk level when it isn't
 * green — never a fake value, an honest compact status otherwise.
 */
export function renderGenericOverviewWeatherBlock(model: GenericDayWeatherViewModel | GenericTransferWeatherViewModel | null): string {
  if (model === null || 'origin' in model) return '<p class="trip-overview__weather-placeholder">Météo non disponible pour le moment.</p>'
  const message = availabilityMessage(model)
  if (message !== null) return `<p class="trip-overview__weather-placeholder">${escapeHtml(message)}</p>`
  const parts = summaryLine(model.summary)
  const risk = model.riskLevel === 'red' || model.riskLevel === 'orange'
    ? `<p class="trip-overview__weather-risk weather-risk--${model.riskLevel}">${escapeHtml(model.alerts[0]?.title ?? `Risque ${RISK_LABELS[model.riskLevel]}`)}</p>`
    : ''
  return `<div class="trip-overview__weather" data-trip-overview-weather>
    <p class="trip-overview__weather-line">${escapeHtml(parts.join(' · '))}</p>
    ${risk}
  </div>`
}

/**
 * Voyage's per-card compact weather line (CDC Jalon C1 section 21) — one
 * line when data exists, nothing at all otherwise (never a repeated
 * paragraph on every card). Renders as an inline `<span>` — its mount point
 * (`trip-detail-view.ts`) sits inside the card's own `<button>`, whose
 * content model only allows phrasing (inline) content, never a block-level
 * `<p>`.
 */
export function renderGenericDayCardWeatherLine(model: GenericDayWeatherViewModel | GenericTransferWeatherViewModel | null): string {
  if (model === null || 'origin' in model || model.summary === null) return ''
  const parts = summaryLine(model.summary)
  if (parts.length === 0) return ''
  const riskClass = model.riskLevel === 'red' || model.riskLevel === 'orange' ? ` trip-day-card__weather--${model.riskLevel}` : ''
  return `<span class="trip-day-card__weather${riskClass}">${escapeHtml(parts.join(' · '))}</span>`
}
