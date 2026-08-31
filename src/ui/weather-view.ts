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

/**
 * CDC D1.2 sections 18-22/26: the compact weather line injected straight
 * into a single Parcours waypoint row (`day-detail-view.ts`'s own
 * `[data-waypoint-weather]` mount point, filled by `trips-manager.ts` once
 * weather arrives) — never a second, separate list repeating the same
 * names/times (section 24: only the scenario comparison, a genuinely
 * different question, stays its own section). A normal point stays one
 * sober line, no chevron (section 21); an orange/red point gets a visible
 * highlight and an expand toggle revealing the reasons already computed by
 * the alert engine (`GenericWeatherPointViewModel.riskReasons`) — never a
 * second scoring, never a fresh fetch per point (`point` is read straight
 * from the already-fetched/interpolated view-model).
 */
export function renderInlineWaypointWeather(waypointId: string, point: GenericWeatherPointViewModel | undefined): string {
  if (point === undefined || !point.available) return ''
  const parts = [
    formatTemperatureRange(point.temperatureC, null),
    formatPrecipitation(point.precipitationProbabilityPct, point.precipitationMm),
    formatWind(point.windSpeedKph, point.windGustsKph),
  ].filter((value): value is string => value !== null)
  if (parts.length === 0) return ''
  const line = escapeHtml(parts.join(' · '))
  const isAlert = point.riskLevel === 'orange' || point.riskLevel === 'red'
  if (!isAlert) {
    return `<span class="day-detail__waypoint-weather day-detail__waypoint-weather--${point.riskLevel}">${line}</span>`
  }
  const detailId = `waypoint-weather-detail-${escapeHtml(waypointId)}`
  const reasons = point.riskReasons.length === 0
    ? ''
    : `<ul class="day-detail__waypoint-weather-reasons">${point.riskReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>`
  return `<button type="button" class="day-detail__waypoint-weather day-detail__waypoint-weather--${point.riskLevel} day-detail__waypoint-weather-toggle" data-action="toggle-waypoint-weather" aria-expanded="false" aria-controls="${detailId}">
      <span>${line}</span><span class="day-detail__waypoint-weather-chevron" aria-hidden="true">›</span>
    </button>
    <div class="day-detail__waypoint-weather-detail" id="${detailId}" hidden>
      <p>Risque ${RISK_LABELS[point.riskLevel].toLowerCase()}${point.etaLabel === null ? '' : ` · ${escapeHtml(point.etaLabel)}`}</p>
      ${reasons}
    </div>`
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

/**
 * One row of the "Comparer les horaires" comparison (section 24) — offset
 * label, departure/arrival, risk, and (for any other coherent scenario) its
 * own "Choisir HH:MM" (section 25). `isRecommended` (CDC D1.1 section 15) is
 * a plain boolean flag, independent of this row's own position in the
 * list — the badge marks whichever scenario the ranking picked, wherever
 * it happens to sit chronologically, never by moving it.
 */
function renderScenarioRow(scenario: DepartureWeatherScenario, currentClock: string, isRecommended: boolean): string {
  const label = OFFSET_LABELS[scenario.offsetMinutes] ?? `${scenario.offsetMinutes > 0 ? '+' : ''}${scenario.offsetMinutes} min`
  const departureClock = formatClock(scenario.departureTimeLocal)
  const arrivalClock = formatClock(scenario.arrivalTimeLocal)
  const applyButton = scenario.isCurrent || !scenario.isCoherent
    ? ''
    : `<button class="button button--quiet" type="button" data-action="apply-weather-departure-time" data-departure-time="${escapeHtml(departureClock)}" data-current-departure-time="${escapeHtml(currentClock)}">Choisir ${escapeHtml(departureClock)}</button>`
  const badges = [
    scenario.isCurrent ? '<span class="tag tag--data">Actuel</span>' : '',
    isRecommended ? '<span class="tag tag--suggested">Suggéré</span>' : '',
  ].join('')
  return `<li class="weather-decision__scenario weather-decision__scenario--${scenario.risk.level}">
    <div class="weather-decision__scenario-header"><strong>${escapeHtml(label)}</strong>${badges}</div>
    <p class="weather-decision__scenario-times">Départ ${escapeHtml(departureClock)} · Arrivée ${escapeHtml(arrivalClock)}</p>
    <p class="weather-decision__scenario-risk">${RISK_LABELS[scenario.risk.level]} · ${scenario.risk.redCount} rouge · ${scenario.risk.orangeCount} orange${scenario.isCoherent ? '' : ' · écarté (départ avant le début de la journée)'}</p>
    ${applyButton}
  </li>`
}

/**
 * Section 24: a repliable "Comparer les horaires" section carrying all 5
 * scenarios — collapsed by default (`<details>`, no JS needed to open/close
 * it), exactly the historical RGA shape. CDC D1.1 section 15: always
 * presented in `model.departureScenarios`' own chronological order
 * (-2h/-1h/actuel/+1h/+2h — that array is never re-sorted, see
 * `view-model.ts`), whichever one `model.recommendation` marks as
 * recommended — the "Suggéré" badge moves to that row, the row itself never
 * does.
 */
function renderScenarioComparison(model: GenericDayWeatherViewModel): string {
  if (model.departureScenarios.length === 0) return ''
  const current = model.departureScenarios.find((scenario) => scenario.isCurrent) ?? null
  const currentClock = formatClock(current?.departureTimeLocal ?? null)
  const recommendedOffsetMinutes = model.recommendation?.status === 'recommended-change'
    ? model.recommendation.recommendedScenario?.offsetMinutes ?? null
    : null
  const rows = model.departureScenarios
    .map((scenario) => renderScenarioRow(scenario, currentClock, recommendedOffsetMinutes !== null && scenario.offsetMinutes === recommendedOffsetMinutes))
    .join('')
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

function renderDaySection(label: string, model: GenericDayWeatherViewModel, includePointsList: boolean): string {
  const message = availabilityMessage(model)
  // CDC D1.2 section 24: once each significant point already carries its
  // own inline weather line in the Parcours timeline
  // (`renderInlineWaypointWeather`, wired by `trips-manager.ts`), this
  // "Points significatifs" list would just repeat the exact same names/
  // times/values a second time — `includePointsList: false` (ride days
  // only; OFF/transfer have no Parcours timeline to fold into, section 29)
  // drops it. The scenario comparison above answers a genuinely different
  // question ("at what time to depart") and is never affected by this flag.
  const points = !includePointsList || model.points.length === 0 ? '' : `<section class="weather-points-block" data-weather-points>
    <p class="eyebrow">Points significatifs</p>
    <ol class="weather-points-list">${model.points.map(renderPointRow).join('')}</ol>
  </section>`
  return `<section class="weather-summary-block" data-weather-summary>
    <p class="eyebrow">${escapeHtml(label)}</p>
    ${message !== null ? `<p class="weather-message">${escapeHtml(message)}</p>` : `${renderDecisionCard(model)}${renderSynthesis(model)}`}
  </section>${points}`
}

export interface RenderStageWeatherPanelOptions {
  /** `false` for a ride day's inline Parcours mount (CDC D1.2 section 24) — every significant point already gets its own inline line there, so the panel's own "Points significatifs" list would just duplicate it. Defaults to `true` (OFF/transfer's own Météo tab, and any other caller). */
  readonly includePointsList?: boolean
}

/**
 * The Étape/Journée weather block (CDC Jalon C1 section 19, inspired by
 * `docs/ux-reference/rga/08_rga_stage_weather.png`): a synthesis then the
 * significant points in chronological order (already the order
 * `sample-points.ts` produced them in, itself the same order Parcours
 * shows) — unless `includePointsList: false`. A transfer day renders its
 * origin/destination as two independent sections (CDC section 13: minimal,
 * no invented waypoint along the way).
 */
export function renderGenericStageWeatherPanel(container: HTMLElement, model: GenericDayWeatherViewModel | GenericTransferWeatherViewModel | null, isLoading: boolean, options: RenderStageWeatherPanelOptions = {}): void {
  const includePointsList = options.includePointsList ?? true
  if (isLoading) { container.innerHTML = '<p role="status">Chargement des prévisions…</p>'; return }
  if (model === null) { container.innerHTML = '<p>Météo non disponible pour le moment.</p>'; return }
  if ('origin' in model) {
    const side = (label: string, side: GenericDayWeatherViewModel | null): string => side === null
      ? `<section class="weather-summary-block" data-weather-summary><p class="eyebrow">${escapeHtml(label)}</p><p class="weather-message">Météo non disponible pour le moment.</p></section>`
      : renderDaySection(label, side, includePointsList)
    container.innerHTML = `${side('Origine', model.origin)}${side('Destination', model.destination)}`
    return
  }
  container.innerHTML = renderDaySection('Synthèse', model, includePointsList)
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
