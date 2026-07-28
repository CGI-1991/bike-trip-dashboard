/**
 * Provisional operational thresholds for mountain cycling risk alerts.
 *
 * These numbers are cautious starting points, not a validated safety standard —
 * they are meant to be reviewed and tuned centrally, from this single file,
 * as real-world feedback comes in. Nothing in this module should be read as a
 * guarantee that conditions below "orange"/"red" are safe.
 */
export interface WeatherAlertThresholds {
  readonly precipitation: {
    readonly orangeProbabilityPct: number
    readonly orangeProbabilityAmountMm: number
    readonly orangeAmountMm: number
    readonly redProbabilityPct: number
    readonly redProbabilityAmountMm: number
    readonly redAmountMm: number
  }
  readonly wind: {
    readonly orangeSustainedKph: number
    readonly redSustainedKph: number
    readonly orangeGustKph: number
    readonly redGustKph: number
  }
  readonly summitWind: {
    readonly orangeGustKph: number
    readonly redGustKph: number
  }
  readonly cold: {
    readonly orangeApparentC: number
    readonly redApparentC: number
  }
  readonly summitCold: {
    readonly orangeApparentC: number
    readonly redApparentC: number
  }
  readonly heat: {
    readonly orangeApparentC: number
    readonly redApparentC: number
  }
  readonly visibility: {
    readonly orangeM: number
    readonly redM: number
  }
  readonly freezingLevel: {
    readonly orangeMarginM: number
    readonly redMarginM: number
  }
  readonly snow: {
    readonly orangeAnyCm: number
    readonly redSignificantCm: number
  }
  readonly thunderstormCodes: {
    readonly orange: readonly number[]
    readonly red: readonly number[]
  }
  readonly highAltitudeM: number
  readonly coverage: {
    readonly minimumEssentialCoverageRatio: number
  }
  readonly staleData: {
    readonly maxTrustedAgeMs: number
  }
}

/**
 * Initial values per the Phase D specification. Precipitation intentionally
 * models the dual-condition rule ("probability AND amount" OR "amount alone")
 * with two distinct amount fields rather than the single `orangeAmountMm`
 * shorthand suggested in the brief, since the two conditions require different
 * amounts (0.5 mm/h combined with a high probability vs. 1.5 mm/h alone).
 * Thunderstorm codes get their own dedicated alert (see `evaluate-point.ts`)
 * rather than also feeding the precipitation red condition, to avoid firing
 * two alerts of different `riskType` for the exact same trigger.
 */
export const WEATHER_ALERT_THRESHOLDS: WeatherAlertThresholds = {
  precipitation: {
    orangeProbabilityPct: 60,
    orangeProbabilityAmountMm: 0.5,
    orangeAmountMm: 1.5,
    redProbabilityPct: 80,
    redProbabilityAmountMm: 2,
    redAmountMm: 4,
  },
  wind: {
    orangeSustainedKph: 35,
    redSustainedKph: 50,
    orangeGustKph: 50,
    redGustKph: 70,
  },
  summitWind: {
    orangeGustKph: 45,
    redGustKph: 65,
  },
  cold: {
    orangeApparentC: 3,
    redApparentC: -2,
  },
  summitCold: {
    orangeApparentC: 5,
    redApparentC: 0,
  },
  heat: {
    orangeApparentC: 30,
    redApparentC: 35,
  },
  visibility: {
    orangeM: 5_000,
    redM: 1_000,
  },
  freezingLevel: {
    orangeMarginM: 300,
    redMarginM: 0,
  },
  snow: {
    orangeAnyCm: 0,
    redSignificantCm: 1,
  },
  thunderstormCodes: {
    orange: [95],
    red: [96, 99],
  },
  highAltitudeM: 1_500,
  coverage: {
    minimumEssentialCoverageRatio: 0.8,
  },
  staleData: {
    maxTrustedAgeMs: 6 * 60 * 60_000,
  },
} as const

export const DEPARTURE_SCENARIO_OFFSETS_MINUTES = [-120, -60, 0, 60, 120] as const

/**
 * Centralized "is a candidate departure time meaningfully better" gate (Phase D,
 * section I). A candidate must clear at least one of these margins before it is
 * allowed to be recommended over the currently configured departure time.
 */
export const SCENARIO_IMPROVEMENT_THRESHOLDS = {
  minimumRedAlertReduction: 1,
  minimumOrangeAlertReduction: 2,
  minimumRainReductionMm: 2,
  minimumGustReductionKph: 15,
  minimumExposedApparentTemperatureGainC: 5,
} as const
