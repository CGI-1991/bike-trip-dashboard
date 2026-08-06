/**
 * The public, high-level entry point for the generic GPX import pipeline
 * (CDC section 7/11/13/16, phase 6): turns one or more GPX files into a
 * validated `TripBundle` and persists it atomically alongside their raw
 * bytes and a final `ImportJob` (phase 5's `saveTripImportAtomically`).
 *
 * Not wired into `src/main.ts` or any UI — see the module `README.md` note.
 * Every id and timestamp is supplied by the caller; nothing here reads the
 * real clock or generates a random id.
 */

import { saveTripImportAtomically } from '../../storage/indexeddb/atomic-import.ts'
import type { ImportJob } from '../../storage/indexeddb/import-job-repository.ts'
import type { SourceFilePayloadInput } from '../../storage/indexeddb/source-file-repository.ts'
import type { Climb, RideStage, Route, RoutePoint, SourceFile, TripBundle, TripDay } from '../../trip-core/index.ts'
import { sourceFileId as toSourceFileId, validateTripBundle } from '../../trip-core/index.ts'
import { isIsoDate, isNonEmptyString, isNonNegativeInteger, isPositiveNumber, isSlug, isTimeOfDay } from '../../trip-core/validation/primitives.ts'
import { analyzeGpxDocument } from './analyze-gpx.ts'
import { GpxXmlParseError, parseGpxXml } from './gpx-xml.ts'
import { sha256Hex } from './hash.ts'
import { createInitialImportJob, transitionImportJob } from './import-job.ts'
import { analyzeRouteTerrainClimbsAndTiming } from './route-analysis.ts'
import { buildRouteFromAnalysis } from './route-builder.ts'
import { buildSourceFile, validateGpxImportFile } from './source-file.ts'
import { buildStageAndDay } from './stage-builder.ts'
import { assembleTripBundle } from './trip-builder.ts'
import type {
  GpxImportFile,
  GpxTripImportOptions,
  GpxTripImportResult,
  IdFactory,
  ImportError,
  ImportErrorCode,
  ImportIssue,
  NowFn,
  ResolvedGpxTripImportOptions,
} from './types.ts'
import { GpxImportError, importIssue } from './types.ts'
import { applyDayStructure } from './day-structure.ts'
import type { DayStructureSlot } from './day-structure.ts'

/**
 * Real, non-simulated progress markers (CDC phase 6C1 section 20) — each
 * one only ever fires once the work it names has actually happened.
 * `'reading'`/`'validating'` fire once for the whole batch; `'analyzing'`/
 * `'climbs'`/`'stages'` fire once per file, in that order, as that file's
 * own processing reaches each point (a caller wanting a single "done"
 * marker per phase can just track the highest one reached so far).
 */
export type ImportProgressLabel = 'reading' | 'validating' | 'analyzing' | 'climbs' | 'stages' | 'saving'

export interface ImportGpxTripInput {
  readonly files: readonly GpxImportFile[]
  readonly options: GpxTripImportOptions
  readonly database: IDBDatabase
  readonly idFactory: IdFactory
  readonly now: NowFn
  /**
   * Optional OFF/transfer day structure (CDC phase 6C1 section 14/15/19) —
   * applied to the ride-only bundle `assembleTripBundle` just produced,
   * before validation and the atomic save, so the whole trip (rides +
   * inserted days) still lands in a single transaction. Omit for the
   * default "one GPX = one ride day" structure.
   */
  readonly dayStructure?: readonly DayStructureSlot[]
  /** Optional progress callback — see `ImportProgressLabel`. Never required for correctness, purely observational. */
  readonly onProgress?: (label: ImportProgressLabel) => void
}

/** Same complete 6C1 analysis/build pipeline, without opening a storage transaction. Used by structural editing before its single atomic replacement write. */
export type BuildGpxTripInput = Omit<ImportGpxTripInput, 'database'>

const DEFAULT_REFERENCE_SPEED_KPH = 18
const DEFAULT_DEPARTURE_TIME = '08:00'
const DEFAULT_TOTAL_BREAK_MINUTES = 60
const DEFAULT_LANGUAGE = 'fr'

