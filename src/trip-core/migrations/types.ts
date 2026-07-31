/**
 * One registered migration step, transforming a bundle shaped like
 * `fromVersion` into one shaped like `toVersion`. `migrate` must not mutate
 * its input and must not touch disk, IndexedDB, or any other storage.
 */
export interface TripBundleMigration {
  readonly fromVersion: number
  readonly toVersion: number
  migrate(value: unknown): unknown
}
