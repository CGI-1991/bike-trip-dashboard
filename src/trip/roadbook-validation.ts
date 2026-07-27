import { rga2026TripPlan } from './plan.ts'
import type {
  RoadbookDocument,
  RoadbookMatchMethod,
  RoadbookOverridesDocument,
  RoadbookPointSubtype,
  RoadbookPointStatus,
  RoadbookPointType,
  RoadbookValidationIssue,
} from './roadbook-types.ts'
import type {
  RideDay,
  TripDay,
  TripDayId,
  TripPlan,
} from './types.ts'

const expectedRoadbookSource = 'docs/sources/roadbook-rga-2026.md'
const roadbookPointStatuses: ReadonlySet<string> = new Set([
  'matched',
  'needs-review',
  'unmatched',
])
const manualMatchMethods: ReadonlySet<RoadbookMatchMethod> = new Set([
  'manual-confirmed-profile-candidate',
  'manual-anchor-projected-to-track',
  'manual-track-loop-confirmation',
])
const roadbookPointTypes: ReadonlySet<RoadbookPointType> = new Set([
  'start',
  'end',
  'col',
  'summit',
  'village',
  'passage',
  'resupply',
  'pause',
  'shelter',
  'lodging',
  'poi',
])
const roadbookPointSubtypes: ReadonlySet<RoadbookPointSubtype> = new Set([
  'strategic-passage',
  'scenic-high-point',
  'optional-passage',
])

const documentKeys = ['version', 'tripId', 'sourceFile', 'days'] as const
const rideDayKeys = [
  'id',
  'dayNumber',
  'type',
  'title',
  'startName',
  'endName',
  'ambiance',
  'editorialStats',
  'cols',
  'resupplyPassages',
  'explicitPauses',
  'notes',
  'variant',
  'options',
  'lodgings',
] as const
const offDayKeys = [
  'id',
  'dayNumber',
  'type',
  'title',
  'locationName',
  'ambiance',
  'logistics',
  'activities',
  'recovery',
  'lodgings',
  'notes',
  'nextRideDayId',
] as const
const editorialStatsKeys = [
  'distanceKm',
  'elevationGainM',
  'elevationLossM',
] as const
const climbKeys = [
  'id',
  'name',
  'elevationM',
  'distanceKm',
  'elevationGainM',
  'averageGradientPercent',
] as const
const labelKeys = ['id', 'label'] as const
const explicitPauseKeys = ['id', 'title'] as const
const optionKeys = [
  'id',
  'title',
  'elevationM',
  'distanceKm',
  'elevationGainM',
  'averageGradientPercent',
] as const
const descriptionKeys = ['id', 'description'] as const
const overridesDocumentKeys = ['version', 'tripId', 'overrides'] as const
const overrideKeys = [
  'pointId',
  'dayId',
  'approvedStatus',
  'sourceAnchor',
  'gpxProjection',
  'anchorDistanceM',
  'matchMethod',
  'comment',
  'validationSource',
  'displayName',
  'pointType',
  'pointSubtype',
] as const
const sourceAnchorKeys = ['latitude', 'longitude'] as const
const gpxProjectionKeys = [
  'latitude',
  'longitude',
  'trackDistanceKm',
  'segmentIndex',
  'pointIndex',
  'nextPointIndex',
  'segmentFraction',
  'elevationM',
] as const

interface NumberRules {
  readonly minimum: number
  readonly maximum: number
  readonly integer?: boolean
  readonly exclusiveMinimum?: boolean
}

interface ValidationContext {
  readonly issues: RoadbookValidationIssue[]
  readonly ids: Set<string>
  readonly overrideTargetIds: Set<string>
}

export class RoadbookValidationError extends Error {
  readonly issues: readonly RoadbookValidationIssue[]

