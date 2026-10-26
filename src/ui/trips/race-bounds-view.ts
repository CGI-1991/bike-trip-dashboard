import type { RideStage, TripBundle } from '../../trip-core/index.ts'
import type { RaceBounds } from '../../trip-core/model/ride-stage.ts'
import { buildRaceCourse, validRaceOffsets } from '../../analysis/race-bounds.ts'
import { selectOrganizationCapabilities } from '../../trip-core/index.ts'
import type { RaceCourse } from '../../analysis/race-bounds.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'
import { neutralizedCyclingReferenceSpeed } from '../../analysis/waypoint-timeline.ts'
import { selectTravelMode } from '../../trip-core/index.ts'

const km = (value: number) => value.toFixed(3).replace('.', ',')

export function renderRaceCourseCard(course: RaceCourse, _stage: RideStage, explicitBounds = false, approachSpeedKph?: number): string {
  return `<section class="race-course" aria-label="Limites de course"><header><h3>Course</h3>${renderFeatureUpdateBadge('race-bounds')}</header>
    ${course.status === 'stale' ? '<p role="status">La trace a changé : redéfinissez les limites de course.</p>' : ''}
    <p class="race-course__hint">${course.status === 'full' ? 'Départ et arrivée du GPX utilisés pour la course.' : course.status === 'bounded' ? `Départ réel km ${km(course.bounds!.startOffsetM / 1000)} · arrivée km ${km(course.bounds!.finishOffsetM / 1000)}.${course.bounds!.startOffsetM > 0 && approachSpeedKph !== undefined ? ` Avant la course : référence ${approachSpeedKph.toLocaleString('fr-BE')} km/h.` : ''}` : 'Horaires et météo suspendus pour ces anciennes limites.'}</p>
    <details data-race-editor><summary>Départ et arrivée de course</summary><div class="race-course__fields">
      <label>Départ réel facultatif · km GPX<input type="number" inputmode="decimal" step="any" min="0" data-race-offset="start" aria-label="Départ de course en kilomètres" placeholder="0 · départ GPX"></label>
      <label>Arrivée · km GPX<input type="number" inputmode="decimal" step="any" min="0" data-race-offset="finish" aria-label="Arrivée de course en kilomètres" placeholder="Fin du GPX"></label>
      <button type="button" class="button button--quiet" data-race-pick="start" aria-pressed="false">Placer le départ</button>
      <button type="button" class="button button--quiet" data-race-pick="finish" aria-pressed="false">Placer l’arrivée</button>
    </div><p class="race-course__hint" data-race-status role="status">Choisissez une limite puis touchez le profil, ou saisissez ses kilomètres.</p>
    <div class="race-course__actions"><button type="button" class="button" data-race-save>Enregistrer</button><button type="button" class="button button--quiet" data-race-cancel>Annuler</button><button type="button" class="button button--quiet" data-race-reset>${explicitBounds ? 'Effacer les limites' : 'Trace entière'}</button></div></details></section>`
}

/** Full source trace stays visible, independently of the Neutre/Pente/Vent layer. */
export function paintRaceBounds(profile: HTMLElement, bounds: RaceBounds | null, lengthKm: number): void {
  const svg = profile.querySelector<SVGSVGElement>('[data-profile-interactive]')
  svg?.querySelector('[data-race-overlay]')?.remove()
  if (svg === null || bounds === null || !validRaceOffsets(bounds, lengthKm)) return
  const x = (offsetM: number) => 20 + 760 * offsetM / (lengthKm * 1000)
  const start = x(bounds.startOffsetM), finish = x(bounds.finishOffsetM)
  svg.querySelector('.profile-area')?.setAttribute('id', 'race-bounds-source-area')
  svg.insertAdjacentHTML('beforeend', `<g class="race-profile-bounds" data-race-overlay aria-hidden="true"><defs><clipPath id="race-bounds-area-clip"><use href="#race-bounds-source-area"/></clipPath></defs><g clip-path="url(#race-bounds-area-clip)"><rect class="race-profile-bounds__outside" x="20" y="25" width="${Math.max(0, start - 20)}" height="189"/><rect class="race-profile-bounds__outside" x="${finish}" y="25" width="${Math.max(0, 780 - finish)}" height="189"/></g><line x1="${start}" x2="${start}" y1="25" y2="214"/><line x1="${finish}" x2="${finish}" y1="25" y2="214"/><text x="${start}" y="38" text-anchor="${start > 740 ? 'end' : 'start'}">D</text><text x="${finish}" y="55" text-anchor="${finish > 740 ? 'end' : 'start'}">A</text></g>`)
}

