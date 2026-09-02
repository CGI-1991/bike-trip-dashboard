/**
 * "Voyage" screen (CDC Jalon B4.3 sections 9-11): a compact, RGA-style
 * chronological day-card list for one `TripBundle` — nothing else. Global
 * trip statistics live only in Aperçu (CDC section 9: "ne pas répéter dans
 * Voyage"); structural points/climbs live only in each stage's own Étape
 * view (`day-detail-view.ts`) — never duplicated here. The whole card is the
 * navigation target for a ride day (CDC section 4: no separate "Voir le
 * détail" button when the card itself can carry the action). The global
 * "Mes voyages" app-nav link always returns to the trip list, so this screen
 * carries no redundant "Retour" button of its own (CDC hardening section 14).
 */

import { resolveOffLocation, resolveTransferLocations } from '../../analysis/day-location-fill.ts'
import { formatTransferModeAndTimes } from './transfer-summary-format.ts'
import { deriveTripTemporalState, getTripDayTemporalState } from '../../trips-manager/trip-day-temporal-state.ts'
import type { TripDayTemporalState } from '../../trips-manager/trip-day-temporal-state.ts'
import type { StagePreparationStatus } from '../../trips-manager/stage-preparation.ts'
import { formatShortDate } from '../date-format.ts'
import { compactPlaceName } from '../compact-place-name.ts'
import type { TripBundle, TripDayId } from '../../trip-core/index.ts'

export interface TripDetailRenderOptions {
  readonly now?: Date | string | null
  readonly canEnrichEndpoints?: boolean
  readonly geocodingPending?: boolean
  readonly geocodingError?: string | null
  readonly automaticEnrichmentPending?: boolean
  readonly automaticEnrichmentProgress?: string | null
  readonly automaticEnrichmentError?: string | null
  /** C2.5 section 11/13: one status per ride day, keyed by `TripDay.id` — `undefined`/missing is treated as `null` (no indicator, e.g. an OFF/transfer day). Absent entirely, the whole indicator/summary UI is omitted (every existing caller/test keeps working unchanged). */
  readonly stagePreparationStatuses?: ReadonlyMap<TripDayId, StagePreparationStatus | null>
}

// C2.5 section 11: compact, non-intrusive, never Postpass/HTTP/provider
// jargon — one glyph + an accessible label, nothing else.
const STAGE_PREP_LABELS: Readonly<Record<StagePreparationStatus, string>> = {
  pending: 'En attente de préparation',
  running: 'Préparation en cours',
  ready: 'Étape prête',
  stale: 'Mise à jour en cours',
  partial: 'Préparation incomplète — Réessayer disponible',
  error: 'Préparation en erreur — Réessayer disponible',
}

/**
 * A fixed-size mount point (section 11: "zone graphique FIXE") — present or
 * not, its own box never changes the card's height/width. `null` (no ride
 * stage, or the caller never supplied a status map at all) renders nothing.
 * Always a plain, non-interactive `<span>` — the whole card is already a
 * real `<button>` (`data-action="open-day-detail"`), and nested interactive
 * controls inside a `<button>` are invalid HTML; the "Réessayer" action for
 * `partial`/`error` (section 17) lives on the Étape screen itself instead
 * (`day-detail-view.ts`), never nested in this list card.
 *
 * R1 section 3 ("silence when healthy"): `ready` renders nothing at all — a
 * permanent ✓ glyph on every single healthy card carries no functional role
 * (no action, nothing left to retry) and is exactly the kind of "check
 * permanent" the CDC asks to make disappear once preparation is genuinely
 * done. A ready ride-day card is now visually indistinguishable from any
 * other normal card, as intended ("une carte Voyage prête doit simplement
 * ressembler à une carte normale").
 */
export function renderStagePreparationIndicator(status: StagePreparationStatus | null | undefined): string {
  if (status === null || status === undefined || status === 'ready') return ''
  const label = STAGE_PREP_LABELS[status]
  const inner = status === 'running' || status === 'stale'
    ? '<span class="trip-day-card__prep-spinner" aria-hidden="true"></span>'
    : `<span aria-hidden="true">${status === 'pending' ? '○' : '⚠'}</span>`
  return `<span class="trip-day-card__prep trip-day-card__prep--${status}" data-trip-day-prep data-status="${status}" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${inner}</span>`
}

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

