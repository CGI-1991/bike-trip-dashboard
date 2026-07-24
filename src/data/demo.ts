export interface DemoStage {
  readonly id: number
  readonly start: string
  readonly end: string
  readonly distanceKm: number
  readonly elevationGainM: number
}

export interface DemoTimelinePoint {
  readonly name: string
  readonly time: string
  readonly weather: string
}

export interface DemoAlert {
  readonly id: string
  readonly tone: 'warning' | 'danger'
  readonly title: string
  readonly detail: string
}

export interface TodayDemo {
  readonly dateLabel: string
  readonly start: string
  readonly end: string
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly estimatedArrivalTime: string
  readonly weatherSummary: string
}

export const activeStageId = 1

export const todayDemo: TodayDemo = {
  dateLabel: 'Samedi 20 juin 2026',
  start: 'Thonon-les-Bains',
  end: 'Morzine',
  distanceKm: 50,
  elevationGainM: 1250,
  estimatedArrivalTime: '12:15',
  weatherSummary: 'Éclaircies, 18 °C',
}

export const demoTimeline: readonly DemoTimelinePoint[] = [
  { name: 'Thonon-les-Bains', time: '08:00', weather: '17 °C, couvert' },
  { name: 'Col du Feu', time: '09:35', weather: '14 °C, éclaircies' },
  { name: 'Col de Jambaz', time: '10:45', weather: '13 °C, averses' },
  { name: 'Morzine', time: '12:15', weather: '19 °C, sec' },
]

export const demoAlerts: readonly DemoAlert[] = [
  {
    id: 'storm-altitude',
    tone: 'danger',
    title: 'Risque d’orage en altitude',
    detail: 'Orage simulé près du Col du Feu autour de 10:00.',
  },
  {
    id: 'valley-heat',
    tone: 'warning',
    title: 'Forte chaleur dans la vallée',
    detail: 'Température fictive de 31 °C dans la vallée après 14:00.',
  },
]

export const demoStages: readonly DemoStage[] = [
  { id: 1, start: 'Thonon-les-Bains', end: 'Morzine', distanceKm: 50, elevationGainM: 1250 },
  { id: 2, start: 'Morzine', end: 'La Clusaz', distanceKm: 96, elevationGainM: 2600 },
  { id: 3, start: 'La Clusaz', end: 'Bourg-Saint-Maurice', distanceKm: 104, elevationGainM: 2900 },
  {
    id: 4,
    start: 'Bourg-Saint-Maurice',
    end: 'Val-d’Isère',
    distanceKm: 50,
    elevationGainM: 1700,
  },
  { id: 5, start: 'Val-d’Isère', end: 'Valloire', distanceKm: 94, elevationGainM: 2450 },
  { id: 6, start: 'Valloire', end: 'Briançon', distanceKm: 55, elevationGainM: 1550 },
  { id: 7, start: 'Briançon', end: 'Barcelonnette', distanceKm: 105, elevationGainM: 2550 },
  { id: 8, start: 'Barcelonnette', end: 'Menton', distanceKm: 165, elevationGainM: 3200 },
]
