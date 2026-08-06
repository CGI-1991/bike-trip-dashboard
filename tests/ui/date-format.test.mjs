import assert from 'node:assert/strict'
import test from 'node:test'

import { formatCompactDate, formatSimpleDate } from '../../src/ui/date-format.ts'

// CDC Jalon B4.3 section 3/47 — the two normalized date formats, no
// dependency on the browser's regional `Intl` default, no timezone-related
// day shift (these are pure string operations on the ISO `YYYY-MM-DD`
// components, never re-parsed through a `Date` object).

test('formatCompactDate: dd.mm.yy', () => {
  assert.equal(formatCompactDate('2026-04-02'), '02.04.26')
  assert.equal(formatCompactDate('2026-08-20'), '20.08.26')
})

test('formatSimpleDate: dd Mois, French month names, first letter capitalized', () => {
  assert.equal(formatSimpleDate('2026-04-02'), '02 Avril')
  assert.equal(formatSimpleDate('2026-08-20'), '20 Août')
})

test('every month name renders correctly', () => {
  const expected = [
    '01-Janvier', '02-Février', '03-Mars', '04-Avril', '05-Mai', '06-Juin',
    '07-Juillet', '08-Août', '09-Septembre', '10-Octobre', '11-Novembre', '12-Décembre',
  ]
  for (const [index, label] of expected.entries()) {
    const month = String(index + 1).padStart(2, '0')
    assert.equal(formatSimpleDate(`2026-${month}-15`), `15 ${label.split('-')[1]}`)
  }
})

test('the day is always 2 digits', () => {
  assert.equal(formatSimpleDate('2026-04-02'), '02 Avril')
  assert.equal(formatCompactDate('2026-04-02'), '02.04.26')
})

test('an unparseable value is returned unchanged rather than throwing', () => {
  assert.equal(formatCompactDate('not-a-date'), 'not-a-date')
  assert.equal(formatSimpleDate('not-a-date'), 'not-a-date')
})

test('no timezone-related day shift — the ISO string\'s own day/month/year are used verbatim, never re-parsed as a Date', () => {
  // A naive `new Date('2026-08-20').toLocaleDateString()` can shift by a day
  // depending on the host timezone; these helpers never construct a `Date`.
  assert.equal(formatCompactDate('2026-01-01'), '01.01.26')
  assert.equal(formatSimpleDate('2026-12-31'), '31 Décembre')
})