  constructor(label: string, issues: readonly RoadbookValidationIssue[]) {
    const firstIssue = issues[0]
    const detail =
      firstIssue === undefined
        ? ''
        : ` ${firstIssue.path} : ${firstIssue.message}`
    super(`${label} invalide (${issues.length} problème${issues.length > 1 ? 's' : ''}).${detail}`)
    this.name = 'RoadbookValidationError'
    this.issues = [...issues]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function addIssue(
  context: ValidationContext,
  path: string,
  message: string,
  dayId?: TripDayId,
): void {
  context.issues.push(dayId === undefined ? { path, message } : { path, message, dayId })
}

function validateAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  context: ValidationContext,
  dayId?: TripDayId,
): void {
  const allowed = new Set(allowedKeys)

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addIssue(
        context,
        `${path}.${key}`,
        'champ inattendu ; les coordonnées et résultats de matching ne sont pas autorisés dans le roadbook brut.',
        dayId,
      )
    }
  }
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  context: ValidationContext,
  dayId?: TripDayId,
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    addIssue(context, path, 'chaîne non vide attendue.', dayId)
    return false
  }

  return true
}

function validateFiniteNumber(
  value: unknown,
  path: string,
  rules: NumberRules,
  context: ValidationContext,
  dayId?: TripDayId,
): value is number {
  const belowMinimum =
    typeof value === 'number' &&
    (rules.exclusiveMinimum
      ? value <= rules.minimum
      : value < rules.minimum)

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    belowMinimum ||
    value > rules.maximum ||
    (rules.integer === true && !Number.isSafeInteger(value))
  ) {
    const lowerOperator = rules.exclusiveMinimum === true ? '>' : '≥'
    const integerLabel = rules.integer === true ? ' entier' : ''
    addIssue(
      context,
      path,
      `nombre fini${integerLabel} attendu (${lowerOperator} ${rules.minimum} et ≤ ${rules.maximum}).`,
      dayId,
    )
    return false
  }

  return true
}

function validateOptionalFiniteNumber(
  value: unknown,
  path: string,
  rules: NumberRules,
  context: ValidationContext,
  dayId?: TripDayId,
): void {
  if (value !== undefined) {
    validateFiniteNumber(value, path, rules, context, dayId)
  }
}

function validateArray(
  value: unknown,
  path: string,
  context: ValidationContext,
  dayId?: TripDayId,
): value is readonly unknown[] {
  if (!Array.isArray(value)) {
    addIssue(context, path, 'tableau attendu.', dayId)
    return false
  }

  return true
}

function validateStringArray(
  value: unknown,
  path: string,
  context: ValidationContext,
  dayId: TripDayId,
): void {
  if (!validateArray(value, path, context, dayId)) {
    return
  }

  value.forEach((item, index) => {
    validateNonEmptyString(item, `${path}[${index}]`, context, dayId)
  })
}

function registerId(
  rawId: unknown,
  expectedPrefix: string,
  path: string,
  context: ValidationContext,
  dayId: TripDayId,
  canBeOverridden: boolean,
): void {
  if (!validateNonEmptyString(rawId, path, context, dayId)) {
    return
  }

  const expectedPattern = new RegExp(
    `^${expectedPrefix}[a-z0-9]+(?:-[a-z0-9]+)*$`,
  )

  if (!expectedPattern.test(rawId)) {
    addIssue(
      context,
      path,
      `identifiant déterministe attendu avec le préfixe "${expectedPrefix}".`,
      dayId,
    )
  }

  if (context.ids.has(rawId)) {
    addIssue(context, path, `identifiant dupliqué : ${rawId}.`, dayId)
  } else {
    context.ids.add(rawId)
  }

  if (canBeOverridden) {
    context.overrideTargetIds.add(rawId)
  }
}

