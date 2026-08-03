export interface SerialRateLimiterOptions {
  readonly minimumIntervalMs: number
  readonly nowMs?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Shared single-flight rate limiter for public OSM services. */
export function createSerialRateLimiter(options: SerialRateLimiterOptions) {
  const minimumIntervalMs = Math.max(0, options.minimumIntervalMs)
  const nowMs = options.nowMs ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  let lastStartedAt = Number.NEGATIVE_INFINITY
  let queue: Promise<void> = Promise.resolve()

  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const scheduled = queue.then(async () => {
        const delay = Math.max(0, minimumIntervalMs - (nowMs() - lastStartedAt))
        if (delay > 0) await sleep(delay)
        lastStartedAt = nowMs()
        return operation()
      })
      queue = scheduled.then(() => undefined, () => undefined)
      return scheduled
    },
  }
}
