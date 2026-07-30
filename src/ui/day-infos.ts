import { findColImage } from '../trip/col-images.ts'
import type { RoadbookDayMatchReport } from '../trip/roadbook-match.ts'
import type { RoadbookClimb } from '../trip/roadbook-types.ts'

const decimalFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})
const integerFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0,
})

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function list(values: readonly string[], empty: string): string {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  return unique.length === 0 ? `<p>${escapeHtml(empty)}</p>` : `<ul>${unique.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
}

function descriptions(values: readonly { readonly description: string }[]): readonly string[] {
  return values.map(({ description }) => description)
}

function renderClimb(climb: RoadbookClimb): string {
  const image = findColImage(climb.name)
  const body = `<header><strong>${escapeHtml(climb.name)}</strong><span>${integerFormatter.format(climb.elevationM)} m</span></header><dl><div><dt>Montée</dt><dd>${decimalFormatter.format(climb.distanceKm)} km</dd></div><div><dt>D+</dt><dd>${integerFormatter.format(climb.elevationGainM)} m</dd></div><div><dt>Pente moyenne</dt><dd>${decimalFormatter.format(climb.averageGradientPercent)} %</dd></div></dl>`
  if (image === null) return `<li class="day-infos__col">${body}</li>`
  return `<li class="day-infos__col day-infos__col--clickable"><button type="button" class="day-infos__col-trigger" data-col-image-trigger data-col-name="${escapeHtml(climb.name)}" data-col-image-url="${escapeHtml(image.imageUrl)}" data-col-image-source="${escapeHtml(image.sourceLabel)}" aria-label="Voir le profil du ${escapeHtml(climb.name)}">${body}</button></li>`
}

function renderClimbs(climbs: readonly RoadbookClimb[]): string {
  if (climbs.length === 0) return ''
  return `<section class="day-infos__section day-infos__cols" aria-labelledby="day-infos-cols-title"><h4 id="day-infos-cols-title">Cols du jour</h4><ol class="day-infos__col-list">${climbs.map(renderClimb).join('')}</ol></section>`
}

export function renderDayInfosLoading(container: HTMLElement): void {
  container.innerHTML = '<p role="status">Chargement des informations…</p>'
}

export function renderDayInfosError(container: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Informations indisponibles.'
  container.innerHTML = `<p role="alert">${escapeHtml(message)}</p>`
}

export function renderDayInfos(container: HTMLElement, day: RoadbookDayMatchReport): void {
  const roadbook = day.roadbook
  if (roadbook.type === 'ride') {
    const usefulNotes = [...roadbook.notes, ...(roadbook.variant === null ? [] : [`Variante : ${roadbook.variant}`])]
    container.innerHTML = `<section class="day-infos__section"><p class="eyebrow">Esprit de l’étape</p><p>${escapeHtml(roadbook.ambiance)}</p></section>${renderClimbs(roadbook.cols ?? [])}<section class="day-infos__section"><h4>Notes utiles</h4>${list(usefulNotes, 'Aucune note complémentaire documentée.')}</section>`
    return
  }
  const usefulNotes = [...descriptions(roadbook.activities), ...descriptions(roadbook.recovery), ...descriptions(roadbook.logistics), ...roadbook.notes]
  container.innerHTML = `<section class="day-infos__section"><p class="eyebrow">Esprit de la journée OFF</p><p>${escapeHtml(roadbook.ambiance)}</p></section><section class="day-infos__section"><h4>Notes utiles</h4>${list(usefulNotes, 'Aucune note complémentaire documentée.')}</section>`
}
