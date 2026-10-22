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
 * Only positive evidence of excessive cost warrants subdivision. Invalid
 * payloads, rejected requests and programming errors cannot be repaired by
 * halving the route and must leave the work pending without fan-out.
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

export class EnrichmentResponseError extends Error {
  constructor(cause?: unknown) {
    super('Réponse GeoJSON Postpass invalide. Les lieux déjà enregistrés sont conservés.', { cause })
    this.name = 'EnrichmentResponseError'
  }
}

/** Keep transport/read failures distinct from a response containing invalid JSON. */
export async function readEnrichmentJson(response: Pick<Response, 'json'>): Promise<unknown> {
  try { return await response.json() }
  catch (error) {
    if (error instanceof SyntaxError) throw new EnrichmentResponseError(error)
    throw error
  }
}

export class EnrichmentStorageError extends Error {
  constructor(cause: unknown) {
    super('La recherche a répondu, mais les données ne peuvent pas être enregistrées sur cet appareil. Vérifiez l’espace de stockage disponible.', { cause })
    this.name = 'EnrichmentStorageError'
  }
}

export type EnrichmentFailureKind = 'too-heavy' | 'unavailable' | 'invalid-response' | 'permanent' | 'cancelled'

/** Explicit request timeout or size limits; other 4xx failures do not justify splitting. */
const EXPENSIVE_REQUEST_STATUSES = new Set([408, 413, 414])

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
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
  // A confirmed-offline device explains every failure, whatever it looks
  // like — no amount of subdividing will help.
  if (context.online === false) return 'unavailable'
  if (looksLikeNetworkFailure(error)) return 'unavailable'
  if (error instanceof EnrichmentResponseError || error instanceof SyntaxError) return 'invalid-response'
  if (error instanceof EnrichmentTimeoutError) return 'too-heavy'
  if (error instanceof EnrichmentHttpError) {
    if (error.status === 429 || error.status >= 500) return 'unavailable'
    return EXPENSIVE_REQUEST_STATUSES.has(error.status) ? 'too-heavy' : 'permanent'
  }
  return 'permanent'
}

/** A short explanation suitable for the saved provider status and mobile UI. */
export function enrichmentFailureMessage(error: unknown): string {
  const kind = classifyEnrichmentFailure(error)
  if (kind === 'invalid-response') return new EnrichmentResponseError().message
  if (kind === 'cancelled') return 'Recherche interrompue ; les lieux acquis sont conservés.'
  if (kind === 'unavailable') return 'Le service de recherche est momentanément indisponible ou la connexion est interrompue. Les lieux acquis sont conservés.'
  if (kind === 'too-heavy') return 'Une zone demande trop de temps de recherche ; les lieux acquis sont conservés.'
  return error instanceof EnrichmentHttpError
    ? `Le service de recherche a refusé la requête (HTTP ${error.status}). Les lieux acquis sont conservés.`
    : 'La recherche a rencontré une erreur ; les lieux acquis sont conservés.'
}

/** Reads `navigator.onLine` where it exists, without assuming a browser. */
export function currentOnlineState(): boolean | undefined {
  if (typeof navigator === 'undefined') return undefined
  const online = (navigator as { readonly onLine?: unknown }).onLine
  return typeof online === 'boolean' ? online : undefined
}
