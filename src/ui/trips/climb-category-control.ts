/** One shared five-level climb filter in the main creation/editing settings.
 * Detection calibration stays internal; saved legacy sensitivity is preserved. */
import type { ClimbCategoryMinimum, TravelMode } from '../../trip-core/index.ts'
import { CLIMB_CATEGORY_FILTER_LABELS } from '../../analysis/climb-category.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'

export function renderClimbCategoryControl(minimum: ClimbCategoryMinimum = 0, mode: TravelMode = 'cycling'): string {
  const labels = CLIMB_CATEGORY_FILTER_LABELS[mode]
  return `<div class="field climb-sensitivity" data-climb-category-filter>
    <label for="climb-category-input">Montées retenues ${renderFeatureUpdateBadge('climb-categories')}</label>
    <input id="climb-category-input" class="climb-sensitivity__slider" type="range" min="0" max="4" step="1" value="${minimum}" data-field="climb-category" aria-describedby="climb-category-hint" aria-valuetext="${labels[minimum]}">
    <div class="climb-sensitivity__scale" aria-hidden="true"><span>Toutes</span><span>${labels[4]}</span></div>
    <p class="climb-sensitivity__value" data-climb-category-value>${labels[minimum]}</p>
    <p id="climb-category-hint" class="field__hint">${mode === 'walking' ? 'Effort indicatif selon la longueur et le D+.' : 'Catégories indicatives selon la longueur et la pente.'}</p>
  </div>`
}

/** Patch in place so dragging the range never loses pointer capture. */
export function patchClimbCategoryLabel(container: { querySelector: (selector: string) => Element | null }, minimum: ClimbCategoryMinimum, mode: TravelMode): void {
  const label = CLIMB_CATEGORY_FILTER_LABELS[mode][minimum]
  const value = container.querySelector('[data-climb-category-value]')
  if (value !== null) value.textContent = label
  container.querySelector('[data-field="climb-category"]')?.setAttribute('aria-valuetext', label)
}
