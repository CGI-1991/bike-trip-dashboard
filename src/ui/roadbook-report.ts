import {
  describeRouteClockTime,
  formatRouteClockTime,
} from '../route/time.ts'
import type { RouteClockTime } from '../route/types.ts'
import type {
  RoadbookMatchAlternative,
  RoadbookMatchReport,
  RoadbookPointMatch,
} from '../trip/roadbook-match.ts'
import type {
  RoadbookMatchMethod,
  RoadbookPointStatus,
  RoadbookPointType,
  RoadbookResolution,
} from '../trip/roadbook-types.ts'

const decimalFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const integerFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0,
})
const coordinateFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 5,
  maximumFractionDigits: 5,
})

const pointStatusItemLabels: Record<RoadbookPointStatus, string> = {
  matched: 'Apparié',
  'needs-review': 'À contrôler',
  unmatched: 'Non apparié',
}

const resolutionLabels: Record<RoadbookResolution, string> = {
  matched: 'Actif',
  informational: 'Information',
  excluded: 'Exclu',
  'user-decision-required': 'Décision requise',
}

const resolutionGroupLabels: Record<RoadbookResolution, string> = {
  matched: 'Points actifs',
  informational: 'Informations seulement',
  excluded: 'Exclus',
  'user-decision-required': 'Décisions requises',
}

const resolutionOrder = [
  'matched',
  'user-decision-required',
  'informational',
  'excluded',
] as const satisfies readonly RoadbookResolution[]

function getResolutionTagClass(resolution: RoadbookResolution): string {
  switch (resolution) {
    case 'matched':
      return 'tag--ride'
    case 'informational':
      return 'tag--data'
    case 'excluded':
      return 'tag--muted'
    case 'user-decision-required':
      return 'tag--variant'
  }
}

const pointTypeLabels: Record<RoadbookPointType, string> = {
  start: 'Départ',
  end: 'Arrivée',
  col: 'Col',
  summit: 'Sommet',
  village: 'Village',
  passage: 'Passage',
  resupply: 'Ravitaillement',
  pause: 'Pause',
  shelter: 'Abri',
  lodging: 'Logement',
  poi: 'Point d’intérêt',
}

const matchMethodLabels: Record<RoadbookMatchMethod, string> = {
  endpoint: 'Extrémité du tracé',
  'named-gpx-point': 'Point nommé du GPX',
  'nearest-track-point': 'Point du tracé le plus proche',
  'profile-altitude-order-candidate': 'Candidat par profil, altitude et ordre',
  'manual-confirmed-profile-candidate': 'Candidat de profil confirmé manuellement',
  'manual-anchor-projected-to-track': 'Ancre manuelle projetée sur le GPX',
  'manual-track-loop-confirmation': 'Boucle du tracé confirmée manuellement',
  manual: 'Validation manuelle',
}


function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderRouteClockTime(value: RouteClockTime): string {
  return `<time aria-label="${escapeHtml(describeRouteClockTime(value))}">${escapeHtml(formatRouteClockTime(value))}</time>`
}

function formatAltitude(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : `${integerFormatter.format(value)} m`
}

function formatDifference(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : `${integerFormatter.format(value)} m`
}

function formatDistance(value: number | undefined): string {
  return value === undefined ? '—' : `${decimalFormatter.format(value)} km`
}

function formatCoordinatePair(
  latitude: number | undefined,
  longitude: number | undefined,
): string {
  if (latitude === undefined || longitude === undefined) {
    return 'Absentes'
  }

  return `Présentes : ${coordinateFormatter.format(latitude)}, ${coordinateFormatter.format(longitude)}`
}

function hasSourceCoordinates(point: RoadbookPointMatch): boolean {
  return (
    point.sourceLatitude !== undefined &&
    point.sourceLongitude !== undefined
  )
}

function getMatchReason(point: RoadbookPointMatch): string {
  const baseReason =
    point.status === 'matched'
      ? 'Correspondance retenue par le moteur.'
      : point.status === 'needs-review'
        ? 'Candidat conservé avec un niveau de confiance insuffisant pour une validation automatique.'
        : 'Aucune correspondance fiable n’a été validée.'

  return point.notes === undefined || point.notes.trim() === ''
    ? baseReason
    : `${baseReason} ${point.notes}`
}

function renderAlternative(
  alternative: RoadbookMatchAlternative,
  index: number,
): string {
  return `
    <li
      data-roadbook-alternative="${index + 1}"
      data-roadbook-alternative-waypoint="${escapeHtml(alternative.waypointId)}"
      data-roadbook-alternative-preferred="${alternative.preferredAltitude}"
    >
      <strong>${escapeHtml(alternative.waypointId)}</strong>
      <span>
        ${formatDistance(alternative.trackDistanceKm)} ·
        ${formatAltitude(alternative.altitudeM)} ·
        écart ${formatDifference(alternative.elevationDifferenceM)}
      </span>
      <span>
        ${coordinateFormatter.format(alternative.latitude)},
        ${coordinateFormatter.format(alternative.longitude)}
      </span>
      <span>Heure théorique : ${renderRouteClockTime(alternative.eta)}</span>
      ${alternative.preferredAltitude ? '<small>Altitude préférée</small>' : ''}
    </li>`
}

