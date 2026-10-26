import type { GeographicWindReading, RelativeWindReading, RouteWindModel } from '../weather/relative-wind.ts'
import { headwindColor, relativeWindLabel } from '../weather/relative-wind.ts'
import { profileGradeColor } from './profile-grade-colors.ts'
import type { ProfileSample } from './elevation-profile.ts'
import { renderFeatureUpdateBadge } from './release-notes.ts'
import type { TravelMode } from '../trip-core/model/settings.ts'
import { aggregateProfileBands } from './profile-display-bands.ts'

type ProfileMode = 'neutral' | 'grade' | 'wind'

function compass(reading: RelativeWindReading | null, travelMode: TravelMode): string {
  const arrow = reading?.relativeFromDeg === null || reading?.relativeFromDeg === undefined ? ''
    : `<g transform="rotate(${reading.relativeFromDeg.toFixed(1)} 32 32)" class="relative-wind__arrow"><path d="M32 3V14m-4-4 4 4 4-4"/></g>`
  const traveller = travelMode === 'walking'
    ? '<g class="relative-wind__rider relative-wind__walker"><circle cx="32" cy="21" r="4"/><path d="M32 27v11m0-10-7 7m7-7 7 7m-7 3-6 10m6-10 6 10M27 28v9h10v-9"/></g>'
    : '<g class="relative-wind__rider relative-wind__bike"><path class="relative-wind__wheels" d="M32 20v6m0 13v6"/><path d="M32 28v10m-7-6v-3h14v3m-10 3h6"/></g>'
  return `<svg class="relative-wind__compass" viewBox="0 0 64 64" aria-hidden="true"><title>↑ ${travelMode === 'walking' ? 'sens de marche' : 'sens de roulage'} · flèche = déplacement de l’air</title><circle class="relative-wind__ring" cx="32" cy="32" r="27"/>${arrow}${traveller}</svg>`
}

/** Arrow sits on the incoming side and follows airflow towards the rider.
 * Rider always travels up; the text removes meteorological FROM ambiguity. */
export function renderRelativeWind(reading: RelativeWindReading | null, compact = false, travelMode: TravelMode = 'cycling'): string {
  if (reading === null) return '<span class="relative-wind relative-wind--unknown"><span>Vent indisponible</span></span>'
  const qualifier = reading.coverage < 0.001 ? ' · au point' : reading.coverage < 0.9 ? ' · partiel' : ''
  return `<span class="relative-wind${compact ? ' relative-wind--compact' : ''}" aria-label="${relativeWindLabel(reading)}, ${Math.round(reading.speedKph)} km/h${qualifier}">${compass(reading, travelMode)}<span><strong>${relativeWindLabel(reading)}</strong><span class="relative-wind__detail">${Math.round(reading.speedKph)} km/h${qualifier}</span></span></span>`
}

/** Compact stage stat; cardinal directions describe where the air comes from. */
export function renderStageWindStat(reading: GeographicWindReading | null): string {
  if (reading === null) return '<span aria-label="Vent moyen indisponible">—</span>'
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
  const label = reading.kind === 'calm' ? 'calme' : reading.kind === 'variable' || reading.fromDeg === null ? 'variable' : directions[Math.round(reading.fromDeg / 45) % 8]!
  const partial = reading.coverage < .9 ? ' · partiel' : ''
  return `<span aria-label="Vent moyen${reading.kind === 'directional' ? ' provenant de' : ''} ${label}, ${Math.round(reading.speedKph)} kilomètres par heure${partial}">${Math.round(reading.speedKph)} km/h · ${label}${partial}</span>`
}

export function renderProfileWindControls(windEnabled = true): string {
  return `<div class="profile-modes"><div role="group" aria-label="Coloration du profil"><button type="button" data-profile-mode="neutral" aria-pressed="true">Neutre</button><button type="button" data-profile-mode="grade" aria-pressed="false">Pente</button>${windEnabled ? '<button type="button" data-profile-mode="wind" aria-pressed="false">Vent</button>' : ''}</div>${renderFeatureUpdateBadge(windEnabled ? 'relative-wind' : 'elevation-profile')}</div><p class="profile-color-legend" data-profile-color-legend></p>`
}


interface WindProfileHandle {
  update(model: RouteWindModel | null, travelMode: TravelMode): void
  select(distanceKm: number | null): void
  destroy(): void
}
const handles = new WeakMap<HTMLElement, WindProfileHandle>()
export function disposeProfileWind(container:HTMLElement):void { handles.get(container)?.destroy();handles.delete(container) }

