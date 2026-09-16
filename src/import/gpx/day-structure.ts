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
import { calendarDayOffsets, tripDayId } from '../../trip-core/index.ts'
import type { IsoDate, RideStage, TransferTiming, TripBundle, TripDay } from '../../trip-core/index.ts'

export type DayStructureSlot =
  /**
   * `customName` — the traveller's own optional stage name (`RideStage.customName`);
   * `sameCalendarDayAsPrevious` — "étape liée" (this stage is ridden the
   * same calendar day as the previous one, Course/Tour mode). Both
   * optional/absent for every historical caller, which reproduces the
   * previous behaviour exactly.
   */
  | { readonly kind: 'ride'; readonly customName?: string | null; readonly sameCalendarDayAsPrevious?: boolean }
  | { readonly kind: 'off'; readonly notes?: string | null }
  /** `transferTiming` (CDC Jalon B4.4 section 22) — `undefined`/omitted means `'dedicated'`, exactly like `TripDay.transferTiming` itself. */
  | { readonly kind: 'transfer'; readonly notes?: string | null; readonly transferTiming?: TransferTiming }

export class DayStructureError extends Error {}

function asIsoDate(value: string): IsoDate {
  return value as IsoDate
}

/**
 * Sets (or genuinely REMOVES) an optional field. `{ ...day, field:
 * undefined }` would leave an own property holding `undefined` behind,
 * which survives a structured clone into IndexedDB and reads back as
 * "present" to anything doing a key check — an unlinked day must carry no
 * link key at all, exactly like every bundle written before this field
 * existed.
 */
function withOptional<T extends object, K extends string, V>(target: T, key: K, value: V | undefined): T {
  const next = { ...target } as Record<string, unknown>
  if (value === undefined) delete next[key]
  else next[key] = value
  return next as T
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
  // Étapes liées: a link is only ever legal between two consecutive RIDE
  // slots, so a flag that a reorder/removal left dangling (first position,
  // or preceded by an OFF/transfer) is simply dropped here rather than
  // written out for the validator to reject. `calendarDayOffsets` then
  // turns the sanitized flags into each day's own civil-day offset — the
  // plain `index` arithmetic this used to do, whenever nothing is linked.
  const linkedFlags = slots.map((slot, index) => slot.kind === 'ride' && slot.sameCalendarDayAsPrevious === true && slots[index - 1]?.kind === 'ride')
  const offsets = calendarDayOffsets(linkedFlags.map((linked) => ({ sameCalendarDayAsPrevious: linked })))
  const newDays: TripDay[] = []
  const stagePatches = new Map<string, string | undefined>()
  let rideCursor = 0

  slots.forEach((slot, index) => {
    const displayNumber = index + 1
    const date = dated && startDate !== null ? asIsoDate(addCivilDays(startDate, offsets[index] ?? index)) : null

    if (slot.kind === 'ride') {
      const original = bundle.days[rideCursor]
      if (original === undefined) {
        throw new DayStructureError('Étape roulée manquante lors de la reconstruction de la structure.')
      }
      rideCursor++
      if (original.stageId !== null) {
        const trimmed = slot.customName?.trim() ?? ''
        stagePatches.set(original.stageId, trimmed === '' ? undefined : trimmed)
      }
      newDays.push(withOptional({ ...original, index, displayNumber, date }, 'sameCalendarDayAsPrevious', linkedFlags[index] === true ? true : undefined))
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

  const endDate = dated && startDate !== null && newDays.length > 0
    ? asIsoDate(addCivilDays(startDate, offsets[newDays.length - 1] ?? newDays.length - 1))
    : null
  const newDayIds = new Set(newDays.map((day) => day.id))
  // `customName` is the only stage field this structural pass owns — it is
  // carried on the slot (the editor/wizard row the user typed it into), not
  // derived from the GPX, so it has to be written back onto the rebuilt
  // stage here. Every other stage field stays exactly as the analysis
  // pipeline produced it.
  const stages: readonly RideStage[] = stagePatches.size === 0
    ? bundle.stages
    : bundle.stages.map((stage) => (stagePatches.has(stage.id) ? withOptional(stage, 'customName', stagePatches.get(stage.id)) : stage))

  return {
    ...bundle,
    days: newDays,
    stages,
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
