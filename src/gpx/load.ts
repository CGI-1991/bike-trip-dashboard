import { parseGpxDocument } from './parser.ts'
import type {
  GpxAnalysisError,
  GpxAnalysisReport,
  GpxAnalysisResult,
  GpxAnalysisSuccess,
  GpxManifestEntry,
  GpxSource,
} from './types.ts'

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type GpxParserImplementation = (
  xmlText: string,
  source: GpxSource,
) => GpxAnalysisSuccess

const manifestRelativePath = 'data/gpx/manifest.json'
const variantPattern = /(?:^|[-_.\s])variante(?:[-_.\s]|$)/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getPublicUrl(relativePath: string): string {
  const baseUrl = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return `${baseUrl}${relativePath}`
}

function parseManifestEntry(value: unknown, index: number): GpxManifestEntry {
  if (!isRecord(value)) {
    throw new Error(`Entrée ${index + 1} du manifeste invalide.`)
  }

  const { fileName, startName, endName } = value

  if (
    typeof fileName !== 'string' ||
    !fileName.toLocaleLowerCase('fr-FR').endsWith('.gpx') ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    typeof startName !== 'string' ||
    startName.trim().length === 0 ||
    typeof endName !== 'string' ||
    endName.trim().length === 0
  ) {
    throw new Error(`Entrée ${index + 1} du manifeste incomplète ou non sûre.`)
  }

  return {
    fileName,
    startName: startName.trim(),
    endName: endName.trim(),
  }
}

export function parseGpxFileNumber(fileName: string): number {
  const match = /^(\d+)(?=[_-])/.exec(fileName)
  const fileNumber = match === null ? Number.NaN : Number(match[1])

  if (!Number.isSafeInteger(fileNumber) || fileNumber <= 0) {
    throw new Error(`Numéro de fichier GPX invalide : ${fileName}`)
  }

  return fileNumber
}

function createSource(entry: GpxManifestEntry): GpxSource {
  return {
    ...entry,
    fileNumber: parseGpxFileNumber(entry.fileName),
    url: getPublicUrl(`data/gpx/${encodeURIComponent(entry.fileName)}`),
    isVariant: variantPattern.test(entry.fileName),
  }
}

function sortSources(left: GpxSource, right: GpxSource): number {
  return (
    left.fileNumber - right.fileNumber ||
    left.fileName.localeCompare(right.fileName, 'fr-FR', { numeric: true, sensitivity: 'base' })
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur inconnue pendant l’analyse.'
}

export async function loadGpxSources(
  fetchImplementation: FetchImplementation = globalThis.fetch.bind(globalThis),
): Promise<readonly GpxSource[]> {
  const response = await fetchImplementation(getPublicUrl(manifestRelativePath))

  if (!response.ok) {
    throw new Error(`Manifeste GPX inaccessible (HTTP ${response.status}).`)
  }

  const manifest: unknown = await response.json()

  if (!isRecord(manifest) || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Le manifeste GPX ne contient aucun fichier.')
  }

  const sources = manifest.files.map(parseManifestEntry).map(createSource).sort(sortSources)
  const fileNames = new Set<string>()
  const fileNumbers = new Set<number>()

  for (const source of sources) {
    if (fileNames.has(source.fileName) || fileNumbers.has(source.fileNumber)) {
      throw new Error(`Doublon détecté dans le manifeste GPX : ${source.fileName}`)
    }

    fileNames.add(source.fileName)
    fileNumbers.add(source.fileNumber)
  }

  return sources
}

async function analyzeSource(
  source: GpxSource,
  fetchImplementation: FetchImplementation,
  parserImplementation: GpxParserImplementation,
): Promise<GpxAnalysisSuccess> {
  const response = await fetchImplementation(source.url)

  if (!response.ok) {
    throw new Error(`Fichier inaccessible (HTTP ${response.status}).`)
  }

  return parserImplementation(await response.text(), source)
}

export async function analyzeGpxSources(
  sources: readonly GpxSource[],
  fetchImplementation: FetchImplementation = globalThis.fetch.bind(globalThis),
  parserImplementation: GpxParserImplementation = parseGpxDocument,
): Promise<readonly GpxAnalysisResult[]> {
  const settledResults = await Promise.allSettled(
    sources.map((source) => analyzeSource(source, fetchImplementation, parserImplementation)),
  )

  return settledResults.map((settledResult, index) => {
    const source = sources[index]

    if (source === undefined) {
      throw new Error('Résultat GPX sans source associée.')
    }

    if (settledResult.status === 'fulfilled') {
      return settledResult.value
    }

    const errorResult: GpxAnalysisError = {
      status: 'error',
      source,
      message: getErrorMessage(settledResult.reason),
    }
    return errorResult
  })
}

export async function loadGpxAnalysis(
  configuredStageCount: number,
  fetchImplementation: FetchImplementation = globalThis.fetch.bind(globalThis),
): Promise<GpxAnalysisReport> {
  const sources = await loadGpxSources(fetchImplementation)
  const files = await analyzeGpxSources(sources, fetchImplementation)
  const successfulFileCount = files.filter((file) => file.status === 'success').length
  const failedFileCount = files.length - successfulFileCount

  return {
    status:
      failedFileCount === 0 ? 'success' : successfulFileCount === 0 ? 'error' : 'partial',
    detectedFileCount: sources.length,
    successfulFileCount,
    failedFileCount,
    configuredStageCount,
    files,
  }
}
