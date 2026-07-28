import { getDateInTimezone } from '../trip/calendar.ts'
import type { RoadbookMatchReport } from '../trip/roadbook-match.ts'
import type { TripDayId, TripPlan, TripTimeline } from '../trip/types.ts'
import { computeDepartureScenarios } from './alerts/departure-scenarios.ts'
import { WeatherCache } from './cache.ts'
import { weatherConfig } from './config.ts'
import { isTripDateInPast } from './display-policy.ts'
import {
  createWeatherRequest,
} from './open-meteo.ts'
import { isAbortError } from './provider.ts'
import { buildWeatherDayDefinitions } from './sample-points.ts'
import {
  associateWeatherDay,
  isWeatherDayDataComplete,
  isWithinExpectedWeatherHorizon,
} from './selectors.ts'
import type {
  WeatherCacheState,
  WeatherDayDefinition,
  WeatherDayState,
  WeatherForecastResult,
  WeatherLocationResult,
  WeatherProvider,
  WeatherRequest,
  WeatherSnapshot,
} from './types.ts'

interface MemoryForecast {
  readonly result: WeatherForecastResult
  readonly source: 'network' | 'cache'
}

interface QueuedWeatherTask {
  readonly definition: WeatherDayDefinition
  readonly request: WeatherRequest
  readonly resolve: () => void
}

export interface WeatherCoordinatorOptions {
  readonly provider: WeatherProvider
  readonly cache?: WeatherCache
  readonly now?: () => Date
  readonly maxConcurrentRequests?: number
}

export type WeatherListener = (snapshot: WeatherSnapshot) => void

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur météo inconnue.'
}

function mergePartialResult(
  current: WeatherForecastResult,
  previous: WeatherForecastResult | null,
): WeatherForecastResult {
  if (current.status !== 'partial' || previous === null) {
    return current
  }

  let retainedLocation = false
  const previousById = new Map(
    previous.locations.map((location) => [
      location.requestLocationId,
      location,
    ]),
  )
  const locations = current.locations.map((location): WeatherLocationResult => {
    if (location.status === 'success') {
      return location
    }

    const fallback = previousById.get(location.requestLocationId)
    if (fallback?.status === 'success') {
      retainedLocation = true
      return fallback
    }
    return location
  })

  if (!retainedLocation) {
    return current
  }

  return {
    ...current,
    status: 'partial',
    locations,
    datesCovered: [
      ...new Set([
        ...current.datesCovered,
        ...previous.datesCovered,
      ]),
    ].sort(),
    issues: [
      ...current.issues,
      'Certaines localisations utilisent le dernier résultat valide.',
    ],
  }
}

export class WeatherCoordinator {
  private readonly provider: WeatherProvider
  private readonly cache: WeatherCache
  private readonly now: () => Date
  private readonly maxConcurrentRequests: number
  private readonly listeners = new Set<WeatherListener>()
  private readonly definitions = new Map<TripDayId, WeatherDayDefinition>()
  private readonly requests = new Map<TripDayId, WeatherRequest>()
  private readonly states = new Map<TripDayId, WeatherDayState>()
  private readonly memory = new Map<string, MemoryForecast>()
  private readonly pendingPromises = new Map<string, Promise<void>>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly queue: QueuedWeatherTask[] = []
  private activeRequestCount = 0
  private selectedDayId: TripDayId = 'J1'
  private disposed = false
  private isPreparingDefinitions = false

  constructor(options: WeatherCoordinatorOptions) {
    this.provider = options.provider
    this.cache = options.cache ?? new WeatherCache()
    this.now = options.now ?? (() => new Date())
    this.maxConcurrentRequests =
      options.maxConcurrentRequests ?? weatherConfig.maxConcurrentRequests

    if (
      !Number.isInteger(this.maxConcurrentRequests) ||
      this.maxConcurrentRequests < 1
    ) {
      throw new Error('Concurrence météo invalide.')
    }
  }

