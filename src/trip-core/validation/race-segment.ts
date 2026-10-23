import { RACE_SEGMENT_TYPES } from '../model/race-segment.ts'
import type { RaceSegmentFields } from '../model/race-segment.ts'
import { isBoolean, isNonEmptyString, isNonNegativeNumber, isOneOf, isPlainObject } from './primitives.ts'

export function isValidRaceSegmentFields(value: unknown): value is RaceSegmentFields {
  if (!isPlainObject(value) || !isOneOf(value.type, RACE_SEGMENT_TYPES) || !isNonEmptyString(value.name)
    || !isNonNegativeNumber(value.startOffsetM) || !isNonNegativeNumber(value.endOffsetM)
    || value.endOffsetM <= value.startOffsetM || !isPlainObject(value.alerts)) return false
  return isBoolean(value.alerts.beforeEnabled) && isNonNegativeNumber(value.alerts.beforeM)
    && isBoolean(value.alerts.atStart) && isBoolean(value.alerts.atEnd)
}
