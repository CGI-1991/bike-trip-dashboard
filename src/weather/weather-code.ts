interface WeatherCodeDefinition {
  readonly label: string
  readonly severity: number
}

const WEATHER_CODES = new Map<number, WeatherCodeDefinition>([
  [0, { label: 'Ciel dégagé', severity: 0 }],
  [1, { label: 'Plutôt dégagé', severity: 1 }],
  [2, { label: 'Partiellement nuageux', severity: 2 }],
  [3, { label: 'Couvert', severity: 3 }],
  [45, { label: 'Brouillard', severity: 5 }],
  [48, { label: 'Brouillard givrant', severity: 6 }],
  [51, { label: 'Bruine faible', severity: 4 }],
  [53, { label: 'Bruine modérée', severity: 5 }],
  [55, { label: 'Bruine forte', severity: 6 }],
  [56, { label: 'Bruine verglaçante faible', severity: 7 }],
  [57, { label: 'Bruine verglaçante forte', severity: 8 }],
  [61, { label: 'Pluie faible', severity: 5 }],
  [63, { label: 'Pluie modérée', severity: 6 }],
  [65, { label: 'Pluie forte', severity: 8 }],
  [66, { label: 'Pluie verglaçante faible', severity: 8 }],
  [67, { label: 'Pluie verglaçante forte', severity: 9 }],
  [71, { label: 'Neige faible', severity: 6 }],
  [73, { label: 'Neige modérée', severity: 7 }],
  [75, { label: 'Neige forte', severity: 9 }],
  [77, { label: 'Grains de neige', severity: 6 }],
  [80, { label: 'Averses faibles', severity: 6 }],
  [81, { label: 'Averses modérées', severity: 7 }],
  [82, { label: 'Averses violentes', severity: 9 }],
  [85, { label: 'Averses de neige faibles', severity: 7 }],
  [86, { label: 'Averses de neige fortes', severity: 9 }],
  [95, { label: 'Orage', severity: 10 }],
  [96, { label: 'Orage avec grêle faible', severity: 11 }],
  [99, { label: 'Orage avec forte grêle', severity: 12 }],
])

export function getWeatherCodeLabel(code: number | null): string {
  if (code === null) {
    return 'Conditions non identifiées'
  }

  return WEATHER_CODES.get(code)?.label ?? 'Conditions non identifiées'
}

export function getWeatherCodeSeverity(code: number): number {
  return WEATHER_CODES.get(code)?.severity ?? -1
}

export function selectWorstWeatherCode(
  codes: Iterable<number | null>,
): number | null {
  let selected: number | null = null
  let selectedSeverity = Number.NEGATIVE_INFINITY

  for (const code of codes) {
    if (code === null) {
      continue
    }

    const severity = getWeatherCodeSeverity(code)
    if (
      severity > selectedSeverity ||
      (severity === selectedSeverity && (selected === null || code > selected))
    ) {
      selected = code
      selectedSeverity = severity
    }
  }

  return selected
}
