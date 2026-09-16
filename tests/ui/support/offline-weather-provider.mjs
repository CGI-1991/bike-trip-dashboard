/**
 * The weather provider every `initializeTripsManager` test must inject.
 *
 * `TripsManagerDeps.weatherProvider` is optional, and the component falls
 * back to the REAL Open-Meteo client when it is absent. A test that omits it
 * therefore issues genuine network requests, and their continuations touch
 * the IndexedDB connection after the test has closed it — surfacing as
 * `InvalidStateError: ... unhandledRejection` once the test ended. It only
 * ever fails where the network actually answers, which is why it showed up
 * on CI and not behind a blocked one.
 *
 * Answers `status: 'error'` immediately: the point is never to simulate a
 * forecast, only to keep the suite off the network. A test that genuinely
 * exercises weather supplies its own richer stub instead.
 */
export function offlineWeatherProvider() {
  return {
    id: 'open-meteo',
    async fetchForecast(request) {
      return {
        provider: 'open-meteo',
        requestKey: request.key,
        fetchedAt: '2027-01-01T00:00:00.000Z',
        status: 'error',
        locations: [],
        datesCovered: [],
        issues: ['offline test stub'],
      }
    },
  }
}
