/**
 * "Aperçu" screen (CDC Jalon B2 section 9): the trip's landing screen —
 * name/dates/day counts/distance/D+/OFF-transfer summary, a global map
 * (every stage's own geometry, no villages/POIs — same compact-map default
 * as the Étape screen), and one highlighted day depending on where `today`
 * falls relative to the trip:
 *  - before the trip starts → day 1
 *  - during the trip → today's own day (ride, OFF or transfer alike), or
 *    the next future day if today has no exact match (a calendar gap)
 *  - after the trip ends → no highlighted day, just the summary
 *
 * Built from the active `TripBundle` only — never RGA-hardcoded. Only
 * produces the map container's markup; the caller (`trips-manager.ts`)
 * wires the actual Leaflet map into it, exactly like `day-detail-view.ts`.
 */

import { computeStageWaypoints } from '../../analysis/waypoint-timeline.ts'
import type { LatLngTuple } from '../route-map-model.ts'
import { routeGeometry } from '../../route-enrichment/route-fingerprint.ts'
import type { CanonicalWaypoint } from '../../analysis/canonical-waypoints.ts'
import type { TripBundle, TripDayId } from '../../trip-core/index.ts'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatKilometers(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} km`
}

function formatShortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return iso
  const [, year, month, day] = match
  return `${day}.${month}.${year?.slice(2)}`
}

/**
 * Which day to highlight, given `today` (CDC section 9). Returns `null`
 * only when the trip is undated, or when `today` is strictly after every
 * day's date (the "after the trip" case) — a calendar gap during the trip
 * falls forward to the next future day rather than showing nothing.
 */
export function computeHighlightedDayId(bundle: TripBundle, todayIso: string | null): TripDayId | null {
  const datedDays = bundle.days.filter((day): day is TripBundle['days'][number] & { readonly date: string } => day.date !== null)
  if (todayIso === null || datedDays.length === 0) return bundle.days[0]?.id ?? null
  const firstDay = datedDays[0]
  const lastDay = datedDays[datedDays.length - 1]
  if (firstDay === undefined || lastDay === undefined) return null
  if (todayIso < firstDay.date) return bundle.days[0]?.id ?? null
  if (todayIso > lastDay.date) return null
  const exact = datedDays.find((day) => day.date === todayIso)
  if (exact !== undefined) return exact.id
  const nextFuture = datedDays.find((day) => day.date > todayIso)
  return nextFuture?.id ?? null
}

export interface TripOverviewMapStage {
  readonly waypoints: readonly CanonicalWaypoint[]
  readonly geometry: readonly LatLngTuple[]
}

export interface TripOverview {
  readonly html: string
  readonly mapStages: readonly TripOverviewMapStage[]
  readonly highlightedDayId: TripDayId | null
}

function dayCounts(bundle: TripBundle): { readonly ride: number; readonly off: number; readonly transfer: number } {
  return {
    ride: bundle.days.filter((day) => day.type === 'ride').length,
    off: bundle.days.filter((day) => day.type === 'off').length,
    transfer: bundle.days.filter((day) => day.type === 'transfer').length,
  }
}

function renderHighlightedDay(bundle: TripBundle, highlightedDayId: TripDayId | null): string {
  if (highlightedDayId === null) return ''
  const day = bundle.days.find((candidate) => candidate.id === highlightedDayId)
  if (day === undefined) return ''
  const dateLabel = day.date === null ? null : formatShortDate(day.date)
  if (day.type === 'ride') {
    const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
    const locations = `${escapeHtml(stage?.startLocationName ?? '—')} → ${escapeHtml(stage?.endLocationName ?? '—')}`
    const headerParts = [`J${day.displayNumber}`, dateLabel, locations].filter((part): part is string => part !== null)
    return `<section class="card trip-overview__highlighted-day"><p class="eyebrow">À suivre</p><h3>${headerParts.join(' — ')}</h3>
      <button class="button button--primary" type="button" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}">Voir cette étape</button>
    </section>`
  }
  const typeLabel = day.type === 'off' ? 'OFF' : 'Transfert'
  const known = day.startLocationName !== null && day.startLocationName === day.endLocationName
    ? escapeHtml(day.startLocationName)
    : `${escapeHtml(day.startLocationName ?? '—')} → ${escapeHtml(day.endLocationName ?? '—')}`
  const headerParts = [`J${day.displayNumber}`, typeLabel, dateLabel].filter((part): part is string => part !== null)
  return `<section class="card trip-overview__highlighted-day"><p class="eyebrow">À suivre</p><h3>${headerParts.join(' — ')}</h3><p>${known}</p></section>`
}

export function buildTripOverview(bundle: TripBundle, todayIso: string | null): TripOverview {
  const totalDistanceKm = bundle.stages.reduce((total, stage) => total + (stage.distanceKm ?? 0), 0)
  const totalElevationGainM = bundle.stages.reduce((total, stage) => total + (stage.elevationGainM ?? 0), 0)
  const counts = dayCounts(bundle)
  const offTransferParts = [
    counts.off > 0 ? `${counts.off} jour${counts.off > 1 ? 's' : ''} OFF` : null,
    counts.transfer > 0 ? `${counts.transfer} transfert${counts.transfer > 1 ? 's' : ''}` : null,
  ].filter((part): part is string => part !== null)

  const mapStages: TripOverviewMapStage[] = bundle.stages.map((stage) => {
    const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
    const geometry = route === undefined ? null : routeGeometry(route)
    if (geometry === null) return { waypoints: [], geometry: [] }
    const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === stage.dayId)
    const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: daySettings?.departureTime ?? '08:00' }
    const waypoints = computeStageWaypoints({ stage, route: route as NonNullable<typeof route>, routePoints: bundle.routePoints, climbs: bundle.climbs, settings })
      .filter((waypoint) => waypoint.visibleByDefault)
    return { waypoints, geometry: geometry.map((point) => [point.latitude, point.longitude] as const) }
  })

  const highlightedDayId = computeHighlightedDayId(bundle, todayIso)

  const html = `<div class="trip-overview" data-trip-overview>
    <header class="view-heading"><p class="eyebrow">Aperçu</p><h2>${escapeHtml(bundle.metadata.name)}</h2></header>
    <dl class="trip-overview__summary">
      <div><dt>Dates</dt><dd>${bundle.metadata.startDate ?? 'Non daté'}${bundle.metadata.endDate ? ` → ${bundle.metadata.endDate}` : ''}</dd></div>
      <div><dt>Journées</dt><dd>${bundle.days.length} (${counts.ride} roulée${counts.ride > 1 ? 's' : ''}${offTransferParts.length > 0 ? ` · ${offTransferParts.join(' · ')}` : ''})</dd></div>
      <div><dt>Distance totale</dt><dd>${formatKilometers(totalDistanceKm)}</dd></div>
      <div><dt>D+ total</dt><dd>+${Math.round(totalElevationGainM)} m</dd></div>
    </dl>
    ${renderHighlightedDay(bundle, highlightedDayId)}
    <section class="card route-map-card" data-route-visuals>
      <div class="section-heading"><div><p class="eyebrow">Vue d’ensemble</p><h3>Carte du voyage</h3></div><button class="button button--quiet" type="button" data-explore-map>Explorer la carte</button></div>
      <div class="route-map" data-trip-overview-map></div>
    </section>
    <dialog class="route-map-dialog" data-trip-overview-map-dialog aria-labelledby="trip-overview-expanded-map-title">
      <header><h2 id="trip-overview-expanded-map-title">Carte du voyage</h2><div class="route-map-dialog__actions"><button class="button button--quiet" type="button" data-close-map>Fermer</button></div></header>
      <div class="route-map-dialog__map-wrap"><div class="route-map route-map--expanded" data-route-map-expanded></div><p class="route-map__fallback route-map__fallback--expanded" data-expanded-route-map-fallback hidden>Fond de carte indisponible.</p></div>
    </dialog>
    <button class="button button--primary button--full" type="button" data-action="open-trip-detail">Voir le voyage</button>
  </div>`

  return { html, mapStages, highlightedDayId }
}
