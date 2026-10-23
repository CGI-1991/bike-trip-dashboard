import type { RelativeWindReading, RouteWindModel, RouteWindSummary } from '../weather/relative-wind.ts'
import { headwindColor, relativeWindLabel } from '../weather/relative-wind.ts'
import { classifyClimbGrade } from '../analysis/climb-profile.ts'
import type { ProfileSample } from './elevation-profile.ts'
import { renderFeatureUpdateBadge } from './release-notes.ts'

type ProfileMode = 'neutral' | 'grade' | 'wind'
const MODE_KEY = 'bike-trip-dashboard:profile-color-mode'

function preferredMode(): ProfileMode {
  try { const mode = localStorage.getItem(MODE_KEY); return mode === 'grade' || mode === 'wind' ? mode : 'neutral' } catch { return 'neutral' }
}

function compass(reading: RelativeWindReading | null): string {
  const arrow = reading?.relativeFromDeg === null || reading?.relativeFromDeg === undefined ? ''
    : `<g transform="rotate(${reading.relativeFromDeg.toFixed(1)} 32 32)" class="relative-wind__arrow"><path d="M32 3V14m-4-4 4 4 4-4"/></g>`
  return `<svg class="relative-wind__compass" viewBox="0 0 64 64" aria-hidden="true"><circle class="relative-wind__ring" cx="32" cy="32" r="27"/>${arrow}<g class="relative-wind__rider"><path d="M32 18v6m0 16v7M24 27h16M25 34l4-5h6l4 5M29 37l-4 7m10-7 4 7"/><circle cx="32" cy="27" r="3"/><path d="M32 31v8"/></g></svg>`
}

/** Arrow sits on the incoming side and follows airflow towards the rider.
 * Rider always travels up; the text removes meteorological FROM ambiguity. */
export function renderRelativeWind(reading: RelativeWindReading | null, compact = false): string {
  if (reading === null) return `<span class="relative-wind relative-wind--unknown">${compact ? '' : compass(null)}<span>Vent relatif indisponible</span></span>`
  const component = reading.headwindKph >= 0 ? `Face ${Math.round(reading.headwindKph)}` : `Dos ${Math.round(-reading.headwindKph)}`
  const details = `${component} · latéral ${Math.round(Math.abs(reading.crosswindKph))} km/h${reading.coverage < 0.001 ? ' · prévision au point' : reading.coverage < 0.9 ? ' · moyenne partielle' : ''}`
  return `<span class="relative-wind${compact ? ' relative-wind--compact' : ''}">${compass(reading)}<span><strong>${relativeWindLabel(reading)}</strong><span class="relative-wind__detail">${reading.kind === 'directional' ? details : `${Math.round(reading.speedKph)} km/h en moyenne`}${compact || reading.gustsKph === null ? '' : ` · rafales jusqu’à ${Math.round(reading.gustsKph)} km/h`}</span></span></span>`
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
  update(model: RouteWindModel | null): void
  select(distanceKm: number | null): void
  destroy(): void
}
const handles = new WeakMap<HTMLElement, WindProfileHandle>()

export function updateProfileWind(container: HTMLElement, model: RouteWindModel | null): void { handles.get(container)?.update(model) }
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
  if (svg === null || bands === null || area === null || legend === null || readout === null || summary === null) return
  const controller = new AbortController()
  let mode = preferredMode()
  let wind: RouteWindModel | null = null
  let selected: number | null = null
  const renderReadout = () => {
    const reading = selected === null ? wind?.summary.mean ?? null : wind?.at(selected) ?? null
    const title = selected === null ? 'Vent moyen du parcours' : `Vent vers le km ${selected.toFixed(1).replace('.', ',')}`
    readout.innerHTML = `<p class="profile-wind__title">${title}</p>${renderRelativeWind(reading)}<p class="profile-wind__orientation">↑ sens de roulage · flèche = déplacement de l’air</p>`
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
    legend!.textContent = mode === 'neutral' ? 'Profil sans coloration.' : mode === 'grade'
      ? 'Pente : vert 0–4 %, jaune 4–8 %, orange 8–12 %, rouge ≥12 %. Descente en violet.'
      : 'Bleu clair → foncé : composante de face <1 / 1–5 / 5–10 / 10–20 / 20–30 / ≥30 km/h. Gris : estimation indisponible ou variable. Le vent latéral est indiqué séparément.'
    for (const button of container.querySelectorAll<HTMLElement>('[data-profile-mode]')) button.setAttribute('aria-pressed', String(button.dataset.profileMode === mode))
  }
  function update(model: RouteWindModel | null): void {
    wind = model
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
