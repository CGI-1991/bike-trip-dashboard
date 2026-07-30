import type { OverviewViewModel } from './overview-view-model.ts'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function renderStats(model: OverviewViewModel): string {
  const { progress } = model
  return `<section class="card overview-stats" aria-labelledby="overview-stats-title"><header class="view-heading"><p class="eyebrow">${formatNumber(progress.progressPercent, 0)} % du voyage</p><h3 id="overview-stats-title">Progression du voyage</h3></header><dl class="overview-stats__grid">
    <div><dt>Distance totale</dt><dd>${formatNumber(progress.totalDistanceKm, 1)} km</dd></div>
    <div><dt>Distance parcourue</dt><dd>${formatNumber(progress.completedDistanceKm, 1)} km</dd></div>
    <div><dt>Distance restante</dt><dd>${formatNumber(progress.remainingDistanceKm, 1)} km</dd></div>
    <div><dt>D+ total</dt><dd>${formatNumber(progress.totalElevationGainM)} m</dd></div>
    <div><dt>D+ parcouru</dt><dd>${formatNumber(progress.completedElevationGainM)} m</dd></div>
    <div><dt>D+ restant</dt><dd>${formatNumber(progress.remainingElevationGainM)} m</dd></div>
    <div><dt>D− total</dt><dd>${formatNumber(progress.totalElevationLossM)} m</dd></div>
    <div><dt>D− parcouru</dt><dd>${formatNumber(progress.completedElevationLossM)} m</dd></div>
    <div><dt>D− restant</dt><dd>${formatNumber(progress.remainingElevationLossM)} m</dd></div>
    <div><dt>Étapes roulées terminées</dt><dd>${progress.completedRideDays}</dd></div>
    <div><dt>Étapes roulées restantes</dt><dd>${progress.remainingRideDays}</dd></div>
    <div><dt>Journées OFF</dt><dd>${progress.offDays}</dd></div>
  </dl></section>`
}

function renderAlerts(model: OverviewViewModel): string {
  if (model.alerts.length === 0) return ''
  const items = model.alerts.map((alert) => `<li class="overview-alert overview-alert--${alert.level}">${escapeHtml(alert.message)}</li>`).join('')
  return `<section class="card overview-alerts" aria-labelledby="overview-alerts-title"><h3 id="overview-alerts-title">Alertes</h3><ul class="overview-alerts__list">${items}</ul></section>`
}

/**
 * Renders the Aperçu shell only (stats, alerts, map/stage placeholders) — the
 * map (Leaflet) and the embedded stage card are rendered separately into
 * `[data-overview-map]` / `[data-overview-stage]` right after this call, the
 * same two-step pattern already used for the per-day route map.
 */
export function renderOverviewView(container: HTMLElement, model: OverviewViewModel): void {
  container.dataset.overviewState = model.period
  container.innerHTML = `${renderStats(model)}
    <section class="card overview-map-card" data-route-visuals><div class="section-heading"><div><p class="eyebrow">Les dix étapes roulées</p><h3>Carte du voyage</h3></div><button class="button button--quiet" type="button" data-overview-explore-map>Explorer la carte</button></div><div class="route-map" data-overview-map></div></section>
    ${renderAlerts(model)}
    <section class="card today-card overview-stage" data-overview-stage></section>`
}
