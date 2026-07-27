import {
  describeRouteClockTime,
  formatRouteClockTime,
} from '../route/time.ts'
import type { RouteClockTime } from '../route/types.ts'
import type {
  RoadbookDayMatchReport,
  RoadbookPointMatch,
  RoadbookStatsDelta,
  RoadbookStatsValues,
  RoadbookTheoreticalPause,
} from '../trip/roadbook-match.ts'
import type {
  RoadbookDescription,
  RoadbookMatchMethod,
  RoadbookResolution,
} from '../trip/roadbook-types.ts'
import type { RideDayTimeline, TripDayTimeline } from '../trip/types.ts'

const decimalFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const integerFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0,
})

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

function formatDistance(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : `${decimalFormatter.format(value)} km`
}

function formatElevation(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : `${integerFormatter.format(value)} m`
}

function formatGradient(value: number): string {
  return `${decimalFormatter.format(value)} %`
}

function formatDuration(value: number): string {
  const roundedMinutes = Math.round(value)
  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60

  return hours === 0
    ? `${minutes} min`
    : `${hours} h ${String(minutes).padStart(2, '0')}`
}

function formatSignedMetric(
  value: number | null | undefined,
  unit: 'km' | 'm',
): string {
  if (value === null || value === undefined) {
    return '—'
  }

  const formatter = unit === 'km' ? decimalFormatter : integerFormatter
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatter.format(Math.abs(value))} ${unit}`
}

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

function renderMatchBadge(point: RoadbookPointMatch | undefined): string {
  if (point === undefined) {
    return '<span class="tag tag--error" data-roadbook-point-resolution="missing">Absent du diagnostic</span>'
  }

  const method =
    point.matchMethod === undefined
      ? ''
      : ` · ${matchMethodLabels[point.matchMethod]}`

  return `
    <span
      class="tag ${getResolutionTagClass(point.resolution)}"
      data-roadbook-point-resolution="${point.resolution}"
      title="${escapeHtml(`${resolutionLabels[point.resolution]}${method}`)}"
    >
      ${resolutionLabels[point.resolution]}
    </span>`
}

function renderPointEta(point: RoadbookPointMatch | undefined): string {
  if (point?.eta === undefined) {
    return '<span aria-label="Heure théorique indisponible">—</span>'
  }

  return renderRouteClockTime(point.eta)
}

function renderTextList(
  values: readonly string[],
  emptyMessage: string,
  className: string,
): string {
  if (values.length === 0) {
    return `<p class="${className}__empty">${escapeHtml(emptyMessage)}</p>`
  }

  return `
    <ul class="${className}">
      ${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}
    </ul>`
}

function renderDescriptionList(
  values: readonly RoadbookDescription[],
  emptyMessage: string,
  className: string,
): string {
  return renderTextList(
    values.map(({ description }) => description),
    emptyMessage,
    className,
  )
}

function renderResolutionCounters(points: readonly RoadbookPointMatch[]): string {
  const active = points.filter(({ resolution }) => resolution === 'matched').length
  const informational = points.filter(
    ({ resolution }) => resolution === 'informational',
  ).length
  const excluded = points.filter(({ resolution }) => resolution === 'excluded').length
  const decisionRequired = points.filter(
    ({ resolution }) => resolution === 'user-decision-required',
  ).length

  return `
    <dl class="roadbook-detail__counters" aria-label="Compteurs de résolution des points de la journée">
      <div>
        <dt>${resolutionGroupLabels.matched}</dt>
        <dd data-roadbook-detail-count="matched">${active}</dd>
      </div>
      <div>
        <dt>${resolutionGroupLabels.informational}</dt>
        <dd data-roadbook-detail-count="informational">${informational}</dd>
      </div>
      <div>
        <dt>${resolutionGroupLabels.excluded}</dt>
        <dd data-roadbook-detail-count="excluded">${excluded}</dd>
      </div>
      <div>
        <dt>${resolutionGroupLabels['user-decision-required']}</dt>
        <dd data-roadbook-detail-count="user-decision-required">${decisionRequired}</dd>
      </div>
    </dl>`
}

function renderStatsRow(
  label: string,
  gpxValue: number | null | undefined,
  roadbookValue: number | null | undefined,
  deltaValue: number | null | undefined,
  unit: 'km' | 'm',
): string {
  const format = unit === 'km' ? formatDistance : formatElevation

  return `
    <tr>
      <th scope="row">${escapeHtml(label)}</th>
      <td data-roadbook-stats-source="gpx">${format(gpxValue)}</td>
      <td data-roadbook-stats-source="roadbook">${format(roadbookValue)}</td>
      <td data-roadbook-stats-source="delta">${formatSignedMetric(deltaValue, unit)}</td>
    </tr>`
}

function renderStatsComparison(
  gpx: RoadbookStatsValues | null,
  roadbook: RoadbookStatsValues,
  delta: RoadbookStatsDelta | null,
): string {
  return `
    <section class="roadbook-detail__section" aria-labelledby="roadbook-detail-stats">
      <h4 id="roadbook-detail-stats">Statistiques comparées</h4>
      <div
        class="roadbook-detail__table-wrapper"
        role="region"
        tabindex="0"
        aria-label="Comparaison des statistiques GPX et roadbook"
      >
        <table class="roadbook-detail__stats">
          <thead>
            <tr>
              <th scope="col">Mesure</th>
              <th scope="col">GPX calculé</th>
              <th scope="col">Roadbook</th>
              <th scope="col">Écart GPX − roadbook</th>
            </tr>
          </thead>
          <tbody>
            ${renderStatsRow(
              'Distance',
              gpx?.distanceKm,
              roadbook.distanceKm,
              delta?.distanceKm,
              'km',
            )}
            ${renderStatsRow(
              'Dénivelé positif',
              gpx?.elevationGainM,
              roadbook.elevationGainM,
              delta?.elevationGainM,
              'm',
            )}
            ${renderStatsRow(
              'Dénivelé négatif',
              gpx?.elevationLossM,
              roadbook.elevationLossM,
              delta?.elevationLossM,
              'm',
            )}
          </tbody>
        </table>
      </div>
    </section>`
}

function renderCols(dayMatch: Extract<RoadbookDayMatchReport, { type: 'ride' }>): string {
  const { cols } = dayMatch.roadbook

  if (cols.length === 0) {
    return '<p class="roadbook-detail__empty">Aucun col documenté.</p>'
  }

  return `
    <ul class="roadbook-detail__items">
      ${cols
        .map((col) => {
          const match = dayMatch.points.find(({ id }) => id === col.id)
          return `
            <li data-roadbook-detail-point="${escapeHtml(col.id)}">
              <div class="roadbook-detail__item-heading">
                <strong>${escapeHtml(col.name)}</strong>
                ${renderMatchBadge(match)}
              </div>
              <span>
                ${formatElevation(col.elevationM)} ·
                ${formatDistance(col.distanceKm)} ·
                D+ ${formatElevation(col.elevationGainM)} ·
                ${formatGradient(col.averageGradientPercent)}
              </span>
              <small>Heure théorique : ${renderPointEta(match)}</small>
            </li>`
        })
        .join('')}
    </ul>`
}

function renderPassageItem(passage: { readonly id: string; readonly label: string }, match: RoadbookPointMatch | undefined): string {
  return `
    <li data-roadbook-detail-point="${escapeHtml(passage.id)}">
      <div class="roadbook-detail__item-heading">
        <strong>${escapeHtml(passage.label)}</strong>
        ${renderMatchBadge(match)}
      </div>
      <small>Heure théorique : ${renderPointEta(match)}</small>
    </li>`
}

function renderMainPassages(
  dayMatch: Extract<RoadbookDayMatchReport, { type: 'ride' }>,
): string {
  const mainPassages = dayMatch.roadbook.resupplyPassages.filter((passage) => {
    const match = dayMatch.points.find(({ id }) => id === passage.id)
    return match?.resolution === 'matched'
  })

  if (mainPassages.length === 0) {
    return '<p class="roadbook-detail__empty">Aucun arrêt principal documenté.</p>'
  }

  return `
    <ul class="roadbook-detail__items">
      ${mainPassages
        .map((passage) =>
          renderPassageItem(
            passage,
            dayMatch.points.find(({ id }) => id === passage.id),
          ),
        )
        .join('')}
    </ul>`
}

function renderOtherPassages(
  dayMatch: Extract<RoadbookDayMatchReport, { type: 'ride' }>,
): string {
  const secondaryPassages = dayMatch.roadbook.resupplyPassages.filter((passage) => {
    const match = dayMatch.points.find(({ id }) => id === passage.id)
    return match?.resolution !== 'matched'
  })
  const secondaryContent =
    secondaryPassages.length === 0
      ? '<p class="roadbook-detail__empty">Aucun autre passage documenté.</p>'
      : `
        <ul class="roadbook-detail__items">
          ${secondaryPassages
            .map((passage) =>
              renderPassageItem(
                passage,
                dayMatch.points.find(({ id }) => id === passage.id),
              ),
            )
            .join('')}
        </ul>`

  return `
    <p class="roadbook-detail__hint">
      Libellés conservés comme groupe éditorial du roadbook ; leur nature exacte
      n’est pas déduite automatiquement.
    </p>
    <div class="roadbook-detail__subsection">
      <h5>Passages secondaires</h5>
      ${secondaryContent}
    </div>
    ${renderPauses(dayMatch)}
    <div class="roadbook-detail__subsection">
      <h5>Options</h5>
      ${renderOptions(dayMatch)}
    </div>`
}

function renderTheoreticalPause(pause: RoadbookTheoreticalPause): string {
  return `
    <li data-roadbook-theoretical-pause="${escapeHtml(pause.id)}">
      <strong>${escapeHtml(pause.name)}</strong>
      <span>
        ${formatDuration(pause.durationMinutes)} ·
        ${formatDistance(pause.trackDistanceKm)} ·
        ${formatElevation(pause.altitudeM)}
      </span>
      <small>
        ${renderRouteClockTime(pause.startEta)} à ${renderRouteClockTime(pause.endEta)}
      </small>
    </li>`
}

function renderPauses(
  dayMatch: Extract<RoadbookDayMatchReport, { type: 'ride' }>,
): string {
  const { explicitPauses } = dayMatch.roadbook
  const explicitContent =
    explicitPauses.length === 0
      ? '<p class="roadbook-detail__empty">Aucune pause explicite dans le roadbook.</p>'
      : `
        <ul class="roadbook-detail__items">
          ${explicitPauses
            .map((pause) => {
              const match = dayMatch.points.find(({ id }) => id === pause.id)
              return `
                <li data-roadbook-detail-point="${escapeHtml(pause.id)}">
                  <div class="roadbook-detail__item-heading">
                    <strong>${escapeHtml(pause.title)}</strong>
                    ${renderMatchBadge(match)}
                  </div>
                  <small>Heure théorique : ${renderPointEta(match)}</small>
                </li>`
            })
            .join('')}
        </ul>`

  const theoreticalContent =
    dayMatch.theoreticalPauses.length === 0
      ? '<p class="roadbook-detail__empty">Aucune pause théorique disponible.</p>'
      : `
        <ul class="roadbook-detail__items roadbook-detail__items--theoretical">
          ${dayMatch.theoreticalPauses.map(renderTheoreticalPause).join('')}
        </ul>`

  return `
    <div class="roadbook-detail__subsection">
      <h5>Pauses du roadbook</h5>
      ${explicitContent}
    </div>
    <div class="roadbook-detail__subsection">
      <h5>Pauses réparties par le moteur</h5>
      ${theoreticalContent}
    </div>`
}

function renderOptions(
  dayMatch: Extract<RoadbookDayMatchReport, { type: 'ride' }>,
): string {
  const { options } = dayMatch.roadbook

  if (options.length === 0) {
    return '<p class="roadbook-detail__empty">Aucune option documentée.</p>'
  }

  return `
    <ul class="roadbook-detail__items">
      ${options
        .map((option) => {
          const match = dayMatch.points.find(({ id }) => id === option.id)
          const metrics = [
            option.elevationM === undefined
              ? null
              : formatElevation(option.elevationM),
            option.distanceKm === undefined ? null : formatDistance(option.distanceKm),
            option.elevationGainM === undefined
              ? null
              : `D+ ${formatElevation(option.elevationGainM)}`,
            option.averageGradientPercent === undefined
              ? null
              : formatGradient(option.averageGradientPercent),
          ].filter((value): value is string => value !== null)

          return `
            <li data-roadbook-detail-point="${escapeHtml(option.id)}">
              <div class="roadbook-detail__item-heading">
                <strong>${escapeHtml(option.title)}</strong>
                ${renderMatchBadge(match)}
              </div>
              ${metrics.length === 0 ? '' : `<span>${metrics.join(' · ')}</span>`}
              <small>Heure théorique : ${renderPointEta(match)}</small>
            </li>`
        })
        .join('')}
    </ul>`
}

function findReadyTimeline(
  dayMatch: Extract<RoadbookDayMatchReport, { type: 'ride' }>,
  timelineDay: TripDayTimeline | null,
): RideDayTimeline | null {
  if (
    dayMatch.status !== 'ready' ||
    timelineDay === null ||
    timelineDay.type !== 'ride' ||
    timelineDay.status !== 'ready' ||
    timelineDay.day.id !== dayMatch.dayId
  ) {
    return null
  }

  return timelineDay
}

function renderRideDay(
  dayMatch: Extract<RoadbookDayMatchReport, { type: 'ride' }>,
  timelineDay: TripDayTimeline | null,
): string {
  const { roadbook, stats } = dayMatch
  const readyTimeline = findReadyTimeline(dayMatch, timelineDay)
  const unavailableMessage =
    dayMatch.status === 'unavailable'
      ? `
        <div class="roadbook-detail__warning" role="alert">
          <strong>Trace indisponible pour cette journée</strong>
          <p>${escapeHtml(dayMatch.error ?? 'Le calcul associé à cette journée n’est pas disponible.')}</p>
        </div>`
      : readyTimeline === null
        ? `
          <p class="roadbook-detail__warning" role="status">
            Chronologie indisponible : aucune heure de départ ni d’arrivée n’est affichée.
          </p>`
        : ''

  return `
    <header class="roadbook-detail__header">
      <div>
        <span class="tag tag--ride">${dayMatch.dayId} · Journée roulée</span>
        <h3>${escapeHtml(roadbook.title)}</h3>
        <p class="roadbook-detail__route">
          ${escapeHtml(roadbook.startName)} → ${escapeHtml(roadbook.endName)}
        </p>
      </div>
    </header>

    <p class="roadbook-detail__ambiance">${escapeHtml(roadbook.ambiance)}</p>

    ${unavailableMessage}

    <dl class="roadbook-detail__schedule">
      <div>
        <dt>Départ prévu</dt>
        <dd>${readyTimeline === null ? '—' : escapeHtml(readyTimeline.startTime)}</dd>
      </div>
      <div>
        <dt>Arrivée théorique</dt>
        <dd>${readyTimeline === null ? '—' : renderRouteClockTime(readyTimeline.arrivalTime)}</dd>
      </div>
    </dl>

    <section class="roadbook-detail__section" aria-labelledby="roadbook-detail-cols">
      <h4 id="roadbook-detail-cols">Cols</h4>
      ${renderCols(dayMatch)}
    </section>

    <section class="roadbook-detail__section" aria-labelledby="roadbook-detail-passages">
      <h4 id="roadbook-detail-passages">Arrêts principaux</h4>
      ${renderMainPassages(dayMatch)}
    </section>

    <details class="roadbook-detail__disclosure" data-roadbook-other-passages>
      <summary>Autres passages</summary>
      ${renderOtherPassages(dayMatch)}
    </details>

    <details class="roadbook-detail__disclosure" data-roadbook-source-detail>
      <summary>Roadbook</summary>
      ${renderResolutionCounters(dayMatch.points)}
      ${renderStatsComparison(stats.gpx, stats.roadbook, stats.deltaGpxMinusRoadbook)}
      <div class="roadbook-detail__subsection">
        <h5>Variante</h5>
        <p>${escapeHtml(roadbook.variant ?? 'Aucune variante documentée.')}</p>
      </div>
      <div class="roadbook-detail__subsection">
        <h5>Logements</h5>
        ${renderDescriptionList(
          dayMatch.lodgings,
          'Aucun logement documenté.',
          'roadbook-detail__descriptions',
        )}
      </div>
      <div class="roadbook-detail__subsection">
        <h5>Notes</h5>
        ${renderTextList(
          roadbook.notes,
          'Aucune note complémentaire.',
          'roadbook-detail__notes',
        )}
      </div>
    </details>`
}

function renderOffDay(
  dayMatch: Extract<RoadbookDayMatchReport, { type: 'off' }>,
): string {
  const { roadbook } = dayMatch

  return `
    <header class="roadbook-detail__header roadbook-detail__header--off">
      <div>
        <span class="tag tag--off">${dayMatch.dayId} · OFF</span>
        <h3>${escapeHtml(roadbook.title)}</h3>
        <p class="roadbook-detail__route">${escapeHtml(roadbook.locationName)}</p>
      </div>
    </header>

    <p class="roadbook-detail__ambiance">${escapeHtml(roadbook.ambiance)}</p>

    <section class="roadbook-detail__section" aria-labelledby="roadbook-detail-activities">
      <h4 id="roadbook-detail-activities">Activités</h4>
      ${renderDescriptionList(
        roadbook.activities,
        'Aucune activité documentée.',
        'roadbook-detail__descriptions',
      )}
    </section>

    <section class="roadbook-detail__section" aria-labelledby="roadbook-detail-recovery">
      <h4 id="roadbook-detail-recovery">Récupération</h4>
      ${renderDescriptionList(
        roadbook.recovery,
        'Aucune consigne de récupération documentée.',
        'roadbook-detail__descriptions',
      )}
    </section>

    <details class="roadbook-detail__disclosure" data-roadbook-source-detail>
      <summary>Roadbook</summary>
      <div class="roadbook-detail__subsection">
        <h5>Logistique</h5>
        ${renderDescriptionList(
          roadbook.logistics,
          'Aucune consigne logistique documentée.',
          'roadbook-detail__descriptions',
        )}
      </div>
      <div class="roadbook-detail__subsection">
        <h5>Logements</h5>
        ${renderDescriptionList(
          dayMatch.lodgings,
          'Aucun logement documenté.',
          'roadbook-detail__descriptions',
        )}
      </div>
      <div class="roadbook-detail__subsection">
        <h5>Notes</h5>
        ${renderTextList(
          roadbook.notes,
          'Aucune note complémentaire.',
          'roadbook-detail__notes',
        )}
      </div>
    </details>

    <p class="roadbook-detail__next-day">
      <strong>Prochaine journée roulée</strong>
      <span>${roadbook.nextRideDayId}</span>
    </p>`
}

function clearDetailData(container: HTMLElement): void {
  delete container.dataset.roadbookDayId
  delete container.dataset.roadbookDayType
  delete container.dataset.roadbookDayStatus
  delete container.dataset.roadbookHasEta
  delete container.dataset.roadbookMatchedCount
  delete container.dataset.roadbookNeedsReviewCount
  delete container.dataset.roadbookUnmatchedCount
  delete container.dataset.roadbookActiveCount
  delete container.dataset.roadbookInformationalCount
  delete container.dataset.roadbookExcludedCount
  delete container.dataset.roadbookDecisionRequiredCount
}

export function renderRoadbookDetailLoading(container: HTMLElement): void {
  clearDetailData(container)
  container.dataset.roadbookDetailState = 'loading'
  container.setAttribute('aria-busy', 'true')
  container.innerHTML = `
    <p class="roadbook-detail__message" role="status" aria-live="polite">
      Chargement du détail du roadbook…
    </p>`
}

export function renderRoadbookDetailError(
  container: HTMLElement,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : 'Erreur inconnue.'

  clearDetailData(container)
  container.dataset.roadbookDetailState = 'error'
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <div class="roadbook-detail__message roadbook-detail__message--error" role="alert">
      <strong>Détail du roadbook indisponible</strong>
      <p>${escapeHtml(message)}</p>
    </div>`
}

