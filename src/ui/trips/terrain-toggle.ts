/**
 * R2.1 sections 18-23: the single shared Terrain control — exactly two
 * choices, Normal/Montagne, nothing else selectable (no "Mixte", no
 * "Automatique" option any more) — reused verbatim by both the creation
 * wizard (`import-wizard.ts`) and the trip editor (`trip-editor.ts`) so the
 * two screens present the same control rather than a checkbox in one and a
 * 3-option `<select>` in the other. "Mixte"/"Roulant"/"Montagneux" remain a
 * read-only, informational *label* elsewhere (`analysis/terrain-context.ts`'s
 * own `TripTerrainLabel`, e.g. the editor's Informations summary) — never a
 * selectable option here.
 */

export function renderTerrainToggle(mountainMode: boolean): string {
  return `<div class="field">
    <label id="terrain-toggle-label">Terrain</label>
    <div class="segmented-toggle" role="group" aria-labelledby="terrain-toggle-label" data-terrain-toggle>
      <button type="button" class="segmented-toggle__option" data-action="set-terrain-mode" data-terrain-mode="normal" aria-pressed="${mountainMode ? 'false' : 'true'}">Normal</button>
      <button type="button" class="segmented-toggle__option" data-action="set-terrain-mode" data-terrain-mode="mountain" aria-pressed="${mountainMode ? 'true' : 'false'}">Montagne</button>
    </div>
  </div>`
}