function resolveOptions(raw: GpxTripImportOptions): { readonly options: ResolvedGpxTripImportOptions } | { readonly issues: readonly ImportIssue[] } {
  const issues: ImportIssue[] = []

  if (!isNonEmptyString(raw.tripId)) issues.push(importIssue('validation-error', 'error', 'tripId est requis.'))
  if (!isSlug(raw.slug)) issues.push(importIssue('validation-error', 'error', `slug invalide : ${String(raw.slug)}.`))
  if (!isNonEmptyString(raw.name)) issues.push(importIssue('validation-error', 'error', 'name est requis.'))
  if (!isNonEmptyString(raw.importedAt)) issues.push(importIssue('validation-error', 'error', 'importedAt est requis.'))
  if (!isNonEmptyString(raw.engineVersion)) issues.push(importIssue('validation-error', 'error', 'engineVersion est requis.'))

  const referenceSpeedKph = raw.referenceSpeedKph ?? DEFAULT_REFERENCE_SPEED_KPH
  if (!isPositiveNumber(referenceSpeedKph)) issues.push(importIssue('validation-error', 'error', 'referenceSpeedKph doit être > 0.'))

  const departureTime = raw.departureTime ?? DEFAULT_DEPARTURE_TIME
  if (!isTimeOfDay(departureTime)) issues.push(importIssue('validation-error', 'error', 'departureTime doit être au format HH:MM.'))

  const totalBreakMinutes = raw.totalBreakMinutes ?? DEFAULT_TOTAL_BREAK_MINUTES
  if (totalBreakMinutes !== 'adaptive' && !isNonNegativeInteger(totalBreakMinutes)) {
    issues.push(importIssue('validation-error', 'error', "totalBreakMinutes doit être un entier ≥ 0, ou 'adaptive'."))
  }

  const startDate = raw.startDate ?? null
  const timezone = raw.timezone ?? null
  if (startDate !== null) {
    if (!isIsoDate(startDate)) issues.push(importIssue('validation-error', 'error', 'startDate doit être une date ISO valide.'))
    if (!isNonEmptyString(timezone)) {
      issues.push(importIssue('validation-error', 'error', 'timezone est requis dès que startDate est fourni (aucune détection implicite du fuseau).'))
    }
  }

  if (issues.length > 0) return { issues }

  return {
    options: {
      tripId: raw.tripId,
      slug: raw.slug,
      name: raw.name,
      timezone: startDate === null ? null : timezone,
      language: raw.language ?? DEFAULT_LANGUAGE,
      units: raw.units ?? 'metric',
      startDate,
      referenceSpeedKph,
      departureTime,
      totalBreakMinutes,
      mountainMode: raw.mountainMode ?? false,
      importedAt: raw.importedAt,
      engineVersion: raw.engineVersion,
    },
  }
}

function toImportError(code: ImportErrorCode, issues: readonly ImportIssue[]): ImportError {
  const firstBlocking = issues.find((issue) => issue.severity === 'error')
  return { code, message: firstBlocking?.message ?? 'Échec de l’import GPX.' }
}

function failed(job: ImportJob, now: string, issues: readonly ImportIssue[], code: ImportErrorCode): GpxTripImportResult {
  const error = toImportError(code, issues)
  const job2 = transitionImportJob(job, 'failed', now, { error: error.message, issues })
  return { ok: false, importJob: job2, issues, error }
}

interface PerFileParsed {
  readonly file: GpxImportFile
  readonly sha256: string
  readonly sourceFileIdValue: string
}

async function hashAndAssignIds(files: readonly GpxImportFile[], idFactory: IdFactory): Promise<readonly PerFileParsed[]> {
  return Promise.all(
    files.map(async (file) => ({ file, sha256: await sha256Hex(file.bytes), sourceFileIdValue: idFactory() })),
  )
}

function detectDuplicates(entries: readonly PerFileParsed[]): readonly ImportIssue[] {
  const issues: ImportIssue[] = []
  const seenBySha256 = new Map<string, string>()
  for (const entry of entries) {
    const firstFileName = seenBySha256.get(entry.sha256)
    if (firstFileName !== undefined) {
      issues.push(
        importIssue('duplicate-file', 'error', `${entry.file.name} est un doublon octet-pour-octet de ${firstFileName} (sha256 identique).`, {
          fileName: entry.file.name,
        }),
      )
    } else {
      seenBySha256.set(entry.sha256, entry.file.name)
    }
  }
  return issues
}

