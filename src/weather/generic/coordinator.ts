/**
 * Generic `WeatherCoordinator` adapter (CDC Jalon C1 section 16) — wraps the
 * real, unmodified `WeatherCoordinator` class (queueing, concurrency,
 * cache-first, subscribe/emit, single/coalesced requests, cancellation —
 * all reused as-is, never re-implemented here) and feeds it
 * `WeatherDayDefinition`s built from a `TripBundle` instead of the
 * historical RGA `TripPlan`/`TripTimeline`/`RoadbookMatchReport` (i.e. this
 * module never calls `WeatherCoordinator.setContext`, only the already
 * generic `setDefinitions`).
 *
 * The only adapter-specific concern this module owns: a transfer day (CDC
 * section 13) has no single `WeatherDayState` of its own — its
 * origin/destination each get their own virtual, suffixed day key (see
 * `sample-points.ts`), and `getDayWeatherViewModel` is what stitches those
 * back into one `GenericTransferWeatherViewModel` for the day the user
 * actually opened.
 */

import type { TripBundle, TripDay } from '../../trip-core/index.ts'
import { WeatherCoordinator } from '../coordinator.ts'
import type { WeatherCoordinatorOptions, WeatherListener } from '../coordinator.ts'
import { buildTripWeatherDayDefinitions, transferDestinationDayKey, transferOriginDayKey } from './sample-points.ts'
import { buildGenericDayWeatherViewModel } from './view-model.ts'
import type { GenericDayWeatherViewModel } from './view-model.ts'

export interface GenericTransferWeatherViewModel {
  readonly origin: GenericDayWeatherViewModel | null
  readonly destination: GenericDayWeatherViewModel | null
}

export class GenericWeatherCoordinator {
  private readonly coordinator: WeatherCoordinator
  private readonly now: () => Date

  constructor(options: WeatherCoordinatorOptions) {
    this.coordinator = new WeatherCoordinator(options)
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Rebuilds every weather day-definition for the whole trip and re-selects
   * `selectedDayId` (CDC section 8's pipeline entry point) — call whenever
   * the active `TripBundle` changes (a new trip opened, a pause/GPX edit
   * that can shift ETAs) or the selected day changes. Cheap to call often:
   * `WeatherCoordinator.setDefinitions` itself is what dedupes against
   * already-fresh in-memory/cache results, never re-fetching needlessly.
   */
  setTripBundle(bundle: TripBundle, selectedDayId: string): void {
    const definitions = buildTripWeatherDayDefinitions(bundle)
    // Prioritise whichever real fetch the selected day actually needs — a
    // transfer's own `dayId` never has a definition registered under it
    // directly (see module doc comment), so the queue would otherwise never
    // treat it as "the selected day" for priority ordering.
    const hasOrigin = definitions.some((definition) => definition.dayId === transferOriginDayKey(selectedDayId))
    const priorityKey = hasOrigin ? transferOriginDayKey(selectedDayId) : selectedDayId
    this.coordinator.setDefinitions(definitions, priorityKey)
  }

  selectDay(bundle: TripBundle, dayId: string): void {
    const hasOrigin = bundle.days.some((day) => day.id === dayId && day.type === 'transfer')
    this.coordinator.selectDay(hasOrigin ? transferOriginDayKey(dayId) : dayId)
  }

  subscribe(listener: WeatherListener): () => void {
    return this.coordinator.subscribe(listener)
  }

  async refreshSelected(): Promise<void> {
    await this.coordinator.refreshSelected()
  }

  async waitForIdle(): Promise<void> {
    await this.coordinator.waitForIdle()
  }

  dispose(): void {
    this.coordinator.dispose()
  }

  /**
   * The one per-day read every screen (Aperçu/Voyage/Étape) goes through
   * (CDC section 22) — ride/OFF days resolve straight to a single
   * `GenericDayWeatherViewModel`; a transfer day resolves to its own
   * `GenericTransferWeatherViewModel` (origin + destination, each built the
   * exact same way, independently).
   */
  getDayWeatherViewModel(day: TripDay): GenericDayWeatherViewModel | GenericTransferWeatherViewModel | null {
    if (day.type === 'transfer') {
      const originKey = transferOriginDayKey(day.id)
      const destinationKey = transferDestinationDayKey(day.id)
      const origin = buildGenericDayWeatherViewModel(originKey, this.coordinator.getState(originKey), this.now())
      const destination = buildGenericDayWeatherViewModel(destinationKey, this.coordinator.getState(destinationKey), this.now())
      if (origin === null && destination === null) return null
      return { origin, destination }
    }
    return buildGenericDayWeatherViewModel(day.id, this.coordinator.getState(day.id), this.now())
  }
}
