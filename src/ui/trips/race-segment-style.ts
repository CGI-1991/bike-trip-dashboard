import type { RaceSegmentType } from '../../trip-core/index.ts'

export const RACE_SEGMENT_STYLE: Readonly<Record<RaceSegmentType, { readonly label: string; readonly letter: string; readonly color: string }>> = {
  sprint: { label: 'Sprint', letter: 'S', color: '#16804a' },
  climb: { label: 'Grimpeur', letter: 'G', color: '#b73132' },
  flandrien: { label: 'Flandrien', letter: 'F', color: '#e5bd32' },
}
