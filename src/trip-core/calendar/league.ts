import type { TripBundle, TripDayId } from '../index.ts'
import { isIsoDate, isTimeOfDay } from '../validation/primitives.ts'

/** A course is the existing day/stage/route identity, with an explicit date.
 * Do not persist another copy of its name, source route or forecast date. */
export interface LeagueEventSchedule {
  readonly dayId: TripDayId
  readonly date: string
  readonly departureTime: string
}

/** Normalize chronological order and the date envelope, never deriving an
 * event date from its position, import time or a GPX timestamp. */
export function normalizeLeagueCalendar(bundle: TripBundle): TripBundle {
  if (bundle.settings.global.organizationMode !== 'league') return bundle
  if (bundle.days.length === 0 || bundle.days.some(day => day.type !== 'ride' || !isIsoDate(day.date) || day.sameCalendarDayAsPrevious === true)) {
    throw new Error('Une League exige des courses datées, sans journée OFF, transfert ou étape liée.')
  }
  const departure = new Map(bundle.settings.days.map(entry => [entry.dayId, entry.departureTime ?? '08:00']))
  const days = [...bundle.days].sort((a, b) => a.date!.localeCompare(b.date!)
    || (departure.get(a.id) ?? '08:00').localeCompare(departure.get(b.id) ?? '08:00') || a.index - b.index)
    .map((day, index) => ({ ...day, index, displayNumber: index + 1 }))
  const startDate = days[0]!.date!, endDate = days.at(-1)!.date!
  return { ...bundle, days, calendar: { ...bundle.calendar, startDate, endDate }, metadata: { ...bundle.metadata, startDate, endDate } }
}

export function applyLeagueSchedule(bundle: TripBundle, updates: readonly LeagueEventSchedule[]): TripBundle {
  if (bundle.settings.global.organizationMode !== 'league') throw new Error('Ce voyage n’est pas une League.')
  const byId = new Map<TripDayId, LeagueEventSchedule>()
  const daysById = new Map(bundle.days.map(day => [day.id, day]))
  for (const update of updates) {
    if (byId.has(update.dayId) || !daysById.has(update.dayId) || !isIsoDate(update.date) || !isTimeOfDay(update.departureTime)) {
      throw new Error('Date, heure ou course de League invalide.')
    }
    byId.set(update.dayId, update)
  }
  const previousTime = new Map(bundle.settings.days.map(entry => [entry.dayId, entry.departureTime ?? '08:00']))
  const changed = new Set(updates.filter(update => daysById.get(update.dayId)!.date !== update.date
    || (previousTime.get(update.dayId) ?? '08:00') !== update.departureTime).map(update => update.dayId))
  if (changed.size === 0) return bundle
  const settingsDays = new Map(bundle.settings.days.map(entry => [entry.dayId, entry]))
  for (const update of updates) settingsDays.set(update.dayId, { ...settingsDays.get(update.dayId), dayId: update.dayId, departureTime: update.departureTime, totalBreakSeconds: 0 })
  return normalizeLeagueCalendar({ ...bundle,
    days: bundle.days.map(day => byId.has(day.id) ? { ...day, date: byId.get(day.id)!.date as typeof day.date } : day),
    settings: { ...bundle.settings, days: [...settingsDays.values()] },
    weather: bundle.weather.filter(record => !changed.has(record.dayId)),
    stages: bundle.stages.map(stage => changed.has(stage.dayId) ? { ...stage, weatherRecordIds: [] } : stage),
  })
}
