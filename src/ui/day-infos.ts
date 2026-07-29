import type { RoadbookDayMatchReport } from '../trip/roadbook-match.ts'

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
    container.innerHTML = `<section class="day-infos__section"><p class="eyebrow">Esprit de l’étape</p><p>${escapeHtml(roadbook.ambiance)}</p></section><section class="day-infos__section"><h4>Notes utiles</h4>${list(usefulNotes, 'Aucune note complémentaire documentée.')}</section>`
    return
  }
  const usefulNotes = [...descriptions(roadbook.activities), ...descriptions(roadbook.recovery), ...descriptions(roadbook.logistics), ...roadbook.notes]
  container.innerHTML = `<section class="day-infos__section"><p class="eyebrow">Esprit de la journée OFF</p><p>${escapeHtml(roadbook.ambiance)}</p></section><section class="day-infos__section"><h4>Notes utiles</h4>${list(usefulNotes, 'Aucune note complémentaire documentée.')}</section>`
}
