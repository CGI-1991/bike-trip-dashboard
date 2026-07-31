import type { LatitudeDegrees, LongitudeDegrees } from './common.ts'
import type { AccommodationId } from './ids.ts'
import type { DataProvenance } from './provenance.ts'

/** Generic lodging types, per CDC sections 8 and 22 (no trip-specific type). */
export type AccommodationType =
  | 'hotel'
  | 'airbnb'
  | 'gite'
  | 'chambre-hotes'
  | 'hostel'
  | 'guest-house'
  | 'refuge'
  | 'camping'

export interface Accommodation {
  readonly id: AccommodationId
  readonly name: string
  readonly type: AccommodationType
  readonly address: string | null
  readonly latitude: LatitudeDegrees | null
  readonly longitude: LongitudeDegrees | null
  readonly mapsUrl: string | null
  readonly website: string | null
  readonly phone: string | null
  readonly bookingReference: string | null
  readonly notes: string | null
  /** True once the user has settled on this lodging, as opposed to a suggestion. */
  readonly confirmed: boolean
  readonly provenance: DataProvenance
}
