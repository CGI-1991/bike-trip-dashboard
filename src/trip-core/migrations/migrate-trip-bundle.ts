import { CURRENT_TRIP_BUNDLE_SCHEMA_VERSION } from '../schema/version.ts'
import type { TripBundle } from '../schema/version.ts'
import { validateTripBundle } from '../validation/trip-bundle.ts'
import type { ValidationResult } from '../validation/types.ts'
import type { TripBundleMigration } from './types.ts'

/**
 * Registered migrations, keyed by the version they migrate away from. Empty
 * in v1: schema version 1 is the first version that has ever existed, so
 * there is nothing to migrate from — no invented V0 -> V1 step.
 */
const migrations: readonly TripBundleMigration[] = []

function findMigration(fromVersion: number): TripBundleMigration | undefined {
  return migrations.find((migration) => migration.fromVersion === fromVersion)
}

/**
 * Migrates an unknown value to the current TripBundle schema version and
 * validates the result.
 *
 * - a bundle already at the current version is returned unmodified
 *   (semantically) after validation;
 * - an unknown future version is refused explicitly;
 * - an older version with no registered migration is refused explicitly —
 *   never silently accepted or dropped;
 * - migrations never mutate their input, and this function never touches
 *   disk or IndexedDB.
 */
export function migrateTripBundle(value: unknown): ValidationResult<TripBundle> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return validateTripBundle(value)
  }

  const schemaVersion = (value as { readonly schemaVersion?: unknown }).schemaVersion

  if (schemaVersion === CURRENT_TRIP_BUNDLE_SCHEMA_VERSION) {
    return validateTripBundle(value)
  }

  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    // Not a recognizable version at all — let the structural validator report it.
    return validateTripBundle(value)
  }

  if (schemaVersion > CURRENT_TRIP_BUNDLE_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        {
          path: 'schemaVersion',
          code: 'unsupported-future-schema-version',
          message: `Version de schéma future non prise en charge : ${schemaVersion}.`,
        },
      ],
    }
  }

  let currentVersion = schemaVersion
  let currentValue: unknown = value

  while (currentVersion < CURRENT_TRIP_BUNDLE_SCHEMA_VERSION) {
    const migration = findMigration(currentVersion)
    if (migration === undefined) {
      return {
        ok: false,
        issues: [
          {
            path: 'schemaVersion',
            code: 'no-migration-registered',
            message: `Aucune migration enregistrée depuis la version ${currentVersion}.`,
          },
        ],
      }
    }
    currentValue = migration.migrate(currentValue)
    currentVersion = migration.toVersion
  }

  return validateTripBundle(currentValue)
}
