/**
 * Public surface of the local route-analysis engine (phase 6B): elevation
 * smoothing, terrain/slope profile, climb detection, climb profile, pauses,
 * and timing/ETA. Pure, deterministic, no network, no IndexedDB, no
 * RGA/UI coupling — see each module's own header for details.
 */

export * from './elevation-profile.ts'
export * from './terrain-profile.ts'
export * from './climb-detection.ts'
export * from './climb-profile.ts'
export * from './pauses.ts'
export * from './pause-budget.ts'
export * from './timing.ts'
