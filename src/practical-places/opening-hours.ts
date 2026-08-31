/**
 * Prudent, deterministic `opening_hours` (OSM syntax) × ETA evaluator (CDC
 * C2 sections 21-25) — "Ne pas implémenter un faux parseur qui affirme
 * ouvert/fermé sur des expressions qu'il ne comprend pas": every branch this
 * module cannot confidently interpret returns `'unknown'`, never `'closed'`.
 * Supports exactly the deterministic cases CDC section 23 enumerates —
 * `24/7`, a day-range plus one or more simple `HH:MM-HH:MM` ranges,
 * comma-separated day lists, `;`-separated independent rules covering
 * disjoint days. Anything with `PH`/`SH`, sunrise/sunset, comments, week/
 * month selectors, or an overnight range is left `'unknown'` rather than
 * guessed at (section 24).
 */

export type OpeningStatus = 'open' | 'closed' | 'unknown'

export interface OpeningEvaluation {
  readonly status: OpeningStatus
  /** "HH:MM", the passage's own local clock time — always present, whatever the verdict, so the caller can always show it alongside the status. */
  readonly passageLocalTime: string
  readonly rawOpeningHours: string | null
  readonly reason?: string
}

const DAY_TOKENS: ReadonlyMap<string, number> = new Map([
  ['Mo', 1], ['Tu', 2], ['We', 3], ['Th', 4], ['Fr', 5], ['Sa', 6], ['Su', 0],
])
const DAY_ORDER: readonly string[] = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

interface TimeRange {
  readonly startMinutes: number
  readonly endMinutes: number
}

interface Rule {
  readonly weekdays: ReadonlySet<number>
  readonly ranges: readonly TimeRange[]
}

function parseTimeToken(token: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(token.trim())
  if (match === null) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** A single `HH:MM-HH:MM` range — deliberately rejects an overnight range (`end <= start`), left to `evaluateOpeningAtPassage`'s caller as an unsupported case (section 24) rather than guessed at. */
function parseTimeRange(token: string): TimeRange | null {
  const parts = token.trim().split('-')
  if (parts.length !== 2) return null
  const [startToken, endToken] = parts
  const startMinutes = startToken === undefined ? null : parseTimeToken(startToken)
  const endMinutes = endToken === undefined ? null : parseTimeToken(endToken)
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return null
  return { startMinutes, endMinutes }
}

/** `Mo`, `Mo-Fr`, or a comma-separated mix of both — never a week/month selector or `PH`/`SH`. */
function parseDaySelector(token: string): ReadonlySet<number> | null {
  const weekdays = new Set<number>()
  for (const part of token.split(',')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const rangeMatch = /^([A-Za-z]{2})-([A-Za-z]{2})$/.exec(trimmed)
    if (rangeMatch !== null) {
      const [, startCode, endCode] = rangeMatch
      const startIndex = startCode === undefined ? -1 : DAY_ORDER.indexOf(startCode)
      const endIndex = endCode === undefined ? -1 : DAY_ORDER.indexOf(endCode)
      if (startIndex < 0 || endIndex < 0) return null
      for (let index = startIndex; ; index = (index + 1) % 7) {
        const day = DAY_ORDER[index]
        if (day !== undefined) { const value = DAY_TOKENS.get(day); if (value !== undefined) weekdays.add(value) }
        if (index === endIndex) break
      }
      continue
    }
    const single = DAY_TOKENS.get(trimmed)
    if (single === undefined) return null
    weekdays.add(single)
  }
  return weekdays.size === 0 ? null : weekdays
}

/** One `;`-separated segment: an optional day selector (defaults to every day) followed by one or more comma-separated `HH:MM-HH:MM` ranges. `null` for anything this parser cannot confidently interpret — the caller then falls back to `'unknown'` for the whole expression rather than risk a wrong verdict from a partially-understood rule (CDC section 24's own worked example, "Mo-Fr 08:00-18:00; PH off"). */
function parseSegment(segment: string): Rule | null {
  const trimmed = segment.trim()
  if (trimmed === '') return null
  const tokens = trimmed.split(/\s+/u)
  const firstToken = tokens[0]
  const hasDaySelector = firstToken !== undefined && /^[A-Za-z]{2}(-[A-Za-z]{2})?(,[A-Za-z]{2}(-[A-Za-z]{2})?)*$/.test(firstToken)
  const daySelector = hasDaySelector ? parseDaySelector(firstToken as string) : new Set(DAY_TOKENS.values())
  if (daySelector === null) return null
  const timeTokensRaw = (hasDaySelector ? tokens.slice(1) : tokens).join(' ')
  if (timeTokensRaw.trim() === '') return null
  const ranges = timeTokensRaw.split(',').map((token) => parseTimeRange(token))
  if (ranges.some((range) => range === null)) return null
  return { weekdays: daySelector, ranges: ranges as TimeRange[] }
}

/** `null` return means "cannot be confidently interpreted" — the caller must fall back to `'unknown'`, never guess. */
function parseOpeningHours(value: string): readonly Rule[] | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (/^24\/7$/iu.test(trimmed)) return [{ weekdays: new Set(DAY_TOKENS.values()), ranges: [{ startMinutes: 0, endMinutes: 24 * 60 }] }]
  const rules: Rule[] = []
  for (const segment of trimmed.split(';')) {
    const rule = parseSegment(segment)
    if (rule === null) return null
    rules.push(rule)
  }
  return rules
}

/**
 * Pure evaluation at one passage instant — `weekday` is 0 (Sunday) to 6
 * (Saturday), already resolved by the caller in the trip's own calendar
 * (CDC section 23: "utiliser bundle.calendar.timezone... pas de comparaison
 * UTC naïve" — this function itself does no timezone math at all, it only
 * ever consumes an already-local weekday/clock-time pair).
 */
export function evaluateOpeningAtPassage(openingHours: string | null, weekday: number, clockMinutes: number): OpeningEvaluation {
  const passageLocalTime = `${String(Math.floor(clockMinutes / 60) % 24).padStart(2, '0')}:${String(clockMinutes % 60).padStart(2, '0')}`
  if (openingHours === null || openingHours.trim() === '') {
    return { status: 'unknown', passageLocalTime, rawOpeningHours: openingHours, reason: 'Horaires non renseignés.' }
  }
  const rules = parseOpeningHours(openingHours)
  if (rules === null) {
    return { status: 'unknown', passageLocalTime, rawOpeningHours: openingHours, reason: 'Horaires trop complexes pour être interprétés automatiquement.' }
  }
  const applicableToday = rules.filter((rule) => rule.weekdays.has(weekday))
  if (applicableToday.length === 0) {
    return { status: 'closed', passageLocalTime, rawOpeningHours: openingHours }
  }
  const withinAnyRange = applicableToday.some((rule) => rule.ranges.some((range) => clockMinutes >= range.startMinutes && clockMinutes < range.endMinutes))
  return { status: withinAnyRange ? 'open' : 'closed', passageLocalTime, rawOpeningHours: openingHours }
}
