/**
 * Generic single-day detail screen (CDC Jalon B section 15): header, stats,
 * canonical waypoints, map, profile. Built from the active `TripBundle`
 * only — never from RGA-hardcoded data. Only produces the header/stats/
 * waypoints markup plus empty map/profile containers; the caller
 * (`trips-manager.ts`) wires the actual Leaflet map and SVG profile into
 * those containers, since that requires real DOM elements, not strings.
 *
 * Not meant for OFF/transfer days (CDC: "pas de carte/profil vélo forcé
 * pour une journée OFF") — `buildDayDetail` returns `null` for those; the
 * caller keeps showing them through `trip-detail-view.ts`'s day list only.
 */

import { computeStageWaypoints } from '../../analysis/waypoint-timeline.ts'
import type { CanonicalWaypoint, CanonicalWaypointKind } from '../../analysis/canonical-waypoints.ts'
import { routeGeometry } from '../../route-enrichment/route-fingerprint.ts'
import type { RouteGeometryPoint, TripBundle, TripDayId } from '../../trip-core/index.ts'

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
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.round((seconds % 3_600) / 60)
  return `${hours} h ${String(minutes).padStart(2, '0')}`
}

function formatShortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return iso
  const [, year, month, day] = match
  return `${day}.${month}.${year?.slice(2)}`
}

