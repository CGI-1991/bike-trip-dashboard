import type {
  GpxNumber,
  OffDay,
  RideDay,
  RideDayId,
  TripDayId,
  TripPlan,
} from './types.ts'

const expectedGpxByRideDay: Readonly<Record<RideDayId, GpxNumber>> = {
  J1: 1,
  J2: 2,
  J3: 3,
  J4: 4,
  J6: 5,
  J7: 6,
  J9: 7,
  J10: 8,
  J11: 9,
  J12: 10,
}

function fail(message: string): never {
  throw new Error(`Plan de voyage invalide : ${message}`)
}

export function assertTripPlan(plan: TripPlan): void {
  if (
    plan.totalDays !== 12 ||
    plan.rideDays !== 10 ||
    plan.offDays !== 2 ||
    plan.days.length !== 12
  ) {
    fail('les totaux doivent être exactement 12 jours, 10 roulés et 2 OFF.')
  }

  const ids = new Set<TripDayId>()
  const gpxNumbers = new Set<GpxNumber>()
  const gpxFiles = new Set<string>()
  const rideDays: RideDay[] = []
  const offDays: OffDay[] = []

  plan.days.forEach((day, index) => {
    const expectedDayNumber = index + 1
    const expectedDayId = `J${expectedDayNumber}`

    if (day.dayNumber !== expectedDayNumber || day.id !== expectedDayId) {
      fail(`ordre incorrect à la position ${expectedDayNumber}.`)
    }

    if (ids.has(day.id)) {
      fail(`identifiant de journée dupliqué : ${day.id}.`)
    }

    ids.add(day.id)

    if (day.type === 'ride') {
      if (day.gpxNumber !== expectedGpxByRideDay[day.id]) {
        fail(`association GPX incorrecte pour ${day.id}.`)
      }

      if (gpxNumbers.has(day.gpxNumber) || gpxFiles.has(day.gpxFile)) {
        fail(`association GPX dupliquée pour ${day.id}.`)
      }

      gpxNumbers.add(day.gpxNumber)
      gpxFiles.add(day.gpxFile)
      rideDays.push(day)
    } else {
      offDays.push(day)
    }
  })

  if (rideDays.length !== 10 || offDays.length !== 2) {
    fail('répartition incorrecte entre journées roulées et OFF.')
  }

  for (let gpxNumber = 1; gpxNumber <= 10; gpxNumber++) {
    if (!gpxNumbers.has(gpxNumber as GpxNumber)) {
      fail(`GPX ${String(gpxNumber).padStart(2, '0')} absent.`)
    }
  }

  const j5 = offDays.find(({ id }) => id === 'J5')
  const j8 = offDays.find(({ id }) => id === 'J8')

  if (
    j5?.locationName !== 'Bourg-Saint-Maurice' ||
    j5.name !== j5.locationName ||
    j5.title !== 'Journée OFF' ||
    j5.nextRideDayId !== 'J6' ||
    j8?.locationName !== 'Briançon' ||
    j8.name !== j8.locationName ||
    j8.title !== 'Journée OFF' ||
    j8.nextRideDayId !== 'J9'
  ) {
    fail('J5 ou J8 ne respecte pas le contrat des journées OFF.')
  }

  for (let index = 1; index < plan.days.length; index++) {
    const previousDay = plan.days[index - 1]
    const day = plan.days[index]
    const previousLocation =
      previousDay?.type === 'ride' ? previousDay.endName : previousDay?.locationName
    const currentLocation = day?.type === 'ride' ? day.startName : day?.locationName

    if (previousLocation !== currentLocation) {
      fail(`lieux discontinus entre ${previousDay?.id ?? '?'} et ${day?.id ?? '?'}.`)
    }
  }

  const lastDay = plan.days[plan.days.length - 1]

  if (lastDay?.type !== 'ride' || lastDay.endName !== 'Nice') {
    fail('la destination finale doit être Nice.')
  }
}

