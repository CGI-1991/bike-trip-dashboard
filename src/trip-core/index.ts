/**
 * Public surface of the generic trip-core domain (TripBundle v1).
 *
 * Not yet wired into the application: `src/main.ts` and the UI renderers
 * keep depending on the legacy `src/trip/*` pipeline. This barrel exists for
 * future phases (a legacy-trip adapter, then multi-trip UI) and for tests.
 */

export * from './model/ids.ts'
export * from './model/common.ts'
export * from './model/provenance.ts'
export * from './model/source-file.ts'
export * from './model/trip-metadata.ts'
export * from './model/trip-calendar.ts'
export * from './model/trip-day.ts'
export * from './model/ride-stage.ts'
export * from './model/route.ts'
export * from './model/climb.ts'
export * from './model/route-point.ts'
export * from './model/practical-place.ts'
export * from './model/accommodation.ts'
export * from './model/weather.ts'
export * from './model/settings.ts'
export * from './model/overrides.ts'
export * from './model/generated-metadata.ts'
export * from './model/trip-bundle.ts'

export * from './schema/version.ts'

export * from './validation/types.ts'
export * from './validation/trip-bundle.ts'

export * from './migrations/types.ts'
export * from './migrations/migrate-trip-bundle.ts'

export * from './selectors/trip-selectors.ts'