function renderAlternatives(point: RoadbookPointMatch): string {
  if (point.alternatives.length === 0) {
    return ''
  }

  return `
    <div class="roadbook-report__alternatives">
      <strong>Alternatives (${point.alternatives.length})</strong>
      <ol>
        ${point.alternatives.map(renderAlternative).join('')}
      </ol>
    </div>`
}

function renderPoint(point: RoadbookPointMatch): string {
  const method =
    point.matchMethod === undefined
      ? 'Aucune méthode'
      : matchMethodLabels[point.matchMethod]
  const eta =
    point.eta === undefined
      ? '<span aria-label="Heure théorique indisponible">—</span>'
      : renderRouteClockTime(point.eta)
  const sourceCoordinatesPresent = hasSourceCoordinates(point)

  return `
    <li
      class="roadbook-report__point"
      data-roadbook-point
      data-roadbook-point-id="${escapeHtml(point.id)}"
      data-roadbook-point-day="${point.dayId}"
      data-roadbook-point-type="${point.type}"
      data-roadbook-point-status="${point.status}"
      data-roadbook-point-method="${point.matchMethod ?? 'none'}"
      data-roadbook-point-source-kind="${point.sourceKind}"
      data-roadbook-point-source-coordinates="${sourceCoordinatesPresent ? 'present' : 'absent'}"
      data-roadbook-point-has-eta="${point.eta !== undefined}"
      data-roadbook-point-override="${point.overrideApplied}"
      data-roadbook-point-standalone="${point.standaloneWaypoint}"
      data-roadbook-point-resupply-candidate="${point.isResupplyCandidate === true}"
      data-roadbook-point-pause-candidate="${point.isPauseCandidate === true}"
      data-roadbook-point-resolution="${point.resolution}"
    >
      <header class="roadbook-report__point-heading">
        <span>${point.dayId} · ${pointTypeLabels[point.type]}</span>
        <strong>${escapeHtml(point.name)}</strong>
        <span class="tag ${getResolutionTagClass(point.resolution)}">
          ${resolutionLabels[point.resolution]}
        </span>
      </header>

      <dl class="roadbook-report__point-data">
        <div>
          <dt>Altitude roadbook</dt>
          <dd>${formatAltitude(point.elevationM)}</dd>
        </div>
        <div>
          <dt>Altitude GPX</dt>
          <dd>${formatAltitude(point.matchedElevationM)}</dd>
        </div>
        <div>
          <dt>Écart d’altitude</dt>
          <dd>${formatDifference(point.elevationDifferenceM)}</dd>
        </div>
        <div>
          <dt>Coordonnées source</dt>
          <dd>${formatCoordinatePair(point.sourceLatitude, point.sourceLongitude)}</dd>
        </div>
        <div>
          <dt>Coordonnées GPX</dt>
          <dd>${formatCoordinatePair(point.matchedLatitude, point.matchedLongitude)}</dd>
        </div>
        <div>
          <dt>Méthode</dt>
          <dd>${escapeHtml(method)}</dd>
        </div>
        <div>
          <dt>Statut d’appariement</dt>
          <dd>${pointStatusItemLabels[point.status]}</dd>
        </div>
        <div>
          <dt>Résolution</dt>
          <dd>${resolutionLabels[point.resolution]}</dd>
        </div>
        <div>
          <dt>Distance cumulée</dt>
          <dd>${formatDistance(point.matchedTrackDistanceKm)}</dd>
        </div>
        <div>
          <dt>Heure théorique</dt>
          <dd>${eta}</dd>
        </div>
        <div>
          <dt>Distance à la source</dt>
          <dd>${point.matchDistanceM === undefined ? '—' : formatAltitude(point.matchDistanceM)}</dd>
        </div>
        <div>
          <dt>Index GPX</dt>
          <dd>${
            point.matchedSegmentIndex === undefined ||
            point.matchedPointIndex === undefined
              ? '—'
              : `${point.matchedSegmentIndex}/${point.matchedPointIndex}`
          }</dd>
        </div>
        <div class="roadbook-report__reason">
          <dt>Motif d’appariement</dt>
          <dd>${escapeHtml(getMatchReason(point))}</dd>
        </div>
        ${
          point.resolutionJustification === undefined
            ? ''
            : `
              <div class="roadbook-report__reason">
                <dt>Justification de la résolution</dt>
                <dd>${escapeHtml(point.resolutionJustification)}</dd>
              </div>`
        }
      </dl>

      ${renderAlternatives(point)}
    </li>`
}

