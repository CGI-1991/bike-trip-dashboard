import type { RelativeWindReading, RouteWindModel, RouteWindSummary } from '../weather/relative-wind.ts'
import { headwindColor, relativeWindLabel } from '../weather/relative-wind.ts'
import { classifyClimbGrade } from '../analysis/climb-profile.ts'
import type { ProfileSample } from './elevation-profile.ts'
import { renderFeatureUpdateBadge } from './release-notes.ts'
import type { TravelMode } from '../trip-core/model/settings.ts'

type ProfileMode = 'neutral' | 'grade' | 'wind'
const MODE_KEY = 'bike-trip-dashboard:profile-color-mode'

function preferredMode(): ProfileMode {
  try { const mode = localStorage.getItem(MODE_KEY); return mode === 'grade' || mode === 'wind' ? mode : 'neutral' } catch { return 'neutral' }
}

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

export function renderProfileWindControls(): string {
  return `<div class="profile-modes"><div role="group" aria-label="Coloration du profil"><button type="button" data-profile-mode="neutral" aria-pressed="true">Neutre</button><button type="button" data-profile-mode="grade" aria-pressed="false">Pente</button><button type="button" data-profile-mode="wind" aria-pressed="false">Vent</button></div>${renderFeatureUpdateBadge('relative-wind')}</div><p class="profile-color-legend" data-profile-color-legend></p>`
}

export function formatRouteWindSummary(stats: RouteWindSummary | null): string {
  if (stats === null || stats.mean === null) return 'Prévisions de vent indisponibles pour la date du voyage.'
  const percent = (value: number) => Math.round(value * 100)
  return `Par distance : ${percent(stats.headwindFraction)} % face · ${percent(stats.tailwindFraction)} % dos · ${percent(stats.crosswindFraction)} % latéral${stats.calmFraction > 0.005 ? ` · ${percent(stats.calmFraction)} % calme` : ''}. Estimation sur ${percent(stats.coveredFraction)} % du parcours. Cap lissé sur 100 m ; prévisions interpolées entre points météo, espacés jusqu’à ${stats.mean.maximumWeatherGapKm.toFixed(1).replace('.', ',')} km.${stats.maximumCrosswindGustsKph === null ? '' : ` Rafales latérales estimées jusqu’à ${Math.round(stats.maximumCrosswindGustsKph)} km/h, selon la direction du vent moyen.`}`
}

const GRADE_COLORS = {
  'climb-0-1': '#a1cfa4', 'climb-1-4': '#6bae6e', 'climb-4-8': '#e4c64e', 'climb-8-12': '#e78b39', 'climb-12-plus': '#bd4444',
  'descent-0-7': '#b4b8d7', 'descent-7-plus': '#7568a4',
} as const

interface WindProfileHandle {
  update(model: RouteWindModel | null, travelMode: TravelMode): void
  select(distanceKm: number | null): void
  destroy(): void
}
const handles = new WeakMap<HTMLElement, WindProfileHandle>()

export function updateProfileWind(container: HTMLElement, model: RouteWindModel | null, travelMode: TravelMode = 'cycling'): void { handles.get(container)?.update(model, travelMode) }
export function selectProfileWind(container: HTMLElement, distanceKm: number | null): void { handles.get(container)?.select(distanceKm) }

export function installProfileWindControls(container: HTMLElement, samples: readonly ProfileSample[], bounds: {
  readonly total: number
  readonly x: (km: number) => number
  readonly y: (altitude: number) => number
}): void {
  if (typeof container.querySelector !== 'function') return
  handles.get(container)?.destroy()
  const svg = container.querySelector<SVGSVGElement>('[data-profile-interactive]')
  const bands = container.querySelector<SVGGElement>('[data-profile-color-bands]')
  const area = container.querySelector<SVGPathElement>('.profile-area')
  const legend = container.querySelector<HTMLElement>('[data-profile-color-legend]')
  const readout = container.querySelector<HTMLElement>('[data-profile-wind]')
  const summary = container.querySelector<HTMLElement>('[data-route-wind-summary]')
  const selectedDetails = container.querySelector<HTMLElement>('[data-selected-wind-details]')
  if (svg === null || bands === null || area === null || legend === null || readout === null || summary === null) return
  const controller = new AbortController()
  let mode = preferredMode()
  let wind: RouteWindModel | null = null
  let travelMode: TravelMode = 'cycling'
  let selected: number | null = null
  const renderReadout = () => {
    const reading = selected === null ? wind?.summary.mean ?? null : wind?.at(selected) ?? null
    const title = selected === null ? 'Vent moyen du parcours' : `Vent vers le km ${selected.toFixed(1).replace('.', ',')}`
    readout.innerHTML = `<p class="profile-wind__title">${title}</p>${renderRelativeWind(reading, false, travelMode)}`
    if (selectedDetails !== null) selectedDetails.textContent = reading === null ? ''
      : `${reading.headwindKph >= 0 ? 'Face' : 'Dos'} ${Math.round(Math.abs(reading.headwindKph))} · latéral ${Math.round(Math.abs(reading.crosswindKph))} km/h${reading.gustsKph === null ? '' : ` · rafales jusqu’à ${Math.round(reading.gustsKph)} km/h`}.`
  }
  function paint(): void {
    area!.style.opacity = mode === 'neutral' ? '1' : '0'
    bands!.innerHTML = mode === 'neutral' ? '' : samples.slice(1).map((point, i) => {
      const previous = samples[i]!
      const km = (previous.distanceKm + point.distanceKm) / 2
      const reading = wind?.at(km) ?? null
      const color = mode === 'grade' ? GRADE_COLORS[classifyClimbGrade((previous.smoothedGradePercent + point.smoothedGradePercent) / 2)] : headwindColor(reading)
      return `<path d="M${bounds.x(previous.distanceKm).toFixed(1)},${bounds.y(previous.altitudeM).toFixed(1)} L${bounds.x(point.distanceKm).toFixed(1)},${bounds.y(point.altitudeM).toFixed(1)} L${bounds.x(point.distanceKm).toFixed(1)},214 L${bounds.x(previous.distanceKm).toFixed(1)},214 Z" fill="${color}"/>`
    }).join('')
    legend!.textContent = mode === 'neutral' ? '' : mode === 'grade'
      ? 'Pente : vert → rouge · descentes en violet.'
      : 'Bleu plus foncé = vent de face plus fort · gris = inconnu ou variable.'
    for (const button of container.querySelectorAll<HTMLElement>('[data-profile-mode]')) button.setAttribute('aria-pressed', String(button.dataset.profileMode === mode))
  }
  function update(model: RouteWindModel | null, nextTravelMode: TravelMode = 'cycling'): void {
    wind = model
    travelMode = nextTravelMode
    renderReadout()
    const stats = wind?.summary
    summary!.textContent = formatRouteWindSummary(stats ?? null)
    if (mode === 'wind') paint()
  }
  container.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return
    const value = event.target.closest<HTMLElement>('[data-profile-mode]')?.dataset.profileMode
    if (value !== 'neutral' && value !== 'grade' && value !== 'wind') return
    mode = value
    try { localStorage.setItem(MODE_KEY, mode) } catch { /* Session use still works. */ }
    paint()
  }, { signal: controller.signal })
  handles.set(container, { update, select(km) { selected = km; renderReadout() }, destroy() { controller.abort() } })
  paint()
  update(null)
}
