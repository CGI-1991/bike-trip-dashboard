import type { TripDayId } from './types.ts'

export type AccommodationType = 'hotel' | 'airbnb' | 'gite' | 'chambre-hotes' | 'hostel'

export interface Accommodation {
  readonly id: string
  readonly dayIds: readonly TripDayId[]
  readonly name: string
  readonly type: AccommodationType
  readonly address: string
  readonly website?: string
  readonly latitude?: number
  readonly longitude?: number
  readonly confirmed: true
}

interface AccommodationDocument { readonly version: 1; readonly tripId: 'rga-2026'; readonly accommodations: readonly Accommodation[] }
const typeLabels: Record<AccommodationType, string> = { hotel: 'Hôtel', airbnb: 'Airbnb', gite: 'Gîte', 'chambre-hotes': 'Chambre d’hôtes', hostel: 'Auberge de jeunesse' }

function publicUrl(path: string): string { const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`; return `${base}${path}` }

export async function loadAccommodations(fetcher: typeof fetch = fetch): Promise<readonly Accommodation[]> {
  const response = await fetcher(publicUrl('data/trip/accommodations.json'))
  if (!response.ok) throw new Error(`Hébergements inaccessibles (HTTP ${response.status}).`)
  const document = await response.json() as AccommodationDocument
  if (document.version !== 1 || document.tripId !== 'rga-2026' || !Array.isArray(document.accommodations)) throw new Error('Source des hébergements invalide.')
  return document.accommodations
}

export function getAccommodationForDay(accommodations: readonly Accommodation[], dayId: TripDayId): Accommodation | null { return accommodations.find(({ dayIds }) => dayIds.includes(dayId)) ?? null }
export function getAccommodationMapsUrl(accommodation: Accommodation): string { const query = accommodation.latitude === undefined || accommodation.longitude === undefined ? accommodation.address : `${accommodation.latitude},${accommodation.longitude}`; return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }

export function renderAccommodation(container: HTMLElement, accommodation: Accommodation | null): void {
  if (accommodation === null) { container.innerHTML = ''; container.hidden = true; return }
  container.hidden = false
  container.innerHTML = `<section class="accommodation-card" data-accommodation-id="${escapeHtml(accommodation.id)}"><p class="eyebrow">Hébergement confirmé</p><h4>${escapeHtml(accommodation.name)}</h4><p>${escapeHtml(typeLabels[accommodation.type])}</p><address>${escapeHtml(accommodation.address)}</address><div class="accommodation-card__actions"><a class="button button--primary" href="${escapeHtml(getAccommodationMapsUrl(accommodation))}" target="_blank" rel="noopener noreferrer">Ouvrir dans Maps</a>${accommodation.website === undefined ? '' : `<a class="button button--quiet" href="${escapeHtml(accommodation.website)}" target="_blank" rel="noopener noreferrer" aria-label="Voir le site de ${escapeHtml(accommodation.name)}">Voir le site</a>`}</div></section>`
}