function renderActiveSummaryItem(point: RoadbookPointMatch): string {
  return `
    <li data-roadbook-active-point="${escapeHtml(point.id)}">
      <strong>${point.dayId} · ${escapeHtml(point.name)}</strong>
      <span>
        ${formatDistance(point.matchedTrackDistanceKm)} ·
        ${formatAltitude(point.matchedElevationM)} ·
        ${point.eta === undefined ? 'ETA —' : `ETA ${renderRouteClockTime(point.eta)}`}
      </span>
    </li>`
}

function renderActivePoints(report: RoadbookMatchReport): string {
  const activeCols = report.allPointMatches.filter(
    (point) =>
      point.resolution === 'matched' &&
      (point.sourceKind === 'col' ||
        (point.sourceKind === 'option' && point.type === 'summit')),
  )
  const activePassages = report.allPointMatches.filter(
    (point) =>
      point.resolution === 'matched' && point.sourceKind === 'passage-group',
  )

  return `
    <div class="roadbook-report__active-lists">
      <section aria-labelledby="roadbook-active-cols">
        <h4 id="roadbook-active-cols">Cols et sommets actifs (${activeCols.length})</h4>
        <ol class="roadbook-report__points">
          ${activeCols.map(renderActiveSummaryItem).join('')}
        </ol>
      </section>
      <section aria-labelledby="roadbook-active-passages">
        <h4 id="roadbook-active-passages">Ravitos et passages actifs (${activePassages.length})</h4>
        <ol class="roadbook-report__points">
          ${activePassages.map(renderActiveSummaryItem).join('')}
        </ol>
      </section>
    </div>`
}

function renderResolutionGroup(
  resolution: RoadbookResolution,
  points: readonly RoadbookPointMatch[],
): string {
  const groupPoints = points.filter((point) => point.resolution === resolution)
  const openAttribute = resolution === 'user-decision-required' ? ' open' : ''

  return `
    <details
      class="roadbook-report__group roadbook-report__group--${resolution}"
      data-roadbook-report-group="${resolution}"
      data-roadbook-report-group-count="${groupPoints.length}"
      ${openAttribute}
    >
      <summary>
        <strong>${resolutionGroupLabels[resolution]}</strong>
        <span>${groupPoints.length}</span>
      </summary>
      <ol class="roadbook-report__points">
        ${
          groupPoints.length === 0
            ? '<li class="roadbook-report__empty">Aucun point dans ce groupe.</li>'
            : groupPoints.map(renderPoint).join('')
        }
      </ol>
    </details>`
}

function renderValidation(report: RoadbookMatchReport): string {
  if (report.validation.issues.length === 0) {
    return `
      <p class="roadbook-report__validation roadbook-report__validation--valid">
        Validation structurelle réussie.
      </p>`
  }

  return `
    <div class="roadbook-report__validation roadbook-report__validation--issues" role="status">
      <strong>
        ${report.validation.issues.length} anomalie${report.validation.issues.length > 1 ? 's' : ''}
        de validation
      </strong>
      <ul>
        ${report.validation.issues
          .map(
            (issue) => `
              <li data-roadbook-validation-path="${escapeHtml(issue.path)}">
                ${issue.dayId === undefined ? '' : `<strong>${issue.dayId}</strong> · `}
                <span>${escapeHtml(issue.path)} : ${escapeHtml(issue.message)}</span>
              </li>`,
          )
          .join('')}
      </ul>
    </div>`
}

function renderResolutionCounters(report: RoadbookMatchReport): string {
  const { summary } = report

  return `
    <dl class="roadbook-report__counters roadbook-report__counters--resolution" aria-label="Compteurs de résolution des points roadbook">
      <div>
        <dt>Points actifs</dt>
        <dd data-roadbook-report-count="active">${summary.activePointCount}</dd>
      </div>
      <div>
        <dt>Informations seulement</dt>
        <dd data-roadbook-report-count="informational">${summary.informationalPointCount}</dd>
      </div>
      <div>
        <dt>Exclus</dt>
        <dd data-roadbook-report-count="excluded">${summary.excludedPointCount}</dd>
      </div>
      <div>
        <dt>Décisions requises</dt>
        <dd data-roadbook-report-count="user-decision-required">${summary.userDecisionRequiredPointCount}</dd>
      </div>
    </dl>`
}

