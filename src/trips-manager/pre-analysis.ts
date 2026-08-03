/**
 * Light pre-analysis shown while the wizard is being configured (annexe
 * fonctionnelle section 4, CDC phase 6C1 section 9) — reuses the exact
 * phase 6 parser/analyzer/hash rather than a second, lighter one:
 * `validateGpxImportFile`, `parseGpxXml`, `analyzeGpxDocument`, `sha256Hex`.
 * The full analysis (climbs, timing, TripBundle) only runs once the user
 * actually confirms and creates the trip.
 */

import { analyzeGpxDocument } from '../import/gpx/analyze-gpx.ts'
import { parseGpxXml } from '../import/gpx/gpx-xml.ts'
import { sha256Hex } from '../import/gpx/hash.ts'
import { validateGpxImportFile } from '../import/gpx/source-file.ts'
import type { GpxImportFile } from '../import/gpx/types.ts'
import { sampleTracePoints } from './duplicate-detection.ts'

export interface GpxPreAnalysis {
  readonly fileName: string
  readonly sha256: string
  readonly status: 'valid' | 'invalid'
  readonly errorMessage: string | null
  readonly distanceKm: number | null
  readonly elevationGainM: number | null
  readonly elevationLossM: number | null
  readonly startLatitude: number | null
  readonly startLongitude: number | null
  readonly endLatitude: number | null
  readonly endLongitude: number | null
  readonly sampledPoints: readonly { readonly latitude: number; readonly longitude: number }[]
}

function invalidResult(fileName: string, sha256: string, errorMessage: string): GpxPreAnalysis {
  return {
    fileName,
    sha256,
    status: 'invalid',
    errorMessage,
    distanceKm: null,
    elevationGainM: null,
    elevationLossM: null,
    startLatitude: null,
    startLongitude: null,
    endLatitude: null,
    endLongitude: null,
    sampledPoints: [],
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Analyse impossible.'
}

export async function preAnalyzeGpxFile(file: GpxImportFile): Promise<GpxPreAnalysis> {
  const sha256 = await sha256Hex(file.bytes)

  const fileIssues = validateGpxImportFile(file)
  const firstBlocking = fileIssues.find((issue) => issue.severity === 'error')
  if (firstBlocking !== undefined) {
    return invalidResult(file.name, sha256, firstBlocking.message)
  }

  try {
    const xmlText = new TextDecoder('utf-8').decode(file.bytes)
    const analysis = analyzeGpxDocument(parseGpxXml(xmlText), file.name)
    const first = analysis.points[0]
    const last = analysis.points[analysis.points.length - 1]
    if (first === undefined || last === undefined) {
      return invalidResult(file.name, sha256, 'Trace exploitable introuvable.')
    }

    return {
      fileName: file.name,
      sha256,
      status: 'valid',
      errorMessage: null,
      distanceKm: analysis.distanceKm,
      elevationGainM: analysis.elevationGainM,
      elevationLossM: analysis.elevationLossM,
      startLatitude: first.latitude,
      startLongitude: first.longitude,
      endLatitude: last.latitude,
      endLongitude: last.longitude,
      sampledPoints: sampleTracePoints(analysis.points),
    }
  } catch (error) {
    return invalidResult(file.name, sha256, getErrorMessage(error))
  }
}

export async function preAnalyzeGpxFiles(files: readonly GpxImportFile[]): Promise<readonly GpxPreAnalysis[]> {
  return Promise.all(files.map((file) => preAnalyzeGpxFile(file)))
}
