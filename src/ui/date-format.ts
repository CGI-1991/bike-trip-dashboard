/**
 * Single centralized date-rendering helper (CDC Jalon B4.3 section 3): every
 * screen that shows a user-facing date must go through one of these two
 * functions — never a bespoke `formatShortDate` copy, never the browser's
 * regional `Intl`/`toLocaleDateString` default (which drifts with the
 * device's locale). Storage stays ISO (`YYYY-MM-DD`) everywhere; only the
 * rendered text changes here.
 */

const FRENCH_MONTHS: readonly string[] = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

function parseIsoDate(iso: string): { readonly year: string; readonly month: string; readonly day: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return null
  const [, year, month, day] = match
  if (year === undefined || month === undefined || day === undefined) return null
  return { year, month, day }
}

/**
 * Full compact date — `dd.mm.yy` (e.g. `02.04.26`). Used wherever the year
 * is relevant: the Étape header, information screens.
 */
export function formatCompactDate(iso: string): string {
  const parsed = parseIsoDate(iso)
  if (parsed === null) return iso
  return `${parsed.day}.${parsed.month}.${parsed.year.slice(2)}`
}

/**
 * Simplified date — `dd Mois` (e.g. `02 Avril`). Used in compact lists:
 * Voyage day cards, OFF/transfer rows, and other dense listings where the
 * year is redundant (already implied by the trip's own dates).
 */
export function formatSimpleDate(iso: string): string {
  const parsed = parseIsoDate(iso)
  if (parsed === null) return iso
  const monthIndex = Number(parsed.month) - 1
  const monthName = FRENCH_MONTHS[monthIndex] ?? parsed.month
  return `${parsed.day} ${monthName}`
}
