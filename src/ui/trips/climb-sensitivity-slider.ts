/**
 * The shared "Détection des montées" control — one 5-step slider, from
 * Montagne (only the most significant ascents) to Pays plat (shorter, gentler
 * côtes count too).
 *
 * Reused verbatim by the creation wizard and the trip editor, exactly like
 * `terrain-toggle.ts` next to it, so the two screens never present the same
 * trip setting differently. The steps themselves are ordinal — a native
 * `<input type="range">` gives a real keyboard and touch control for free,
 * and the visible value below it says, in the traveller's own words, what
 * the current step actually does.
 *
 * The slider only PICKS a level; the thresholds each level applies live in
 * `analysis/climb-detection.ts::CLIMB_SENSITIVITY_TUNINGS`, which is where
 * they are defined and documented.
 */

import { CLIMB_DETECTION_SENSITIVITIES } from '../../trip-core/index.ts'
import type { ClimbCategoryMinimum, ClimbDetectionSensitivity, TravelMode } from '../../trip-core/index.ts'
import { CLIMB_CATEGORY_FILTER_LABELS } from '../../analysis/climb-category.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'

const LABELS: Readonly<Record<ClimbDetectionSensitivity, string>> = {
  mountain: 'Montagne',
  hilly: 'Vallonné',
  standard: 'Standard',
  rolling: 'Collines',
  flat: 'Pays plat',
}

const HINTS: Readonly<Record<ClimbDetectionSensitivity, string>> = {
  mountain: 'Seules les ascensions majeures sont retenues.',
  hilly: 'Les montées franches, sans les petites bosses.',
  standard: 'Réglage d’origine, adapté à la plupart des voyages.',
  rolling: 'Les côtes plus courtes comptent aussi.',
  flat: 'Détecte les côtes courtes et peu pentues, sans transformer le bruit GPS en montée.',
}

export function climbSensitivityLabel(value: ClimbDetectionSensitivity): string {
  return LABELS[value]
}

/** The slider position (0-based) for a level, and the reverse — the only place the ordinal encoding lives. */
export function climbSensitivityIndex(value: ClimbDetectionSensitivity): number {
  const index = CLIMB_DETECTION_SENSITIVITIES.indexOf(value)
  return index === -1 ? CLIMB_DETECTION_SENSITIVITIES.indexOf('standard') : index
}

export function climbSensitivityAtIndex(index: number): ClimbDetectionSensitivity {
  return CLIMB_DETECTION_SENSITIVITIES[index] ?? 'standard'
}

export function renderClimbSensitivitySlider(value: ClimbDetectionSensitivity, minimum: ClimbCategoryMinimum = 0, mode: TravelMode = 'cycling'): string {
  const index = climbSensitivityIndex(value)
  const labels = CLIMB_CATEGORY_FILTER_LABELS[mode]
  return `<div class="field climb-sensitivity" data-climb-category-filter>
    <label for="climb-category-input">Montées retenues ${renderFeatureUpdateBadge('climb-categories')}</label>
    <input id="climb-category-input" class="climb-sensitivity__slider" type="range" min="0" max="4" step="1" value="${minimum}" data-field="climb-category" aria-describedby="climb-category-hint" aria-valuetext="${labels[minimum]}">
    <div class="climb-sensitivity__scale" aria-hidden="true"><span>Toutes</span><span>${labels[4]}</span></div>
    <p class="climb-sensitivity__value" data-climb-category-value>${labels[minimum]}</p>
    <p id="climb-category-hint" class="field__hint">${mode === 'walking' ? 'Effort de montée selon la longueur et le D+. La technicité du sentier n’est pas évaluée.' : 'Catégories indicatives selon la longueur et la pente, de Cat. 4 à HC.'} Vos segments manuels sont conservés.</p>
  </div><details class="climb-sensitivity-advanced"><summary>Détection avancée</summary><div class="field climb-sensitivity" data-climb-sensitivity>
    <label for="climb-sensitivity-input">Détection des montées</label>
    <input id="climb-sensitivity-input" class="climb-sensitivity__slider" type="range" min="0" max="${CLIMB_DETECTION_SENSITIVITIES.length - 1}" step="1" value="${index}"
      data-field="climb-sensitivity" aria-describedby="climb-sensitivity-value climb-sensitivity-hint"
      aria-valuetext="${escapeHtml(LABELS[value])}">
    <div class="climb-sensitivity__scale" aria-hidden="true"><span>${escapeHtml(LABELS.mountain)}</span><span>${escapeHtml(LABELS.flat)}</span></div>
    <p id="climb-sensitivity-value" class="climb-sensitivity__value" data-climb-sensitivity-value>${escapeHtml(LABELS[value])}</p>
    <p id="climb-sensitivity-hint" class="field__hint" data-climb-sensitivity-hint>${escapeHtml(HINTS[value])}</p>
  </div></details>`
}

export function patchClimbCategoryLabel(container: { querySelector: (selector: string) => Element | null }, minimum: ClimbCategoryMinimum, mode: TravelMode): void {
  const label = CLIMB_CATEGORY_FILTER_LABELS[mode][minimum]
  const value = container.querySelector('[data-climb-category-value]')
  if (value !== null) value.textContent = label
  container.querySelector('[data-field="climb-category"]')?.setAttribute('aria-valuetext', label)
}

/**
 * Updates the two text nodes under the slider in place, without a full
 * re-render — dragging a range input through a `innerHTML` rebuild would
 * drop the pointer capture on every step.
 */
export function patchClimbSensitivityLabels(container: { querySelector: (selector: string) => Element | null }, value: ClimbDetectionSensitivity): void {
  const valueElement = container.querySelector('[data-climb-sensitivity-value]')
  if (valueElement !== null) valueElement.textContent = LABELS[value]
  const hintElement = container.querySelector('[data-climb-sensitivity-hint]')
  if (hintElement !== null) hintElement.textContent = HINTS[value]
  const input = container.querySelector('[data-field="climb-sensitivity"]')
  if (input !== null) input.setAttribute('aria-valuetext', LABELS[value])
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
