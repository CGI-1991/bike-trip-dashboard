/** Search-plan compatibility and explicit refreshes. No database deletion or schema reset. */

import type { StageEnrichmentJobs, TripBundle } from '../trip-core/index.ts'
import { enrichableStageIds, planStageJobs, SEARCH_PLAN_VERSION, stageFingerprintFor, stageJobsFor, stageRouteLengthKm, withoutEnrichmentJobs } from './enrichment-jobs.ts'

/** Revalidate only derived search state from older geometry algorithms.
 * Original traces, places and all manually entered trip data are retained.
 * Once the current plan is saved this is idempotent across app restarts.
 */
export function migrateEnrichmentJobs(bundle: TripBundle): TripBundle {
  const records: StageEnrichmentJobs[] = []
  let changed = false
  for (const stageId of enrichableStageIds(bundle)) {
    const fingerprint = stageFingerprintFor(bundle, stageId)
    const length = stageRouteLengthKm(bundle, stageId)
    if (fingerprint === null || length === null) continue
    const existing = stageJobsFor(bundle, stageId)
    if (existing?.routeFingerprint === fingerprint && existing.planVersion === SEARCH_PLAN_VERSION) {
      records.push(existing)
    } else {
      changed = true
      records.push({ stageId, routeFingerprint: fingerprint, planVersion: SEARCH_PLAN_VERSION,
        jobs: [...planStageJobs(length, 'structural'), ...planStageJobs(length, 'practical')] })
    }
  }
  if (!changed) return bundle
  return { ...bundle, enrichmentMetadata: { ...bundle.enrichmentMetadata, enrichmentJobs: records } }
}

/** Refresh POI only. Keep acquired places, structure, manual data and pause anchors. */
export function resetPracticalPlacesForRefresh(bundle: TripBundle): TripBundle {
  const migrated = migrateEnrichmentJobs(bundle)
  return { ...migrated, enrichmentMetadata: { ...migrated.enrichmentMetadata,
    practicalPlacesGeneration: (migrated.enrichmentMetadata.practicalPlacesGeneration ?? 0) + 1,
    enrichmentJobs: migrated.enrichmentMetadata.enrichmentJobs?.map(record => ({ ...record,
      jobs: record.jobs.map(job => job.kind === 'practical' ? { ...job, status: 'pending' as const, attempts: 0 } : job) })),
    providers: migrated.enrichmentMetadata.providers.map(state => state.provider === 'postpass-practical-places'
      ? { ...state, status: 'pending' as const, message: null } : state) } }
}

/**
 * The explicit "Recalculer les données du parcours" reset: forget every job
 * and drop each provider back to `pending`, so the next pass genuinely
 * re-queries everything.
 *
 * The legacy `settledFingerprints` go too — leaving them would let the
 * migration above re-derive "already complete" from the very record the user
 * just asked to discard.
 *
 * Only provider bookkeeping is touched. Custom pauses, notes, lodging,
 * reservations, transfers, location overrides and departure times live
 * elsewhere in the bundle and are structurally out of reach here.
 */
export function resetEnrichmentForRecalculation(bundle: TripBundle): TripBundle {
  const withoutJobs = withoutEnrichmentJobs(bundle)
  return {
    ...withoutJobs,
    enrichmentMetadata: {
      providers: withoutJobs.enrichmentMetadata.providers.map((state) => ({
        provider: state.provider,
        lastAttemptedAt: state.lastAttemptedAt,
        lastSuccessAt: state.lastSuccessAt,
        status: 'pending' as const,
        message: null,
      })),
    },
  }
}
