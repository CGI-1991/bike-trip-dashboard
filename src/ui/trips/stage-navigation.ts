import type { TripBundle, TripDayId } from '../../trip-core/index.ts'
import { selectTripDayLabel, selectStageCustomName } from '../../trip-core/index.ts'
import { renderInteractionCue } from '../icons.ts'
const escape = (v: string) => v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')

export function renderStageNavigation(bundle: TripBundle, dayId: TripDayId): string {
  const day = bundle.days.find(d => d.id === dayId)
  const current = day === undefined ? '' : selectTripDayLabel(bundle, dayId)
  return `<nav class="day-detail__floating-nav" aria-label="Journées voisines"><button class="button button--quiet" type="button" data-action="previous-day" aria-label="Journée précédente">‹ Préc.</button><label class="stage-navigation__choice"><span class="visually-hidden">Choisir une journée</span><select data-stage-navigation aria-label="Choisir une journée">${bundle.days.map(d=> {
    const stage = bundle.stages.find(s=>s.dayId===d.id)
    const title = stage ? selectStageCustomName(stage) ?? `${stage.startLocationName ?? '—'} → ${stage.endLocationName ?? '—'}` : d.type === 'off' ? 'Repos' : 'Transfert'
    return `<option value="${escape(d.id)}"${d.id===dayId?' selected':''}>${escape(selectTripDayLabel(bundle,d.id))} — ${escape(title)}</option>`
  }).join('')}</select><span aria-hidden="true">${escape(current)} sur ${bundle.days.length} ${renderInteractionCue('expand')}</span></label><button class="button button--quiet" type="button" data-action="next-day" aria-label="Journée suivante">Suiv. ›</button></nav>`
}