/**
 * CDC D1.1 section 5: the left `Jx`/date column is rendered identically by
 * every card variant — kept as one shared fragment so the fixed-width
 * column never drifts between ride/OFF/transfer cards.
 */
function renderDayNumberGroup(day: TripBundle['days'][number]): string {
  const dateLabel = day.date === null ? null : formatShortDate(day.date)
  return `<span class="trip-day-card__number-group"><strong>J${day.displayNumber}</strong>${day.date === null ? '' : `<time datetime="${day.date}">${escapeHtml(dateLabel ?? '')}</time>`}</span>`
}

function renderRideDayCard(bundle: TripBundle, day: TripBundle['days'][number], stage: TripBundle['stages'][number], temporal: TripDayTemporalState, isPriority: boolean, prepStatus: StagePreparationStatus | null | undefined): string {
  const fullRoute = `${stage.startLocationName ?? '—'} → ${stage.endLocationName ?? '—'}`
  const locations = `${escapeHtml(compactPlaceName(stage.startLocationName ?? '—'))} → ${escapeHtml(compactPlaceName(stage.endLocationName ?? '—'))}`
  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const departureTime = daySettings?.departureTime ?? null
  const eta = temporal.arrivalEta?.label ?? null
  const status = temporal.completed ? '<span class="tag tag--completed">Terminé</span>' : '<span class="tag tag--ride">Étape</span>'
  // Section 5B/K: the status badge is its own grid item in the fixed-width
  // right column — never inline after the route name, so a long place name
  // can never push it around or make it wrap.
  //
  // R1: `[data-trip-day-prep-slot]` is an always-present mount, whatever the
  // current status is — including `ready`/`null`, where it starts out empty
  // (`renderStagePreparationIndicator` now renders nothing for those). This
  // is what lets `trips-manager.ts::patchStagePreparationIndicators` target
  // it unconditionally by `.innerHTML` rather than depending on the
  // indicator glyph itself already existing in the DOM — a day that is
  // `ready` (or was never given a status at all) from the very first render
  // still needs a stable place to grow a spinner into if it is later marked
  // `stale`/re-queued (CDC section 3: "progression compacte" while active).
  return `<li>
    <button class="trip-day-card trip-day-card--ride${isPriority ? ' is-priority' : ''}" type="button" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}"${isPriority ? ' data-trip-priority-day' : ''}>
      ${renderDayNumberGroup(day)}
      <span class="trip-day-card__content">
        <span class="trip-day-card__route" title="${escapeHtml(fullRoute)}" aria-label="${escapeHtml(fullRoute)}">${locations}</span>
        <span class="trip-day-card__metrics"><span>${stage.distanceKm === null ? '—' : formatKilometers(stage.distanceKm)}</span><span>${stage.elevationGainM === null ? '—' : `+${Math.round(stage.elevationGainM)} m`}</span></span>
        <span class="trip-day-card__weather-mount" data-trip-day-weather-mount data-day-id="${escapeHtml(day.id)}"></span>
      </span>
      <span class="trip-day-card__schedule">
        <span class="trip-day-card__status">${status}<span data-trip-day-prep-slot>${renderStagePreparationIndicator(prepStatus)}</span></span>
        <small><span class="visually-hidden">Départ </span>${departureTime ?? '—'}</small>
        <strong><span class="visually-hidden">ETA </span>${eta ?? '—'}</strong>
      </span>
    </button>
  </li>`
}

