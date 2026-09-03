/**
 * The persistent record of what enrichment work has actually been DONE, one
 * micro-segment at a time.
 *
 * ## Why this exists
 *
 * The previous model recorded completion per STAGE, as a route fingerprint
 * stamped once the stage had been "attempted". That conflated two very
 * different things. A 120 km stage whose 60–80 km segment timed out was
 * stamped exactly like one that succeeded end to end, so every later pass
 * skipped it and the stage stayed enriched over its first stretch only,
 * permanently. Attempting is not completing.
 *
 * Here, the unit of completion is the micro-segment that was actually
 * requested. A stage is complete only when every one of its segments has a
 * real answer, and a segment that failed stays visibly unfinished until it
 * gets one.
 *
 * ## States
 *
 * - `pending` — never attempted, or attempted and not yet resolved.
 * - `success` — the provider answered and returned something.
 * - `empty` — the provider answered correctly and there is genuinely nothing
 *   here. This is a completed state, not a failure: an empty stretch of
 *   countryside is a real answer.
 * - `waiting-for-network` — could not be attempted because there was no
 *   network. Distinct from `pending` so the UI can say "waiting for a
 *   connection" rather than "preparing", and so it is never mistaken for
 *   work that simply has not started yet.
 *
 * `running` is deliberately NOT persisted. A `running` record surviving a
 * crash would be indistinguishable from one that is genuinely in flight, and
 * the pass would have to guess. In-memory, the orchestrator knows what it is
 * working on; on disk, a job is either finished or it is not.
 *
 * ## Identity and subdivision
 *
 * A job's identity is its kilometre range within its stage. That is what
 * makes subdivision safe: when 20–40 turns out to be too heavy and becomes
 * 20–30 and 30–40, the already-successful 0–20 keeps its identity and is
 * never requested again. Ranges are rounded to a fixed precision so the same
 * route always yields the same ids across sessions.
 */

import type { EnrichmentJob, EnrichmentJobPhase, RideStageId, StageEnrichmentJobs, TripBundle } from '../trip-core/index.ts'
import { routeFingerprint, routeGeometry } from './route-fingerprint.ts'
import { cumulativeGeometryDistances } from './chunking.ts'

export type { EnrichmentJob, EnrichmentJobPhase, EnrichmentJobStatus, StageEnrichmentJobs } from '../trip-core/index.ts'

/**
 * Starting segment length. 20 km rather than the previous 60 because raw
 * length is a poor predictor of query cost: a dense Belgian corridor can
 * carry an order of magnitude more OSM objects per kilometre than an alpine
 * one. Starting smaller costs a few more requests on easy routes and saves
 * the hard routes entirely.
 */
export const INITIAL_SEGMENT_KM = 20

/**
 * Segments overlap slightly so a village, col or POI sitting exactly on a
 * boundary is seen by both neighbours rather than falling between them.
 * Duplicates are removed downstream by the existing `osmType:osmId` merge.
 */
export const SEGMENT_OVERLAP_KM = 1

/**
 * Subdivision floor. Below this, a failing segment is almost certainly
 * failing for a reason splitting cannot fix (a provider outage, a malformed
 * area), and halving further would just multiply requests. 20 → 10 → 5 →
 * 2.5 gives four attempts at decreasing cost, which is enough to get through
 * any realistically dense stretch.
 */
export const MINIMUM_SEGMENT_KM = 2.5

/**
 * How many too-heavy failures one stage may absorb in a single pass before
 * the pass gives that stage up for now.
 *
 * Subdivision answers "this request asked for too much". If it keeps failing
 * all the way down, the premise is wrong: the provider is unwell, and
 * halving again just multiplies requests against something already
 * struggling. Left unbounded, a single 20 km job against a failing endpoint
 * would issue fifteen requests (1 + 2 + 4 + 8) before reaching the floor —
 * a retry storm by any other name.
 *
 * Stopping is cheap here precisely because nothing is lost: the remaining
 * jobs stay outstanding, and the next pass picks them up.
 */
export const MAX_TOO_HEAVY_FAILURES_PER_PASS = 4