export const rga2026TripPlan = {
  id: 'rga-2026',
  name: 'Route des Grandes Alpes 2026',
  timezone: 'Europe/Paris',
  totalDays: 12,
  rideDays: 10,
  offDays: 2,
  days: [
    {
      id: 'J1',
      dayNumber: 1,
      type: 'ride',
      name: 'Thonon-les-Bains → Morzine',
      startName: 'Thonon-les-Bains',
      endName: 'Morzine',
      gpxNumber: 1,
      gpxFile:
        '01_route-des-grandes-alpes-a-velo-thonon-les-bains-morzine-avoriaz.gpx',
    },
    {
      id: 'J2',
      dayNumber: 2,
      type: 'ride',
      name: 'Morzine → Le Grand-Bornand',
      startName: 'Morzine',
      endName: 'Le Grand-Bornand',
      gpxNumber: 2,
      gpxFile:
        '02_route-des-grandes-alpes-a-velo-morzine-avoriaz-le-grand-bornand.gpx',
    },
    {
      id: 'J3',
      dayNumber: 3,
      type: 'ride',
      name: 'Le Grand-Bornand → Beaufort-sur-Doron',
      startName: 'Le Grand-Bornand',
      endName: 'Beaufort-sur-Doron',
      gpxNumber: 3,
      gpxFile:
        '03_route-des-grandes-alpes-a-velo-le-grand-bornand-beaufort-sur-doron.gpx',
    },
    {
      id: 'J4',
      dayNumber: 4,
      type: 'ride',
      name: 'Beaufort-sur-Doron → Bourg-Saint-Maurice',
      startName: 'Beaufort-sur-Doron',
      endName: 'Bourg-Saint-Maurice',
      gpxNumber: 4,
      gpxFile:
        '04_route-des-grandes-alpes-a-velo-beaufort-sur-doron-bourg-saint-maurice.gpx',
    },
    {
      id: 'J5',
      dayNumber: 5,
      type: 'off',
      name: 'Bourg-Saint-Maurice',
      locationName: 'Bourg-Saint-Maurice',
      title: 'Journée OFF',
      nextRideDayId: 'J6',
    },
    {
      id: 'J6',
      dayNumber: 6,
      type: 'ride',
      name: 'Bourg-Saint-Maurice → Val-Cenis',
      startName: 'Bourg-Saint-Maurice',
      endName: 'Val-Cenis',
      gpxNumber: 5,
      gpxFile:
        '05_route-des-grandes-alpes-a-velo-bourg-saint-maurice-val-cenis.gpx',
    },
    {
      id: 'J7',
      dayNumber: 7,
      type: 'ride',
      name: 'Val-Cenis → Briançon',
      startName: 'Val-Cenis',
      endName: 'Briançon',
      gpxNumber: 6,
      gpxFile: '06_route-des-grandes-alpes-a-velo-val-cenis-briancon.gpx',
    },
    {
      id: 'J8',
      dayNumber: 8,
      type: 'off',
      name: 'Briançon',
      locationName: 'Briançon',
      title: 'Journée OFF',
      nextRideDayId: 'J9',
    },
    {
      id: 'J9',
      dayNumber: 9,
      type: 'ride',
      name: 'Briançon → Barcelonnette',
      startName: 'Briançon',
      endName: 'Barcelonnette',
      gpxNumber: 7,
      gpxFile: '07_route-des-grandes-alpes-a-velo-briancon-barcelonnette.gpx',
    },
    {
      id: 'J10',
      dayNumber: 10,
      type: 'ride',
      name: 'Barcelonnette → Saint-Étienne-de-Tinée',
      startName: 'Barcelonnette',
      endName: 'Saint-Étienne-de-Tinée',
      gpxNumber: 8,
      gpxFile:
        '08_route-des-grandes-alpes-a-velo-variante-barcelonnette-saint-etienne-de-tinee.gpx',
      variant: 'Bonette',
    },
    {
      id: 'J11',
      dayNumber: 11,
      type: 'ride',
      name: 'Saint-Étienne-de-Tinée → Saint-Martin-Vésubie',
      startName: 'Saint-Étienne-de-Tinée',
      endName: 'Saint-Martin-Vésubie',
      gpxNumber: 9,
      gpxFile:
        '09_route-des-grandes-alpes-a-velo-variante-saint-etienne-de-tinee-saint-martin-vesubie.gpx',
      variant: 'Variante',
    },
    {
      id: 'J12',
      dayNumber: 12,
      type: 'ride',
      name: 'Saint-Martin-Vésubie → Nice',
      startName: 'Saint-Martin-Vésubie',
      endName: 'Nice',
      gpxNumber: 10,
      gpxFile:
        '10_route-des-grandes-alpes-a-velo-saint-martin-vesubie-nice.gpx',
    },
  ],
} as const satisfies TripPlan

assertTripPlan(rga2026TripPlan)

const tripDayIds = new Set<TripDayId>(rga2026TripPlan.days.map(({ id }) => id))

export function isTripDayId(value: string): value is TripDayId {
  return tripDayIds.has(value as TripDayId)
}
