import type { ClimbProfileSegment } from '../../analysis/climb-profile.ts'
import { profileGradeColor } from '../profile-grade-colors.ts'
import { aggregateProfileBands } from '../profile-display-bands.ts'
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;')
const formatKilometers = (value: number) => `${value.toFixed(1).replace('.', ',')} km`
function renderClimbProfileShape(segments: readonly ClimbProfileSegment[], id: string): string {
  const altitudes = segments.flatMap((segment) => [segment.startAltitudeM, segment.endAltitudeM]).filter((value): value is number => value !== null)
  if (altitudes.length === 0) return ''
  const minAltitude = Math.min(...altitudes)
  const maxAltitude = Math.max(...altitudes)
  const span = Math.max(maxAltitude - minAltitude, 1)
  const totalKm = Math.max((segments[segments.length - 1]?.endDistanceKm ?? 0) - (segments[0]?.startDistanceKm ?? 0), 0.001)
  const startKm = segments[0]?.startDistanceKm ?? 0
  const clipId = 'mini-profile-' + Array.from(id).map(c=>c.codePointAt(0)!.toString(16)).join('-')
  const width = 300
  const height = 130
  const x = (km: number): number => ((km - startKm) / totalKm) * width
  const y = (altitude: number): number => height - ((altitude - minAltitude) / span) * (height - 10) - 5

  const bands = aggregateProfileBands(segments, 300).map((segment) => {
    const x1 = x(segment.startDistanceKm)
    const x2 = x(segment.endDistanceKm)
    const color = profileGradeColor(segment.averageGradientPercent)
    return `<rect x="${x1.toFixed(1)}" y="0" width="${(x2-x1+.1).toFixed(1)}" height="${height}" fill="${color}"></rect>`
  }).join('')
  const outline = segments
    .filter((segment) => segment.startAltitudeM !== null)
    .map((segment, index) => `${index === 0 ? 'M' : 'L'}${x(segment.startDistanceKm).toFixed(1)},${y(segment.startAltitudeM as number).toFixed(1)}`)
    .join(' ')
  const last = segments[segments.length - 1]
  const outlineEnd = last?.endAltitudeM === null || last?.endAltitudeM === undefined ? '' : ` L${x(last.endDistanceKm).toFixed(1)},${y(last.endAltitudeM).toFixed(1)}`

  // Embedded once, read by `mountClimbProfileInteractions` — never a second
  // recomputation of the climb profile in the DOM-wiring layer.
  const interactionData = JSON.stringify(segments.map((segment) => [segment.startDistanceKm, segment.endDistanceKm, segment.startAltitudeM, segment.endAltitudeM, segment.averageGradientPercent]))

  return `<svg class="day-detail__climb-profile-shape" data-climb-profile-interactive tabindex="0" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Profil interactif de la montée" data-segments="${escapeHtml(interactionData)}" data-start-km="${startKm}"><defs><clipPath id="${clipId}"><path d="${outline}${outlineEnd} L${width},${height} L0,${height}Z"/></clipPath></defs><g data-climb-color-bands clip-path="url(#${clipId})">${bands}</g><path d="${outline}${outlineEnd}" fill="none" stroke="var(--forest-950, #102d28)" stroke-width="1.5"></path><g class="profile-cursor" data-profile-cursor hidden><line data-profile-cursor-line y1="0" y2="${height}"></line><circle data-profile-cursor-dot r="4"></circle></g></svg>`
}

/**
 * CDC Jalon C1 closeout: the colour-coded altimetric silhouette
 * (`renderClimbProfileShape`) already carries the same per-segment gradient
 * colouring — the horizontal colour-coded strip that used to render right
 * below it (`day-detail__climb-profile-bar`, one `<span>` per segment) was a
 * plain duplicate of the exact same information, just flattened. Removed
 * outright; the segmentation itself (`ClimbProfileSegment[]`, grade classes)
 * still drives the shape's colours and the interactive tooltip — only this
 * second, redundant visual is gone.
 */
export function renderClimbProfileBar(segments: readonly ClimbProfileSegment[], id = 'profile'): string {
  if (segments.length === 0) return '<p class="day-detail__climb-profile-empty">Profil indisponible pour cette montée.</p>'
  const first = segments[0]
  const last = segments[segments.length - 1]
  // `.elevation-profile__stage`/`.profile-tooltip` (CDC Jalon B4.4 section
  // 30) — the exact same positioning classes the main elevation profile
  // uses for its own interactive tooltip, reused here rather than a second,
  // parallel set of tooltip CSS.
  return `<div class="elevation-profile__stage">${renderClimbProfileShape(segments,id)}<div class="profile-tooltip" data-profile-tooltip hidden></div></div>
    <p class="visually-hidden" data-profile-live aria-live="polite"></p>
    <div class="day-detail__climb-profile-scale">
      <span>${formatKilometers(first?.startDistanceKm ?? 0)} · ${first?.startAltitudeM === null || first?.startAltitudeM === undefined ? '—' : `${Math.round(first.startAltitudeM)} m`}</span>
      <span>${formatKilometers(last?.endDistanceKm ?? 0)} · ${last?.endAltitudeM === null || last?.endAltitudeM === undefined ? '—' : `${Math.round(last.endAltitudeM)} m`}</span>
    </div>
    <p class="day-detail__climb-profile-caption">Touchez le profil pour explorer.</p>`
}


/** Repaint only the colours when a mini-profile is opened at its real width. */
export function paintClimbProfileBands(svg:SVGSVGElement):void {
  const bands=svg.querySelector<SVGGElement>('[data-climb-color-bands]')
  if(!bands)return
  let rows:readonly [number,number,number|null,number|null,number|null][]
  try{rows=JSON.parse(svg.dataset.segments??'[]')}catch{return}
  if(!rows.length)return
  const start=rows[0]![0],span=rows.at(-1)![1]-start
  if(span<=0)return
  bands.innerHTML=aggregateProfileBands(rows.map(r=>({startDistanceKm:r[0],endDistanceKm:r[1],averageGradientPercent:r[4]})),svg.getBoundingClientRect().width).map(r=>`<rect x="${((r.startDistanceKm-start)/span*300).toFixed(1)}" y="0" width="${((r.endDistanceKm-r.startDistanceKm)/span*300+.1).toFixed(1)}" height="130" fill="${profileGradeColor(r.averageGradientPercent)}"></rect>`).join('')
}
