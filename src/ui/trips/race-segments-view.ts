import { DEFAULT_RACE_SEGMENT_ALERTS, RACE_SEGMENT_TYPES } from '../../trip-core/index.ts'
import type { RaceSegment, RaceSegmentFields, RideStage, TripBundle } from '../../trip-core/index.ts'
import { buildRaceCourse } from '../../analysis/race-bounds.ts'
import type { RaceCourse } from '../../analysis/race-bounds.ts'
import { analyzeRaceSegment, raceSegmentStatus } from '../../analysis/race-segments.ts'
import type { RaceSegmentChange } from '../../analysis/race-segments.ts'
import { isValidRaceSegmentFields } from '../../trip-core/validation/race-segment.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'
import { RACE_SEGMENT_STYLE } from './race-segment-style.ts'

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
const km = (m: number) => (m / 1000).toFixed(1).replace('.', ',')
const statusLabel = { ready: '', 'outside-course': 'Hors course', stale: 'Trace modifiée · à replacer', 'course-stale': 'Limites de course à redéfinir' } as const
export function formatSegmentLength(m: number): string {
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`
}
export function segmentStats(course: RaceCourse, segment: RaceSegment): string {
  const value = analyzeRaceSegment(course, segment)
  if (value.distanceM === null) return 'Statistiques suspendues jusqu’au repositionnement.'
  const grade = value.averageGradientPercent === null ? 'Pente inconnue' : `${value.averageGradientPercent.toFixed(1).replace('.', ',')} % net`
  return `${formatSegmentLength(value.distanceM)}${segment.type !== 'climb' ? '' : ` · D+ ${value.elevationGainM === null ? 'inconnu' : `${Math.round(value.elevationGainM)} m`} · ${grade}`}${value.partialAltitude ? ' · altitude incomplète' : ''}`
}

/** Colored portions reuse the original silhouette: no bar or extra plot. */
export function renderRaceSegmentProfile(course: RaceCourse, segments: readonly RaceSegment[], line: string, area: string, draftId?: string): string {
  const drawable = segments.filter(segment => raceSegmentStatus(course, segment) !== 'stale')
  return `<g data-race-segment-profile pointer-events="none"><defs><path id="race-segment-source-line" d="${escape(line)}"/><path id="race-segment-source-area" d="${escape(area)}"/></defs>${drawable.map((segment, index) => {
    const style = RACE_SEGMENT_STYLE[segment.type]
    const left = 20 + 760 * segment.startOffsetM / (course.indexed.lengthKm * 1000)
    const right = 20 + 760 * segment.endOffsetM / (course.indexed.lengthKm * 1000)
    const clip = `race-segment-clip-${index}`
    return `<g data-profile-segment="${escape(segment.id)}"><title>${escape(segment.name)} · km ${km(segment.startOffsetM)} → ${km(segment.endOffsetM)}</title><clipPath id="${clip}"><rect x="${left}" y="25" width="${Math.max(0, right-left)}" height="189"/></clipPath><g clip-path="url(#${clip})"><use href="#race-segment-source-area" fill="${style.color}" opacity=".4"/><use href="#race-segment-source-line" fill="none" stroke="${style.color}" stroke-width="4"${segment.id === draftId || raceSegmentStatus(course, segment) !== 'ready' ? ' stroke-dasharray="7 4"' : ''}/></g></g>`
  }).join('')}</g>`
}

export function renderRaceSegmentsPanel(course: RaceCourse, stage: RideStage): string {
  return `<section class="race-segments" data-race-segments-host aria-label="Édition des points de passage">
  ${(stage.raceSegments?.length ?? 0) > 0 ? `<label class="race-segments__chooser">Modifier un segment<select data-segment-choose aria-label="Segment à modifier"><option value="">Choisir…</option>${stage.raceSegments!.map(segment => `<option value="${escape(segment.id)}">${escape(segment.name)}${statusLabel[raceSegmentStatus(course, segment)] ? ` · ${statusLabel[raceSegmentStatus(course, segment)]}` : ''}</option>`).join('')}</select></label>` : ''}
  <button type="button" class="button button--quiet" data-segment-add${course.status === 'stale' ? ' disabled' : ''}>+ Ajouter un segment</button>${renderFeatureUpdateBadge('race-segments')}
  ${course.status === 'stale' ? '<p class="race-course__hint">Redéfinissez d’abord le départ et l’arrivée de course.</p>' : ''}
  <div data-race-segment-editor hidden><h4 data-segment-editor-title>Nouveau segment</h4>
  <div class="race-segments__fields"><label>Type<select data-segment-field="type" aria-label="Type de segment">${RACE_SEGMENT_TYPES.map(type => `<option value="${type}">${RACE_SEGMENT_STYLE[type].label}</option>`).join('')}</select></label><label>Nom<input data-segment-field="name" aria-label="Nom du segment"></label>
  <label>Début · km GPX<input type="number" min="0" step="0.1" inputmode="decimal" data-segment-field="start" aria-label="Début du segment en kilomètres GPX"></label>
  <label>Fin · km GPX<input type="number" min="0" step="0.1" inputmode="decimal" data-segment-field="end" aria-label="Fin du segment en kilomètres GPX"></label>
  <button type="button" class="button button--quiet" data-segment-pick="start" aria-pressed="false">Placer le début</button><button type="button" class="button button--quiet" data-segment-pick="end" aria-pressed="false">Placer la fin</button></div>
  <p class="race-course__hint" data-segment-live role="status"></p><p class="race-course__hint" data-segment-preview></p>
  <details class="race-segments__alerts"><summary>Alertes des segments · FIT en essai</summary><label><input type="checkbox" data-segment-field="beforeEnabled"> Alerte avant</label><label>Distance avant · m<input type="number" min="0" step="any" inputmode="decimal" data-segment-field="beforeM" aria-label="Distance d’alerte avant le segment en mètres"></label><label><input type="checkbox" data-segment-field="atStart"> Alerte au début</label><label><input type="checkbox" data-segment-field="atEnd"> Alerte à la fin</label></details>
  <div class="race-segments__actions"><button type="button" class="button button--primary" data-segment-save>Enregistrer</button><button type="button" class="button button--quiet" data-segment-cancel>Annuler</button><button type="button" class="button button--danger" data-segment-delete hidden>Supprimer</button></div>
  <div data-segment-delete-confirm hidden><p>Supprimer ce segment ?</p><button type="button" class="button button--danger" data-segment-delete-yes>Confirmer la suppression</button><button type="button" class="button button--quiet" data-segment-delete-no>Conserver</button></div>
  </div></section>`
}

export interface RaceSegmentsEditorOptions {
  readonly idFactory: () => string
  readonly save: (change: RaceSegmentChange, expectedFingerprint: string) => Promise<void>
}

export function mountRaceSegmentsEditor(profile: HTMLElement, bundle: TripBundle, stage: RideStage, options: RaceSegmentsEditorOptions): () => void {
  const course = buildRaceCourse(bundle, stage)
  if (course === null) return () => {}
  const controller = new AbortController(), signal = controller.signal
  const segments = stage.raceSegments ?? []
  profile.insertAdjacentHTML('beforeend', renderRaceSegmentsPanel(course, stage))
  const host = profile.querySelector<HTMLElement>('[data-race-segments-host]')!
  const editor = host.querySelector<HTMLElement>('[data-race-segment-editor]')!
  const live = host.querySelector<HTMLElement>('[data-segment-live]')!
  const preview = host.querySelector<HTMLElement>('[data-segment-preview]')!
  const field = (name: string) => host.querySelector<HTMLInputElement>(`[data-segment-field="${name}"]`)!
  let current: RaceSegment | null = null, id = '', picked: 'start' | 'end' | null = null, saving = false, automaticName = false
  let start = NaN, end = NaN, timer: ReturnType<typeof setTimeout> | undefined
  const boundsEditor = profile.querySelector<HTMLDetailsElement>('[data-race-editor]')
  const read = (): RaceSegmentFields => ({ type: field('type').value as RaceSegmentFields['type'], name: field('name').value,
    startOffsetM: start, endOffsetM: end, alerts: { beforeEnabled: field('beforeEnabled').checked, beforeM: field('beforeM').valueAsNumber, atStart: field('atStart').checked, atEnd: field('atEnd').checked } })
  const draft = (): RaceSegment => ({ ...read(), id, routeFingerprint: course.fingerprint,
    provenance: current?.provenance ?? { sourceType: 'user', sourceId: null, fetchedAt: null, engineVersion: 'race-segments@1', confidence: 'high', manuallyOverridden: true } })
  const paint = (values: readonly RaceSegment[] = segments, draftId?: string) => {
    const svg = profile.querySelector<SVGSVGElement>('[data-profile-interactive]')
    svg?.querySelector('[data-race-segment-profile]')?.remove()
    const line = svg?.querySelector('.profile-line')?.getAttribute('d'), area = svg?.querySelector('.profile-area')?.getAttribute('d')
    if (svg !== null && line && area) svg.querySelector('.profile-line')?.insertAdjacentHTML('afterend', renderRaceSegmentProfile(course, values, line, area, draftId))
  }
  const setInputs = () => {
    for (const [key, value] of [['start', start], ['end', end]] as const) field(key).value = Number.isFinite(value) ? (value / 1000).toFixed(1) : ''
  }
  const setPicked = (value: typeof picked) => {
    picked = value
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-segment-pick]')) button.setAttribute('aria-pressed', String(button.dataset.segmentPick === value))
  }
  const close = () => {
    clearTimeout(timer)
    const chooser = host.querySelector<HTMLSelectElement>('[data-segment-choose]')
    if (chooser !== null) chooser.value = ''
    editor.hidden = true; setPicked(null); paint()
  }
  const update = () => {
    clearTimeout(timer)
    const value = draft()
    if (!isValidRaceSegmentFields(value) || end > course.indexed.lengthKm * 1000 + .001) { preview.textContent = ''; paint(); return }
    paint([...segments.filter(segment => segment.id !== id), value], id)
    timer = setTimeout(() => {
      const analysis = analyzeRaceSegment(course, value)
      preview.textContent = `${segmentStats(course, value)}${statusLabel[analysis.status] ? ` · ${statusLabel[analysis.status]}` : ''}${analysis.beforeOmitted ? ' · Alerte avant omise : départ de course trop proche.' : ''}`
    }, 180)
  }
  const chooseOffset = (value: number) => {
    const offsetM = Math.min(Math.floor(course.indexed.lengthKm * 10) * 100, Math.max(0, Math.round(value / 100) * 100))
    if (picked === null || saving) return
    if (picked === 'start') start = offsetM; else end = offsetM
    setInputs(); update()
    live.textContent = `${picked === 'start' ? 'Début' : 'Fin'} au km ${km(offsetM)}. ${picked === 'start' ? 'Placez ensuite la fin.' : 'Enregistrez pour confirmer.'}`
  }
  const open = (segment: RaceSegment | null) => {
    close();
    const chooser = host.querySelector<HTMLSelectElement>('[data-segment-choose]')
    if (chooser !== null) chooser.value = segment?.id ?? ''
    current = segment; id = segment?.id ?? options.idFactory(); automaticName = segment === null
    if (boundsEditor !== null) boundsEditor.open = false
    const stale = segment !== null && raceSegmentStatus(course, segment) === 'stale'
    start = stale || segment === null ? NaN : segment.startOffsetM; end = stale || segment === null ? NaN : segment.endOffsetM
    field('type').value = segment?.type ?? 'sprint'
    field('name').value = segment?.name ?? `Sprint ${segments.filter(value => value.type === 'sprint').length + 1}`
    const alerts = segment?.alerts ?? DEFAULT_RACE_SEGMENT_ALERTS
    for (const key of ['beforeEnabled', 'atStart', 'atEnd'] as const) field(key).checked = alerts[key]
    field('beforeM').value = String(alerts.beforeM)
    setInputs(); editor.hidden = false; setPicked(segment === null || stale ? 'start' : null)
    host.querySelector<HTMLElement>('[data-segment-editor-title]')!.textContent = segment === null ? 'Nouveau segment' : 'Modifier le segment'
    host.querySelector<HTMLElement>('[data-segment-delete]')!.hidden = segment === null
    host.querySelector<HTMLElement>('[data-segment-delete-confirm]')!.hidden = true
    live.textContent = stale ? 'Trace modifiée : replacez le début et la fin sur le nouveau parcours.' : 'Choisissez une limite puis touchez le profil, ou saisissez ses kilomètres GPX.'
    update(); field('type').focus()
  }
  const commit = async (remove: boolean) => {
    if (!remove && (!isValidRaceSegmentFields(read()) || end > course.indexed.lengthKm * 1000 + .001)) { live.textContent = 'Indiquez un nom, un début avant la fin dans le GPX et une distance d’alerte valide.'; return }
    saving = true; setPicked(null)
    for (const input of host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) input.disabled = true
    live.textContent = 'Enregistrement…'
    try { await options.save(remove ? { kind: 'delete', id } : { kind: current === null ? 'add' : 'edit', id, fields: read() }, course.fingerprint) }
    catch (error) {
      saving = false
      for (const input of host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) input.disabled = false
      live.textContent = error instanceof Error ? error.message : 'Impossible d’enregistrer. Réessayez.'
    }
  }
  profile.addEventListener('course-editor-hidden', () => setPicked(null), { signal })
  profile.addEventListener('profile-distance-active', event => { if (!editor.hidden && profile.dataset.courseEditing !== 'false') chooseOffset((event as CustomEvent<{ distanceKm: number }>).detail.distanceKm * 1000) }, { signal })
  // The gesture previews continuously, then lifting/clicking fixes that limit.
  // Moving the mouse out of the plot must not move the chosen point again.
  profile.addEventListener('pointerup', event => {
    if (event.target instanceof Element && event.target.closest('[data-profile-interactive]') !== null) setPicked(null)
  }, { signal })
  profile.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target instanceof Element && event.target.closest('[data-profile-interactive]') !== null && picked !== null) {
      event.preventDefault(); setPicked(null)
    }
  }, { signal })
  boundsEditor?.addEventListener('toggle', () => { if (boundsEditor.open) close() }, { signal })
  host.addEventListener('input', event => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) || saving) return
    const key = event.target.dataset.segmentField
    if (key === 'start' || key === 'end') { setPicked(null); if (key === 'start') start = Math.round(field('start').valueAsNumber * 10) * 100; else end = Math.round(field('end').valueAsNumber * 10) * 100 }
    if (key === 'name') automaticName = false
    if (key === 'type' && automaticName) field('name').value = `${RACE_SEGMENT_STYLE[read().type].label} ${segments.filter(value => value.type === read().type).length + 1}`
    update()
  }, { signal })
  const onClick = (event: Event) => {
    if (!(event.target instanceof Element) || saving) return
    const target = event.target
    const editId = target.closest<HTMLElement>('[data-segment-edit]')?.dataset.segmentEdit
    if (editId !== undefined) { const segment = segments.find(value => value.id === editId); if (segment !== undefined) open(segment); return }
    if (!host.contains(target)) return
    if (target.closest('[data-segment-add]')) { open(null); return }
    if (target.closest('[data-segment-cancel]')) { close(); return }
    const pick = target.closest<HTMLElement>('[data-segment-pick]')?.dataset.segmentPick
    if (pick === 'start' || pick === 'end') { setPicked(pick); live.textContent = `Touchez le profil pour placer ${pick === 'start' ? 'le début' : 'la fin'}.`; return }
    if (target.closest('[data-segment-save]')) { void commit(false); return }
    if (target.closest('[data-segment-delete]')) { host.querySelector<HTMLElement>('[data-segment-delete-confirm]')!.hidden = false; return }
    if (target.closest('[data-segment-delete-no]')) { host.querySelector<HTMLElement>('[data-segment-delete-confirm]')!.hidden = true; return }
    if (target.closest('[data-segment-delete-yes]') && current !== null) { void commit(true); return }
  }
  profile.addEventListener('click', onClick, { signal })
  host.addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement && event.target.hasAttribute('data-segment-choose')) {
      const selected = segments.find(segment => segment.id === (event.target as HTMLSelectElement).value)
      if (selected !== undefined) open(selected); else close()
      return
    }
    if (event.target instanceof HTMLInputElement && ['start', 'end'].includes(event.target.dataset.segmentField ?? '')) setInputs()
  }, { signal })

  paint()
  return () => { clearTimeout(timer); controller.abort() }
}
