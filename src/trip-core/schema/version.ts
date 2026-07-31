import type { TripBundleV1 } from '../model/trip-bundle.ts'

/**
 * The single source of truth for the current schema version. Never repeat
 * the literal `1` elsewhere in trip-core — import this constant/type
 * instead.
 */
export const CURRENT_TRIP_BUNDLE_SCHEMA_VERSION = 1 as const

export type TripBundleSchemaVersion = typeof CURRENT_TRIP_BUNDLE_SCHEMA_VERSION

/**
 * Alias of whichever version is current. Code should depend on this, not
 * `TripBundleV1` directly. `TripBundleV1` itself is defined (and exported)
 * in `../model/trip-bundle.ts`, not re-exported here, so the barrel
 * (`../index.ts`) never sees the same name from two star-exports.
 */
export type TripBundle = TripBundleV1
