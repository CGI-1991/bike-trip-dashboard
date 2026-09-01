/**
 * C3.B — a single, shared, session-only geolocation watcher (CDC C3 sections
 * 38-50). Encapsulates `navigator.geolocation` behind a tiny pub/sub
 * service so every map surface (compact Détail map, fullscreen Étape map)
 * reads from the SAME live position — never a second `watchPosition` of its
 * own (section 43).
 *
 * Privacy (CDC section 39/61): the position is PURELY runtime/in-memory —
 * never written to `TripBundle`, IndexedDB, `localStorage`, or any cache;
 * never sent to Postpass/Open-Meteo/geocoding/any backend (section 40). It
 * exists only to render a marker locally and to build an on-demand Google
 * Maps Directions link when the user explicitly clicks for one (section
 * 55). Closing every surface that needs it (`stop()`) releases the OS-level
 * watch — no background battery drain once the last consumer unmounts.
 */

export type CurrentLocationStatus = 'idle' | 'requesting' | 'active' | 'unavailable' | 'denied'

export interface CurrentLocationPosition {
  readonly latitude: number
  readonly longitude: number
  /** Meters, or `null` when the platform doesn't report one. */
  readonly accuracyMeters: number | null
}

export interface CurrentLocationState {
  readonly status: CurrentLocationStatus
  /** The last known fix — kept even while `status` transitions to `'requesting'` again on a fresh `start()`, cleared only by `stop()` (CDC section 46: the real coordinate, never snapped/interpolated, so a stale-but-real point is still more honest than nothing while a new fix is pending). */
  readonly position: CurrentLocationPosition | null
}

const IDLE_STATE: CurrentLocationState = { status: 'idle', position: null }

/** A structural subset of the DOM `Geolocation` interface — real `navigator.geolocation` in production, a plain fake in tests (never a jsdom/browser dependency for this module itself). */
export interface GeolocationLike {
  watchPosition(
    onSuccess: (position: { readonly coords: { readonly latitude: number; readonly longitude: number; readonly accuracy: number | null } }) => void,
    onError?: (error: { readonly code: number }) => void,
    options?: PositionOptions,
  ): number
  clearWatch(id: number): void
}

export interface CurrentLocationService {
  getState(): CurrentLocationState
  /** Called immediately with the current state, then again on every change — returns the unsubscribe function. */
  subscribe(listener: (state: CurrentLocationState) => void): () => void
  /**
   * Starts (or, if already active/requesting, no-ops — CDC section 43: at
   * most one `watchPosition` ever) the shared watch. Never throws — an
   * unsupported platform or a denied/failed permission resolves to
   * `'unavailable'`/`'denied'` through the normal state, never an
   * exception (CDC section 50).
   */
  start(): void
  /** Releases the OS-level watch and resets to `'idle'` with no position (CDC section 44/61 — nothing lingers once nobody needs it any more). */
  stop(): void
}

/** GPS is genuinely a "vélo" use case, not a pedestrian one (CDC section 42) — accuracy matters more than a quick fix, and the terrain rarely calls for aggressive re-polling. */
const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }

function resolveGeolocation(injected: GeolocationLike | undefined): GeolocationLike | null {
  if (injected !== undefined) return injected
  if (typeof navigator === 'undefined') return null
  const geolocation = (navigator as { readonly geolocation?: GeolocationLike }).geolocation
  return geolocation ?? null
}

/**
 * Creates an independent service instance — used directly by tests; the
 * live app instead imports `sharedCurrentLocationService` below so every
 * caller genuinely shares the one watch.
 */
export function createCurrentLocationService(geolocationOverride?: GeolocationLike): CurrentLocationService {
  let state: CurrentLocationState = IDLE_STATE
  let watchId: number | null = null
  const listeners = new Set<(state: CurrentLocationState) => void>()

  function setState(next: CurrentLocationState): void {
    state = next
    for (const listener of [...listeners]) listener(state)
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => { listeners.delete(listener) }
    },
    start() {
      if (state.status === 'active' || state.status === 'requesting') return
      const geolocation = resolveGeolocation(geolocationOverride)
      if (geolocation === null) { setState({ status: 'unavailable', position: state.position }); return }
      setState({ status: 'requesting', position: state.position })
      watchId = geolocation.watchPosition(
        (position) => {
          setState({
            status: 'active',
            position: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy ?? null },
          })
        },
        (error) => {
          // `GeolocationPositionError.PERMISSION_DENIED === 1` — the one
          // DOM-spec code number worth naming explicitly (CDC section 41:
          // "si permission refusée, ne pas insister"); every other failure
          // (timeout, position unavailable, unsupported) is just `'unavailable'`.
          setState({ status: error.code === 1 ? 'denied' : 'unavailable', position: null })
        },
        WATCH_OPTIONS,
      )
    },
    stop() {
      const geolocation = resolveGeolocation(geolocationOverride)
      if (watchId !== null && geolocation !== null) geolocation.clearWatch(watchId)
      watchId = null
      setState(IDLE_STATE)
    },
  }
}

/** The one shared instance every map surface reads from (CDC section 43). */
export const sharedCurrentLocationService: CurrentLocationService = createCurrentLocationService()
