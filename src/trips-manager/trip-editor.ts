/**
 * Structural editing of an existing GPX trip. The 6C1 parser/analyzer/build
 * pipeline produces a complete replacement bundle in memory; this module
 * then restores only identities and manual data belonging to retained days
 * before one atomic IndexedDB replacement write.
 */

import { buildGpxTrip } from '../import/gpx/import-gpx-trip.ts'
import type { ImportProgressLabel } from '../import/gpx/import-gpx-trip.ts'
import type { GpxImportFile, ImportIssue } from '../import/gpx/types.ts'
import { createSourceFileRepository } from '../storage/indexeddb/source-file-repository.ts'
import type { SourceFilePayloadContent } from '../storage/indexeddb/source-file-repository.ts'
import { createTripRepository, TripValidationError } from '../storage/indexeddb/trip-repository.ts'
import type {
  RideStage,
  RideStageId,
  Route,
  RouteId,
  SourceFile,
  SourceFileId,
  TripBundle,
  TripDay,
  TripDayId,
  TripId,
} from '../trip-core/index.ts'
import { validateTripBundle } from '../trip-core/index.ts'

interface RetainedSlotIdentity {
  /** Existing day identity to retain. `null` means this is a new day. */
  readonly existingDayId: TripDayId | null
}

export interface TripEditRideSlot extends RetainedSlotIdentity {
  readonly kind: 'ride'
  readonly file: GpxImportFile
  /** Existing source identity only when this is the unchanged GPX. A replacement must set `null`. */
  readonly existingSourceFileId: SourceFileId | null
}

export interface TripEditOffSlot extends RetainedSlotIdentity {
  readonly kind: 'off'
  readonly notes?: string | null
}

export interface TripEditTransferSlot extends RetainedSlotIdentity {
  readonly kind: 'transfer'
  readonly notes?: string | null
}

export type TripEditSlot = TripEditRideSlot | TripEditOffSlot | TripEditTransferSlot

export interface TripEditDraft {
  readonly bundle: TripBundle
  readonly slots: readonly TripEditSlot[]
}

export interface EditGpxTripInput {
  readonly database: IDBDatabase
  readonly tripId: TripId
  readonly slots: readonly TripEditSlot[]
  readonly idFactory: () => string
  readonly now: () => string
  readonly onProgress?: (label: ImportProgressLabel) => void
}

export type EditGpxTripResult =
  | { readonly ok: true; readonly bundle: TripBundle; readonly issues: readonly ImportIssue[] }
  | { readonly ok: false; readonly code: 'not-found' | 'invalid-structure' | 'analysis-error' | 'storage-error'; readonly message: string; readonly issues: readonly ImportIssue[] }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur inconnue.'
}

async function payloadToArrayBuffer(content: SourceFilePayloadContent): Promise<ArrayBuffer> {
  return content instanceof ArrayBuffer ? content.slice(0) : content.arrayBuffer()
}

function rideEntitiesForDay(bundle: TripBundle, day: TripDay): { readonly stage: RideStage; readonly route: Route; readonly sourceFile: SourceFile } {
  const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
  const route = stage === undefined ? undefined : bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  const sourceFile = route === undefined ? undefined : bundle.sourceFiles.find((candidate) => candidate.id === route.sourceFileId)
  if (stage === undefined || route === undefined || sourceFile === undefined) {
    throw new Error(`Journée roulée incohérente : ${day.id}.`)
  }
  return { stage, route, sourceFile }
}

/** Loads the existing source payloads without re-encoding them. */
export async function loadTripEditDraft(database: IDBDatabase, tripId: TripId): Promise<TripEditDraft | null> {
  const tripRepository = createTripRepository(database)
  const bundle = await tripRepository.loadTripBundle(tripId)
  if (bundle === null) return null

  const sourceFileRepository = createSourceFileRepository(database)
  const slots: TripEditSlot[] = []
  for (const day of [...bundle.days].sort((left, right) => left.index - right.index)) {
    if (day.type !== 'ride') {
      slots.push({ kind: day.type, existingDayId: day.id, notes: day.notes })
      continue
    }

    const { sourceFile } = rideEntitiesForDay(bundle, day)
    const payload = await sourceFileRepository.getSourceFilePayload(bundle.metadata.id, sourceFile.id)
    if (payload === null) throw new Error(`Octets GPX introuvables pour ${sourceFile.originalName}.`)
    const bytes = await payloadToArrayBuffer(payload.content)
    slots.push({
      kind: 'ride',
      existingDayId: day.id,
      existingSourceFileId: sourceFile.id,
      file: {
        name: sourceFile.originalName,
        mimeType: sourceFile.mimeType,
        sizeBytes: bytes.byteLength,
        lastModifiedAt: sourceFile.lastModifiedAt,
        bytes,
      },
    })
  }

  return { bundle, slots }
}