// CDC Jalon B4.4 section 23/35: OFF/transfer cards are real navigation
// targets now that `day-detail-view.ts` has a shell to open them into — a
// `<button data-action="open-day-detail">`, exactly like a ride day card,
// not the plain non-interactive `<div>` these used to be.
function renderOffDayCard(bundle: TripBundle, day: TripBundle['days'][number], isPriority: boolean): string {
  const location = resolveOffLocation(bundle, day)
  const fullLocation = location.name ?? 'Lieu à préciser'
  return `<li>
    <button class="trip-day-card trip-day-card--off${isPriority ? ' is-priority' : ''}" type="button" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}"${isPriority ? ' data-trip-priority-day' : ''}>
      ${renderDayNumberGroup(day)}
      <span class="trip-day-card__content">
        <span class="trip-day-card__route" title="${escapeHtml(fullLocation)}" aria-label="${escapeHtml(fullLocation)}">${escapeHtml(compactPlaceName(fullLocation))}</span>
        <span class="trip-day-card__weather-mount" data-trip-day-weather-mount data-day-id="${escapeHtml(day.id)}"></span>
      </span>
      <span class="trip-day-card__schedule"><span class="trip-day-card__status"><span class="tag tag--off">OFF</span></span></span>
    </button>
  </li>`
}

function renderTransferDayCard(bundle: TripBundle, day: TripBundle['days'][number], isPriority: boolean): string {
  const { origin, destination } = resolveTransferLocations(bundle, day)
  const fullRoute = origin === null && destination === null ? 'Trajet à préciser' : `${origin ?? '—'} → ${destination ?? '—'}`
  const route = origin === null && destination === null ? fullRoute : `${compactPlaceName(origin ?? '—')} → ${compactPlaceName(destination ?? '—')}`
  // R2 section 12: mode/heures show only when actually filled in — never a
  // fake D+/profile, never a fabricated duration/distance.
  const modeAndTimes = formatTransferModeAndTimes(day)
  return `<li>
    <button class="trip-day-card trip-day-card--transfer${isPriority ? ' is-priority' : ''}" type="button" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}"${isPriority ? ' data-trip-priority-day' : ''}>
      ${renderDayNumberGroup(day)}
      <span class="trip-day-card__content">
        <span class="trip-day-card__route" title="${escapeHtml(fullRoute)}" aria-label="${escapeHtml(fullRoute)}">${escapeHtml(route)}</span>
        ${modeAndTimes === null ? '' : `<span class="trip-day-card__transfer-meta">${escapeHtml(modeAndTimes)}</span>`}
      </span>
      <span class="trip-day-card__schedule"><span class="trip-day-card__status"><span class="tag tag--transfer">Transfert</span></span></span>
    </button>
  </li>`
}

function renderDayCard(bundle: TripBundle, day: TripBundle['days'][number], temporal: TripDayTemporalState, priorityDayId: string | null, prepStatus: StagePreparationStatus | null | undefined): string {
  const isPriority = day.id === priorityDayId
  const stage = day.stageId === null ? null : bundle.stages.find((candidate) => candidate.id === day.stageId) ?? null
  if (stage !== null) return renderRideDayCard(bundle, day, stage, temporal, isPriority, prepStatus)
  if (day.type === 'off') return renderOffDayCard(bundle, day, isPriority)
  return renderTransferDayCard(bundle, day, isPriority)
}

/** C2.5 section 4/22: recomputes exactly ONE ride day's card (same markup `renderTripDetail` itself would produce for that day) — for `trips-manager.ts` to patch a single `[data-day-id]` button's `outerHTML` when its preparation status changes, never the whole list. */
export function renderSingleDayCard(bundle: TripBundle, dayId: TripDayId, now: Date | string | null, prepStatus: StagePreparationStatus | null | undefined): string | null {
  const day = bundle.days.find((candidate) => candidate.id === dayId)
  if (day === undefined) return null
  const temporal = deriveTripTemporalState(bundle, now)
  const dayTemporal = getTripDayTemporalState(temporal, dayId)
  if (dayTemporal === null) return null
  const html = renderDayCard(bundle, day, dayTemporal, temporal.priorityDayId, prepStatus)
  // `renderDayCard` returns a full `<li>...</li>` — the patch target is the
  // `<button data-day-id>` inside it, matching what's already in the DOM.
  const match = /<button[^]*<\/button>/.exec(html)
  return match?.[0] ?? null
}

