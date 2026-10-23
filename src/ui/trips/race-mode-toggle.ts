/**
 * The shared "Mode" control — Voyage / Tour — reused verbatim by the
 * creation wizard and the trip editor, exactly like
 * `climb-sensitivity-slider.ts` next to it.
 *
 * Tour disables the pauses planned DURING a stage. It says so in plain terms
 * right under the control, because the setting removes data the traveller
 * may have entered and the confirmation that follows should never be the
 * first time they learn what it does. OFF days, transfers and POI are
 * untouched — a POI is a place on the route, not a planned stop.
 *
 * The stored value stays `GlobalTripSettings.raceMode`: renaming a boolean
 * on disk would buy nothing and would need a migration.
 */

import type { OrganizationMode } from '../../trip-core/index.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'

export function renderRaceModeToggle(raceMode: boolean, organizationMode?: OrganizationMode, editing = false): string {
  const league = organizationMode === 'league'
  const showLeague = organizationMode !== undefined
  return `<div class="field">
    <label id="race-mode-toggle-label">Mode</label>${showLeague ? renderFeatureUpdateBadge('league-calendar') : ''}
    <div class="segmented-toggle${showLeague ? ' segmented-toggle--three' : ''}" role="group" aria-labelledby="race-mode-toggle-label" data-race-mode-toggle>
      <button type="button" class="segmented-toggle__option" data-action="set-race-mode" data-race-mode="off" aria-pressed="${raceMode || league ? 'false' : 'true'}" ${editing && league ? 'disabled' : ''}>Voyage</button>
      ${showLeague ? `<button type="button" class="segmented-toggle__option" data-action="set-organization-mode" data-organization-mode="league" aria-pressed="${league}" ${editing && !league ? 'disabled' : ''}>League</button>` : ''}
      <button type="button" class="segmented-toggle__option" data-action="set-race-mode" data-race-mode="on" aria-pressed="${raceMode && !league ? 'true' : 'false'}" ${editing && league ? 'disabled' : ''}>Tour</button>
    </div>
    <p class="field__hint">${league ? 'Calendrier de courses indépendantes, chacune avec sa date et son heure. Aucun arrêt planifié pendant une course.' : raceMode
      ? 'Aucun arrêt planifié pendant les étapes. Les journées OFF, les transferts et les points d’intérêt restent inchangés, et plusieurs étapes peuvent être liées sur une même journée.'
      : 'Des arrêts sont planifiés pendant les étapes et comptés dans les heures d’arrivée.'}</p>${showLeague && editing ? '<p class="field__hint">League se choisit à la création : ses dates indépendantes sont conservées lors de l’édition.</p>' : ''}
  </div>`
}
