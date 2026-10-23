import { selectStageCustomName } from '../../trip-core/index.ts'
import { selectStageCourseMetrics } from '../../analysis/race-bounds.ts'
import type { TripBundle, TripDay } from '../../trip-core/index.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'

function escape(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }

export function renderLeagueCalendar(bundle: TripBundle, renderEvent?: (day: TripDay) => string): string {
  const months = new Map<string, TripDay[]>()
  for (const day of bundle.days) {
    const month = day.date!.slice(0, 7)
    const days = months.get(month) ?? []
    days.push(day); months.set(month, days)
  }
  const defaultEvent = (day: TripDay) => {
    const stage = bundle.stages.find(stage => stage.id === day.stageId)!
    const metrics = selectStageCourseMetrics(bundle, stage)
    const name = selectStageCustomName(stage) ?? `${stage.startLocationName ?? 'Départ'} → ${stage.endLocationName ?? 'Arrivée'}`
    const time = bundle.settings.days.find(entry => entry.dayId === day.id)?.departureTime ?? '08:00'
    const date = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))
    return `<li><button type="button" class="league-event" data-action="open-day-detail" data-day-id="${escape(day.id)}"><strong>${escape(name)}</strong><time datetime="${day.date}T${time}">${date} · Départ ${time}</time><span>${metrics.distanceKm === null ? 'Distance indisponible' : `${metrics.distanceKm.toFixed(1).replace('.', ',')} km`}${metrics.elevationGainM === null ? '' : ` · +${Math.round(metrics.elevationGainM)} m`}</span><span class="league-event__open">Ouvrir la course →</span></button></li>`
  }
  return `<section class="league-calendar" data-league-calendar><div class="section-heading"><h3>Calendrier des courses</h3>${renderFeatureUpdateBadge('league-calendar')}</div><p class="field__hint">Chaque course garde sa date et son départ. Modifiez le calendrier depuis Modifier le voyage.</p>${[...months].map(([month, days]) => {
    const label = new Intl.DateTimeFormat('fr', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`))
    return `<section class="league-month"><h4>${label}</h4><ol class="trip-day-list">${days.map(renderEvent ?? defaultEvent).join('')}</ol></section>`
  }).join('')}</section>`
}
