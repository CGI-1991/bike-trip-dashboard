/** Display-only shortening. Canonical trip data is never mutated. */
export function compactPlaceName(value: string): string {
  return value
    .replace(/\bSainte-/gu, 'Ste-')
    .replace(/\bSaint-/gu, 'St-')
}
