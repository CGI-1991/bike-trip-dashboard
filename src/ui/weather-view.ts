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
import type { DepartureWeatherScenario, WeatherRiskLevel } from '../weather/alerts/types.ts'
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

/** Sections 19/24: the exact historical scenario offsets, labelled for display — never a second, invented set. */
const OFFSET_LABELS: Readonly<Record<number, string>> = { [-120]: '−2 h', [-60]: '−1 h', 0: 'Actuel', 60: '+1 h', 120: '+2 h' }

function formatClock(localIso: string | null): string {
  if (localIso === null) return '—'
  const match = /T(?<time>\d{2}:\d{2})/.exec(localIso)
  return match?.groups?.time ?? localIso
}

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

/** Section 23: a red/orange risk gets a real, visible callout — never a small badge lost among 15 values. Green/unknown stay sober (a plain sentence, already carried by `renderSynthesis`). */
function renderRiskBanner(model: GenericDayWeatherViewModel): string {
  if (model.riskLevel !== 'red' && model.riskLevel !== 'orange') return ''
  const topAlert = model.alerts[0] ?? null
  return `<div class="weather-decision__banner weather-decision__banner--${model.riskLevel}" role="status">
    <p class="weather-decision__banner-title">ALERTE MÉTÉO · RISQUE ${RISK_LABELS[model.riskLevel].toUpperCase()}</p>
    ${topAlert === null ? '' : `<p class="weather-decision__banner-detail">${escapeHtml(topAlert.title)}${topAlert.summary === '' ? '' : ` — ${escapeHtml(topAlert.summary)}`}</p>`}
  </div>`
}

/**
 * Sections 20-21/25-26/28: the one-sentence conclusion, plus — only for an
 * actual `recommended-change` — the "Appliquer HH:MM"/"Modifier manuellement"
 * actions (never persisted without the confirmation panel below, section 26).
 * "Modifier manuellement" reuses the exact same `edit-day-departure-time`
 * action the Étape stats header's own editor already wires (section 28 —
 * never a second implementation).
 */
function renderRecommendation(model: GenericDayWeatherViewModel): string {
  const { recommendation } = model
  if (recommendation === null || recommendation.status === 'not-applicable') return ''
  if (recommendation.status !== 'recommended-change') {
    return `<p class="weather-decision__note">${escapeHtml(recommendation.title)}</p>`
  }
  const targetClock = formatClock(recommendation.recommendedScenario?.departureTimeLocal ?? null)
  const currentClock = formatClock(recommendation.currentScenario?.departureTimeLocal ?? null)
  return `<div class="weather-decision__recommendation">
    <p class="weather-decision__recommendation-title">${escapeHtml(recommendation.title)}</p>
    <div class="weather-decision__actions">
      <button class="button button--primary" type="button" data-action="apply-weather-departure-time" data-departure-time="${escapeHtml(targetClock)}" data-current-departure-time="${escapeHtml(currentClock)}">Appliquer ${escapeHtml(targetClock)}</button>
      <button class="button button--quiet" type="button" data-action="edit-day-departure-time">Modifier manuellement</button>
    </div>
  </div>`
}

/** One row of the "Comparer les horaires" comparison (section 24) — offset label, departure/arrival, risk, and (for any other coherent scenario) its own "Choisir HH:MM" (section 25). */
function renderScenarioRow(scenario: DepartureWeatherScenario, currentClock: string): string {
  const label = OFFSET_LABELS[scenario.offsetMinutes] ?? `${scenario.offsetMinutes > 0 ? '+' : ''}${scenario.offsetMinutes} min`
  const departureClock = formatClock(scenario.departureTimeLocal)
  const arrivalClock = formatClock(scenario.arrivalTimeLocal)
  const applyButton = scenario.isCurrent || !scenario.isCoherent
    ? ''
    : `<button class="button button--quiet" type="button" data-action="apply-weather-departure-time" data-departure-time="${escapeHtml(departureClock)}" data-current-departure-time="${escapeHtml(currentClock)}">Choisir ${escapeHtml(departureClock)}</button>`
  return `<li class="weather-decision__scenario weather-decision__scenario--${scenario.risk.level}">
    <div class="weather-decision__scenario-header"><strong>${escapeHtml(label)}</strong>${scenario.isCurrent ? '<span class="tag tag--data">Actuel</span>' : ''}</div>
    <p class="weather-decision__scenario-times">Départ ${escapeHtml(departureClock)} · Arrivée ${escapeHtml(arrivalClock)}</p>
    <p class="weather-decision__scenario-risk">${RISK_LABELS[scenario.risk.level]} · ${scenario.risk.redCount} rouge · ${scenario.risk.orangeCount} orange${scenario.isCoherent ? '' : ' · écarté (départ avant le début de la journée)'}</p>
    ${applyButton}
  </li>`
}