export function renderTripDetail(bundle: TripBundle, options: TripDetailRenderOptions = {}): string {
  const temporal = deriveTripTemporalState(bundle, options.now ?? null)
  const hasOsmEndpoints = bundle.routePoints.some((point) =>
    (point.type === 'start' || point.type === 'end') && point.provenance.sourceType === 'osm',
  )
  const hasOsmClimbNames = bundle.climbs.some((climb) => climb.provenance.sourceType === 'osm')
  const hasOsmRouteData = bundle.routePoints.some((point) => point.provenance.sourceType === 'osm')
  const osmState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm')
  const routeEnrichmentState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-route-enrichment')
  const hasRideStages = bundle.stages.length > 0
  // UI-POLISH-01 section 10: never surface provider names/diagnostics here
  // (`automaticEnrichmentProgress`/`automaticEnrichmentError` still carry
  // that raw detail for dev/debug callers, just never rendered) — at most
  // one concise, non-blocking line with a discreet spinner while it runs.
  const automaticStatus = options.automaticEnrichmentPending
    ? '<div class="trip-detail__enrichment trip-detail__enrichment--pending" role="status"><span class="trip-detail__enrichment-spinner" aria-hidden="true"></span><span>Mise à jour des données…</span></div>'
    : options.automaticEnrichmentError !== null && options.automaticEnrichmentError !== undefined
      ? '<p class="trip-detail__enrichment">Certaines données seront complétées ultérieurement.</p>'
      : routeEnrichmentState?.status === 'success' && (osmState === undefined || osmState.status === 'success')
        ? ''
        : routeEnrichmentState?.status === 'partial' || routeEnrichmentState?.status === 'error' || osmState?.status === 'partial' || osmState?.status === 'error'
          ? '<p class="trip-detail__enrichment">Certaines données seront complétées ultérieurement.</p>'
          : ''
  const geocodingStatus = options.geocodingPending
    ? '<p role="status">Identification des lieux en cours…</p>'
    : options.geocodingError !== null && options.geocodingError !== undefined
      ? `<p role="alert">${escapeHtml(options.geocodingError)}</p>`
      : osmState?.status === 'error'
        ? `<p role="status">${escapeHtml(osmState.message ?? 'Les lieux n’ont pas pu être identifiés.')}</p>`
        : ''
  const geocodingAction = options.canEnrichEndpoints && !options.geocodingPending
    ? '<button class="button button--quiet" type="button" data-action="enrich-trip-endpoints">Identifier les lieux de départ et d’arrivée</button>'
    : ''
  const attribution = hasOsmEndpoints || hasOsmRouteData || hasOsmClimbNames ? '<p class="trip-detail__attribution">Données géographiques : © OpenStreetMap contributors.</p>' : ''

  // C2.5 section 13: "4/10 étapes prêtes" — a plain count, never a
  // percentage (section 14), shown only when there's something to prepare
  // and it isn't fully done yet. Omitted entirely when the caller supplies
  // no status map at all (existing callers/tests keep their exact output).
  const prepStatuses = options.stagePreparationStatuses
  let prepSummary = ''
  if (prepStatuses !== undefined) {
    const rideDayIds = bundle.days.filter((day) => day.type === 'ride' && day.stageId !== null).map((day) => day.id)
    const total = rideDayIds.length
    const ready = rideDayIds.filter((id) => prepStatuses.get(id) === 'ready').length
    if (total > 0 && ready < total) {
      prepSummary = `<p class="trip-detail__prep-summary" data-trip-prep-summary role="status">${ready}/${total} étapes prêtes</p>`
    }
  }

  return `
    <div class="trip-detail" data-trip-detail>
      <header class="view-heading"><p class="eyebrow">Voyage</p><h2>${escapeHtml(bundle.metadata.name)}</h2></header>
      ${prepSummary}
      <ol class="trip-day-list">${bundle.days.map((day) => renderDayCard(bundle, day, getTripDayTemporalState(temporal, day.id) as TripDayTemporalState, temporal.priorityDayId, prepStatuses?.get(day.id))).join('')}</ol>
      ${hasRideStages ? '<button class="button button--quiet button--full" type="button" data-action="download-trip-gpx">Télécharger les GPX</button>' : ''}
      ${automaticStatus}
      ${geocodingStatus}
      ${geocodingAction}
      ${attribution}
    </div>`
}
