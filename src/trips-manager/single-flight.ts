/**
 * Guarantees at most one call in flight per key (stability hardening
 * 2026-08-04 — fixes a real bug: `startAutomaticEnrichment` used to check
 * "already running?" and only claim the lock *after* its first `await`,
 * so two calls issued back-to-back — a double click on "Ouvrir", or
 * navigating away and back before the first job settles — both passed the
 * check before either had claimed it, and both ran a full Postpass
 * enrichment job concurrently for the same trip).
 *
 * The claim (`inFlight.add(key)`) happens synchronously, before `fn` is
 * even invoked — there is no `await` between the check and the claim, so a
 * second call issued in the same synchronous turn can never slip through.
 */
export interface SingleFlightGuard<K> {
  readonly isInFlight: (key: K) => boolean
  /** Runs `fn` for `key` unless a call for that same key is already in flight, in which case this resolves immediately without calling `fn`. */
  readonly run: (key: K, fn: () => Promise<void>) => Promise<void>
}

export function createSingleFlightGuard<K>(): SingleFlightGuard<K> {
  const inFlight = new Set<K>()
  return {
    isInFlight(key: K): boolean {
      return inFlight.has(key)
    },
    async run(key: K, fn: () => Promise<void>): Promise<void> {
      if (inFlight.has(key)) return
      inFlight.add(key)
      try {
        await fn()
      } finally {
        inFlight.delete(key)
      }
    },
  }
}