/** Fixed precision so a range always produces the same id, in any session. */
function km(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

export function jobId(job: Pick<EnrichmentJob, 'kind' | 'startKm' | 'endKm'>): string {
  return `${job.kind}:${km(job.startKm).toFixed(3)}-${km(job.endKm).toFixed(3)}`
}

export function isJobComplete(job: EnrichmentJob): boolean {
  return job.status === 'success' || job.status === 'empty'
}

/** The total route length a stage's jobs must cover, or `null` when it has no usable geometry. */
export function stageRouteLengthKm(bundle: TripBundle, stageId: RideStageId): number | null {
  const stage = bundle.stages.find((candidate) => candidate.id === stageId)
  const route = stage === undefined ? undefined : bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  const geometry = route === undefined ? null : routeGeometry(route)
  if (geometry === null) return null
  const distances = cumulativeGeometryDistances(geometry)
  const total = distances[distances.length - 1] ?? 0
  return total > 0 ? total : null
}

/**
 * The initial job plan for one phase of one stage: contiguous segments of
 * `segmentKm`, each overlapping its predecessor slightly.
 *
 * A route at or under one segment length yields a single job covering the
 * whole thing, so short stages behave exactly as one plain request — the
 * segmentation machinery costs them nothing.
 */
export function planStageJobs(totalKm: number, kind: EnrichmentJobPhase, segmentKm: number = INITIAL_SEGMENT_KM): readonly EnrichmentJob[] {
  if (!(totalKm > 0)) return []
  if (!(segmentKm > 0) || totalKm <= segmentKm) {
    return [{ kind, startKm: 0, endKm: km(totalKm), status: 'pending', attempts: 0 }]
  }
  const step = Math.max(segmentKm / 2, segmentKm - SEGMENT_OVERLAP_KM)
  const jobs: EnrichmentJob[] = []
  for (let startKm = 0; startKm < totalKm; startKm += step) {
    const endKm = Math.min(totalKm, startKm + segmentKm)
    // A trailing sliver — say the last 2 km of a 40 km route — is not worth
    // a request of its own: it would cost a full round-trip to cover ground
    // the previous segment can simply be extended over. Overlap already
    // makes segments slightly longer than `step`, so absorbing the remainder
    // keeps every job within a sensible size.
    const remainder = totalKm - endKm
    if (remainder > 0 && remainder < MINIMUM_SEGMENT_KM) {
      jobs.push({ kind, startKm: km(startKm), endKm: km(totalKm), status: 'pending', attempts: 0 })
      break
    }
    jobs.push({ kind, startKm: km(startKm), endKm: km(endKm), status: 'pending', attempts: 0 })
    if (endKm >= totalKm) break
  }
  return jobs
}

/**
 * Splits one too-heavy job in half. The children replace the parent: the
 * parent range is no longer outstanding work, so it must not remain in the
 * plan alongside them or the stage could never reach completion.
 *
 * Returns `null` at the floor — the caller then leaves the job pending
 * rather than splitting into uselessly small pieces.
 */
export function subdivideJob(job: EnrichmentJob): readonly EnrichmentJob[] | null {
  const length = job.endKm - job.startKm
  if (length <= MINIMUM_SEGMENT_KM) return null
  const middle = km(job.startKm + length / 2)
  if (middle <= job.startKm || middle >= job.endKm) return null
  return [
    { kind: job.kind, startKm: job.startKm, endKm: middle, status: 'pending', attempts: 0 },
    { kind: job.kind, startKm: middle, endKm: job.endKm, status: 'pending', attempts: 0 },
  ]
}

/**
 * Merges a job list update into a stage's record, keeping jobs in
 * kilometre order so two identical passes persist an identical value (no
 * spurious `updatedAt` churn, no golden-master drift).
 */
export function sortJobs(jobs: readonly EnrichmentJob[]): readonly EnrichmentJob[] {
  return [...jobs].sort((left, right) => left.kind.localeCompare(right.kind) || left.startKm - right.startKm || left.endKm - right.endKm)
}

export function stageJobsFor(bundle: TripBundle, stageId: RideStageId): StageEnrichmentJobs | undefined {
  return bundle.enrichmentMetadata.enrichmentJobs?.find((entry) => entry.stageId === stageId)
}

/**
 * The stages this trip can enrich at all — a stage with no usable route
 * geometry is out of scope, not incomplete.
 */
export function enrichableStageIds(bundle: TripBundle): readonly RideStageId[] {
  return bundle.stages
    .filter((stage) => {
      const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
      return route !== undefined && routeGeometry(route) !== null
    })
    .map((stage) => stage.id)
}

export function stageFingerprintFor(bundle: TripBundle, stageId: RideStageId): string | null {
  const stage = bundle.stages.find((candidate) => candidate.id === stageId)
  const route = stage === undefined ? undefined : bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  return route === undefined ? null : routeFingerprint(bundle, route)
}

/**
 * Whether one phase of one stage is genuinely finished: it has a plan, that
 * plan was made against the route's CURRENT fingerprint, and every job in it
 * has a real answer.
 *
 * A stale fingerprint means the GPX changed under us — the old plan describes
 * a route that no longer exists, so the phase is not complete and will be
 * replanned.
 */
export function isStagePhaseComplete(bundle: TripBundle, stageId: RideStageId, kind: EnrichmentJobPhase): boolean {
  const record = stageJobsFor(bundle, stageId)
  if (record === undefined) return false
  if (record.routeFingerprint !== stageFingerprintFor(bundle, stageId)) return false
  const phaseJobs = record.jobs.filter((job) => job.kind === kind)
  if (phaseJobs.length === 0) return false
  return phaseJobs.every(isJobComplete)
}

/**
 * The hard gate the whole pipeline turns on: POI work may not begin anywhere
 * in the trip until the structural geography of EVERY ride stage is
 * complete.
 *
 * Trip-wide rather than per-stage on purpose. The POI phase searches around
 * real places, and the pause phase then chooses among them; letting stage 1
 * proceed on the strength of its own structure while stage 6 is still
 * missing half its villages produces a trip whose early stages look finished
 * and whose later ones silently are not — exactly the failure this replaces.
 */
export function isStructuralGloballyComplete(bundle: TripBundle): boolean {
  const stageIds = enrichableStageIds(bundle)
  if (stageIds.length === 0) return true
  // A structural pass that has never run at all means the phase does not
  // apply here — no structural provider is configured in this deployment or
  // test. Gating on a phase that can never run would block POI forever
  // instead of ordering them.
  //
  // Keyed on the provider's own history rather than on the presence of
  // structural jobs: the migration plans jobs for both phases up front, so
  // "has structural jobs" is true even where nothing will ever run them.
  const structuralAttempted = bundle.enrichmentMetadata.providers
    .some((state) => state.provider === 'postpass-route-enrichment' && state.lastAttemptedAt !== null)
  if (!structuralAttempted) return true
  return stageIds.every((stageId) => isStagePhaseComplete(bundle, stageId, 'structural'))
}

/** A stage is ready for its pauses once both of its phases have really finished. */
export function isStageFullyEnriched(bundle: TripBundle, stageId: RideStageId): boolean {
  return isStagePhaseComplete(bundle, stageId, 'structural') && isStagePhaseComplete(bundle, stageId, 'practical')
}

/**
 * Whether a stage may show an automatic pause plan — the single predicate
 * every view goes through, so no surface can disagree with another about
 * whether a stage is ready.
 *
 * A trip that has no job record at all is treated as allowed. That covers
 * two cases that must keep working: a deployment with no enrichment
 * providers configured (nothing will ever populate the record, and gating
 * forever would mean never a single pause), and every existing fixture and
 * unit test written before this record existed.
 */
export function stageAutomaticPausesAllowed(bundle: TripBundle, stageId: RideStageId): boolean {
  if (bundle.enrichmentMetadata.enrichmentJobs === undefined) return true
  return isStageFullyEnriched(bundle, stageId)
}

/** `true` when any job of this phase is still waiting on a connection rather than on us. */
export function isPhaseWaitingForNetwork(bundle: TripBundle, kind: EnrichmentJobPhase): boolean {
  return (bundle.enrichmentMetadata.enrichmentJobs ?? []).some((entry) =>
    entry.jobs.some((job) => job.kind === kind && job.status === 'waiting-for-network'))
}

/**
 * Writes a stage's job list back into the bundle, replacing any previous
 * record for that stage and keeping the list ordered by stage for stable
 * serialisation.
 */
export function withStageJobs(bundle: TripBundle, record: StageEnrichmentJobs): TripBundle {
  const others = (bundle.enrichmentMetadata.enrichmentJobs ?? []).filter((entry) => entry.stageId !== record.stageId)
  const stageOrder = bundle.stages.map((stage) => stage.id)
  const enrichmentJobs = [...others, { ...record, jobs: sortJobs(record.jobs) }]
    .sort((left, right) => stageOrder.indexOf(left.stageId) - stageOrder.indexOf(right.stageId))
  return {
    ...bundle,
    enrichmentMetadata: { ...bundle.enrichmentMetadata, enrichmentJobs },
  }
}

/** Drops every job record — the explicit "recalculate everything" reset. */
export function withoutEnrichmentJobs(bundle: TripBundle): TripBundle {
  const { enrichmentJobs: _dropped, ...rest } = bundle.enrichmentMetadata
  return { ...bundle, enrichmentMetadata: rest }
}

/**
 * The plan for one phase of one stage, creating it if it does not exist yet
 * and discarding it if it was made against a different route.
 */
export function ensureStageJobs(bundle: TripBundle, stageId: RideStageId, kind: EnrichmentJobPhase): StageEnrichmentJobs | null {
  const fingerprint = stageFingerprintFor(bundle, stageId)
  const totalKm = stageRouteLengthKm(bundle, stageId)
  if (fingerprint === null || totalKm === null) return null
  const existing = stageJobsFor(bundle, stageId)
  // A different fingerprint means a different route: the old plan's
  // kilometre ranges no longer describe anything real, so it is replaced
  // wholesale rather than merged.
  const carried = existing !== undefined && existing.routeFingerprint === fingerprint ? existing.jobs : []
  const hasPhase = carried.some((job) => job.kind === kind)
  const jobs = hasPhase ? carried : [...carried, ...planStageJobs(totalKm, kind)]
  return { stageId, routeFingerprint: fingerprint, jobs: sortJobs(jobs) }
}
