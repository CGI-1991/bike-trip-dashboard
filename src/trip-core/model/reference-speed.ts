import type { TravelMode } from './settings.ts'

export const REFERENCE_SPEED_MODES = ['chill', 'tempo', 'normal', 'sustained', 'sporty', 'manual'] as const
export type ReferenceSpeedMode = (typeof REFERENCE_SPEED_MODES)[number]
export const REFERENCE_SPEED_LABELS: Record<ReferenceSpeedMode, string> = {
  chill: 'Chill', tempo: 'Tempo', normal: 'Normal', sustained: 'Soutenu', sporty: 'Sportif', manual: 'Manuel',
}
/** Level ground reference, before terrain factors. Normal keeps existing defaults. */
export const REFERENCE_SPEED_PRESETS = {
  cycling: { chill: 12, tempo: 15, normal: 18, sustained: 23, sporty: 28 },
  walking: { chill: 3, tempo: 3.8, normal: 4.5, sustained: 5.3, sporty: 6.2 },
} as const
export function isReferenceSpeedMode(value: unknown): value is ReferenceSpeedMode {
  return REFERENCE_SPEED_MODES.includes(value as ReferenceSpeedMode)
}
export function resolveReferenceSpeedMode(speed: number, travelMode: TravelMode, stored?: ReferenceSpeedMode): ReferenceSpeedMode {
  if (stored === 'manual') return stored
  return REFERENCE_SPEED_MODES.find(mode => mode !== 'manual' && REFERENCE_SPEED_PRESETS[travelMode][mode] === speed) ?? 'manual'
}
