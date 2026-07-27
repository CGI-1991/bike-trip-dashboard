import {
  describeRouteClockTime,
  formatRouteClockTime,
} from '../route/time.ts'
import type { RouteClockTime } from '../route/types.ts'
import type {
  OffDay,
  RideDay,
  RideDayTimeline,
  TripDay,
  TripDayId,
  TripDayTimeline,
  TripPlan,
  TripTimeline,
} from '../trip/types.ts'

const distanceFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const elevationFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0,
})

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderRouteClockTime(value: RouteClockTime): string {
  return `<time aria-label='${escapeHtml(describeRouteClockTime(value))}'>${escapeHtml(formatRouteClockTime(value))}</time>`
}

function formatGpxNumber(gpxNumber: number): string {
  return String(gpxNumber).padStart(2, '0')
}

function formatVariant(variant: string): string {
  return variant === 'Variante' ? variant : `Variante ${variant}`
}

function renderDayButtonStart(
  day: RideDay | OffDay,
  selectedDayId: TripDayId,
  status: 'ready' | 'unavailable' | 'loading' | 'off',
): string {
  const isSelected = day.id === selectedDayId
  const gpxAttribute =
    day.type === 'ride' ? ` data-trip-gpx="${day.gpxNumber}"` : ''

  return `
    <li
      class="trip-day trip-day--${day.type}${isSelected ? ' trip-day--selected' : ''}"
      data-trip-day="${day.id}"
      data-trip-day-type="${day.type}"
      data-trip-day-status="${status}"
      data-trip-has-eta="${day.type === 'ride' && status === 'ready'}"
      ${gpxAttribute}
    >
      <button
        class="trip-day__button"
        type="button"
        data-trip-day-select="${day.id}"
        aria-pressed="${isSelected}"
      >
        <span class="trip-day__number">${day.id}</span>`
}

function renderReadyRideDay(
  dayTimeline: RideDayTimeline,
  selectedDayId: TripDayId,
): string {
  const { day, route } = dayTimeline

  return `${renderDayButtonStart(day, selectedDayId, 'ready')}
        <span class="trip-day__content">
          <span class="trip-day__heading">
            <strong>${escapeHtml(day.name)}</strong>
            <span class="tag tag--ride">Roulé</span>
          </span>
          <span class="trip-day__meta">
            GPX ${formatGpxNumber(day.gpxNumber)}
            ${day.variant === undefined ? '' : ` · ${escapeHtml(formatVariant(day.variant))}`}
          </span>
          <span class="trip-day__metrics">
            <span>${distanceFormatter.format(route.summary.distanceKm)} km</span>
            <span>+${elevationFormatter.format(route.summary.elevationGainM)} m</span>
          </span>
        </span>
        <span class="trip-day__schedule">
          <small>
            <span class='visually-hidden'>Départ </span>${escapeHtml(dayTimeline.startTime)}
          </small>
          <strong>
            <span class='visually-hidden'>ETA </span>${renderRouteClockTime(dayTimeline.arrivalTime)}
          </strong>
        </span>
      </button>
    </li>`
}

function renderUnavailableRideDay(
  dayTimeline: Extract<TripDayTimeline, { type: 'ride'; status: 'unavailable' }>,
  selectedDayId: TripDayId,
): string {
  const { day } = dayTimeline

  return `${renderDayButtonStart(day, selectedDayId, 'unavailable')}
        <span class="trip-day__content">
          <span class="trip-day__heading">
            <strong>${escapeHtml(day.name)}</strong>
            <span class="tag tag--error">Indisponible</span>
          </span>
          <span class="trip-day__meta">GPX ${formatGpxNumber(day.gpxNumber)}</span>
          <span class="trip-day__metrics trip-day__metrics--error">
            Analyse de la trace impossible
          </span>
        </span>
        <span class="trip-day__schedule trip-day__schedule--empty">
          <strong>—</strong>
        </span>
      </button>
    </li>`
}

