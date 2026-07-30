import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { colImages, findColImage } from '../../src/trip/col-images.ts'

const EXPECTED_ENTRIES = [
  ['Col du Feu', 'https://www.alpes4ever.com/wp-content/uploads/2020/12/Col-du-Feu-3.jpg', 'Alpes4ever'],
  ['Col de Joux Plane', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/inline-images/image-20220617141051-2.jpeg', 'Route des Grandes Alpes'],
  ['Col de Chatillon', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DE-CHATILLON_versant-nord.jpg', 'Route des Grandes Alpes'],
  ['Col de la Colombière', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DE-LA-COLOMBIERE_versant-nord-est_0.jpg', 'Route des Grandes Alpes'],
  ['Col des Aravis', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DES-ARAVIS_versant-nord.jpg', 'Route des Grandes Alpes'],
  ['Col des Saisies', 'https://www.alpes4ever.com/wp-content/uploads/2012/12/Col-des-Saisies9.jpg', 'Alpes4ever'],
  ['Cormet de Roselend', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-CORMET-DE-ROSELEND_versant-ouest.jpg', 'Route des Grandes Alpes'],
  ['Col de l’Iseran', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DE-L-ISERAN_versant-nord.jpg', 'Route des Grandes Alpes'],
  ['Col du Télégraphe', 'https://www.alpes4ever.com/wp-content/uploads/2014/12/col-du-telegraphe-1.jpg', 'Alpes4ever'],
  ['Col du Galibier', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DU-GALIBIER_versant-nord.jpg', 'Route des Grandes Alpes'],
  ['Col d’Izoard', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-D-IZOARD_versant-nord.jpg', 'Route des Grandes Alpes'],
  ['Le Sauze-du-Lac', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/VARIANTE-LE_SAUZE-DU-LAC_versant-nord.jpg', 'Route des Grandes Alpes'],
  ['Col de la Bonette', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/VARIANTE-CIME-DE-LA-BONETTE_versant-nord.jpg', 'Route des Grandes Alpes'],
  ['Col Saint-Martin', 'https://www.alpes4ever.com/wp-content/uploads/2021/04/Col-de-Saint-Martin-1.jpg', 'Alpes4ever'],
  ['Col de Turini', 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DE-TURINI_versant-ouest.jpg', 'Route des Grandes Alpes'],
  ['Col de Castillon', 'https://www.alpes4ever.com/wp-content/uploads/2020/10/Col-de-Castillon-1.jpg', 'Alpes4ever'],
  ['Col d’Èze', 'https://www.alpes4ever.com/wp-content/uploads/2019/04/Col-d-Eze-1.jpg', 'Alpes4ever'],
]

test('exactly seventeen cols/passages are documented, each with its explicit, hand-provided image URL and source label', () => {
  assert.equal(colImages.cols.length, EXPECTED_ENTRIES.length)
  for (const [name, imageUrl, sourceLabel] of EXPECTED_ENTRIES) {
    const entry = findColImage(name)
    assert.ok(entry, `${name} must be documented`)
    assert.equal(entry.name, name)
    assert.equal(entry.imageUrl, imageUrl)
    assert.equal(entry.sourceLabel, sourceLabel)
  }
})

test('sourceLabel is derived from the real host: alpes4ever.com → Alpes4ever, routedesgrandesalpes.com → Route des Grandes Alpes', () => {
  for (const entry of colImages.cols) {
    if (entry.imageUrl.includes('alpes4ever.com')) assert.equal(entry.sourceLabel, 'Alpes4ever')
    if (entry.imageUrl.includes('routedesgrandesalpes.com')) assert.equal(entry.sourceLabel, 'Route des Grandes Alpes')
  }
})

test('every entry carries a real https URL, never an invented or dynamically built search link', () => {
  for (const entry of colImages.cols) {
    assert.match(entry.imageUrl, /^https:\/\//)
    assert.doesNotMatch(entry.imageUrl, /google\.|search\?/i)
  }
})

test('the Cormet de Roselend duplicate URLs collapse into a single entry, never two', () => {
  const matches = colImages.cols.filter((entry) => entry.name === 'Cormet de Roselend')
  assert.equal(matches.length, 1)
})

test('Le Sauze-du-Lac is documented with its variant image and its shortened alias', () => {
  const entry = findColImage('Le Sauze-du-Lac')
  assert.ok(entry)
  assert.match(entry.imageUrl, /SAUZE-DU-LAC/)
  assert.deepEqual(findColImage('le Sauze-du-Lac'), entry)
  assert.deepEqual(findColImage('Sauze-du-Lac'), entry)
})

test('Col de l’Iseran now has its own explicit image, matched with either apostrophe style', () => {
  const entry = findColImage('Col de l’Iseran')
  assert.ok(entry)
  assert.equal(entry.id, 'col-de-l-iseran')
  assert.match(entry.imageUrl, /COL-DE-L-ISERAN/)
  assert.deepEqual(findColImage('Col de l\'Iseran'), entry)
})

test('documented name variants resolve to the same shared entry as their canonical name', () => {
  const bonette = findColImage('Col de la Bonette')
  assert.ok(bonette)
  assert.deepEqual(findColImage('Cime de la Bonette'), bonette)
  assert.deepEqual(findColImage('Col de la Bonette / Cime de la Bonette'), bonette)
  assert.deepEqual(findColImage('cime-de-la-bonette'), bonette)

  const saintMartin = findColImage('Col Saint-Martin')
  assert.ok(saintMartin)
  assert.deepEqual(findColImage('Col de Saint-Martin'), saintMartin)
  assert.deepEqual(findColImage('Col de la Colmiane'), saintMartin)

  const izoard = findColImage('Col d’Izoard')
  assert.ok(izoard)
  assert.deepEqual(findColImage('Col d\'Izoard'), izoard)

  const eze = findColImage('Col d’Èze')
  assert.ok(eze)
  assert.deepEqual(findColImage('Col d\'Èze'), eze)
  assert.deepEqual(findColImage('Col d’Eze'), eze)
  assert.deepEqual(findColImage('Col d\'Eze'), eze)
})

test('findColImage matches case, accent and apostrophe variants of a known col, and never fuzzy-matches an undocumented one', () => {
  const feu = findColImage('Col du Feu')
  assert.deepEqual(findColImage('col du feu'), feu)
  assert.deepEqual(findColImage('COL-DU-FEU'), feu)
  assert.deepEqual(findColImage('  Col   du   Feu  '), feu)
  assert.equal(findColImage('Col Feu'), null, 'a shorter, different name must not fuzzy-match')
  assert.equal(findColImage(''), null)
  assert.equal(findColImage('Un col totalement inconnu'), null)
  assert.notEqual(findColImage('Col Saint-Martin').id, findColImage('Col de la Colombière')?.id, 'distinct places must never share an entry')
})

test('every col documented in the real roadbook now resolves to an image — no place left unmatched', () => {
  const roadbook = JSON.parse(readFileSync(new URL('../../public/data/trip/roadbook.json', import.meta.url), 'utf8'))
  const allCols = roadbook.days.flatMap((day) => day.cols ?? [])
  assert.ok(allCols.length >= 17, 'the trip documents at least seventeen named cols/passes across its ten ride days')
  const unresolved = allCols.filter((col) => findColImage(col.name) === null)
  assert.deepEqual(unresolved.map((col) => col.name), [])
})