function validateSlots(existing: TripBundle, slots: readonly TripEditSlot[]): string | null {
  if (slots.filter((slot) => slot.kind === 'ride').length === 0) return 'Au moins une étape GPX doit être conservée.'

  const existingDays = new Map(existing.days.map((day) => [day.id, day]))
  const seenDayIds = new Set<TripDayId>()
  for (const slot of slots) {
    if (slot.existingDayId === null) continue
    if (seenDayIds.has(slot.existingDayId)) return `Journée conservée en double : ${slot.existingDayId}.`
    seenDayIds.add(slot.existingDayId)
    const day = existingDays.get(slot.existingDayId)
    if (day === undefined) return `Journée conservée inconnue : ${slot.existingDayId}.`
    if (day.type !== slot.kind) return `Le type de la journée ${slot.existingDayId} ne peut pas être changé implicitement.`

    if (slot.kind === 'ride' && slot.existingSourceFileId !== null) {
      const { sourceFile } = rideEntitiesForDay(existing, day)
      if (sourceFile.id !== slot.existingSourceFileId) {
        return `La source GPX conservée ne correspond pas à la journée ${slot.existingDayId}.`
      }
    }
  }
  return null
}

interface IdentityRemaps {
  readonly dayIds: ReadonlyMap<TripDayId, TripDayId>
  readonly stageIds: ReadonlyMap<RideStageId, RideStageId>
  readonly routeIds: ReadonlyMap<RouteId, RouteId>
  readonly sourceFileIds: ReadonlyMap<SourceFileId, SourceFileId>
  readonly unchangedStageIds: ReadonlySet<RideStageId>
}

function buildIdentityRemaps(existing: TripBundle, rebuilt: TripBundle, slots: readonly TripEditSlot[]): IdentityRemaps {
  const dayIds = new Map<TripDayId, TripDayId>()
  const stageIds = new Map<RideStageId, RideStageId>()
  const routeIds = new Map<RouteId, RouteId>()
  const sourceFileIds = new Map<SourceFileId, SourceFileId>()
  const unchangedStageIds = new Set<RideStageId>()

  slots.forEach((slot, index) => {
    const rebuiltDay = rebuilt.days[index]
    if (rebuiltDay === undefined || slot.existingDayId === null) return
    const existingDay = existing.days.find((day) => day.id === slot.existingDayId)
    if (existingDay === undefined) return
    dayIds.set(rebuiltDay.id, existingDay.id)

    if (slot.kind !== 'ride' || slot.existingSourceFileId === null) return
    const oldEntities = rideEntitiesForDay(existing, existingDay)
    const newEntities = rideEntitiesForDay(rebuilt, rebuiltDay)
    stageIds.set(newEntities.stage.id, oldEntities.stage.id)
    routeIds.set(newEntities.route.id, oldEntities.route.id)
    sourceFileIds.set(newEntities.sourceFile.id, oldEntities.sourceFile.id)
    unchangedStageIds.add(oldEntities.stage.id)
  })

  return { dayIds, stageIds, routeIds, sourceFileIds, unchangedStageIds }
}

function isManualProvenance(provenance: { readonly sourceType: string; readonly manuallyOverridden: boolean }): boolean {
  return provenance.sourceType === 'user' || provenance.manuallyOverridden
}

