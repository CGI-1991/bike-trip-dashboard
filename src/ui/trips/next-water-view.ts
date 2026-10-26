import { nextWaterAt, prepareNextWater } from '../../practical-places/next-water.ts'
import type { PracticalPlaceViewModel } from '../../practical-places/view-model.ts'
import type { TravelMode } from '../../trip-core/index.ts'
import { buildDirectionsUrl } from '../bicycle-directions.ts'
import { tripIcon } from '../icons.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'

const controllers = new WeakMap<HTMLElement, AbortController>()
const rendered = new WeakMap<HTMLElement, string>()
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const km = (value: number) => value.toFixed(1).replace('.', ',')

export function renderNextWater(points: readonly PracticalPlaceViewModel[], fromKm: number, travelMode: TravelMode, badge = renderFeatureUpdateBadge('next-water')): string {
  const next = nextWaterAt(points, fromKm)
  const origin = fromKm <= 1e-6 ? 'Depuis le départ GPX' : `Depuis le km ${km(fromKm)}`
  const heading = `<div class="next-water__heading"><span>Eau indiquée potable</span>${badge}</div>`
  if (next === null) return `${heading}<span>${origin}</span><p>Aucun point potable identifié plus loin.</p>`
  const { place } = next
  const gap = Math.max(0, place.trackDistanceKm! - fromKm)
  const offset = place.detourKm === null ? '' : ` · à ~${Math.round(place.detourKm * 1000)} m du tracé`
  return `${heading}<span>${origin}</span><a class="next-water__point" href="${escape(buildDirectionsUrl(place, null, travelMode))}" target="_blank" rel="noopener"><span><strong>${escape(next.displayName)}</strong><span>Dans ${km(gap)} km · Passage ${escape(next.passageClockTimeLabel ?? '—')}${offset}</span></span>${tripIcon('location')}<span class="visually-hidden">Itinéraire vers ce point</span></a><small>${place.usefulTags?.fee === 'yes' ? 'Payant · ' : ''}Disponibilité à vérifier</small>`
}

export function mountNextWater(host: HTMLElement, profile: HTMLElement, points: readonly PracticalPlaceViewModel[], routeLengthKm: number, travelMode: TravelMode): void {
  controllers.get(host)?.abort()
  const controller = new AbortController()
  controllers.set(host, controller)
  const prepared = prepareNextWater(points, routeLengthKm)
  // Empty saved lists stay quiet; uncertain legacy water remains in Services.
  host.hidden = !points.some(point => point.place.category === 'water' && !point.place.hidden)
  let previousDistance: number | null = null
  const paint = (fromKm: number): void => {
    if (fromKm === previousDistance) return
    previousDistance = fromKm
    host.dataset.waterFromKm = String(fromKm)
    if (host.hidden) return
    const html = renderNextWater(prepared, fromKm, travelMode)
    if (rendered.get(host) !== html) { host.innerHTML = html; rendered.set(host, html) }
  }
  paint(Number(host.dataset.waterFromKm ?? 0))
  profile.addEventListener('profile-distance-active', event => paint((event as CustomEvent<{ distanceKm: number }>).detail.distanceKm), { signal: controller.signal })
  profile.addEventListener('profile-sample-cleared', () => paint(0), { signal: controller.signal })
}