function renderOffDay(
  dayTimeline: Extract<TripDayTimeline, { type: 'off' }>,
  selectedDayId: TripDayId,
): string {
  const { day } = dayTimeline

  return `${renderDayButtonStart(day, selectedDayId, 'off')}
        <span class="trip-day__content">
          <span class="trip-day__heading">
            <strong>${escapeHtml(day.title)}</strong>
            <span class="tag tag--off">OFF</span>
          </span>
          <span class="trip-day__route">${escapeHtml(day.locationName)}</span>
          <span class="trip-day__metrics">Prochaine journée roulée : ${day.nextRideDayId}</span>
        </span>
        <span class="trip-day__schedule trip-day__schedule--off">
          <small>Aucune</small>
          <strong>ETA</strong>
        </span>
      </button>
    </li>`
}

function renderStaticDay(day: TripDay, selectedDayId: TripDayId): string {
  if (day.type === 'off') {
    return renderOffDay({ type: 'off', day }, selectedDayId)
  }

  return `${renderDayButtonStart(day, selectedDayId, 'loading')}
        <span class="trip-day__content">
          <span class="trip-day__heading">
            <strong>${escapeHtml(day.name)}</strong>
            <span class="tag tag--ride">Roulé</span>
          </span>
          <span class="trip-day__meta">GPX ${formatGpxNumber(day.gpxNumber)}</span>
          <span class="trip-day__metrics">Calcul en attente</span>
        </span>
        <span class="trip-day__schedule trip-day__schedule--empty">
          <strong>—</strong>
        </span>
      </button>
    </li>`
}

function renderTimelineDay(
  dayTimeline: TripDayTimeline,
  selectedDayId: TripDayId,
): string {
  if (dayTimeline.type === 'off') {
    return renderOffDay(dayTimeline, selectedDayId)
  }

  return dayTimeline.status === 'ready'
    ? renderReadyRideDay(dayTimeline, selectedDayId)
    : renderUnavailableRideDay(dayTimeline, selectedDayId)
}

export function renderTripPlanLoading(
  container: HTMLElement,
  plan: TripPlan,
  selectedDayId: TripDayId,
): void {
  container.dataset.tripState = 'loading'
  container.setAttribute('aria-busy', 'true')
  container.innerHTML = `
    <p class="trip-plan__status" role="status" aria-live="polite">
      Calcul des dix journées roulées…
    </p>
    <ol class="trip-day-list">
      ${plan.days.map((day) => renderStaticDay(day, selectedDayId)).join('')}
    </ol>`
}

export function renderTripPlanError(
  container: HTMLElement,
  plan: TripPlan,
  selectedDayId: TripDayId,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : 'Erreur inconnue.'
  container.dataset.tripState = 'error'
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <div class="trip-plan__status trip-plan__status--error" role="alert">
      <strong>Calcul des journées indisponible</strong>
      <span>${escapeHtml(message)}</span>
    </div>
    <ol class="trip-day-list">
      ${plan.days.map((day) => renderStaticDay(day, selectedDayId)).join('')}
    </ol>`
}

export function renderTripTimeline(
  container: HTMLElement,
  timeline: TripTimeline,
  selectedDayId: TripDayId,
): void {
  const isPartial = timeline.summary.unavailableRideDays > 0
  const statusText = isPartial
    ? `${timeline.summary.availableRideDays}/10 journées roulées calculées`
    : '10 journées roulées calculées indépendamment'

  container.dataset.tripState = isPartial ? 'partial' : 'success'
  container.dataset.tripDayCount = String(timeline.summary.totalDays)
  container.dataset.tripRideDayCount = String(timeline.summary.rideDays)
  container.dataset.tripOffDayCount = String(timeline.summary.offDays)
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <p
      class="trip-plan__status${isPartial ? ' trip-plan__status--partial' : ''}"
      role="status"
      aria-live="polite"
    >
      <strong>${statusText}</strong>
      <span>Chaque ETA repart de ${escapeHtml(timeline.settings.departureTime)}.</span>
    </p>
    <ol class="trip-day-list">
      ${timeline.days
        .map((dayTimeline) => renderTimelineDay(dayTimeline, selectedDayId))
        .join('')}
    </ol>`
}
