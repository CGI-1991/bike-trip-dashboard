export interface GpxManifestEntry {
  readonly fileName: string
  readonly startName: string
  readonly endName: string
}

export interface GpxSource extends GpxManifestEntry {
  readonly fileNumber: number
  readonly url: string
  readonly isVariant: boolean
}

export interface GpxTrackPoint {
  readonly latitude: number
  readonly longitude: number
  readonly elevationM: number | null
}

export type GpxNamedPointSourceType = 'wpt' | 'rtept'

export interface GpxNamedPoint extends GpxTrackPoint {
  readonly id: string
  readonly sourceType: GpxNamedPointSourceType
  readonly name: string | null
  readonly description: string | null
  readonly symbol: string | null
  readonly hasExtensions: boolean
}

export interface GpxInternalInspection {
  readonly waypointCount: number
  readonly routePointCount: number
  readonly namedPointCount: number
  readonly nameElementCount: number
  readonly descriptionElementCount: number
  readonly symbolElementCount: number
  readonly extensionElementCount: number
  readonly metadataName: string | null
  readonly metadataDescription: string | null
  readonly trackName: string | null
  readonly trackDescription: string | null
}

export interface GpxSegment {
  readonly points: readonly GpxTrackPoint[]
  readonly distanceKm: number
  readonly elevationGainM: number | null
  readonly elevationLossM: number | null
}

export interface GpxTrackSummary {
  readonly fileNumber: number
  readonly fileName: string
  readonly trackName: string | null
  readonly startName: string
  readonly endName: string
  readonly firstPoint: GpxTrackPoint
  readonly lastPoint: GpxTrackPoint
  readonly totalPoints: number
  readonly distanceKm: number
  readonly elevationGainM: number | null
  readonly elevationLossM: number | null
  readonly minElevationM: number | null
  readonly maxElevationM: number | null
  readonly segmentCount: number
  readonly hasMultipleSegments: boolean
  readonly isVariant: boolean
}

export interface GpxAnalysisSuccess {
  readonly status: 'success'
  readonly source: GpxSource
  readonly summary: GpxTrackSummary
  readonly segments: readonly GpxSegment[]
  readonly namedPoints: readonly GpxNamedPoint[]
  readonly internalInspection: GpxInternalInspection
}

export interface GpxAnalysisError {
  readonly status: 'error'
  readonly source: GpxSource
  readonly message: string
}

export type GpxAnalysisResult = GpxAnalysisSuccess | GpxAnalysisError

export interface GpxAnalysisReport {
  readonly status: 'success' | 'partial' | 'error'
  readonly detectedFileCount: number
  readonly successfulFileCount: number
  readonly failedFileCount: number
  readonly configuredStageCount: number
  readonly files: readonly GpxAnalysisResult[]
}
