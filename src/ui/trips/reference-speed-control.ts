import type { TravelMode } from '../../trip-core/model/settings.ts'
import { REFERENCE_SPEED_LABELS, REFERENCE_SPEED_MODES } from '../../trip-core/model/reference-speed.ts'
import type { ReferenceSpeedMode } from '../../trip-core/model/reference-speed.ts'
import { TRAVEL_MODE_SETTINGS } from '../../trips-manager/travel-mode.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'

export function renderReferenceSpeedControl(speed: number, mode: ReferenceSpeedMode, travelMode: TravelMode, context: 'editor' | 'wizard'): string {
  const attribute = context === 'editor' ? 'data-editor-field' : 'data-field'
  const limits = TRAVEL_MODE_SETTINGS[travelMode]
  return `<div class="field reference-speed-control"><label for="${context}-speed-mode">Vitesse de référence sur le plat ${renderFeatureUpdateBadge('reference-speed')}</label>
    <select id="${context}-speed-mode" data-reference-speed-mode aria-label="Allure de référence">${REFERENCE_SPEED_MODES.map(value => `<option value="${value}"${mode === value ? ' selected' : ''}>${REFERENCE_SPEED_LABELS[value]}</option>`).join('')}</select>
    <div class="field__control"><input id="${context}-reference-speed" type="number" min="${limits.minimumSpeedKph}" max="${limits.maximumSpeedKph}" step="0.1" inputmode="decimal" ${attribute}="reference-speed" value="${Number.isFinite(speed) ? speed : ''}"${mode !== 'manual' ? ' readonly' : ''} aria-label="Vitesse de référence en kilomètres par heure"><span>km/h</span></div>
    <span class="field__error" data-field-error="referenceSpeedKph" role="status"></span></div>`
}
