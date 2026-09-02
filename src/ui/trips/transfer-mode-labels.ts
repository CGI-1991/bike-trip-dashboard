/**
 * R2.1 section 36 — the 7-value `TRANSFER_MODES` list, given French display
 * labels for the `<select>` and every read-only display of a transfer's
 * mode. `TripDay.transferMode` itself stays a plain `string` (see its own
 * doc comment) so a legacy free-text value from R2 — or anything else not
 * in the list — is never silently dropped: `formatTransferModeLabel` shows
 * it back verbatim, and the edit `<select>` keeps it selectable as an extra
 * option rather than snapping to a default.
 */

import { TRANSFER_MODES, type TransferMode } from '../../trip-core/index.ts'

export const TRANSFER_MODE_LABELS: Readonly<Record<TransferMode, string>> = {
  train: 'Train',
  bus: 'Bus',
  car: 'Voiture',
  ferry: 'Ferry',
  taxi: 'Taxi',
  bike: 'Vélo',
  other: 'Autre',
}

export function isKnownTransferMode(value: string): value is TransferMode {
  return (TRANSFER_MODES as readonly string[]).includes(value)
}

/** The mode's display label — the canonical French label for one of the 7 known codes, or the stored value shown verbatim for a legacy/free-text value. `null` when nothing is stored at all. */
export function formatTransferModeLabel(mode: string | null | undefined): string | null {
  if (mode === null || mode === undefined || mode.trim() === '') return null
  return isKnownTransferMode(mode) ? TRANSFER_MODE_LABELS[mode] : mode
}
