/**
 * Migration from the old stage-level completion record to the micro-segment
 * one, and the reset used by "Recalculer les données du parcours".
 *
 * ## The inconsistency this has to repair
 *
 * The previous model stamped a stage's route fingerprint into
 * `EnrichmentProviderState.settledFingerprints` as soon as the stage had
 * been ATTEMPTED — including when some of its segments had timed out. A
 * trip saved under that model can therefore be internally contradictory:
 * the provider says `partial` or `error`, and yet every stage is marked
 * settled. Read naively, such a trip looks finished and never gets touched
 * again, which is exactly how a stage ends up enriched over its first
 * stretch only, forever.
 *
 * So the migration cannot simply trust the old marks. It has to decide, per
 * provider, whether the old record is credible:
 *
 * - provider `success` — the pass really did finish cleanly. Its stages are
 *   migrated to complete, with no network call. A healthy trip stays
 *   healthy and is never re-fetched.
 * - provider `partial` / `error` — the old marks are known to be unreliable,
 *   because that is precisely the case the old code stamped anyway. Those
 *   stages are migrated as NOT complete and get a fresh job plan, so the
 *   missing work is picked up automatically.
 *
 * This is deliberately conservative in one direction only: a healthy trip is
 * never needlessly re-queried, and a doubtful one is re-checked rather than
 * trusted.
 */

import type { EnrichmentProvider, StageEnrichmentJobs, TripBundle } from '../trip-core/index.ts'
import {
  enrichableStageIds,
  planStageJobs,
  stageFingerprintFor,
  stageJobsFor,
  stageRouteLengthKm,
  withoutEnrichmentJobs,
} from './enrichment-jobs.ts'
import type { EnrichmentJob, EnrichmentJobPhase } from './enrichment-jobs.ts'

const STRUCTURAL_PROVIDER = 'postpass-route-enrichment'
const PRACTICAL_PROVIDER = 'postpass-practical-places'

function providerTrustworthy(bundle: TripBundle, provider: EnrichmentProvider): boolean {
  return bundle.enrichmentMetadata.providers.find((state) => state.provider === provider)?.status === 'success'
}

function legacySettled(bundle: TripBundle, provider: EnrichmentProvider, fingerprint: string): boolean {
  const settled = bundle.enrichmentMetadata.providers.find((state) => state.provider === provider)?.settledFingerprints
  return settled !== undefined && settled.includes(fingerprint)
}

/**
 * One phase's migrated job list for one stage: a single job covering the
 * whole route, already complete, when the old record is credible; otherwise
 * a fresh pending plan.
 *
 * The "already complete" case is represented as one whole-route job rather
 * than a reconstructed 20 km plan because that is honestly what the old pass
 * did — one request per stage. Inventing a segmented history it never had
 * would claim more precision than exists.
 */
function migratedPhaseJobs(bundle: TripBundle, kind: EnrichmentJobPhase, totalKm: number, fingerprint: string): readonly EnrichmentJob[] {
  const provider = kind === 'structural' ? STRUCTURAL_PROVIDER : PRACTICAL_PROVIDER
  const credible = providerTrustworthy(bundle, provider) && legacySettled(bundle, provider, fingerprint)
  if (!credible) return planStageJobs(totalKm, kind)
  return [{ kind, startKm: 0, endKm: Math.round(totalKm * 1_000) / 1_000, status: 'success', attempts: 1 }]
}

/**
 * Brings a bundle up to the micro-segment model if it is not already, and
 * returns it unchanged when nothing needs doing (so callers can compare by
 * reference and skip a pointless save).
 *
 * Idempotent: a bundle that already has a job record for every enrichable
 * stage, planned against its current route, is returned as-is.
 */
export function migrateEnrichmentJobs(bundle: TripBundle): TripBundle {
  const stageIds = enrichableStageIds(bundle)
  if (stageIds.length === 0) return bundle

  const migrated: StageEnrichmentJobs[] = []
  let changed = false

  for (const stageId of stageIds) {
    const fingerprint = stageFingerprintFor(bundle, stageId)
    const totalKm = stageRouteLengthKm(bundle, stageId)
    if (fingerprint === null || totalKm === null) continue
    const existing = stageJobsFor(bundle, stageId)
    if (existing !== undefined && existing.routeFingerprint === fingerprint) {
      migrated.push(existing)
      continue
    }
    changed = true
    migrated.push({
      stageId,
      routeFingerprint: fingerprint,
      jobs: [
        ...migratedPhaseJobs(bundle, 'structural', totalKm, fingerprint),
        ...migratedPhaseJobs(bundle, 'practical', totalKm, fingerprint),
      ],
    })
  }

  if (!changed) return bundle
  const stageOrder = bundle.stages.map((stage) => stage.id)
  return {
    ...bundle,
    enrichmentMetadata: {
      ...bundle.enrichmentMetadata,
      enrichmentJobs: migrated.slice().sort((left, right) => stageOrder.indexOf(left.stageId) - stageOrder.indexOf(right.stageId)),
    },
  }
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