async function processGpxTrip(input: BuildGpxTripInput & { readonly database: IDBDatabase | null }): Promise<GpxTripImportResult> {
  const { idFactory, now: nowFn } = input
  const creationTimestamp = nowFn()
  let job = createInitialImportJob(idFactory(), creationTimestamp, input.options.engineVersion)

  if (input.files.length === 0) {
    return failed(job, creationTimestamp, [importIssue('invalid-file', 'error', 'Aucun fichier GPX fourni.')], 'invalid-file')
  }

  const resolved = resolveOptions(input.options)
  if ('issues' in resolved) {
    return failed(job, creationTimestamp, resolved.issues, 'validation-error')
  }
  const options = resolved.options

  job = transitionImportJob(job, 'parsing', nowFn())
  input.onProgress?.('reading')

  const fileValidationIssues = input.files.flatMap((file) => validateGpxImportFile(file))
  if (fileValidationIssues.length > 0) {
    return failed(job, nowFn(), fileValidationIssues, 'invalid-file')
  }

  const hashedFiles = await hashAndAssignIds(input.files, idFactory)
  const duplicateIssues = detectDuplicates(hashedFiles)
  if (duplicateIssues.length > 0) {
    return failed(job, nowFn(), duplicateIssues, 'duplicate-file')
  }
  input.onProgress?.('validating')

  const allIssues: ImportIssue[] = []
  const sourceFiles: SourceFile[] = []
  const routes: Route[] = []
  const routePoints: RoutePoint[] = []
  const stages: RideStage[] = []
  const days: TripDay[] = []
  const climbs: Climb[] = []
  let blockingCode: ImportErrorCode | null = null

  hashedFiles.forEach((entry, index) => {
    if (blockingCode !== null) return
    try {
      const document = parseGpxXml(new TextDecoder('utf-8').decode(entry.file.bytes))
      const analysis = analyzeGpxDocument(document, entry.file.name)
      allIssues.push(...analysis.issues)
      input.onProgress?.('analyzing')

      const sourceFile = buildSourceFile(
        entry.file,
        entry.sourceFileIdValue,
        entry.sha256,
        options.importedAt,
        analysis.issues.some((issue) => issue.code === 'invalid-coordinate' || issue.code === 'gpx-discontinuity') ? 'partial' : 'success',
        analysis.issues.map((issue) => issue.message),
      )
      sourceFiles.push(sourceFile)

      const routeIdValue = idFactory()
      const { route, routePoints: builtRoutePoints } = buildRouteFromAnalysis(analysis, sourceFile.id, routeIdValue, options.engineVersion, idFactory)
      routes.push(route)
      routePoints.push(...builtRoutePoints)

      const routeAnalysis = analyzeRouteTerrainClimbsAndTiming(
        analysis,
        route.id,
        idFactory,
        options.engineVersion,
        { referenceSpeedKph: options.referenceSpeedKph, departureTime: options.departureTime, totalBreakMinutes: options.totalBreakMinutes },
        entry.file.name,
      )
      allIssues.push(...routeAnalysis.issues)
      climbs.push(...routeAnalysis.climbs)
      input.onProgress?.('climbs')

      const { stage, day } = buildStageAndDay({
        index,
        route,
        routePoints: builtRoutePoints,
        stageIdValue: idFactory(),
        dayIdValue: idFactory(),
        startDate: options.startDate,
        metricsProvenance: route.provenance,
        timing: routeAnalysis.timing,
        climbIds: routeAnalysis.climbs.map((climb) => climb.id),
      })
      stages.push(stage)
      days.push(day)
      input.onProgress?.('stages')
    } catch (error) {
      if (error instanceof GpxXmlParseError) {
        allIssues.push(importIssue('invalid-xml', 'error', `${entry.file.name} : ${error.message}`, { fileName: entry.file.name, sourceFileId: entry.sourceFileIdValue }))
        blockingCode = 'invalid-xml'
      } else if (error instanceof GpxImportError) {
        allIssues.push(importIssue(error.code as ImportIssue['code'], 'error', error.message, { fileName: entry.file.name, sourceFileId: entry.sourceFileIdValue }))
        blockingCode = error.code as ImportErrorCode
      } else {
        throw error
      }
    }
  })

  if (blockingCode !== null) {
    return failed(job, nowFn(), allIssues, blockingCode)
  }

  const assembledBundle: TripBundle = assembleTripBundle({ options, sourceFiles, routes, routePoints, stages, days, climbs })

  let bundle: TripBundle
  try {
    bundle = input.dayStructure === undefined ? assembledBundle : applyDayStructure(assembledBundle, input.dayStructure, idFactory)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Structure de journées invalide.'
    return failed(job, nowFn(), [...allIssues, importIssue('validation-error', 'error', message)], 'validation-error')
  }

  job = transitionImportJob(job, 'validating', nowFn(), { sourceFileIds: sourceFiles.map((file) => file.id) })

  const validation = validateTripBundle(bundle)
  if (!validation.ok) {
    const validationIssues = validation.issues.map((issue) =>
      importIssue('validation-error', 'error', `${issue.path} : ${issue.message}`, { context: { code: issue.code } }),
    )
    return failed(job, nowFn(), [...allIssues, ...validationIssues], 'validation-error')
  }

  job = transitionImportJob(job, 'writing', nowFn(), { tripId: options.tripId, progress: 0.9 })
  input.onProgress?.('saving')

  const sourcePayloads: readonly SourceFilePayloadInput[] = input.files.map((file, index) => ({
    sourceFileId: toSourceFileId(hashedFiles[index]?.sourceFileIdValue ?? ''),
    content: file.bytes,
  }))

  const readyJob = transitionImportJob(job, 'ready', nowFn(), { tripId: options.tripId, progress: 1, issues: allIssues })

  if (input.database !== null) {
    try {
      await saveTripImportAtomically(input.database, { bundle: validation.value, sourcePayloads, importJob: readyJob })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Échec de l’écriture IndexedDB.'
      return failed(job, nowFn(), [...allIssues, importIssue('storage-error', 'error', message)], 'storage-error')
    }
  }

  return { ok: true, bundle: validation.value, importJob: readyJob, issues: allIssues }
}

export function buildGpxTrip(input: BuildGpxTripInput): Promise<GpxTripImportResult> {
  return processGpxTrip({ ...input, database: null })
}

export function importGpxTrip(input: ImportGpxTripInput): Promise<GpxTripImportResult> {
  return processGpxTrip(input)
}