/** Pure preservation layer applied after all GPX-derived fields were rebuilt. */
export function mergeEditedTripBundle(existing: TripBundle, rebuilt: TripBundle, slots: readonly TripEditSlot[], updatedAt: string): TripBundle {
  const remaps = buildIdentityRemaps(existing, rebuilt, slots)
  const existingDayById = new Map(existing.days.map((day) => [day.id, day]))
  const existingSourceById = new Map(existing.sourceFiles.map((sourceFile) => [sourceFile.id, sourceFile]))

  const sourceFiles = rebuilt.sourceFiles.map((sourceFile) => {
    const retainedId = remaps.sourceFileIds.get(sourceFile.id)
    return retainedId === undefined ? sourceFile : (existingSourceById.get(retainedId) ?? { ...sourceFile, id: retainedId })
  })

  const routes = rebuilt.routes.map((route) => ({
    ...route,
    id: remaps.routeIds.get(route.id) ?? route.id,
    sourceFileId: route.sourceFileId === null ? null : (remaps.sourceFileIds.get(route.sourceFileId) ?? route.sourceFileId),
  }))

  const baseClimbs = rebuilt.climbs.map((climb) => ({ ...climb, routeId: remaps.routeIds.get(climb.routeId) ?? climb.routeId }))
  const unchangedRouteIds = new Set(remaps.routeIds.values())
  const manualClimbs = existing.climbs.filter((climb) => unchangedRouteIds.has(climb.routeId) && isManualProvenance(climb.provenance))
  const climbIds = new Set(baseClimbs.map((climb) => climb.id))
  const climbs = [...baseClimbs, ...manualClimbs.filter((climb) => !climbIds.has(climb.id))]

  const baseRoutePoints = rebuilt.routePoints.map((point) => ({ ...point, routeId: remaps.routeIds.get(point.routeId) ?? point.routeId }))
  const manualRoutePoints = existing.routePoints.filter((point) => unchangedRouteIds.has(point.routeId) && isManualProvenance(point.provenance))
  const routePointIds = new Set(baseRoutePoints.map((point) => point.id))
  const routePoints = [...baseRoutePoints, ...manualRoutePoints.filter((point) => !routePointIds.has(point.id))]

  const stages = rebuilt.stages.map((stage) => {
    const mappedId = remaps.stageIds.get(stage.id) ?? stage.id
    const mappedRouteId = remaps.routeIds.get(stage.sourceRouteId) ?? stage.sourceRouteId
    const retainedManualClimbIds = manualClimbs.filter((climb) => climb.routeId === mappedRouteId).map((climb) => climb.id)
    const retainedManualPointIds = manualRoutePoints.filter((point) => point.routeId === mappedRouteId).map((point) => point.id)
    return {
      ...stage,
      id: mappedId,
      dayId: remaps.dayIds.get(stage.dayId) ?? stage.dayId,
      sourceRouteId: mappedRouteId,
      climbIds: [...stage.climbIds, ...retainedManualClimbIds],
      routePointIds: [...stage.routePointIds, ...retainedManualPointIds],
    }
  })

  const days = rebuilt.days.map((day, index) => {
    const mappedId = remaps.dayIds.get(day.id) ?? day.id
    const original = slots[index]?.existingDayId === null ? undefined : existingDayById.get(mappedId)
    return {
      ...day,
      id: mappedId,
      stageId: day.stageId === null ? null : (remaps.stageIds.get(day.stageId) ?? day.stageId),
      accommodationId: original?.accommodationId ?? null,
      notes: original?.notes ?? day.notes,
      enrichmentStatus: original?.enrichmentStatus ?? day.enrichmentStatus,
    }
  })

  const keptDayIds = new Set(days.map((day) => day.id))
  const retainedAccommodationIds = new Set(days.flatMap((day) => (day.accommodationId === null ? [] : [day.accommodationId])))
  const accommodations = existing.accommodations.filter((accommodation) => retainedAccommodationIds.has(accommodation.id))
  const practicalPlaces = existing.practicalPlaces
    .filter((place) => isManualProvenance(place.provenance) && place.dayIds.some((dayId) => keptDayIds.has(dayId)))
    .map((place) => ({ ...place, dayIds: place.dayIds.filter((dayId) => keptDayIds.has(dayId)) }))

  const existingDaySettings = new Map(existing.settings.days.map((settings) => [settings.dayId, settings]))
  const settingsDays = rebuilt.settings.days.map((settings) => {
    const dayId = remaps.dayIds.get(settings.dayId) ?? settings.dayId
    return { ...settings, dayId, departureTime: existingDaySettings.get(dayId)?.departureTime ?? settings.departureTime }
  })

  const targetIds = {
    'trip-day': keptDayIds as ReadonlySet<string>,
    'ride-stage': new Set(stages.map((stage) => stage.id)) as ReadonlySet<string>,
    'route-point': new Set(routePoints.map((point) => point.id)) as ReadonlySet<string>,
    climb: new Set(climbs.map((climb) => climb.id)) as ReadonlySet<string>,
    'practical-place': new Set(practicalPlaces.map((place) => place.id)) as ReadonlySet<string>,
    accommodation: retainedAccommodationIds as ReadonlySet<string>,
  }
  const overrides = existing.overrides.filter((override) => targetIds[override.targetType].has(override.targetId))

  return {
    ...rebuilt,
    metadata: {
      ...rebuilt.metadata,
      id: existing.metadata.id,
      slug: existing.metadata.slug,
      name: existing.metadata.name,
      description: existing.metadata.description,
      createdAt: existing.metadata.createdAt,
      updatedAt,
      language: existing.metadata.language,
      units: existing.metadata.units,
    },
    days,
    stages,
    sourceFiles,
    routes,
    climbs,
    routePoints,
    practicalPlaces,
    accommodations,
    settings: { global: { ...existing.settings.global, pausePlanMode: 'automatic' }, days: settingsDays, stages: [] },
    overrides,
  }
}

