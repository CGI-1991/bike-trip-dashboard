/**
 * Why an enrichment request failed, and therefore what to do about it.
 *
 * The distinction matters because the two answers are opposites:
 *
 * - a request that was too EXPENSIVE should be split into smaller ones and
 *   retried immediately — that is the whole point of adaptive segmentation;
 * - a request that could not reach the network at all should NOT be split.
 *   Halving a 20 km segment four times while the phone has no signal just
 *   produces sixteen failures instead of one, and burns the battery doing
 *   it. The work is simply suspended and picked up when connectivity comes
 *   back.
 *
 * Getting this wrong in the "too heavy" direction is wasteful; getting it
 * wrong in the "unavailable" direction is worse, because a genuinely heavy
 * segment would then never be subdivided and the stage would never complete.
 * So the classifier only answers `unavailable` on positive evidence that the
 * network is the problem, and treats everything else — including a plain
 * timeout, the most common symptom of an over-large query — as `too-heavy`.
 */

/** Thrown by a provider when its own request timeout elapsed (as opposed to an external cancellation). */
export class EnrichmentTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number) {
    super(`Postpass n’a pas répondu dans le délai de ${timeoutMs} ms.`)
    this.name = 'EnrichmentTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/** Thrown by a provider when the endpoint answered with a non-2xx status. */
export class EnrichmentHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Postpass a répondu avec le statut HTTP ${status}.`)
    this.name = 'EnrichmentHttpError'
    this.status = status
  }
}

export type EnrichmentFailureKind = 'too-heavy' | 'unavailable'

/**
 * HTTP statuses that mean "the server is fine, but not for you right now".
 * Splitting the query would not help and would multiply the pressure, so
 * these suspend instead — the same answer as being offline.
 */
const SERVER_UNAVAILABLE_STATUSES = new Set([429, 500, 502, 503, 504])

function looksLikeNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  // A failed `fetch` rejects with a TypeError whose message differs per
  // engine ("Failed to fetch", "NetworkError when attempting to fetch
  // resource", "Load failed"). Matching on the shape plus a keyword is the
  // only portable signal available.
  const message = error.message.toLowerCase()
  return error.name === 'TypeError'
    && (message.includes('fetch') || message.includes('network') || message.includes('load failed'))
}

export interface ClassifyFailureContext {
  /** `false` only when the platform positively reports being offline; `undefined` when unknown. */
  readonly online?: boolean | undefined
}

export function classifyEnrichmentFailure(error: unknown, context: ClassifyFailureContext = {}): EnrichmentFailureKind {
  // A confirmed-offline device explains every failure, whatever it looks
  // like — no amount of subdividing will help.
  if (context.online === false) return 'unavailable'
  if (looksLikeNetworkFailure(error)) return 'unavailable'
  if (error instanceof EnrichmentHttpError && SERVER_UNAVAILABLE_STATUSES.has(error.status)) return 'unavailable'
  // Everything else — a timeout above all, but also a 4xx from an
  // over-large query — is treated as "this request asked for too much".
  return 'too-heavy'
}

/** Reads `navigator.onLine` where it exists, without assuming a browser. */
export function currentOnlineState(): boolean | undefined {
  if (typeof navigator === 'undefined') return undefined
  const online = (navigator as { readonly onLine?: unknown }).onLine
  return typeof online === 'boolean' ? online : undefined
}