function validateObjectArray(
  value: unknown,
  path: string,
  context: ValidationContext,
  dayId: TripDayId,
  validateItem: (
    item: Record<string, unknown>,
    itemPath: string,
    index: number,
  ) => void,
): void {
  if (!validateArray(value, path, context, dayId)) {
    return
  }

  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`

    if (!isRecord(item)) {
      addIssue(context, itemPath, 'objet attendu.', dayId)
      return
    }

    validateItem(item, itemPath, index)
  })
}

function validateEditorialStats(
  value: unknown,
  path: string,
  context: ValidationContext,
  dayId: TripDayId,
): void {
  if (!isRecord(value)) {
    addIssue(context, path, 'objet de statistiques attendu.', dayId)
    return
  }

  validateAllowedKeys(value, editorialStatsKeys, path, context, dayId)
  validateFiniteNumber(
    value.distanceKm,
    `${path}.distanceKm`,
    { minimum: 0, maximum: 1000, exclusiveMinimum: true },
    context,
    dayId,
  )
  validateFiniteNumber(
    value.elevationGainM,
    `${path}.elevationGainM`,
    { minimum: 0, maximum: 50_000, integer: true },
    context,
    dayId,
  )
  validateFiniteNumber(
    value.elevationLossM,
    `${path}.elevationLossM`,
    { minimum: 0, maximum: 50_000, integer: true },
    context,
    dayId,
  )
}

function validateClimbs(
  value: unknown,
  path: string,
  dayNumber: number,
  context: ValidationContext,
  dayId: TripDayId,
): void {
  validateObjectArray(value, path, context, dayId, (item, itemPath) => {
    validateAllowedKeys(item, climbKeys, itemPath, context, dayId)
    registerId(
      item.id,
      `j${String(dayNumber).padStart(2, '0')}-col-`,
      `${itemPath}.id`,
      context,
      dayId,
      true,
    )
    validateNonEmptyString(item.name, `${itemPath}.name`, context, dayId)
    validateFiniteNumber(
      item.elevationM,
      `${itemPath}.elevationM`,
      { minimum: -500, maximum: 9000, integer: true },
      context,
      dayId,
    )
    validateFiniteNumber(
      item.distanceKm,
      `${itemPath}.distanceKm`,
      { minimum: 0, maximum: 1000, exclusiveMinimum: true },
      context,
      dayId,
    )
    validateFiniteNumber(
      item.elevationGainM,
      `${itemPath}.elevationGainM`,
      { minimum: 0, maximum: 50_000, integer: true },
      context,
      dayId,
    )
    validateFiniteNumber(
      item.averageGradientPercent,
      `${itemPath}.averageGradientPercent`,
      { minimum: -40, maximum: 40 },
      context,
      dayId,
    )
  })
}

function validateLabels(
  value: unknown,
  path: string,
  dayNumber: number,
  context: ValidationContext,
  dayId: TripDayId,
): void {
  validateObjectArray(value, path, context, dayId, (item, itemPath) => {
    validateAllowedKeys(item, labelKeys, itemPath, context, dayId)
    registerId(
      item.id,
      `j${String(dayNumber).padStart(2, '0')}-passage-`,
      `${itemPath}.id`,
      context,
      dayId,
      true,
    )
    validateNonEmptyString(item.label, `${itemPath}.label`, context, dayId)
  })
}

function validateExplicitPauses(
  value: unknown,
  path: string,
  dayNumber: number,
  context: ValidationContext,
  dayId: TripDayId,
): void {
  validateObjectArray(value, path, context, dayId, (item, itemPath) => {
    validateAllowedKeys(item, explicitPauseKeys, itemPath, context, dayId)
    registerId(
      item.id,
      `j${String(dayNumber).padStart(2, '0')}-pause-`,
      `${itemPath}.id`,
      context,
      dayId,
      true,
    )
    validateNonEmptyString(item.title, `${itemPath}.title`, context, dayId)
  })
}

function validateOptions(
  value: unknown,
  path: string,
  dayNumber: number,
  context: ValidationContext,
  dayId: TripDayId,
): void {
  validateObjectArray(value, path, context, dayId, (item, itemPath) => {
    validateAllowedKeys(item, optionKeys, itemPath, context, dayId)
    registerId(
      item.id,
      `j${String(dayNumber).padStart(2, '0')}-option-`,
      `${itemPath}.id`,
      context,
      dayId,
      true,
    )
    validateNonEmptyString(item.title, `${itemPath}.title`, context, dayId)
    validateOptionalFiniteNumber(
      item.elevationM,
      `${itemPath}.elevationM`,
      { minimum: -500, maximum: 9000, integer: true },
      context,
      dayId,
    )
    validateOptionalFiniteNumber(
      item.distanceKm,
      `${itemPath}.distanceKm`,
      { minimum: 0, maximum: 1000, exclusiveMinimum: true },
      context,
      dayId,
    )
    validateOptionalFiniteNumber(
      item.elevationGainM,
      `${itemPath}.elevationGainM`,
      { minimum: 0, maximum: 50_000, integer: true },
      context,
      dayId,
    )
    validateOptionalFiniteNumber(
      item.averageGradientPercent,
      `${itemPath}.averageGradientPercent`,
      { minimum: -40, maximum: 40 },
      context,
      dayId,
    )
  })
}

function validateDescriptions(
  value: unknown,
  path: string,
  dayNumber: number,
  category: 'lodging' | 'logistics' | 'activity' | 'recovery',
  context: ValidationContext,
  dayId: TripDayId,
  canBeOverridden: boolean,
): void {
  validateObjectArray(value, path, context, dayId, (item, itemPath) => {
    validateAllowedKeys(item, descriptionKeys, itemPath, context, dayId)
    registerId(
      item.id,
      `j${String(dayNumber).padStart(2, '0')}-${category}-`,
      `${itemPath}.id`,
      context,
      dayId,
      canBeOverridden,
    )
    validateNonEmptyString(
      item.description,
      `${itemPath}.description`,
      context,
      dayId,
    )
  })
}

export function createSyntheticRoadbookEndpointId(
  dayNumber: number,
  endpoint: 'start' | 'end',
): string {
  return `j${String(dayNumber).padStart(2, '0')}-${endpoint}`
}

function registerSyntheticEndpoints(
  day: RideDay,
  context: ValidationContext,
): void {
  const dayId = day.id

  for (const endpoint of ['start', 'end'] as const) {
    const id = createSyntheticRoadbookEndpointId(day.dayNumber, endpoint)

    if (context.ids.has(id)) {
      addIssue(context, `days.${dayId}`, `identifiant synthétique dupliqué : ${id}.`, dayId)
    } else {
      context.ids.add(id)
    }

  }
}

function validateRideDay(
  value: Record<string, unknown>,
  path: string,
  planDay: RideDay,
  context: ValidationContext,
): void {
  const dayId = planDay.id
  validateAllowedKeys(value, rideDayKeys, path, context, dayId)
  registerSyntheticEndpoints(planDay, context)
  validateNonEmptyString(value.title, `${path}.title`, context, dayId)

  if (
    validateNonEmptyString(value.startName, `${path}.startName`, context, dayId) &&
    value.startName !== planDay.startName
  ) {
    addIssue(
      context,
      `${path}.startName`,
      `doit correspondre au TripPlan : "${planDay.startName}".`,
      dayId,
    )
  }

  if (
    validateNonEmptyString(value.endName, `${path}.endName`, context, dayId) &&
    value.endName !== planDay.endName
  ) {
    addIssue(
      context,
      `${path}.endName`,
      `doit correspondre au TripPlan : "${planDay.endName}".`,
      dayId,
    )
  }

  validateNonEmptyString(value.ambiance, `${path}.ambiance`, context, dayId)
  validateEditorialStats(value.editorialStats, `${path}.editorialStats`, context, dayId)
  validateClimbs(value.cols, `${path}.cols`, planDay.dayNumber, context, dayId)
  validateLabels(
    value.resupplyPassages,
    `${path}.resupplyPassages`,
    planDay.dayNumber,
    context,
    dayId,
  )
  validateExplicitPauses(
    value.explicitPauses,
    `${path}.explicitPauses`,
    planDay.dayNumber,
    context,
    dayId,
  )
  validateStringArray(value.notes, `${path}.notes`, context, dayId)

  if (
    value.variant !== null &&
    !validateNonEmptyString(value.variant, `${path}.variant`, context, dayId)
  ) {
    // The validation helper already recorded the precise issue.
  }

  validateOptions(value.options, `${path}.options`, planDay.dayNumber, context, dayId)
  validateDescriptions(
    value.lodgings,
    `${path}.lodgings`,
    planDay.dayNumber,
    'lodging',
    context,
    dayId,
    true,
  )
}

function validateOffDay(
  value: Record<string, unknown>,
  path: string,
  planDay: Extract<TripDay, { type: 'off' }>,
  context: ValidationContext,
): void {
  const dayId = planDay.id
  validateAllowedKeys(value, offDayKeys, path, context, dayId)
  validateNonEmptyString(value.title, `${path}.title`, context, dayId)

  if (
    validateNonEmptyString(
      value.locationName,
      `${path}.locationName`,
      context,
      dayId,
    ) &&
    value.locationName !== planDay.locationName
  ) {
    addIssue(
      context,
      `${path}.locationName`,
      `doit correspondre au TripPlan : "${planDay.locationName}".`,
      dayId,
    )
  }

  validateNonEmptyString(value.ambiance, `${path}.ambiance`, context, dayId)
  validateDescriptions(
    value.logistics,
    `${path}.logistics`,
    planDay.dayNumber,
    'logistics',
    context,
    dayId,
    false,
  )
  validateDescriptions(
    value.activities,
    `${path}.activities`,
    planDay.dayNumber,
    'activity',
    context,
    dayId,
    false,
  )
  validateDescriptions(
    value.recovery,
    `${path}.recovery`,
    planDay.dayNumber,
    'recovery',
    context,
    dayId,
    false,
  )
  validateDescriptions(
    value.lodgings,
    `${path}.lodgings`,
    planDay.dayNumber,
    'lodging',
    context,
    dayId,
    false,
  )
  validateStringArray(value.notes, `${path}.notes`, context, dayId)

  if (
    validateNonEmptyString(
      value.nextRideDayId,
      `${path}.nextRideDayId`,
      context,
      dayId,
    ) &&
    value.nextRideDayId !== planDay.nextRideDayId
  ) {
    addIssue(
      context,
      `${path}.nextRideDayId`,
      `doit correspondre au TripPlan : "${planDay.nextRideDayId}".`,
      dayId,
    )
  }
}

function validateDay(
  value: unknown,
  index: number,
  planDay: TripDay,
  context: ValidationContext,
): void {
  const path = `days[${index}]`
  const dayId = planDay.id

  if (!isRecord(value)) {
    addIssue(context, path, 'objet journée attendu.', dayId)
    return
  }

  if (value.id !== planDay.id) {
    addIssue(context, `${path}.id`, `identifiant attendu : ${planDay.id}.`, dayId)
  }

  if (value.dayNumber !== planDay.dayNumber) {
    addIssue(
      context,
      `${path}.dayNumber`,
      `numéro attendu : ${planDay.dayNumber}.`,
      dayId,
    )
  }

  if (value.type !== planDay.type) {
    addIssue(
      context,
      `${path}.type`,
      `type attendu selon le TripPlan : ${planDay.type}.`,
      dayId,
    )
  }

  if (planDay.type === 'ride') {
    validateRideDay(value, path, planDay, context)
  } else {
    validateOffDay(value, path, planDay, context)
  }
}

function createContext(): ValidationContext {
  return {
    issues: [],
    ids: new Set<string>(),
    overrideTargetIds: new Set<string>(),
  }
}

export function validateRoadbookDocument(
  value: unknown,
  plan: TripPlan = rga2026TripPlan,
): RoadbookDocument {
  const context = createContext()

  if (!isRecord(value)) {
    throw new RoadbookValidationError('Document roadbook', [
      { path: '$', message: 'objet racine attendu.' },
    ])
  }

  validateAllowedKeys(value, documentKeys, '$', context)

  if (value.version !== 1) {
    addIssue(context, '$.version', 'version attendue : 1.')
  }

  if (value.tripId !== plan.id) {
    addIssue(context, '$.tripId', `identifiant de voyage attendu : ${plan.id}.`)
  }

  if (value.sourceFile !== expectedRoadbookSource) {
    addIssue(
      context,
      '$.sourceFile',
      `source attendue : ${expectedRoadbookSource}.`,
    )
  }

  if (validateArray(value.days, '$.days', context)) {
    const days = value.days

    if (days.length !== plan.days.length) {
      addIssue(
        context,
        '$.days',
        `exactement ${plan.days.length} journées attendues.`,
      )
    }

    plan.days.forEach((planDay, index) => {
      validateDay(days[index], index, planDay, context)
    })

    const rideCount = days.filter(
      (day) => isRecord(day) && day.type === 'ride',
    ).length
    const offCount = days.filter(
      (day) => isRecord(day) && day.type === 'off',
    ).length

    if (rideCount !== plan.rideDays || offCount !== plan.offDays) {
      addIssue(
        context,
        '$.days',
        `répartition attendue : ${plan.rideDays} journées roulées et ${plan.offDays} OFF.`,
      )
    }
  }

  if (context.issues.length > 0) {
    throw new RoadbookValidationError('Document roadbook', context.issues)
  }

  return value as unknown as RoadbookDocument
}

export function getRoadbookOverrideTargetIds(
  document: RoadbookDocument,
): ReadonlySet<string> {
  const ids = new Set<string>()

  for (const day of document.days) {
    if (day.type === 'off') {
      continue
    }

    for (const item of [
      ...day.cols,
      ...day.resupplyPassages,
      ...day.explicitPauses,
      ...day.options,
    ]) {
      ids.add(item.id)
    }
  }

  return ids
}

function inferDayIdFromPointId(pointId: unknown): TripDayId | undefined {
  if (typeof pointId !== 'string') {
    return undefined
  }

  const match = /^j(?<day>\d{2})-/.exec(pointId)
  const dayNumber = match?.groups?.day === undefined
    ? Number.NaN
    : Number(match.groups.day)
  const candidate = `J${dayNumber}` as TripDayId

  return rga2026TripPlan.days.some(({ id }) => id === candidate)
    ? candidate
    : undefined
}

function validateOverride(
  value: unknown,
  index: number,
  targetIds: ReadonlySet<string>,
  seenPointIds: Set<string>,
  context: ValidationContext,
): void {
  const path = `overrides[${index}]`

  if (!isRecord(value)) {
    addIssue(context, path, 'objet override attendu.')
    return
  }

  const dayId = inferDayIdFromPointId(value.pointId)
  validateAllowedKeys(value, overrideKeys, path, context, dayId)

  if (validateNonEmptyString(value.pointId, `${path}.pointId`, context, dayId)) {
    if (!targetIds.has(value.pointId)) {
      addIssue(
        context,
        `${path}.pointId`,
        'la cible ne correspond à aucun point métier roulé ni endpoint synthétique.',
        dayId,
      )
    }

    if (seenPointIds.has(value.pointId)) {
      addIssue(
        context,
        `${path}.pointId`,
        `override dupliqué pour ${value.pointId}.`,
        dayId,
      )
    } else {
      seenPointIds.add(value.pointId)
    }
  }

  if (value.dayId !== dayId) {
    addIssue(
      context,
      `${path}.dayId`,
      `journée attendue pour cette cible : ${dayId ?? 'inconnue'}.`,
      dayId,
    )
  }

  if (!isRecord(value.sourceAnchor)) {
    addIssue(context, `${path}.sourceAnchor`, 'ancre source requise.', dayId)
  } else {
    validateAllowedKeys(
      value.sourceAnchor,
      sourceAnchorKeys,
      `${path}.sourceAnchor`,
      context,
      dayId,
    )
    validateFiniteNumber(
      value.sourceAnchor.latitude,
      `${path}.sourceAnchor.latitude`,
      { minimum: -90, maximum: 90 },
      context,
      dayId,
    )
    validateFiniteNumber(
      value.sourceAnchor.longitude,
      `${path}.sourceAnchor.longitude`,
      { minimum: -180, maximum: 180 },
      context,
      dayId,
    )
  }

  if (!isRecord(value.gpxProjection)) {
    addIssue(context, `${path}.gpxProjection`, 'projection GPX complète requise.', dayId)
  } else {
    const projectionPath = `${path}.gpxProjection`
    validateAllowedKeys(
      value.gpxProjection,
      gpxProjectionKeys,
      projectionPath,
      context,
      dayId,
    )
    validateFiniteNumber(value.gpxProjection.latitude, `${projectionPath}.latitude`, { minimum: -90, maximum: 90 }, context, dayId)
    validateFiniteNumber(value.gpxProjection.longitude, `${projectionPath}.longitude`, { minimum: -180, maximum: 180 }, context, dayId)
    validateFiniteNumber(value.gpxProjection.trackDistanceKm, `${projectionPath}.trackDistanceKm`, { minimum: 0, maximum: 1000 }, context, dayId)
    validateFiniteNumber(value.gpxProjection.segmentIndex, `${projectionPath}.segmentIndex`, { minimum: 0, maximum: 10_000, integer: true }, context, dayId)
    validateFiniteNumber(value.gpxProjection.pointIndex, `${projectionPath}.pointIndex`, { minimum: 0, maximum: 10_000_000, integer: true }, context, dayId)
    validateFiniteNumber(value.gpxProjection.nextPointIndex, `${projectionPath}.nextPointIndex`, { minimum: 0, maximum: 10_000_000, integer: true }, context, dayId)
    validateFiniteNumber(value.gpxProjection.segmentFraction, `${projectionPath}.segmentFraction`, { minimum: 0, maximum: 1 }, context, dayId)
    validateFiniteNumber(value.gpxProjection.elevationM, `${projectionPath}.elevationM`, { minimum: -500, maximum: 9000 }, context, dayId)
  }

  validateFiniteNumber(
    value.anchorDistanceM,
    `${path}.anchorDistanceM`,
    { minimum: 0, maximum: 1_000_000 },
    context,
    dayId,
  )

  if (
    typeof value.approvedStatus !== 'string' ||
    !roadbookPointStatuses.has(value.approvedStatus)
  ) {
    addIssue(
      context,
      `${path}.approvedStatus`,
      'statut attendu : matched, needs-review ou unmatched.',
      dayId,
    )
  }

  if (
    typeof value.matchMethod !== 'string' ||
    !manualMatchMethods.has(value.matchMethod as RoadbookMatchMethod)
  ) {
    addIssue(
      context,
      `${path}.matchMethod`,
      'méthode manuelle documentée attendue.',
      dayId,
    )
  }

  validateNonEmptyString(value.comment, `${path}.comment`, context, dayId)
  validateNonEmptyString(
    value.validationSource,
    `${path}.validationSource`,
    context,
    dayId,
  )

  if (value.displayName !== undefined) {
    validateNonEmptyString(value.displayName, `${path}.displayName`, context, dayId)
  }

  if (
    value.pointType !== undefined &&
    (typeof value.pointType !== 'string' ||
      !roadbookPointTypes.has(value.pointType as RoadbookPointType))
  ) {
    addIssue(
      context,
      `${path}.pointType`,
      'type de point roadbook inconnu.',
      dayId,
    )
  }

  if (
    value.pointSubtype !== undefined &&
    (typeof value.pointSubtype !== 'string' ||
      !roadbookPointSubtypes.has(value.pointSubtype as RoadbookPointSubtype))
  ) {
    addIssue(
      context,
      `${path}.pointSubtype`,
      'sous-type de point roadbook inconnu.',
      dayId,
    )
  }
}

export function validateRoadbookOverridesDocument(
  value: unknown,
  roadbook: RoadbookDocument,
): RoadbookOverridesDocument {
  const context = createContext()

  if (!isRecord(value)) {
    throw new RoadbookValidationError('Document overrides roadbook', [
      { path: '$', message: 'objet racine attendu.' },
    ])
  }

  validateAllowedKeys(value, overridesDocumentKeys, '$', context)

  if (value.version !== 1) {
    addIssue(context, '$.version', 'version attendue : 1.')
  }

  if (value.tripId !== roadbook.tripId) {
    addIssue(
      context,
      '$.tripId',
      `identifiant de voyage attendu : ${roadbook.tripId}.`,
    )
  }

  if (validateArray(value.overrides, '$.overrides', context)) {
    const targetIds = getRoadbookOverrideTargetIds(roadbook)
    const seenPointIds = new Set<string>()

    value.overrides.forEach((override, index) => {
      validateOverride(
        override,
        index,
        targetIds,
        seenPointIds,
        context,
      )
    })
  }

  if (context.issues.length > 0) {
    throw new RoadbookValidationError(
      'Document overrides roadbook',
      context.issues,
    )
  }

  return value as unknown as RoadbookOverridesDocument
}

export function isRoadbookPointStatus(
  value: unknown,
): value is RoadbookPointStatus {
  return typeof value === 'string' && roadbookPointStatuses.has(value)
}
