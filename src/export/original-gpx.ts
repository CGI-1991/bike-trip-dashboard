import { createSourceFileRepository } from '../storage/indexeddb/source-file-repository.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { RideStage, TripBundle, TripDayId, TripId } from '../trip-core/index.ts'
import { buildZipArchive } from '../archive/zip-writer.ts'
import type { ZipEntryInput } from '../archive/zip-writer.ts'

interface PreparedGpxDownload { readonly blob: Blob; readonly filename: string }

async function loadBundle(database: IDBDatabase, tripId: TripId): Promise<TripBundle> {
  const bundle = await createTripRepository(database).loadTripBundle(tripId)
  if (bundle === null) throw new Error('Ce voyage est indisponible. Aucun fichier n’a été exporté.')
  return bundle
}

async function sourceForStage(database: IDBDatabase, bundle: TripBundle, stage: RideStage) {
  const route = bundle.routes.find(route => route.id === stage.sourceRouteId)
  const source = bundle.sourceFiles.find(source => source.id === route?.sourceFileId)
  const payload = source === undefined ? null : await createSourceFileRepository(database).getSourceFilePayload(bundle.metadata.id, source.id)
  if (source === undefined || payload === null) {
    throw new Error(`GPX d’origine indisponible pour « ${stage.customName?.trim() || stage.name} ». Aucun fichier n’a été exporté.`)
  }
  return { source, payload }
}

/** Export saved original bytes, never a reconstruction of the analysed geometry. */
export async function prepareOriginalStageGpx(database: IDBDatabase, tripId: TripId, dayId: TripDayId): Promise<PreparedGpxDownload> {
  const bundle = await loadBundle(database, tripId)
  const stage = bundle.stages.find(stage => stage.dayId === dayId)
  if (stage === undefined) throw new Error('Cette étape ne possède pas de GPX.')
  const { source, payload } = await sourceForStage(database, bundle, stage)
  const blob = payload.content instanceof Blob ? payload.content : new Blob([payload.content], { type: 'application/gpx+xml' })
  return { blob, filename: source.originalName }
}

/** An archive is complete or rejected explicitly; a missing stage is never silently skipped. */
export async function prepareOriginalTripGpx(database: IDBDatabase, tripId: TripId, now: string): Promise<PreparedGpxDownload> {
  const bundle = await loadBundle(database, tripId)
  const entries: ZipEntryInput[] = []
  for (const day of [...bundle.days].sort((a, b) => a.index - b.index)) {
    if (day.type !== 'ride') continue
    const stage = bundle.stages.find(stage => stage.dayId === day.id)
    if (stage === undefined) throw new Error('Une étape est indisponible. Aucun fichier n’a été exporté.')
    const { source, payload } = await sourceForStage(database, bundle, stage)
    const buffer = payload.content instanceof Blob ? await payload.content.arrayBuffer() : payload.content
    entries.push({ name: source.originalName, data: new Uint8Array(buffer) })
  }
  if (entries.length === 0) throw new Error('Ce voyage ne contient aucun GPX à exporter.')
  const safeName = bundle.metadata.name.replaceAll(/[\\/:*?"<>|]/g, '_').trim() || 'voyage'
  return { blob: buildZipArchive(entries, new Date(now)), filename: `${safeName}_GPX.zip` }
}