export function updateProfileWind(container: HTMLElement, model: RouteWindModel | null, travelMode: TravelMode = 'cycling'): void { handles.get(container)?.update(model, travelMode) }
export function selectProfileWind(container: HTMLElement, distanceKm: number | null): void { handles.get(container)?.select(distanceKm) }

export function installProfileWindControls(container: HTMLElement, samples: readonly ProfileSample[], bounds: {
  readonly total: number
  readonly x: (km: number) => number
  readonly y: (altitude: number) => number
}, windEnabled = true): void {
  if (typeof container.querySelector !== 'function') return
  handles.get(container)?.destroy()
  const svg = container.querySelector<SVGSVGElement>('[data-profile-interactive]')
  const bands = container.querySelector<SVGGElement>('[data-profile-color-bands]')
  const area = container.querySelector<SVGPathElement>('.profile-area')
  const legend = container.querySelector<HTMLElement>('[data-profile-color-legend]')
  const readout = container.querySelector<HTMLElement>('[data-profile-wind]')
  const controls = container.querySelector<HTMLElement>('.profile-modes')
  if (svg === null || bands === null || area === null || legend === null) return
  const controller = new AbortController()
  let mode: ProfileMode = 'neutral'
  let wind: RouteWindModel | null = null
  let travelMode: TravelMode = 'cycling'
  let selected: number | null = null
  let editing = container.dataset?.courseEditing === 'true'
  const renderReadout = () => {
    if (!windEnabled || readout === null) return
    const reading = selected === null ? null : wind?.at(selected) ?? null
    readout.innerHTML = `<div data-profile-selected-wind aria-label="${reading === null ? 'Vent indisponible au point exploré' : `${relativeWindLabel(reading)}, ${Math.round(reading.speedKph)} km/h`}">${compass(reading, travelMode)}<span>${reading === null ? '—' : Math.round(reading.speedKph)}<small>km/h</small>${reading !== null && reading.coverage < .9 ? '<small>partiel</small>' : ''}</span></div>`
  }
  function paint(): void {
    const displayed = editing ? 'neutral' : mode
    if (container.dataset) container.dataset.profileColorMode = displayed
    if (controls !== null) controls.hidden = editing
    legend!.hidden = editing
    area!.style.opacity = displayed === 'neutral' ? '1' : '0'
    const intervals = aggregateProfileBands(samples.slice(1).map((point, i) => ({ startDistanceKm: samples[i]!.distanceKm, endDistanceKm: point.distanceKm, averageGradientPercent: (samples[i]!.smoothedGradePercent + point.smoothedGradePercent) / 2 })), svg!.getBoundingClientRect?.().width ?? 320)
    bands!.innerHTML = displayed === 'neutral' ? '' : intervals.map(point => {
      const km = (point.startDistanceKm + point.endDistanceKm) / 2
      const reading = wind?.at(km, (point.endDistanceKm - point.startDistanceKm) * 1000) ?? null
      const color = displayed === 'grade' ? profileGradeColor(point.averageGradientPercent) : headwindColor(reading)
      return `<rect x="${bounds.x(point.startDistanceKm).toFixed(1)}" y="0" width="${(bounds.x(point.endDistanceKm) - bounds.x(point.startDistanceKm) + .1).toFixed(1)}" height="214" fill="${color}"/>`
    }).join('')
    legend!.textContent = displayed === 'neutral' ? '' : displayed === 'grade'
      ? 'Pente moyenne'
      : 'Vent de face : bleu foncé / gris : non estimé'
    for (const button of container.querySelectorAll<HTMLElement>('[data-profile-mode]')) button.setAttribute('aria-pressed', String(button.dataset.profileMode === displayed))
  }
  function update(model: RouteWindModel | null, nextTravelMode: TravelMode = 'cycling'): void {
    wind = model
    travelMode = nextTravelMode
    renderReadout()
    if (mode === 'wind') paint()
  }
  container.addEventListener('click', event => {
    if (editing) return
    if (!(event.target instanceof Element)) return
    const value = event.target.closest<HTMLElement>('[data-profile-mode]')?.dataset.profileMode
    if (value !== 'neutral' && value !== 'grade' && value !== 'wind') return
    if (!windEnabled && value === 'wind') return
    mode = value
    paint()
  }, { signal: controller.signal })
  container.addEventListener('course-editor-changed', () => {
    editing = container.dataset?.courseEditing === 'true'
    paint()
  }, { signal: controller.signal })
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(paint)
  observer?.observe(svg)
  handles.set(container, { update, select(km) { selected = km; renderReadout() }, destroy() { controller.abort(); observer?.disconnect() } })
  paint()
  update(null)
}
