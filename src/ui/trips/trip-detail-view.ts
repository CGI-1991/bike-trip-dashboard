/**
 * Minimal technical view of a `TripBundle` (CDC phase 6C1 section 23):
 * days, stats, timings, climbs. Not the final Voyage/Aperçu screens —
 * those stay out of scope for this phase.
 */

import type { TripBundle } from '../../trip-core/index.ts'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return `${hours} h ${String(minutes).padStart(2, '0')}`
}

function renderDayRow(bundle: TripBundle, day: TripBundle['days'][number]): string {
  const stage = day.stageId === null ? null : bundle.stages.find((candidate) => candidate.id === day.stageId) ?? null
  const typeLabel = day.type === 'ride' ? 'Roulé' : day.type === 'off' ? 'OFF' : 'Transfert'
  const dateLabel = day.date ?? '—'

  if (stage === null) {
    return `<li class="trip-detail__day"><span class="tag tag--off">${typeLabel}</span><strong>J${day.displayNumber}</strong><span>${dateLabel}</span><span>${escapeHtml(day.startLocationName ?? '—')} → ${escapeHtml(day.endLocationName ?? '—')}</span></li>`
  }

  const climbCount = stage.climbIds.length
  return `<li class="trip-detail__day"><span class="tag tag--ride">${typeLabel}</span><strong>J${day.displayNumber}</strong><span>${dateLabel}</span><span>${escapeHtml(stage.name ?? `${stage.startLocationName ?? ''} → ${stage.endLocationName ?? ''}`)}</span><dl class="trip-detail__stats"><div><dt>Distance</dt><dd>${stage.distanceKm === null ? '—' : `${stage.distanceKm.toFixed(1)} km`}</dd></div><div><dt>D+</dt><dd>${stage.elevationGainM === null ? '—' : `+${Math.round(stage.elevationGainM)} m`}</dd></div><div><dt>D−</dt><dd>${stage.elevationLossM === null ? '—' : `−${Math.round(stage.elevationLossM)} m`}</dd></div><div><dt>Roulage</dt><dd>${formatDuration(stage.movingDurationSeconds)}</dd></div><div><dt>Pauses</dt><dd>${stage.pauseDurationSeconds === null ? '—' : `${Math.round(stage.pauseDurationSeconds / 60)} min`}</dd></div><div><dt>Montées</dt><dd>${climbCount}</dd></div></dl></li>`
}

export function renderTripDetail(bundle: TripBundle): string {
  const totalDistanceKm = bundle.stages.reduce((total, stage) => total + (stage.distanceKm ?? 0), 0)
  const totalElevationGainM = bundle.stages.reduce((total, stage) => total + (stage.elevationGainM ?? 0), 0)

  const climbsList =
    bundle.climbs.length === 0
      ? '<p>Aucune montée détectée.</p>'
      : `<ul class="trip-detail__climbs">${bundle.climbs
          .map(
            (climb) =>
              `<li><strong>${escapeHtml(climb.name ?? 'Montée')}</strong> — ${(climb.endDistanceKm - climb.startDistanceKm).toFixed(1)} km, +${Math.round(climb.elevationGainM)} m, ${climb.averageGradientPercent.toFixed(1)} % (${climb.confidence})</li>`,
          )
          .join('')}</ul>`

  return `
    <div class="trip-detail" data-trip-detail>
      <header class="view-heading"><p class="eyebrow">Vue technique</p><h2>${escapeHtml(bundle.metadata.name)}</h2></header>
      <dl class="trip-detail__summary">
        <div><dt>Dates</dt><dd>${bundle.metadata.startDate ?? 'Non daté'}${bundle.metadata.endDate ? ` → ${bundle.metadata.endDate}` : ''}</dd></div>
        <div><dt>Journées</dt><dd>${bundle.days.length}</dd></div>
        <div><dt>Étapes</dt><dd>${bundle.stages.length}</dd></div>
        <div><dt>Distance totale</dt><dd>${totalDistanceKm.toFixed(1)} km</dd></div>
        <div><dt>D+ total</dt><dd>+${Math.round(totalElevationGainM)} m</dd></div>
        <div><dt>Montées détectées</dt><dd>${bundle.climbs.length}</dd></div>
        <div><dt>Statut</dt><dd>${escapeHtml(bundle.metadata.status)}</dd></div>
      </dl>
      <p class="tag tag--data">Disponible localement</p>
      <h3>Journées</h3>
      <ol class="trip-detail__day-list">${bundle.days.map((day) => renderDayRow(bundle, day)).join('')}</ol>
      <h3>Montées</h3>
      ${climbsList}
      <button class="button button--quiet" type="button" data-action="back-to-list">← Retour à Mes voyages</button>
    </div>`
}