  subscribe(listener: WeatherListener): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): WeatherSnapshot {
    return {
      selectedDayId: this.selectedDayId,
      states: new Map(this.states),
    }
  }

  getState(dayId: TripDayId): WeatherDayState | null {
    return this.states.get(dayId) ?? null
  }

  setContext(
    plan: TripPlan,
    timeline: TripTimeline,
    report: RoadbookMatchReport,
    selectedDayId: TripDayId,
    plannedReferenceIds: ReadonlySet<string> = new Set(),
  ): void {
    const today = getDateInTimezone(this.now(), weatherConfig.timezone)
    this.setDefinitions(
      buildWeatherDayDefinitions(plan, timeline, report, today, plannedReferenceIds),
      selectedDayId,
    )
  }

  setDefinitions(
    definitions: readonly WeatherDayDefinition[],
    selectedDayId: TripDayId,
  ): void {
    if (this.disposed) {
      return
    }

    this.selectedDayId = selectedDayId
    this.isPreparingDefinitions = true
    this.definitions.clear()
    this.requests.clear()
    const currentRequestKeys = new Set<string>()

    for (const definition of definitions) {
      this.definitions.set(definition.dayId, definition)
      if (
        definition.unavailableReason === undefined &&
        definition.locations.length > 0
      ) {
        const request = createWeatherRequest(definition)
        this.requests.set(definition.dayId, request)
        currentRequestKeys.add(request.key)
      }
    }

    for (const [key, controller] of this.controllers) {
      if (!currentRequestKeys.has(key)) {
        controller.abort()
      }
    }

    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const task = this.queue[index]
      if (task !== undefined && !currentRequestKeys.has(task.request.key)) {
        this.queue.splice(index, 1)
        this.pendingPromises.delete(task.request.key)
        task.resolve()
      }
    }

    for (const definition of definitions) {
      this.prepareDefinition(definition)
    }

    this.isPreparingDefinitions = false
    this.sortQueue()
    this.pumpQueue()
    this.emit()
  }

  selectDay(dayId: TripDayId): void {
    this.selectedDayId = dayId
    this.sortQueue()
    this.pumpQueue()
    this.emit()
  }

  async refreshSelected(): Promise<void> {
    const definition = this.definitions.get(this.selectedDayId)
    const request = this.requests.get(this.selectedDayId)

    if (
      definition === undefined ||
      request === undefined ||
      !isWithinExpectedWeatherHorizon(definition.tripDate, this.now()) ||
      isTripDateInPast(
        definition.tripDate,
        getDateInTimezone(this.now(), weatherConfig.timezone),
      )
    ) {
      return
    }

    const current = this.states.get(definition.dayId)
    this.states.set(definition.dayId, {
      ...(current ?? this.createLoadingState(definition)),
      isRefreshing: true,
      ...(current?.data === null || current === undefined
        ? { availability: 'loading' as const }
        : {}),
    })
    this.emit()
    await this.enqueue(definition, request, true)
  }

  async waitForIdle(): Promise<void> {
    while (this.pendingPromises.size > 0 || this.activeRequestCount > 0) {
      await Promise.all([...this.pendingPromises.values()])
    }
  }

  dispose(): void {
    this.disposed = true
    for (const controller of this.controllers.values()) {
      controller.abort()
    }
    this.controllers.clear()
    this.queue.splice(0).forEach(({ request, resolve }) => {
      this.pendingPromises.delete(request.key)
      resolve()
    })
    this.listeners.clear()
  }

  private prepareDefinition(definition: WeatherDayDefinition): void {
    if (
      definition.unavailableReason !== undefined ||
      definition.locations.length === 0
    ) {
      this.states.set(definition.dayId, {
        dayId: definition.dayId,
        dayType: definition.dayType,
        tripDate: definition.tripDate,
        availability: 'unavailable',
        cacheState: 'miss',
        source: 'none',
        fetchedAt: null,
        receivedDates: [],
        data: null,
        isRefreshing: false,
        departureScenarios: null,
        message:
          definition.unavailableReason ??
          'Aucune localisation météo disponible.',
      })
      return
    }

    const request = this.requests.get(definition.dayId)
    if (request === undefined) {
      return
    }

    const isPast = isTripDateInPast(
      definition.tripDate,
      getDateInTimezone(this.now(), weatherConfig.timezone),
    )

    const memory = this.memory.get(request.key)
    if (memory !== undefined) {
      const cacheState = this.getFreshness(memory.result.fetchedAt)
      this.applyResult(
        definition,
        memory.result,
        memory.source,
        cacheState,
        false,
      )
      if (
        !isPast &&
        cacheState === 'stale' &&
        isWithinExpectedWeatherHorizon(definition.tripDate, this.now())
      ) {
        const staleState = this.states.get(definition.dayId)
        if (staleState !== undefined) {
          this.states.set(definition.dayId, {
            ...staleState,
            isRefreshing: true,
          })
        }
        void this.enqueue(definition, request, false)
      }
      return
    }

    const cached = this.cache.get(request, this.now())
    if (cached !== null) {
      this.memory.set(request.key, {
        result: cached.entry.result,
        source: 'cache',
      })
      this.applyResult(
        definition,
        cached.entry.result,
        'cache',
        cached.state,
        false,
      )
      if (
        !isPast &&
        cached.state === 'stale' &&
        isWithinExpectedWeatherHorizon(definition.tripDate, this.now())
      ) {
        const staleState = this.states.get(definition.dayId)
        if (staleState !== undefined) {
          this.states.set(definition.dayId, {
            ...staleState,
            isRefreshing: true,
          })
        }
        void this.enqueue(definition, request, false)
      }
      return
    }

    if (isPast) {
      this.states.set(definition.dayId, {
        dayId: definition.dayId,
        dayType: definition.dayType,
        tripDate: definition.tripDate,
        availability: 'unavailable',
        cacheState: 'miss',
        source: 'none',
        fetchedAt: null,
        receivedDates: [],
        data: null,
        isRefreshing: false,
        departureScenarios: null,
        message: 'Journée passée : aucune donnée conservée, aucune actualisation.',
      })
      return
    }

    if (!isWithinExpectedWeatherHorizon(definition.tripDate, this.now())) {
      this.states.set(definition.dayId, {
        dayId: definition.dayId,
        dayType: definition.dayType,
        tripDate: definition.tripDate,
        availability: 'outside-horizon',
        cacheState: 'miss',
        source: 'none',
        fetchedAt: null,
        receivedDates: [],
        data: null,
        isRefreshing: false,
        departureScenarios: null,
        message: 'Date hors de l’horizon prévisionnel disponible.',
      })
      return
    }

    this.states.set(definition.dayId, this.createLoadingState(definition))
    void this.enqueue(definition, request, false)
  }

  private createLoadingState(
    definition: WeatherDayDefinition,
  ): WeatherDayState {
    return {
      dayId: definition.dayId,
      dayType: definition.dayType,
      tripDate: definition.tripDate,
      availability: 'loading',
      cacheState: 'miss',
      source: 'none',
      fetchedAt: null,
      receivedDates: [],
      data: null,
      isRefreshing: true,
      departureScenarios: null,
    }
  }

  private getFreshness(fetchedAt: string): Exclude<WeatherCacheState, 'miss'> {
    const age = this.now().getTime() - Date.parse(fetchedAt)
    return Number.isFinite(age) && age >= 0 && age < weatherConfig.cacheFreshMs
      ? 'fresh'
      : 'stale'
  }

  private applyResult(
    definition: WeatherDayDefinition,
    result: WeatherForecastResult,
    source: 'network' | 'cache',
    cacheState: Exclude<WeatherCacheState, 'miss'>,
    isRefreshing: boolean,
    message?: string,
  ): void {
    try {
      const today = getDateInTimezone(this.now(), weatherConfig.timezone)
      const data = associateWeatherDay(definition, result, today)
      const isComplete =
        result.status === 'success' && isWeatherDayDataComplete(data)
      const availability =
        cacheState === 'stale'
          ? 'stale-cache'
          : isComplete
            ? 'available'
            : 'partial'
      const departureScenarios =
        definition.dayType === 'off' ? null : computeDepartureScenarios(definition, result)

      this.states.set(definition.dayId, {
        dayId: definition.dayId,
        dayType: definition.dayType,
        tripDate: definition.tripDate,
        availability,
        cacheState,
        source,
        fetchedAt: result.fetchedAt,
        receivedDates: result.datesCovered,
        data,
        isRefreshing,
        departureScenarios,
        ...(message === undefined ? {} : { message }),
      })
    } catch (error) {
      this.states.set(definition.dayId, {
        dayId: definition.dayId,
        dayType: definition.dayType,
        tripDate: definition.tripDate,
        availability: 'error',
        cacheState,
        source,
        fetchedAt: result.fetchedAt,
        receivedDates: result.datesCovered,
        data: null,
        isRefreshing: false,
        departureScenarios: null,
        message: getErrorMessage(error),
      })
    }
  }

  private enqueue(
    definition: WeatherDayDefinition,
    request: WeatherRequest,
    force: boolean,
  ): Promise<void> {
    const existing = this.pendingPromises.get(request.key)
    if (existing !== undefined) {
      return existing
    }

    if (!force) {
      const memory = this.memory.get(request.key)
      if (
        memory !== undefined &&
        this.getFreshness(memory.result.fetchedAt) === 'fresh'
      ) {
        return Promise.resolve()
      }
    }

    let resolveTask = (): void => undefined
    const promise = new Promise<void>((resolve) => {
      resolveTask = resolve
    })
    this.pendingPromises.set(request.key, promise)
    this.queue.push({ definition, request, resolve: resolveTask })
    this.sortQueue()
    if (!this.isPreparingDefinitions) {
      this.pumpQueue()
    }
    return promise
  }

  private sortQueue(): void {
    this.queue.sort((left, right) => {
      const leftPriority = left.definition.dayId === this.selectedDayId ? 0 : 1
      const rightPriority = right.definition.dayId === this.selectedDayId ? 0 : 1
      return (
        leftPriority - rightPriority ||
        left.definition.tripDate.localeCompare(right.definition.tripDate)
      )
    })
  }

  private pumpQueue(): void {
    while (
      !this.disposed &&
      this.activeRequestCount < this.maxConcurrentRequests &&
      this.queue.length > 0
    ) {
      const task = this.queue.shift()
      if (task === undefined) {
        return
      }

      this.activeRequestCount += 1
      void this.executeTask(task).finally(() => {
        this.activeRequestCount -= 1
        this.pendingPromises.delete(task.request.key)
        task.resolve()
        this.pumpQueue()
      })
    }
  }

  private async executeTask(task: QueuedWeatherTask): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(task.request.key, controller)

    try {
      const fetched = await this.provider.fetchForecast(
        task.request,
        controller.signal,
      )
      const previous = this.memory.get(task.request.key)?.result ?? null
      const result = mergePartialResult(fetched, previous)

      if (fetched.status !== 'error') {
        this.memory.set(task.request.key, { result, source: 'network' })
        if (fetched.status === 'success' || previous === null) {
          this.cache.put(task.request, fetched, this.now())
        }
      }

      if (!this.isCurrentTask(task)) {
        return
      }

      const currentDefinition = this.definitions.get(task.definition.dayId)
      if (currentDefinition === undefined) {
        return
      }

      if (fetched.status === 'error') {
        this.handleFailure(
          currentDefinition,
          new Error(fetched.issues.join(' ') || 'Réponse météo inutilisable.'),
        )
        return
      }

      this.applyResult(
        currentDefinition,
        result,
        'network',
        'fresh',
        false,
      )
    } catch (error) {
      if (isAbortError(error) || !this.isCurrentTask(task)) {
        return
      }
      const currentDefinition = this.definitions.get(task.definition.dayId)
      if (currentDefinition !== undefined) {
        this.handleFailure(currentDefinition, error)
      }
    } finally {
      this.controllers.delete(task.request.key)
      const state = this.states.get(task.definition.dayId)
      if (state?.isRefreshing === true && this.isCurrentTask(task)) {
        this.states.set(task.definition.dayId, {
          ...state,
          isRefreshing: false,
        })
      }
      this.emit()
    }
  }

  private handleFailure(
    definition: WeatherDayDefinition,
    error: unknown,
  ): void {
    const current = this.states.get(definition.dayId)
    const message = getErrorMessage(error)

    if (current?.data !== null && current?.data !== undefined) {
      this.states.set(definition.dayId, {
        ...current,
        availability: 'stale-cache',
        cacheState: 'stale',
        isRefreshing: false,
        message: `Dernières données conservées. ${message}`,
      })
      return
    }

    this.states.set(definition.dayId, {
      dayId: definition.dayId,
      dayType: definition.dayType,
      tripDate: definition.tripDate,
      availability: 'error',
      cacheState: 'miss',
      source: 'none',
      fetchedAt: null,
      receivedDates: [],
      data: null,
      isRefreshing: false,
      departureScenarios: null,
      message,
    })
  }

  private isCurrentTask(task: QueuedWeatherTask): boolean {
    return this.requests.get(task.definition.dayId)?.key === task.request.key
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}
