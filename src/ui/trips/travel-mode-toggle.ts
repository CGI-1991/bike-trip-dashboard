import type { TravelMode } from '../../trip-core/index.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'

export function renderTravelModeToggle(mode: TravelMode): string {
  return `<div class="field"><div class="section-heading"><label id="travel-mode-label">Déplacement</label>${renderFeatureUpdateBadge('travel-mode')}</div>
    <div class="segmented-toggle" role="group" aria-labelledby="travel-mode-label">
      <button type="button" class="segmented-toggle__option" data-action="set-travel-mode" data-travel-mode="cycling" aria-pressed="${mode === 'cycling'}">Vélo</button>
      <button type="button" class="segmented-toggle__option" data-action="set-travel-mode" data-travel-mode="walking" aria-pressed="${mode === 'walking'}">Randonnée</button>
    </div><p class="field__hint">${mode === 'walking'
      ? 'Temps de marche estimés selon la pente, sur terrain régulier. Les sentiers techniques, la charge et les conditions peuvent les allonger.'
      : 'Temps de déplacement estimés selon la pente et votre vitesse de référence.'}</p>
    <p class="field__hint">Changer de déplacement propose une nouvelle vitesse de référence et réévalue les pauses automatiques. Vos pauses manuelles sont conservées.</p></div>`
}
