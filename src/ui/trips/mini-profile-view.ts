import type { ClimbGradeClass, ClimbProfileSegment } from '../../analysis/climb-profile.ts'
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;')
const formatKilometers = (value: number) => `${value.toFixed(1).replace('.', ',')} km`
const GRADE_CLASS_COLORS: Readonly<Record<ClimbGradeClass, string>> = {
  'descent-7-plus': '#4f7f8f',
  'descent-0-7': '#7fa9a6',
  'climb-0-1': '#7fb35a',
  'climb-1-4': '#c9c24a',
  'climb-4-8': '#e2963a',
  'climb-8-12': '#cf4a3a',
  'climb-12-plus': '#7a2a52',
}
function renderClimbProfileShape(segments: readonly ClimbProfileSegment[]): string {
  const altitudes = segments.flatMap((segment) => [segment.startAltitudeM, segment.endAltitudeM]).filter((value): value is number => value !== null)
  if (altitudes.length === 0) return ''
  const minAltitude = Math.min(...altitudes)
  const maxAltitude = Math.max(...altitudes)
  const span = Math.max(maxAltitude - minAltitude, 1)
  const totalKm = Math.max((segments[segments.length - 1]?.endDistanceKm ?? 0) - (segments[0]?.startDistanceKm ?? 0), 0.001)
  const startKm = segments[0]?.startDistanceKm ?? 0
  const width = 300
  const height = 130
  const x = (km: number): number => ((km - startKm) / totalKm) * width
  const y = (altitude: number): number => height - ((altitude - minAltitude) / span) * (height - 10) - 5

  const bands = segments.map((segment) => {
    if (segment.startAltitudeM === null || segment.endAltitudeM === null) return ''
    const x1 = x(segment.startDistanceKm)
    const x2 = x(segment.endDistanceKm)
    const y1 = y(segment.startAltitudeM)
    const y2 = y(segment.endAltitudeM)
    const color = segment.gradeClass === null ? '#c7d2cc' : GRADE_CLASS_COLORS[segment.gradeClass]
    return `<polygon points="${x1.toFixed(1)},${height} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${height}" fill="${color}"></polygon>`
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

  return `<svg class="day-detail__climb-profile-shape" data-climb-profile-interactive tabindex="0" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Profil interactif de la montée" data-segments="${escapeHtml(interactionData)}" data-start-km="${startKm}">${bands}<path d="${outline}${outlineEnd}" fill="none" stroke="var(--forest-950, #102d28)" stroke-width="1.5"></path><g class="profile-cursor" data-profile-cursor hidden><line data-profile-cursor-line y1="0" y2="${height}"></line><circle data-profile-cursor-dot r="4"></circle></g></svg>`
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
export function renderClimbProfileBar(segments: readonly ClimbProfileSegment[]): string {
  if (segments.length === 0) return '<p class="day-detail__climb-profile-empty">Profil indisponible pour cette montée.</p>'
  const first = segments[0]
  const last = segments[segments.length - 1]
  // `.elevation-profile__stage`/`.profile-tooltip` (CDC Jalon B4.4 section
  // 30) — the exact same positioning classes the main elevation profile
  // uses for its own interactive tooltip, reused here rather than a second,
  // parallel set of tooltip CSS.
  return `<div class="elevation-profile__stage">${renderClimbProfileShape(segments)}<div class="profile-tooltip" data-profile-tooltip hidden></div></div>
    <p class="visually-hidden" data-profile-live aria-live="polite"></p>
    <div class="day-detail__climb-profile-scale">
      <span>${formatKilometers(first?.startDistanceKm ?? 0)} · ${first?.startAltitudeM === null || first?.startAltitudeM === undefined ? '—' : `${Math.round(first.startAltitudeM)} m`}</span>
      <span>${formatKilometers(last?.endDistanceKm ?? 0)} · ${last?.endAltitudeM === null || last?.endAltitudeM === undefined ? '—' : `${Math.round(last.endAltitudeM)} m`}</span>
    </div>
    <p class="day-detail__climb-profile-caption">Touchez le profil pour explorer.</p>`
}