export async function editGpxTrip(input: EditGpxTripInput): Promise<EditGpxTripResult> {
  const tripRepository = createTripRepository(input.database)
  const existing = await tripRepository.loadTripBundle(input.tripId)
  if (existing === null) {
    return { ok: false, code: 'not-found', message: 'Voyage introuvable.', issues: [] }
  }

  const structureError = validateSlots(existing, input.slots)
  if (structureError !== null) {
    return { ok: false, code: 'invalid-structure', message: structureError, issues: [] }
  }

  const rideSlots = input.slots.filter((slot): slot is TripEditRideSlot => slot.kind === 'ride')
  const updatedAt = input.now()
  const firstDaySettings = existing.settings.days[0]
  const buildResult = await buildGpxTrip({
    files: rideSlots.map((slot) => slot.file),
    options: {
      tripId: existing.metadata.id,
      slug: existing.metadata.slug,
      name: existing.metadata.name,
      startDate: existing.metadata.startDate,
      timezone: existing.metadata.timezone,
      language: existing.metadata.language,
      units: 'metric',
      referenceSpeedKph: existing.settings.global.referenceSpeedKph,
      departureTime: firstDaySettings?.departureTime ?? '08:00',
      totalBreakMinutes: 'adaptive',
      importedAt: updatedAt,
      engineVersion: 'trip-editor-v1@1',
    },
    idFactory: input.idFactory,
    now: input.now,
    dayStructure: input.slots.map((slot) => (slot.kind === 'ride' ? { kind: 'ride' } : { kind: slot.kind, notes: slot.notes ?? null })),
    onProgress: input.onProgress,
  })

  if (!buildResult.ok) {
    return { ok: false, code: 'analysis-error', message: buildResult.error.message, issues: buildResult.issues }
  }

  const merged = mergeEditedTripBundle(existing, buildResult.bundle, input.slots, updatedAt)
  const validation = validateTripBundle(merged)
  if (!validation.ok) {
    const message = validation.issues[0]?.message ?? 'Voyage modifié invalide.'
    return { ok: false, code: 'invalid-structure', message, issues: buildResult.issues }
  }

  const sourcePayloads = validation.value.sourceFiles.map((sourceFile, index) => ({
    sourceFileId: sourceFile.id,
    content: rideSlots[index]?.file.bytes ?? new ArrayBuffer(0),
  }))

  try {
    await tripRepository.saveTripBundle(validation.value, { sourcePayloads })
  } catch (error) {
    const message = error instanceof TripValidationError ? error.message : `Échec de l’enregistrement atomique : ${errorMessage(error)}`
    return { ok: false, code: 'storage-error', message, issues: buildResult.issues }
  }

  return { ok: true, bundle: validation.value, issues: buildResult.issues }
}
