/**
 * Splices OFF days and transfers into an otherwise ride-only `TripBundle`
 * (annexe fonctionnelle section 8, CDC phase 6C1 section 14/15/16). Applied
 * once, right after `importGpxTrip` assembles the ride-only bundle and
 * before it is validated/persisted (see `import-gpx-trip.ts`'s optional
 * `dayStructure` hook) — never a second, separate write.
 *
 * `RideStage`/`Route`/`SourceFile`/`Climb` records are untouched: only
 * `TripDay.index`/`displayNumber`/`date` are recomputed to their new
 * position, and brand-new OFF/transfer `TripDay`s are created alongside.
 */

import { addCivilDays } from '../../trip-core/validation/primitives.ts'
import { tripDayId } from '../../trip-core/index.ts'
import type { IsoDate, TransferTiming, TripBundle, TripDay } from '../../trip-core/index.ts'

export type DayStructureSlot =
  | { readonly kind: 'ride' }
  | { readonly kind: 'off'; readonly notes?: string | null }
  /** `transferTiming` (CDC Jalon B4.4 section 22) — `undefined`/omitted means `'dedicated'`, exactly like `TripDay.transferTiming` itself. */
  | { readonly kind: 'transfer'; readonly notes?: string | null; readonly transferTiming?: TransferTiming }

export class DayStructureError extends Error {}

function asIsoDate(value: string): IsoDate {
  return value as IsoDate
}

/**
 * `slots` describes the FULL final day order. Every `'ride'` slot consumes
 * the next entry of `bundle.days` in order — `bundle.days` must already be
 * in the exact ride order the user confirmed (the order the GPX files were
 * fed to `importGpxTrip` in), never reshuffled here.
 */
export function applyDayStructure(bundle: TripBundle, slots: readonly DayStructureSlot[], idFactory: () => string): TripBundle {
  const rideSlotCount = slots.filter((slot) => slot.kind === 'ride').length
  if (rideSlotCount !== bundle.days.length) {
    throw new DayStructureError(
      `La structure attend ${rideSlotCount} étape(s) roulée(s) mais le voyage importé en contient ${bundle.days.length}.`,
    )
  }

  const dated = bundle.calendar.startDate !== null
  const startDate = bundle.calendar.startDate
  const newDays: TripDay[] = []
  let rideCursor = 0

  slots.forEach((slot, index) => {
    const displayNumber = index + 1
    const date = dated && startDate !== null ? asIsoDate(addCivilDays(startDate, index)) : null

    if (slot.kind === 'ride') {
      const original = bundle.days[rideCursor]
      if (original === undefined) {
        throw new DayStructureError('Étape roulée manquante lors de la reconstruction de la structure.')
      }
      rideCursor++
      newDays.push({ ...original, index, displayNumber, date })
      return
    }

    // Bug 5-9 closeout: a brand-new OFF/transfer slot never bakes a
    // computed default (or a placeholder string like "Lieu à préciser")
    // into `startLocationName`/`endLocationName` any more — `null` is the
    // only value that means "no manual override", per
    // `day-location-fill.ts`'s contract. Baking a snapshot here made it
    // permanent: a later geocoding update to the neighbouring ride stage
    // (`endpoint-enrichment.ts`, which only ever touches ride days) could
    // never reach it again, so the OFF/transfer day was stuck showing
    // whatever was known at structure-application time. `resolveOffLocation`/
    // `resolveTransferLocations` already resolve the same neighbouring-ride
    // fallback chain live, on every read — so leaving these `null` here is
    // strictly more correct, not merely simpler.
    if (slot.kind === 'off') {
      newDays.push({
        id: tripDayId(idFactory()),
        index,
        displayNumber,
        date,
        type: 'off',
        stageId: null,
        startLocationName: null,
        endLocationName: null,
        accommodationId: null,
        notes: slot.notes ?? null,
        enrichmentStatus: 'not-started',
      })
      return
    }

    // transfer
    newDays.push({
      id: tripDayId(idFactory()),
      index,
      displayNumber,
      date,
      type: 'transfer',
      stageId: null,
      startLocationName: null,
      endLocationName: null,
      accommodationId: null,
      notes: slot.notes ?? null,
      enrichmentStatus: 'not-started',
      transferTiming: slot.transferTiming,
    })
  })

  const endDate = dated && startDate !== null && newDays.length > 0 ? asIsoDate(addCivilDays(startDate, newDays.length - 1)) : null
  const newDayIds = new Set(newDays.map((day) => day.id))

  return {
    ...bundle,
    days: newDays,
    calendar: { ...bundle.calendar, endDate },
    metadata: { ...bundle.metadata, endDate },
    settings: { ...bundle.settings, days: bundle.settings.days.filter((entry) => newDayIds.has(entry.dayId)) },
  }
}

/** A default, structure-free slot list: every GPX file is its own ride day, in order — the annexe's "1 fichier = 1 étape" default. */
export function defaultRideOnlyStructure(rideDayCount: number): readonly DayStructureSlot[] {
  return Array.from({ length: rideDayCount }, () => ({ kind: 'ride' as const }))
}

/** Inserts an OFF/transfer slot right after `afterPosition` (`-1` inserts at the very start). Never inserts a `'ride'` slot — rides only ever come from the confirmed GPX order. */
export function insertStructureSlot(
  slots: readonly DayStructureSlot[],
  afterPosition: number,
  slot: Extract<DayStructureSlot, { kind: 'off' | 'transfer' }>,
): readonly DayStructureSlot[] {
  const insertAt = Math.min(Math.max(afterPosition + 1, 0), slots.length)
  return [...slots.slice(0, insertAt), slot, ...slots.slice(insertAt)]
}

export class StructureSlotError extends Error {}

/** Removes the slot at `position`. Throws if that slot is `'ride'` — a ride slot can only disappear by removing its GPX file, never here. */
export function removeStructureSlot(slots: readonly DayStructureSlot[], position: number): readonly DayStructureSlot[] {
  const target = slots[position]
  if (target === undefined) return slots
  if (target.kind === 'ride') {
    throw new StructureSlotError('Une étape roulée ne peut pas être retirée de la structure ici — retirez son fichier GPX.')
  }
  return [...slots.slice(0, position), ...slots.slice(position + 1)]
}
