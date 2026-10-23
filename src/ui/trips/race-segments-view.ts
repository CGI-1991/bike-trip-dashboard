import { DEFAULT_RACE_SEGMENT_ALERTS, RACE_SEGMENT_TYPES } from '../../trip-core/index.ts'
import type { RaceSegment, RaceSegmentFields, RideStage, TripBundle } from '../../trip-core/index.ts'
import { buildRaceCourse } from '../../analysis/race-bounds.ts'
import type { RaceCourse } from '../../analysis/race-bounds.ts'
import { pointAtIndexedDistance } from '../../route-enrichment/segment-geometry.ts'
import { analyzeRaceSegment, projectRacePosition, raceSegmentLanes, raceSegmentStatus } from '../../analysis/race-segments.ts'
import type { RaceSegmentChange } from '../../analysis/race-segments.ts'
import { isValidRaceSegmentFields } from '../../trip-core/validation/race-segment.ts'
import type { RoutePickerHandle } from '../route-map.ts'
import type { RouteMapModel } from '../route-map-model.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'
import { RACE_SEGMENT_STYLE } from './race-segment-style.ts'

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
const km = (m: number) => (m / 1000).toFixed(3).replace('.', ',')
const statusLabel = { ready: '', 'outside-course': 'Hors course', stale: 'Trace modifiée · à replacer', 'course-stale': 'Limites de course à redéfinir' } as const
export function formatSegmentLength(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${m < .001 ? m.toExponential(1) : m.toFixed(m < 1 ? 3 : m < 10 ? 1 : 0).replace('.', ',')} m`
}
export function segmentStats(course: RaceCourse, segment: RaceSegment): string {
  const value = analyzeRaceSegment(course, segment)
  if (value.distanceM === null) return 'Statistiques suspendues jusqu’au repositionnement.'
  const grade = value.averageGradientPercent === null ? 'Pente inconnue' : `${value.averageGradientPercent.toFixed(1).replace('.', ',')} % net`
  return `${formatSegmentLength(value.distanceM)}${segment.type !== 'climb' ? '' : ` · D+ ${value.elevationGainM === null ? 'inconnu' : `${Math.round(value.elevationGainM)} m`} · ${grade}`}${value.partialAltitude ? ' · altitude incomplète' : ''}`
}

export function renderRaceSegmentBands(course: RaceCourse, segments: readonly RaceSegment[], draftId?: string): string {
  const drawable = segments.filter(segment => raceSegmentStatus(course, segment) !== 'stale')
  const lanes = raceSegmentLanes(drawable)
  if (lanes.length === 0) return ''
  return `<div class="race-segment-bands" data-race-segment-bands style="height:${(Math.max(...lanes.map(item => item.lane)) + 1) * 26}px" aria-label="Segments sur le profil">${lanes.map(({ segment, lane }) => {
    const style = RACE_SEGMENT_STYLE[segment.type], status = raceSegmentStatus(course, segment)
    const left = (20 + 760 * segment.startOffsetM / (course.indexed.lengthKm * 1000)) / 8
    const width = 95 * (segment.endOffsetM - segment.startOffsetM) / (course.indexed.lengthKm * 1000)
    const title = `${style.label} · ${segment.name} · km ${km(segment.startOffsetM)} à ${km(segment.endOffsetM)}${statusLabel[status] ? ` · ${statusLabel[status]}` : ''}`
    return `<button type="button" class="race-segment-band race-segment--${segment.type}${status !== 'ready' || segment.id === draftId ? ' race-segment-band--draft' : ''}" style="left:${left}%;width:${width}%;top:${lane * 26}px" data-segment-edit="${escape(segment.id)}" title="${escape(title)}" aria-label="${escape(title)}"><span>${style.letter}</span> ${escape(segment.name)}</button>`
  }).join('')}</div>`
}

export function renderRaceSegmentsPanel(course: RaceCourse, stage: RideStage): string {
  const segments = stage.raceSegments ?? []
  return `<section class="race-segments" data-race-segments-host><header><h3>Segments de course <span>(${segments.length})</span></h3>${renderFeatureUpdateBadge('race-segments')}</header>
  <ul class="race-segments__list">${segments.map(segment => {
    const style = RACE_SEGMENT_STYLE[segment.type], value = analyzeRaceSegment(course, segment)
    return `<li><button type="button" data-segment-edit="${escape(segment.id)}"><strong><span class="race-segment-tag race-segment--${segment.type}">${style.letter}</span> ${escape(segment.name)}</strong><span>${style.label} · km ${km(segment.startOffsetM)} → ${km(segment.endOffsetM)}</span><span>${segmentStats(course, segment)}</span>${value.status === 'ready' ? '' : `<span class="race-segments__warning">${statusLabel[value.status]}</span>`}</button></li>`
  }).join('')}</ul>
  <button type="button" class="button button--quiet" data-segment-add${course.status === 'stale' ? ' disabled' : ''}>+ Ajouter un segment</button>
  ${course.status === 'stale' ? '<p class="race-course__hint">Redéfinissez d’abord le départ et l’arrivée de course.</p>' : ''}
  <div data-race-segment-editor hidden><h4 data-segment-editor-title>Nouveau segment</h4>
  <div class="race-segments__fields"><label>Type<select data-segment-field="type" aria-label="Type de segment">${RACE_SEGMENT_TYPES.map(type => `<option value="${type}">${RACE_SEGMENT_STYLE[type].label}</option>`).join('')}</select></label><label>Nom<input data-segment-field="name" aria-label="Nom du segment"></label>
  <label>Début · km GPX<input type="number" min="0" step="any" inputmode="decimal" data-segment-field="start" aria-label="Début du segment en kilomètres GPX"></label>
  <label>Fin · km GPX<input type="number" min="0" step="any" inputmode="decimal" data-segment-field="end" aria-label="Fin du segment en kilomètres GPX"></label>
  <button type="button" class="button button--quiet" data-segment-pick="start" aria-pressed="false">Placer le début</button><button type="button" class="button button--quiet" data-segment-pick="end" aria-pressed="false">Placer la fin</button></div>
  <div class="race-segments__actions"><button type="button" class="button button--quiet" data-segment-map>Choisir sur la carte</button></div>
  <div data-segment-map-panel hidden><div class="race-segments__map" data-segment-map-canvas></div><p class="race-course__hint" data-segment-map-fallback hidden>Fond de carte indisponible ; le tracé reste sélectionnable.</p><div data-segment-map-choices></div></div>
  <p class="race-course__hint" data-segment-live role="status"></p><p class="race-course__hint" data-segment-preview></p>
  <details class="race-segments__alerts"><summary>Réglages pour les futurs exports</summary><label><input type="checkbox" data-segment-field="beforeEnabled"> Alerte avant</label><label>Distance avant · m<input type="number" min="0" step="any" inputmode="decimal" data-segment-field="beforeM" aria-label="Distance d’alerte avant le segment en mètres"></label><label><input type="checkbox" data-segment-field="atStart"> Alerte au début</label><label><input type="checkbox" data-segment-field="atEnd"> Alerte à la fin</label></details>
  <div class="race-segments__actions"><button type="button" class="button" data-segment-save>Enregistrer</button><button type="button" class="button button--quiet" data-segment-cancel>Annuler</button><button type="button" class="button button--quiet" data-segment-delete hidden>Supprimer</button></div>
  <div data-segment-delete-confirm hidden><p>Supprimer ce segment ?</p><button type="button" class="button button--quiet" data-segment-delete-yes>Confirmer la suppression</button><button type="button" class="button button--quiet" data-segment-delete-no>Conserver</button></div>
  </div></section>`
}

export interface RaceSegmentsEditorOptions {
  readonly idFactory: () => string
  readonly save: (change: RaceSegmentChange, expectedFingerprint: string) => Promise<void>
  readonly mapModel: RouteMapModel | null
  readonly mountPicker?: (container: HTMLElement, model: RouteMapModel, onTileError: () => void) => RoutePickerHandle | null
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
  const mapPanel = host.querySelector<HTMLElement>('[data-segment-map-panel]')!
  const mapChoices = host.querySelector<HTMLElement>('[data-segment-map-choices]')!
  let current: RaceSegment | null = null, id = '', picked: 'start' | 'end' | null = null, saving = false, automaticName = false
  let start = NaN, end = NaN, timer: ReturnType<typeof setTimeout> | undefined, picker: RoutePickerHandle | null = null
  const boundsEditor = profile.querySelector<HTMLDetailsElement>('[data-race-editor]')
  const read = (): RaceSegmentFields => ({ type: field('type').value as RaceSegmentFields['type'], name: field('name').value,
    startOffsetM: start, endOffsetM: end, alerts: { beforeEnabled: field('beforeEnabled').checked, beforeM: field('beforeM').valueAsNumber, atStart: field('atStart').checked, atEnd: field('atEnd').checked } })
  const draft = (): RaceSegment => ({ ...read(), id, routeFingerprint: course.fingerprint,
    provenance: current?.provenance ?? { sourceType: 'user', sourceId: null, fetchedAt: null, engineVersion: 'race-segments@1', confidence: 'high', manuallyOverridden: true } })
  const paint = (values: readonly RaceSegment[] = segments, draftId?: string) => {
    profile.querySelector('[data-race-segment-bands]')?.remove()
    profile.querySelector('.elevation-profile')?.insertAdjacentHTML('afterbegin', renderRaceSegmentBands(course, values, draftId))
  }
  const setInputs = () => {
    for (const [key, value] of [['start', start], ['end', end]] as const) field(key).value = Number.isFinite(value) ? (value / 1000).toFixed(6).replace(/\.?0+$/, '') : ''
  }
  const setPicked = (value: typeof picked) => {
    picked = value
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-segment-pick]')) button.setAttribute('aria-pressed', String(button.dataset.segmentPick === value))
  }
  const close = () => {
    clearTimeout(timer); picker?.destroy(); picker = null; mapPanel.hidden = true; mapChoices.innerHTML = ''
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
  const chooseOffset = (offsetM: number, confirm = false) => {
    if (picked === null || saving) return
    if (picked === 'start') start = offsetM; else end = offsetM
    if (picker !== null) {
      const projected = pointAtIndexedDistance(course.indexed, offsetM / 1000)
      picker.handle.setTemporaryMarker(projected.latitude, projected.longitude)
    }
    setInputs(); update()
    live.textContent = `${picked === 'start' ? 'Début' : 'Fin'} au km ${km(offsetM)}. ${picked === 'start' ? 'Placez ensuite la fin.' : 'Enregistrez pour confirmer.'}`
    mapChoices.innerHTML = ''
    if (confirm) setPicked(null)
  }
  const open = (segment: RaceSegment | null) => {
    close(); current = segment; id = segment?.id ?? options.idFactory(); automaticName = segment === null
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
  profile.addEventListener('profile-distance-active', event => { if (!editor.hidden) chooseOffset((event as CustomEvent<{ distanceKm: number }>).detail.distanceKm * 1000) }, { signal })
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
    if (key === 'start' || key === 'end') { setPicked(null); if (key === 'start') start = field('start').valueAsNumber * 1000; else end = field('end').valueAsNumber * 1000 }
    if (key === 'name') automaticName = false
    if (key === 'type' && automaticName) field('name').value = `${RACE_SEGMENT_STYLE[read().type].label} ${segments.filter(value => value.type === read().type).length + 1}`
    update()
  }, { signal })
  profile.addEventListener('click', event => {
    if (!(event.target instanceof Element) || saving) return
    const target = event.target
    const editId = target.closest<HTMLElement>('[data-segment-edit]')?.dataset.segmentEdit
    if (editId !== undefined) { const segment = segments.find(value => value.id === editId); if (segment !== undefined) open(segment); return }
    if (!host.contains(target)) return
    if (target.closest('[data-segment-add]')) { open(null); return }
    if (target.closest('[data-segment-cancel]')) { close(); return }
    const pick = target.closest<HTMLElement>('[data-segment-pick]')?.dataset.segmentPick
    if (pick === 'start' || pick === 'end') { setPicked(pick); live.textContent = `Touchez le profil ou la carte pour placer ${pick === 'start' ? 'le début' : 'la fin'}.`; return }
    const offset = target.closest<HTMLElement>('[data-segment-projection]')?.dataset.segmentProjection
    if (offset !== undefined) { chooseOffset(Number(offset), true); return }
    if (target.closest('[data-segment-save]')) { void commit(false); return }
    if (target.closest('[data-segment-delete]')) { host.querySelector<HTMLElement>('[data-segment-delete-confirm]')!.hidden = false; return }
    if (target.closest('[data-segment-delete-no]')) { host.querySelector<HTMLElement>('[data-segment-delete-confirm]')!.hidden = true; return }
    if (target.closest('[data-segment-delete-yes]') && current !== null) { void commit(true); return }
    if (!target.closest('[data-segment-map]')) return
    if (picker !== null) { picker.destroy(); picker = null; mapPanel.hidden = true; return }
    if (options.mountPicker === undefined || options.mapModel === null) { live.textContent = 'Utilisez le profil ou les kilomètres pour placer cette limite.'; return }
    mapPanel.hidden = false
    picker = options.mountPicker(host.querySelector<HTMLElement>('[data-segment-map-canvas]')!, options.mapModel, () => { host.querySelector<HTMLElement>('[data-segment-map-fallback]')!.hidden = false })
    if (picked === null) setPicked('start')
    picker?.handle.onMapClick((latitude, longitude) => {
      if (picked === null || saving) return
      const candidates = projectRacePosition(course, { latitude, longitude })
      mapChoices.innerHTML = ''
      if (candidates.length === 0) { live.textContent = 'Touchez plus près de la trace, zoomez ou utilisez le profil.'; return }
      if (candidates.length > 8) { live.textContent = 'Trop de passages proches : choisissez le kilomètre sur le profil.'; return }
      if (candidates.length === 1) { chooseOffset(candidates[0]!.offsetM, true); return }
      live.textContent = 'Plusieurs passages sont proches. Choisissez le kilomètre voulu.'
      mapChoices.innerHTML = candidates.map(value => `<button type="button" class="button button--quiet" data-segment-projection="${value.offsetM}">Passage au km ${km(value.offsetM)}</button>`).join('')
    })
  }, { signal })
  paint()
  return () => { clearTimeout(timer); controller.abort(); picker?.destroy(); picker = null }
}
