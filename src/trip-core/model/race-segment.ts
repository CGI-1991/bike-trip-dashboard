import type { DataProvenance } from './provenance.ts'

export const RACE_SEGMENT_TYPES = ['sprint', 'climb', 'flandrien'] as const
export type RaceSegmentType = typeof RACE_SEGMENT_TYPES[number]

export interface RaceSegmentFields {
  readonly type: RaceSegmentType
  readonly name: string
  /** Original GPX chainage, in metres. Positive length, including sub-metre segments. */
  readonly startOffsetM: number
  readonly endOffsetM: number
  readonly alerts: {
    readonly beforeEnabled: boolean
    readonly beforeM: number
    readonly atStart: boolean
    readonly atEnd: boolean
  }
}

/** Owned by its parent RideStage; independent of automatic Climb entities. */
export interface RaceSegment extends RaceSegmentFields {
  readonly id: string
  readonly routeFingerprint: string
  readonly provenance: DataProvenance
}

export const DEFAULT_RACE_SEGMENT_ALERTS: RaceSegmentFields['alerts'] = {
  beforeEnabled: true, beforeM: 500, atStart: true, atEnd: false,
}