/** Section 24: a repliable "Comparer les horaires" section carrying all 5 scenarios — collapsed by default (`<details>`, no JS needed to open/close it), exactly the historical RGA shape. */
function renderScenarioComparison(model: GenericDayWeatherViewModel): string {
  if (model.departureScenarios.length === 0) return ''
  const current = model.departureScenarios.find((scenario) => scenario.isCurrent) ?? null
  const currentClock = formatClock(current?.departureTimeLocal ?? null)
  const rows = model.departureScenarios.map((scenario) => renderScenarioRow(scenario, currentClock)).join('')
  return `<details class="weather-decision__compare" data-weather-compare>
    <summary>Comparer les horaires</summary>
    <ul class="weather-decision__scenarios">${rows}</ul>
  </details>`
}

/** Section 26: the compact, non-native confirmation panel every "Appliquer"/"Choisir" button reveals — populated by `trips-manager.ts`'s click handler, never persisted before "Confirmer". Rendered once per weather panel, shared by every scenario row. */
function renderApplyConfirm(): string {
  return `<div class="weather-decision__confirm" data-weather-apply-confirm hidden>
    <p>Modifier l’heure de départ ?</p>
    <p class="weather-decision__confirm-times" data-weather-apply-confirm-times></p>
    <p class="weather-decision__confirm-note">Les ETA et l’analyse météo de cette étape seront recalculées.</p>
    <div class="weather-decision__confirm-actions">
      <button class="button button--primary" type="button" data-action="confirm-apply-weather-departure-time">Confirmer</button>
      <button class="button button--quiet" type="button" data-action="cancel-apply-weather-departure-time">Annuler</button>
    </div>
  </div>`
}

/**
 * Section 22's decision card — état/prévision (via `renderSynthesis`, called
 * by the caller) then this: risk banner, recommendation, comparison. Section
 * 29's mode policy: nothing at all for `today-reference`/`past` (no real
 * comparison basis) or `trend` (advisory-only, no firm recommendation —
 * `renderSynthesis`'s own risk sentence already covers it); the scenario
 * comparison itself only for `planning`/`operational`/`live` before the
 * theoretical departure — never after (section 29: "ne plus proposer
 * rétroactivement de modifier le départ").
 */
function renderDecisionCard(model: GenericDayWeatherViewModel): string {
  if (model.mode === null || model.mode === 'today-reference' || model.mode === 'past' || model.mode === 'trend') return ''
  const banner = renderRiskBanner(model)
  const recommendation = renderRecommendation(model)
  const showComparison = model.mode === 'planning' || model.mode === 'operational' || (model.mode === 'live' && !model.departureAlreadyPassed)
  const comparison = showComparison ? renderScenarioComparison(model) : ''
  if (banner === '' && recommendation === '' && comparison === '') return ''
  return `<section class="weather-decision" data-weather-decision>${banner}${recommendation}${comparison}${comparison === '' ? '' : renderApplyConfirm()}</section>`
}

function renderDaySection(label: string, model: GenericDayWeatherViewModel): string {
  const message = availabilityMessage(model)
  const points = model.points.length === 0 ? '' : `<section class="weather-points-block" data-weather-points>
    <p class="eyebrow">Points significatifs</p>
    <ol class="weather-points-list">${model.points.map(renderPointRow).join('')}</ol>
  </section>`
  return `<section class="weather-summary-block" data-weather-summary>
    <p class="eyebrow">${escapeHtml(label)}</p>
    ${message !== null ? `<p class="weather-message">${escapeHtml(message)}</p>` : `${renderDecisionCard(model)}${renderSynthesis(model)}`}
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
