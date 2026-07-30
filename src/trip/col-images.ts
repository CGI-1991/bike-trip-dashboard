export interface ColImageEntry {
  readonly id: string
  readonly name: string
  /** Explicitly documented alternate names (e.g. a variant's own roadbook label) that resolve to this same entry. */
  readonly aliases?: readonly string[]
  readonly imageUrl: string
  readonly sourceLabel: string
}

export interface ColImagesDocument {
  readonly version: 1
  readonly cols: readonly ColImageEntry[]
}

/**
 * Explicit, hand-curated table — never a Google-style search built at
 * runtime. Absence of an entry means no link is shown, ever; it must not be
 * approximated from a partial name match. See the phase report for the full
 * list of documented cols still missing a source image.
 */
export const colImages: ColImagesDocument = {
  version: 1,
  cols: [
    {
      id: 'col-du-feu',
      name: 'Col du Feu',
      imageUrl: 'https://www.alpes4ever.com/wp-content/uploads/2020/12/Col-du-Feu-3.jpg',
      sourceLabel: 'Alpes4ever',
    },
    {
      id: 'col-de-joux-plane',
      name: 'Col de Joux Plane',
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/inline-images/image-20220617141051-2.jpeg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'col-de-chatillon',
      name: 'Col de Chatillon',
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DE-CHATILLON_versant-nord.jpg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'col-de-la-colombiere',
      name: 'Col de la Colombière',
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DE-LA-COLOMBIERE_versant-nord-est_0.jpg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'col-des-aravis',
      name: 'Col des Aravis',
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DES-ARAVIS_versant-nord.jpg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'col-des-saisies',
      name: 'Col des Saisies',
      imageUrl: 'https://www.alpes4ever.com/wp-content/uploads/2012/12/Col-des-Saisies9.jpg',
      sourceLabel: 'Alpes4ever',
    },
    {
      id: 'cormet-de-roselend',
      name: 'Cormet de Roselend',
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-CORMET-DE-ROSELEND_versant-ouest.jpg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'col-du-telegraphe',
      name: 'Col du Télégraphe',
      imageUrl: 'https://www.alpes4ever.com/wp-content/uploads/2014/12/col-du-telegraphe-1.jpg',
      sourceLabel: 'Alpes4ever',
    },
    {
      id: 'col-du-galibier',
      name: 'Col du Galibier',
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DU-GALIBIER_versant-nord.jpg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'col-d-izoard',
      name: 'Col d’Izoard',
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-D-IZOARD_versant-nord.jpg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'col-de-l-iseran',
      name: 'Col de l’Iseran',
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DE-L-ISERAN_versant-nord.jpg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'le-sauze-du-lac',
      name: 'Le Sauze-du-Lac',
      aliases: ['Sauze-du-Lac'],
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/VARIANTE-LE_SAUZE-DU-LAC_versant-nord.jpg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'col-de-la-bonette',
      name: 'Col de la Bonette',
      aliases: ['Cime de la Bonette', 'Col de la Bonette / Cime de la Bonette'],
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/VARIANTE-CIME-DE-LA-BONETTE_versant-nord.jpg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'col-saint-martin',
      name: 'Col Saint-Martin',
      aliases: ['Col de Saint-Martin', 'Col de la Colmiane'],
      imageUrl: 'https://www.alpes4ever.com/wp-content/uploads/2021/04/Col-de-Saint-Martin-1.jpg',
      sourceLabel: 'Alpes4ever',
    },
    {
      id: 'col-de-turini',
      name: 'Col de Turini',
      imageUrl: 'https://www.routedesgrandesalpes.com/sites/alpesavelo/files/medias/images/RGA-COL-DE-TURINI_versant-ouest.jpg',
      sourceLabel: 'Route des Grandes Alpes',
    },
    {
      id: 'col-de-castillon',
      name: 'Col de Castillon',
      imageUrl: 'https://www.alpes4ever.com/wp-content/uploads/2020/10/Col-de-Castillon-1.jpg',
      sourceLabel: 'Alpes4ever',
    },
    {
      id: 'col-d-eze',
      name: 'Col d’Èze',
      imageUrl: 'https://www.alpes4ever.com/wp-content/uploads/2019/04/Col-d-Eze-1.jpg',
      sourceLabel: 'Alpes4ever',
    },
  ],
}

const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g

export function normalizeColName(name: string): string {
  return name
    .normalize('NFD')
    .replace(COMBINING_DIACRITICAL_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const colImageByNormalizedName = new Map(
  colImages.cols.flatMap((entry) => [
    [normalizeColName(entry.name), entry] as const,
    ...(entry.aliases ?? []).map((alias) => [normalizeColName(alias), entry] as const),
  ]),
)

export function findColImage(name: string): ColImageEntry | null {
  return colImageByNormalizedName.get(normalizeColName(name)) ?? null
}
