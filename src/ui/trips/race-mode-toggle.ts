/**
 * The shared "Mode" control — Classique / Course · Tour — reused verbatim
 * by the creation wizard and the trip editor, exactly like
 * `terrain-toggle.ts` and `climb-sensitivity-slider.ts` next to it.
 *
 * Course/Tour disables the pauses planned DURING a stage. It says so in
 * plain terms right under the control, because the setting removes data the
 * traveller may have entered and the confirmation that follows should never
 * be the first time they learn what it does. OFF days, transfers and POI are
 * untouched — a POI is a place on the route, not a planned stop.
 */

export function renderRaceModeToggle(raceMode: boolean): string {
  return `<div class="field">
    <label id="race-mode-toggle-label">Mode</label>
    <div class="segmented-toggle" role="group" aria-labelledby="race-mode-toggle-label" data-race-mode-toggle>
      <button type="button" class="segmented-toggle__option" data-action="set-race-mode" data-race-mode="off" aria-pressed="${raceMode ? 'false' : 'true'}">Classique</button>
      <button type="button" class="segmented-toggle__option" data-action="set-race-mode" data-race-mode="on" aria-pressed="${raceMode ? 'true' : 'false'}">Course · Tour</button>
    </div>
    <p class="field__hint">${raceMode
      ? 'Aucun arrêt planifié pendant les étapes. Les journées OFF, les transferts et les points d’intérêt restent inchangés, et plusieurs étapes peuvent être liées sur une même journée.'
      : 'Des arrêts sont planifiés pendant les étapes et comptés dans les heures d’arrivée.'}</p>
  </div>`
}