export function renderRoadbookDayDetail(
  container: HTMLElement,
  dayMatch: RoadbookDayMatchReport,
  timelineDay: TripDayTimeline | null,
): void {
  clearDetailData(container)
  container.dataset.roadbookDetailState =
    dayMatch.type === 'off' ? 'off' : dayMatch.status
  container.dataset.roadbookDayId = dayMatch.dayId
  container.dataset.roadbookDayType = dayMatch.type
  container.dataset.roadbookDayStatus = dayMatch.status
  container.setAttribute('aria-busy', 'false')

  if (dayMatch.type === 'off') {
    container.innerHTML = renderOffDay(dayMatch)
    return
  }

  const matchedCount = dayMatch.points.filter(
    ({ status }) => status === 'matched',
  ).length
  const needsReviewCount = dayMatch.points.filter(
    ({ status }) => status === 'needs-review',
  ).length
  const unmatchedCount = dayMatch.points.filter(
    ({ status }) => status === 'unmatched',
  ).length
  const activeCount = dayMatch.points.filter(
    ({ resolution }) => resolution === 'matched',
  ).length
  const informationalCount = dayMatch.points.filter(
    ({ resolution }) => resolution === 'informational',
  ).length
  const excludedCount = dayMatch.points.filter(
    ({ resolution }) => resolution === 'excluded',
  ).length
  const decisionRequiredCount = dayMatch.points.filter(
    ({ resolution }) => resolution === 'user-decision-required',
  ).length
  const readyTimeline = findReadyTimeline(dayMatch, timelineDay)

  container.dataset.roadbookHasEta = String(readyTimeline !== null)
  container.dataset.roadbookMatchedCount = String(matchedCount)
  container.dataset.roadbookNeedsReviewCount = String(needsReviewCount)
  container.dataset.roadbookUnmatchedCount = String(unmatchedCount)
  container.dataset.roadbookActiveCount = String(activeCount)
  container.dataset.roadbookInformationalCount = String(informationalCount)
  container.dataset.roadbookExcludedCount = String(excludedCount)
  container.dataset.roadbookDecisionRequiredCount = String(decisionRequiredCount)
  container.innerHTML = renderRideDay(dayMatch, timelineDay)
}
