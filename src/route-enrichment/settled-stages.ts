/**
 * DER-DES-DER sections 26/31-33 — the single place that answers "has this
 * provider already finished with this stage?".
 *
 * Before this milestone every provider gate was `status !== 'success'`, which
 * made the whole pipeline re-run on EVERY trip open as soon as one stage had
 * timed out: a partial trip never stopped hitting the network, and a stage
 * that had genuinely settled was re-queried again and again (the "Postpass
 * n'est pas one-shot" symptom). Section 32 asks for the opposite: an explicit
 * record of what is done, rather than an inference from the absence of an
 * error.
 *
 * `EnrichmentProviderState.settledFingerprints` is that record, and this
 * module is the only reader/writer of it. Both Postpass providers share it,
 * so "settled" means exactly the same thing on both.
 */

import type { EnrichmentProvider, EnrichmentProviderState, Route, TripBundle } from '../trip-core/index.ts'
import { routeFingerprint, routeGeometry } from './route-fingerprint.ts'

/** The stages a provider could work on at all — a stage with no usable route geometry is never "pending", it is simply out of scope. */
export function enrichableStageFingerprints(bundle: TripBundle): readonly string[] {
  const routes = new Map(bundle.routes.map((route) => [route.id, route]))
  const fingerprints = new Set<string>()
  for (const stage of bundle.stages) {
    const route = routes.get(stage.sourceRouteId)
    if (route === undefined || routeGeometry(route) === null) continue
    fingerprints.add(routeFingerprint(bundle, route))
  }
  return [...fingerprints]
}

export function stageFingerprint(bundle: TripBundle, route: Route): string {
  return routeFingerprint(bundle, route)
}

function providerState(bundle: TripBundle, provider: EnrichmentProvider): EnrichmentProviderState | undefined {
  return bundle.enrichmentMetadata.providers.find((state) => state.provider === provider)
}

/**
 * `true` when at least one enrichable stage has never been settled by this
 * provider under its current route fingerprint.
 *
 * A bundle with no `settledFingerprints` at all (written before this
 * milestone, or never enriched) falls back to the historical status gate, so
 * behaviour is unchanged until the first pass under this build records the
 * fingerprints — after which the explicit record takes over for good.
 */
export function providerHasPendingStages(bundle: TripBundle, provider: EnrichmentProvider): boolean {
  const enrichable = enrichableStageFingerprints(bundle)
  if (enrichable.length === 0) return false
  const state = providerState(bundle, provider)
  const settled = state?.settledFingerprints
  if (settled === undefined) return state?.status !== 'success'
  const done = new Set(settled)
  return enrichable.some((fingerprint) => !done.has(fingerprint))
}

/**
 * Adds the fingerprints just settled by a pass, dropping any that no longer
 * correspond to a stage of this trip (a replaced GPX, a deleted stage) so the
 * list can never grow unbounded across re-imports. Deterministic order: the
 * trip's own enrichable order, so two identical passes persist identical
 * bundles (no spurious `updatedAt` churn, no golden-master drift).
 */
export function withSettledFingerprints(
  bundle: TripBundle,
  state: EnrichmentProviderState,
  newlySettled: readonly string[],
): EnrichmentProviderState {
  const enrichable = enrichableStageFingerprints(bundle)
  const done = new Set([...(state.settledFingerprints ?? []), ...newlySettled])
  const settledFingerprints = enrichable.filter((fingerprint) => done.has(fingerprint))
  return { ...state, settledFingerprints }
}

/**
 * Sections 48/52 — the explicit "Réessayer" on one stage's Voyage card:
 * forgets just THAT stage's settled record, for every provider, so the next
 * automatic pass genuinely re-runs it (and only it — every other stage stays
 * settled and is skipped). This is the one and only way a settled stage
 * becomes pending again short of a route change or a full recalculation.
 *
 * A provider with no settled record at all is left untouched: it is still on
 * the historical status gate, which already re-runs everything.
 */
export function unsettleStageForRetry(bundle: TripBundle, dayId: string): TripBundle {
  const stage = bundle.stages.find((candidate) => candidate.dayId === dayId)
  const route = stage === undefined ? undefined : bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  if (route === undefined) return bundle
  const fingerprint = routeFingerprint(bundle, route)
  return {
    ...bundle,
    enrichmentMetadata: {
      ...bundle.enrichmentMetadata,
      providers: bundle.enrichmentMetadata.providers.map((state) => state.settledFingerprints === undefined
        ? state
        : { ...state, settledFingerprints: state.settledFingerprints.filter((candidate) => candidate !== fingerprint) }),
    },
  }
}

/**
 * Sections 33-37 — the explicit "Recalculer les données du parcours" reset.
 *
 * Forgets every settled fingerprint AND drops each provider back to
 * `pending`, so the next automatic pass genuinely re-queries every stage
 * (clearing the fingerprints alone would fall back to the status gate and a
 * `success` provider would still be skipped). The per-stage POI error list
 * goes with it — it describes the previous pass, not the new one.
 *
 * This only ever clears provider BOOKKEEPING. Section 37's manual data —
 * custom pauses, notes, lodging, reservations, transfers, location
 * overrides, departure times — lives elsewhere in the bundle entirely and is
 * structurally out of reach here.
 */
export function resetEnrichmentForRecalculation(bundle: TripBundle): TripBundle {
  return {
    ...bundle,
    enrichmentMetadata: {
      providers: bundle.enrichmentMetadata.providers.map((state) => ({
        provider: state.provider,
        lastAttemptedAt: state.lastAttemptedAt,
        lastSuccessAt: state.lastSuccessAt,
        status: 'pending' as const,
        message: null,
      })),
    },
  }
}
