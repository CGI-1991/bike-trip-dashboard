import type { Climb, TravelMode } from '../trip-core/index.ts'

export function retainsClimbCategory(climb: Climb, minimum: number, mode: TravelMode = 'cycling'): boolean {
  return minimum === 0 || climb.provenance.sourceType === 'user' || climb.provenance.manuallyOverridden
    || (classifyClimb(climb, mode)?.rank ?? 0) >= minimum
}

export interface ClimbCategory {
  readonly rank: 0 | 1 | 2 | 3 | 4 | 5
  readonly label: string
  readonly score: number
  readonly explanation: string
}

/** Indicative effort only: never an official race category or trail grade. */
export function classifyClimb(climb: Pick<Climb, 'startDistanceKm' | 'endDistanceKm' | 'elevationGainM' | 'averageGradientPercent'>, mode: TravelMode = 'cycling'): ClimbCategory | null {
  const lengthKm = climb.endDistanceKm - climb.startDistanceKm
  if (![lengthKm, climb.elevationGainM, climb.averageGradientPercent].every(Number.isFinite) || lengthKm <= 0 || climb.elevationGainM < 0) return null
  const score = mode === 'walking' ? lengthKm + climb.elevationGainM / 100 : lengthKm * 1000 * Math.max(0, climb.averageGradientPercent)
  const thresholds = mode === 'walking' ? [2, 4, 8, 12, 20] : [8000, 16000, 32000, 64000, 80000]
  const rank = thresholds.filter(threshold => score >= threshold).length as ClimbCategory['rank']
  const label = mode === 'walking' ? rank === 0 ? 'Petite montée' : `Effort ${rank}/5` : ['Côte', 'Cat. 4', 'Cat. 3', 'Cat. 2', 'Cat. 1', 'HC'][rank]!
  return { rank, label, score, explanation: mode === 'walking'
    ? 'Effort indicatif : longueur + 1 km par 100 m de D+. Ne décrit pas la technicité du sentier.'
    : 'Catégorie indicative : longueur en mètres × pente moyenne en %. Ce n’est pas un classement officiel.' }
}

export const CLIMB_CATEGORY_FILTER_LABELS = {
  cycling: ['Toutes', 'Cat. 4 et plus', 'Cat. 3 et plus', 'Cat. 2 et plus', 'Cat. 1 et HC'],
  walking: ['Toutes', 'Effort 1 et plus', 'Effort 2 et plus', 'Effort 3 et plus', 'Effort 4 et 5'],
} as const
