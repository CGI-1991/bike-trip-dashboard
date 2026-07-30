import { getTripDate } from '../trip/calendar.ts'
import type { TripDayTimeline } from '../trip/types.ts'

const dates = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
const integers = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const clock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export function renderDayHeader(container: HTMLElement, timeline: TripDayTimeline | null, weatherLevel: 'green' | 'orange' | 'red' | 'unknown' = 'unknown'): void {
  if (timeline === null) { container.innerHTML = '<p role="status">Préparation de la journée…</p>'; return }
  const day = timeline.day
  const date = getTripDate(day.dayNumber)
  const formattedDate = dates.format(new Date(`${date}T12:00:00Z`))
  const riskLabels = { green: 'Vert · conditions favorables', orange: 'Orange · prudence', red: 'Rouge · conditions difficiles', unknown: 'Inconnu · données insuffisantes' }
  const risk = `<span class="risk-pill risk-pill--${weatherLevel}">${riskLabels[weatherLevel]}</span>`
  if (timeline.type === 'off') {
    container.innerHTML = `<div><p class="eyebrow">${timeline.day.id} · ${formattedDate}</p><h2>${timeline.day.locationName}</h2><p>Journée OFF</p></div>${risk}`
    return
  }
  if (timeline.status === 'unavailable') { container.innerHTML = `<div><p class="eyebrow">${day.id} · ${formattedDate}</p><h2>${day.startName} → ${day.endName}</h2><p>Trace GPX indisponible</p></div>${risk}`; return }
  const summary = timeline.route.summary
  container.innerHTML = `<div class="day-identity"><p class="eyebrow">${day.id} · <time datetime="${date}">${formattedDate}</time></p><h2>${day.startName} → ${day.endName}</h2></div><dl class="day-header__metrics"><div><dt>Distance</dt><dd>${summary.distanceKm.toFixed(1)} km</dd></div><div><dt>D+</dt><dd>${integers.format(summary.elevationGainM)} m</dd></div><div><dt>Départ</dt><dd>${timeline.startTime}</dd></div><div><dt>ETA</dt><dd>${clock(timeline.arrivalTime.clockMinutes)}</dd></div></dl><button class="button button--quiet" type="button" data-gpx-quick-access>GPX</button>${risk}`
}