function renderCounters(report: RoadbookMatchReport): string {
  const { summary } = report

  return `
    <dl class="roadbook-report__counters" aria-label="Compteurs techniques du diagnostic global">
      <div>
        <dt>Journées</dt>
        <dd>${summary.dayCount}</dd>
      </div>
      <div>
        <dt>Journées roulées prêtes</dt>
        <dd>${summary.readyRideDayCount}/${summary.rideDayCount}</dd>
      </div>
      <div>
        <dt>Journées OFF</dt>
        <dd>${summary.offDayCount}</dd>
      </div>
      <div>
        <dt>Points roadbook</dt>
        <dd>${summary.pointCount}</dd>
      </div>
      <div>
        <dt>Appariés (statut brut)</dt>
        <dd data-roadbook-report-count="matched">${summary.matchedPointCount}</dd>
      </div>
      <div>
        <dt>À contrôler (statut brut)</dt>
        <dd data-roadbook-report-count="needs-review">${summary.needsReviewPointCount}</dd>
      </div>
      <div>
        <dt>Non appariés (statut brut)</dt>
        <dd data-roadbook-report-count="unmatched">${summary.unmatchedPointCount}</dd>
      </div>
      <div>
        <dt>Liens vers des waypoints</dt>
        <dd>${summary.linkedWaypointCount}</dd>
      </div>
      <div>
        <dt>Waypoints autonomes</dt>
        <dd>${summary.standaloneWaypointCount}</dd>
      </div>
      <div>
        <dt>Pauses théoriques</dt>
        <dd>${summary.theoreticalPauseCount}</dd>
      </div>
      <div>
        <dt>Pauses roadbook appariées</dt>
        <dd>${summary.matchedRoadbookPauseCount}</dd>
      </div>
      <div>
        <dt>Journées roulées indisponibles</dt>
        <dd>${summary.unavailableRideDayCount}</dd>
      </div>
    </dl>`
}

function clearReportData(container: HTMLElement): void {
  delete container.dataset.roadbookPointCount
  delete container.dataset.roadbookMatchedCount
  delete container.dataset.roadbookNeedsReviewCount
  delete container.dataset.roadbookUnmatchedCount
  delete container.dataset.roadbookValidation
  delete container.dataset.roadbookUnavailableDays
}

export function renderRoadbookReportLoading(container: HTMLElement): void {
  clearReportData(container)
  container.dataset.roadbookReportState = 'loading'
  container.dataset.roadbookDiagnosticState = 'loading'
  container.setAttribute('aria-busy', 'true')
  container.innerHTML = `
    <p class="roadbook-report__message" role="status" aria-live="polite">
      Construction du diagnostic global du roadbook…
    </p>`
}

export function renderRoadbookReportError(
  container: HTMLElement,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : 'Erreur inconnue.'

  clearReportData(container)
  container.dataset.roadbookReportState = 'error'
  container.dataset.roadbookDiagnosticState = 'error'
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <div class="roadbook-report__message roadbook-report__message--error" role="alert">
      <strong>Diagnostic du roadbook indisponible</strong>
      <p>${escapeHtml(message)}</p>
    </div>`
}

export function renderRoadbookReport(
  container: HTMLElement,
  report: RoadbookMatchReport,
): void {
  const isPartial =
    !report.validation.isValid || report.summary.unavailableRideDayCount > 0

  clearReportData(container)
  container.dataset.roadbookReportState = isPartial ? 'partial' : 'success'
  container.dataset.roadbookDiagnosticState = isPartial ? 'partial' : 'success'
  container.dataset.roadbookPointCount = String(report.summary.pointCount)
  container.dataset.roadbookMatchedCount = String(
    report.summary.matchedPointCount,
  )
  container.dataset.roadbookNeedsReviewCount = String(
    report.summary.needsReviewPointCount,
  )
  container.dataset.roadbookUnmatchedCount = String(
    report.summary.unmatchedPointCount,
  )
  container.dataset.roadbookValidation = report.validation.isValid
    ? 'valid'
    : 'invalid'
  container.dataset.roadbookUnavailableDays = String(
    report.summary.unavailableRideDayCount,
  )
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <header class="roadbook-report__header">
      <div>
        <span class="tag tag--data">Roadbook complet</span>
        <h3>Diagnostic global</h3>
      </div>
      <p role="status" aria-live="polite">
        ${isPartial ? 'Diagnostic disponible avec des points à vérifier.' : 'Diagnostic complet et structurellement valide.'}
      </p>
    </header>

    ${renderResolutionCounters(report)}

    <details class="roadbook-report__disclosure" data-roadbook-diagnostics-disclosure>
      <summary>Diagnostic technique</summary>
      ${renderCounters(report)}
      ${renderValidation(report)}
      ${renderActivePoints(report)}

      <div class="roadbook-report__groups">
        ${resolutionOrder
          .map((resolution) =>
            renderResolutionGroup(resolution, report.allPointMatches),
          )
          .join('')}
      </div>
    </details>`
}