function formatKilometers(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} km`
}

/**
 * A category's group title (Localités/Villages/Relief) already carries the
 * OSM subtype — a row never repeats it inline (CDC hardening section 6).
 * Only `climb`/`pause` still need their own inline word since they are not
 * grouped under one of those three section titles.
 */
const WAYPOINT_KIND_LABELS: Readonly<Record<CanonicalWaypointKind, string>> = {
  start: 'Départ',
  end: 'Arrivée',
  city: '',
  town: '',
  village: '',
  'mountain-pass': '',
  saddle: '',
  climb: 'Montée',
  pause: 'Pause',
}

function renderWaypointRow(waypoint: CanonicalWaypoint): string {
  const label = WAYPOINT_KIND_LABELS[waypoint.kind]
  const altitude = waypoint.elevationM === null ? null : `${Math.round(waypoint.elevationM)} m`
  const pause = waypoint.pauseDurationMinutes === null ? null : `pause ${waypoint.pauseDurationMinutes} min`
  const parts = [formatKilometers(waypoint.trackDistanceKm), label, escapeHtml(waypoint.name), altitude, waypoint.clockTime, pause]
    .filter((part): part is string => part !== null)
  return `<li class="day-detail__waypoint day-detail__waypoint--${waypoint.importance}" data-waypoint-id="${escapeHtml(waypoint.id)}" data-waypoint-kind="${waypoint.kind}">${parts.join(' · ')}</li>`
}

/**
 * Grouped point-of-passage sections (CDC section 15): Localités (city+town,
 * open by default), Villages (collapsed by default — same information, just
 * less prominent), Relief (mountain-pass+saddle, open by default). A group
 * with no matching waypoint renders nothing at all, never an empty section.
 */
function renderWaypointGroup(title: string, waypoints: readonly CanonicalWaypoint[], collapsed: boolean): string {
  if (waypoints.length === 0) return ''
  const rows = `<ol class="day-detail__waypoints">${waypoints.map(renderWaypointRow).join('')}</ol>`
  if (collapsed) return `<details class="day-detail__waypoint-group"><summary>${escapeHtml(title)} (${waypoints.length})</summary>${rows}</details>`
  return `<section class="day-detail__waypoint-group"><h4>${escapeHtml(title)}</h4>${rows}</section>`
}

function renderWaypointsList(waypoints: readonly CanonicalWaypoint[]): string {
  const localities = waypoints.filter((waypoint) => waypoint.kind === 'city' || waypoint.kind === 'town')
  const villages = waypoints.filter((waypoint) => waypoint.kind === 'village')
  const relief = waypoints.filter((waypoint) => waypoint.kind === 'mountain-pass' || waypoint.kind === 'saddle')
  const groups = [
    renderWaypointGroup('Localités', localities, false),
    renderWaypointGroup('Villages', villages, true),
    renderWaypointGroup('Relief', relief, false),
  ].join('')
  return groups === '' ? '<p>Aucun point de passage disponible.</p>' : groups
}

/** Montées (CDC section 20): only the stage's own `climb` waypoints — never rendered at all when there are none. */
function renderClimbsSection(waypoints: readonly CanonicalWaypoint[]): string {
  const climbs = waypoints.filter((waypoint) => waypoint.kind === 'climb')
  if (climbs.length === 0) return ''
  const rows = `<ol class="day-detail__waypoints">${climbs.map(renderWaypointRow).join('')}</ol>`
  return `<section class="card day-detail__climbs"><p class="eyebrow">Relief</p><h3>Montées</h3>${rows}</section>`
}

/** Pauses (CDC section 24): automatic placement by default — this only displays them; editing is wired separately by the caller. */
function renderPausesSection(waypoints: readonly CanonicalWaypoint[]): string {
  const pauses = waypoints.filter((waypoint) => waypoint.kind === 'pause')
  if (pauses.length === 0) return ''
  const rows = `<ol class="day-detail__waypoints">${pauses.map(renderWaypointRow).join('')}</ol>`
  return `<section class="card day-detail__pauses"><p class="eyebrow">Arrêts</p><h3>Pauses</h3>${rows}</section>`
}

export interface DayDetail {
  readonly html: string
  readonly waypoints: readonly CanonicalWaypoint[]
  readonly geometry: readonly RouteGeometryPoint[] | null
  readonly stageLabel: string
}

/**
 * Builds the day-detail screen for one ride day. Returns `null` when the
 * day is OFF/transfer (no stage), the day/stage/route cannot be resolved,
 * or the route has no usable geometry — the caller falls back to the day
 * list in all those cases.
 */
export function buildDayDetail(bundle: TripBundle, dayId: TripDayId): DayDetail | null {
  const day = bundle.days.find((candidate) => candidate.id === dayId)
  if (day === undefined || day.stageId === null) return null
  const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
  if (stage === undefined) return null
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  if (route === undefined) return null
  const geometry = routeGeometry(route)

  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === dayId)
  const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: daySettings?.departureTime ?? '08:00' }
  const waypoints = computeStageWaypoints({ stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs, settings })

  const dateLabel = day.date === null ? null : formatShortDate(day.date)
  const locations = `${escapeHtml(stage.startLocationName ?? '—')} → ${escapeHtml(stage.endLocationName ?? '—')}`
  const stageLabel = `J${day.displayNumber} — ${stage.startLocationName ?? '—'} → ${stage.endLocationName ?? '—'}`
  // Compact day title (CDC section 8): date before locations, e.g.
  // "J1 — 14.08.26 — Saint-Mars-la-Réorthe → Chauché". The GPX/roadbook
  // stage name (`stage.name`) is deliberately never shown here — it stays
  // available as technical data only (`trip-detail-view.ts`'s "Vue technique").
  const headerParts = [`J${day.displayNumber}`, dateLabel, locations].filter((part): part is string => part !== null)

  const arrival = waypoints.length === 0 ? null : waypoints[waypoints.length - 1]
  const stats = `<dl class="day-detail__stats">
    <div><dt>Distance</dt><dd>${stage.distanceKm === null ? '—' : formatKilometers(stage.distanceKm)}</dd></div>
    <div><dt>D+</dt><dd>${stage.elevationGainM === null ? '—' : `+${Math.round(stage.elevationGainM)} m`}</dd></div>
    <div><dt>D−</dt><dd>${stage.elevationLossM === null ? '—' : `−${Math.round(stage.elevationLossM)} m`}</dd></div>
    <div><dt>Roulage</dt><dd>${formatDuration(stage.movingDurationSeconds)}</dd></div>
    <div><dt>Pauses</dt><dd>${stage.pauseDurationSeconds === null ? '—' : `${Math.round(stage.pauseDurationSeconds / 60)} min`}</dd></div>
    <div><dt>Montées</dt><dd>${stage.climbIds.length}</dd></div>
    <div><dt>Arrivée estimée</dt><dd>${arrival?.clockTime ?? '—'}</dd></div>
  </dl>`

  const html = `<div class="day-detail" data-day-detail>
    <nav class="day-detail__sticky-nav" data-day-detail-nav aria-label="Navigation de l’étape">
      <button class="button button--quiet" type="button" data-action="back-to-trip-detail">← Retour</button>
      <button class="button button--quiet" type="button" data-action="previous-day" aria-label="Étape précédente">‹</button>
      <button class="button button--quiet" type="button" data-action="next-day" aria-label="Étape suivante">›</button>
    </nav>
    <header class="view-heading"><p class="eyebrow">Détail de l’étape</p><h2>${headerParts.join(' — ')}</h2></header>
    ${stats}
    <section class="card route-map-card" data-route-visuals>
      <div class="section-heading"><div><p class="eyebrow">Trace GPX</p><h3>Carte de l’étape</h3></div><button class="button button--quiet" type="button" data-explore-map>Explorer la carte</button></div>
      <div class="route-map" data-day-detail-map></div>
    </section>
    <dialog class="route-map-dialog" data-day-detail-map-dialog aria-labelledby="day-detail-expanded-map-title">
      <header><h2 id="day-detail-expanded-map-title">Carte de l’étape</h2><div class="route-map-dialog__actions"><button class="button button--quiet" type="button" data-close-map>Fermer</button></div></header>
      <div class="route-map-dialog__map-wrap"><div class="route-map route-map--expanded" data-route-map-expanded></div><p class="route-map__fallback route-map__fallback--expanded" data-expanded-route-map-fallback hidden>Fond de carte indisponible. Le tracé reste accessible dans le profil.</p></div>
    </dialog>
    <section class="card elevation-profile-card">
      <p class="eyebrow">Relief</p><h3>Profil altimétrique</h3>
      <div data-day-detail-profile></div>
    </section>
    <section class="card day-detail__waypoints-card">
      <p class="eyebrow">Lieux</p><h3>Points de passage</h3>
      ${renderWaypointsList(waypoints)}
    </section>
    ${renderPausesSection(waypoints)}
    ${renderClimbsSection(waypoints)}
  </div>`

  return { html, waypoints, geometry, stageLabel }
}