const controllers = new WeakMap<HTMLElement, AbortController>()
export function mountRaceBoundsEditor(profile: HTMLElement, bundle: TripBundle, stage: RideStage, save: (bounds: RaceBounds | null, expectedFingerprint: string) => Promise<void>): void {
  controllers.get(profile)?.abort()
  profile.querySelector('[data-race-course-host]')?.remove()
  const course = buildRaceCourse(bundle, stage)
  if (course === null) return
  const controller = new AbortController()
  controllers.set(profile, controller)
  profile.insertAdjacentHTML('afterbegin', `<div data-race-course-host>${renderRaceCourseCard(course, stage, selectOrganizationCapabilities(bundle).explicitRaceBounds,
    selectTravelMode(bundle) === 'cycling' ? neutralizedCyclingReferenceSpeed(bundle.settings.global.referenceSpeedKph) : undefined)}</div>`)
  const host = profile.querySelector<HTMLElement>('[data-race-course-host]')!
  const editor = host.querySelector<HTMLDetailsElement>('[data-race-editor]')!
  const status = host.querySelector<HTMLElement>('[data-race-status]')!
  const startInput = host.querySelector<HTMLInputElement>('[data-race-offset="start"]')!
  const finishInput = host.querySelector<HTMLInputElement>('[data-race-offset="finish"]')!
  const savedBounds = course.status === 'bounded' ? course.bounds : null
  let start = savedBounds?.startOffsetM ?? 0
  let finish = savedBounds?.finishOffsetM ?? course.indexed.lengthKm * 1000
  let picked: 'start' | 'finish' | null = null
  let saving = false
  const preview = (): RaceBounds => ({ routeFingerprint: course.fingerprint, startOffsetM: start, finishOffsetM: finish })
  const setInputs = () => { startInput.value = Number.isFinite(start) ? (start / 1000).toFixed(3) : ''; finishInput.value = Number.isFinite(finish) ? (finish / 1000).toFixed(3) : '' }
  const setPicked = (value: typeof picked) => {
    picked = value
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-race-pick]')) button.setAttribute('aria-pressed', String(button.dataset.racePick === picked))
  }
  const redraw = () => paintRaceBounds(profile, preview(), course.indexed.lengthKm)
  const resetDraft = () => {
    setPicked(null)
    start = savedBounds?.startOffsetM ?? 0
    finish = savedBounds?.finishOffsetM ?? course.indexed.lengthKm * 1000
    setInputs()
    paintRaceBounds(profile, savedBounds, course.indexed.lengthKm)
  }
  setInputs()
  paintRaceBounds(profile, savedBounds, course.indexed.lengthKm)
  host.addEventListener('input', event => {
    if (saving) return
    setPicked(null)
    // Only read the field the user changed: the untouched displayed finish
    // may be rounded to 3 decimals while its exact original offset is kept.
    if (event.target === startInput) start = startInput.value === '' ? 0 : startInput.valueAsNumber * 1000
    if (event.target === finishInput) finish = finishInput.value === '' ? course.indexed.lengthKm * 1000 : finishInput.valueAsNumber * 1000
    redraw()
  }, { signal: controller.signal })
  profile.addEventListener('profile-distance-active', event => {
    if (picked === null || !editor.open || saving || profile.dataset.courseEditing === 'false') return
    const distanceKm = (event as CustomEvent<{ distanceKm: number }>).detail.distanceKm
    if (picked === 'start') start = distanceKm * 1000; else finish = distanceKm * 1000
    setInputs(); redraw()
    status.textContent = `${picked === 'start' ? 'Départ' : 'Arrivée'} au km ${km(distanceKm)}. Enregistrez pour confirmer.`
  }, { signal: controller.signal })
  profile.addEventListener('course-editor-hidden', () => setPicked(null), { signal: controller.signal })
  editor.addEventListener('toggle', () => { if (!editor.open && !saving) resetDraft() }, { signal: controller.signal })
  host.addEventListener('click', event => {
    const target = event.target
    if (!(target instanceof Element) || saving) return
    const pick = target.closest<HTMLElement>('[data-race-pick]')?.dataset.racePick
    if (pick === 'start' || pick === 'finish') {
      setPicked(pick)
      status.textContent = `Touchez le profil pour placer ${pick === 'start' ? 'le départ' : 'l’arrivée'} (flèches du clavier possibles).`
      return
    }
    if (target.closest('[data-race-cancel]')) { resetDraft(); editor.open = false; return }
    const reset = target.closest('[data-race-reset]') !== null
    if (!reset && !target.closest('[data-race-save]')) return
    if (!reset && !validRaceOffsets(preview(), course.indexed.lengthKm)) {
      status.textContent = `Le départ doit précéder l’arrivée, entre 0 et ${km(course.indexed.lengthKm)} km.`
      return
    }
    setPicked(null)
    saving = true
    for (const input of host.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) input.disabled = true
    status.textContent = 'Enregistrement…'
    void save(reset ? null : preview(), course.fingerprint).catch(error => {
      saving = false
      for (const input of host.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) input.disabled = false
      status.textContent = error instanceof Error ? error.message : 'Impossible d’enregistrer. Réessayez.'
    })
  }, { signal: controller.signal })
}
