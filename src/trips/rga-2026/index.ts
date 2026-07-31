/**
 * Public surface of the temporary RGA 2026 legacy adapter (phase 3).
 *
 * Not wired into the running application: `src/main.ts` and the UI still
 * load the RGA exclusively through the historical pipeline
 * (`rga2026TripPlan`, `src/trip/*`, `src/route/*`, `src/gpx/*`). This module
 * exists so the resulting `TripBundle` can be built, validated, and tested
 * in isolation ahead of phase 4's golden-master comparison.
 */

export * from './rga-legacy-constants.ts'
export * from './rga-legacy-mapping.ts'
export * from './load-rga-legacy-trip.ts'
