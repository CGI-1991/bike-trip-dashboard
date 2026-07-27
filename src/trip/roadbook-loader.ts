import type {
  RoadbookDocument,
  RoadbookOverridesDocument,
  RoadbookResources,
} from './roadbook-types.ts'
import {
  validateRoadbookDocument,
  validateRoadbookOverridesDocument,
} from './roadbook-validation.ts'

export type RoadbookFetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type RoadbookResourceName = 'roadbook' | 'roadbook-overrides'

export const roadbookRelativePath = 'data/trip/roadbook.json'
export const roadbookOverridesRelativePath =
  'data/trip/roadbook-overrides.json'

export class RoadbookLoadError extends Error {
  readonly resource: RoadbookResourceName
  readonly url: string
  readonly status?: number

  constructor(
    resource: RoadbookResourceName,
    url: string,
    message: string,
    options?: ErrorOptions & { readonly status?: number },
  ) {
    super(message, options)
    this.name = 'RoadbookLoadError'
    this.resource = resource
    this.url = url
    this.status = options?.status
  }
}

export function getRoadbookPublicUrl(relativePath: string): string {
  const baseUrl = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return `${baseUrl}${relativePath}`
}

async function fetchJsonResource(
  resource: RoadbookResourceName,
  relativePath: string,
  fetchImplementation: RoadbookFetchImplementation,
): Promise<unknown> {
  const url = getRoadbookPublicUrl(relativePath)
  let response: Response

  try {
    response = await fetchImplementation(url)
  } catch (error) {
    throw new RoadbookLoadError(
      resource,
      url,
      `Ressource ${resource} inaccessible.`,
      { cause: error },
    )
  }

  if (!response.ok) {
    throw new RoadbookLoadError(
      resource,
      url,
      `Ressource ${resource} inaccessible (HTTP ${response.status}).`,
      { status: response.status },
    )
  }

  try {
    return await response.json()
  } catch (error) {
    throw new RoadbookLoadError(
      resource,
      url,
      `Le JSON de la ressource ${resource} est illisible.`,
      { cause: error },
    )
  }
}

export async function loadRoadbookDocument(
  fetchImplementation: RoadbookFetchImplementation =
    globalThis.fetch.bind(globalThis),
): Promise<RoadbookDocument> {
  const value = await fetchJsonResource(
    'roadbook',
    roadbookRelativePath,
    fetchImplementation,
  )
  return validateRoadbookDocument(value)
}

export async function loadRoadbookOverrides(
  roadbook: RoadbookDocument,
  fetchImplementation: RoadbookFetchImplementation =
    globalThis.fetch.bind(globalThis),
): Promise<RoadbookOverridesDocument> {
  const value = await fetchJsonResource(
    'roadbook-overrides',
    roadbookOverridesRelativePath,
    fetchImplementation,
  )
  return validateRoadbookOverridesDocument(value, roadbook)
}

export async function loadRoadbookResources(
  fetchImplementation: RoadbookFetchImplementation =
    globalThis.fetch.bind(globalThis),
): Promise<RoadbookResources> {
  const roadbook = await loadRoadbookDocument(fetchImplementation)
  const overrides = await loadRoadbookOverrides(
    roadbook,
    fetchImplementation,
  )

  return { roadbook, overrides }
}
