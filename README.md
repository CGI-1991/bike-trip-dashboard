# Bike Trip Dashboard

Moteur générique de voyages à vélo, hérité techniquement du dépôt
`CGI-1991/rga-2026-dashboard`. Le voyage actuellement chargé reste la **Route des
Grandes Alpes 2026** (Thonon-les-Bains → Nice, 12 jours, 10 journées roulées et
2 journées OFF) : chronologie et ETA calculés depuis les traces GPX réelles,
croisement avec le roadbook éditorial, et météo Open-Meteo adaptée à l'échéance
de chaque journée.

- Dépôt : [`CGI-1991/bike-trip-dashboard`](https://github.com/CGI-1991/bike-trip-dashboard)
- URL GitHub Pages : <https://cgi-1991.github.io/bike-trip-dashboard/>
- [`CDC.md`](CDC.md) — cahier des charges du moteur générique multi-voyages (cible).
- [`CDC_RGA_2026_REFERENCE.md`](CDC_RGA_2026_REFERENCE.md) — référence
  historique et fonctionnelle de l'application RGA 2026 héritée, conservée comme
  cas de non-régression.

La migration vers le modèle générique `TripBundle` décrit dans `CDC.md` a
commencé par sa phase 2 : `TripBundle` v1 (schéma, types, validateurs,
migrations, sélecteurs) est défini dans `src/trip-core/`, mais n'est **pas**
encore branché sur l'application. L'application fonctionne aujourd'hui
exactement comme l'application RGA 2026 d'origine, avec une identité technique
(nom de paquet, base GitHub Pages, manifeste PWA, préfixe de cache, clés de
stockage) propre à ce nouveau dépôt, et continue de reposer sur ses modèles
hérités (`src/trip/*`, `src/route/*`, `src/gpx/*`, `src/weather/*`). Un
pipeline d'import GPX générique existe (`src/import/gpx/`, voir plus bas) mais
n'est pas branché sur l'interface ; le multi-voyages ne l'est pas non plus.

## TripBundle v1 (`src/trip-core/`)

`src/trip-core/` porte le cœur de domaine générique et versionné du futur
moteur multi-voyages, développé en parallèle du pipeline RGA existant :

- `model/` — types TypeScript de `TripBundle` v1 (identifiants, métadonnées,
  calendrier, journées, étapes, routes, montées, points, lieux pratiques,
  logements, météo, réglages, overrides, provenance et métadonnées de
  génération/enrichissement) ;
- `schema/version.ts` — version courante du schéma
  (`CURRENT_TRIP_BUNDLE_SCHEMA_VERSION = 1`) ;
- `validation/` — `validateTripBundle`/`assertTripBundle`, un validateur
  runtime sans dépendance qui accumule toutes les erreurs structurelles et
  référentielles plutôt que de s'arrêter à la première ;
- `migrations/` — `migrateTripBundle`, une infrastructure de migration
  minimale (v1 accepté tel quel, versions futures ou anciennes sans migration
  enregistrée explicitement refusées) ;
- `selectors/` — lecteurs purs (`selectOrderedDays`, `selectStageForDay`,
  `selectTripTotals`, etc.), indépendants de l'interface et du stockage.

Ce module n'est importé ni par `src/main.ts` ni par aucun renderer d'interface
à ce stade. Les tests dédiés (`tests/trip-core/`) utilisent une fixture
entièrement synthétique (`tests/trip-core/support/generic-trip-fixture.mjs`),
indépendante de la RGA.

## Adaptateur RGA 2026 → TripBundle (`src/trips/rga-2026/`, phase 3)

Un `TripBundle` v1 complet de la Route des Grandes Alpes 2026 est désormais
disponible via un adaptateur temporaire, **`loadRgaLegacyTrip()`**
(`src/trips/rga-2026/load-rga-legacy-trip.ts`) — mais **le runtime de
l'application ne l'utilise pas encore** : `src/main.ts` et l'interface
continuent de charger la RGA exclusivement via le pipeline historique
(`rga2026TripPlan`, `src/trip/*`, `src/route/*`, `src/gpx/*`, `src/weather/*`).
Aucun écran n'a changé.

- `public/trips/rga-2026/` — paquet canonique et autonome : copies
  byte-identiques des dix GPX, du roadbook, des overrides, des logements et
  des lieux pratiques, plus un `manifest.json` déterministe (avec des
  compteurs calculés : journées, overrides par statut, points migrés, lieux
  pratiques...) et des réglages par défaut. Généré par
  `scripts/generate-rga-trip-package.mjs` (à relancer manuellement si l'un de
  ces actifs historiques change) ; `npm run check:rga-trip-package` (inclus
  dans `prebuild`) vérifie sans jamais rien réécrire que le paquet ne dérive
  pas de ses sources.
- `src/trips/rga-2026/` — `createRgaLegacyTripBundle()` (constructeur pur et
  synchrone, sans DOM/`localStorage`/heure courante) et `loadRgaLegacyTrip()`
  (chargement asynchrone du paquet public, avec `fetch` et URL de base
  injectables — nécessairement asynchrone : les ~3,4 Mo de GPX et de lieux
  pratiques ne doivent pas être embarqués dans le bundle JavaScript pour
  préserver une API synchrone artificielle).
- Le bundle produit couvre les 12 journées, 10 étapes/routes/fichiers source,
  les statistiques éditoriales de chaque étape (distance, D+, D−, avec leur
  provenance propre `RideStage.metricsProvenance`), les logements, et
  l'intégralité des 1 705 lieux pratiques avec leur association aux journées
  (`PracticalPlace.dayIds`, sélectionnable via `selectPracticalPlacesForDay`).
  Les points documentés (cols, passages, détours) ne sont repris comme
  `RoutePoint` que lorsqu'une position géographique validée existe (46 des 53
  candidats du roadbook) ; les entrées non positionnées restent disponibles
  telles quelles dans la copie canonique des sources, jamais dotées d'une
  coordonnée inventée. Les montées, les géométries/profils de route et les
  autres mesures d'étape (min/max altitude, durées, ETA) restent volontairement
  `null` à ce stade (aucun nouveau parseur GPX, aucun calcul approximatif) —
  voir `tests/trips/rga-2026/` pour le détail du mapping et de ses limites
  documentées.
- Le paquet canonique est désormais découvert automatiquement (
  `scripts/offline-resources.mjs`'s `collectOfflineResources`) et inclus dans
  le précache générique du service worker, aux côtés de la liste historique —
  aucun futur paquet `public/trips/<autre-voyage>/` ne nécessitera de
  modification du service worker.
- IndexedDB, le gestionnaire de voyages et l'import GPX ne sont toujours pas
  implémentés. La comparaison exhaustive avec le pipeline historique (golden
  master) reste à faire.

La phase 4 du CDC a ensuite comparé ce `TripBundle` au pipeline historique dans
un golden master complet (`tests/golden/rga-2026/`, `npm run check:rga-golden`) :
564 tests verts, aucune divergence non classée.

## Fondation IndexedDB (`src/storage/indexeddb/`, phase 5)

La phase 5 du CDC ajoute la base IndexedDB versionnée du futur moteur
multi-voyages — **toujours pas branchée sur l'application** : `src/main.ts` et
l'interface continuent de charger la RGA exclusivement via le pipeline
historique, exactement comme en phase 3/4. Aucun écran n'a changé, aucun
gestionnaire de voyages ni assistant d'import GPX n'est visible.

- Base `bike-trip-dashboard`, version 1 (`openBikeTripDatabase()`, `IDBFactory`
  injectable — jamais un accès implicite à `window.indexedDB`) : dix-sept object
  stores (racine `trips` non-collectionnelle ; `tripSettings` ; onze
  collections normalisées isolées par voyage via une clé composée
  `[tripId, id]` et un index `byTripId` ; `sourceFilePayloads` pour le contenu
  binaire des GPX ; `importJobs` ; `providerCache` ; `schemaMigrations`).
- **`TripRepository`** (`trip-repository.ts`) : `saveTripBundle` valide le
  bundle (`validateTripBundle`) avant toute transaction, remplace
  atomiquement toutes les collections d'un voyage en une seule transaction
  `readwrite`, et abandonne sans écriture partielle en cas d'erreur.
  `loadTripBundle` reconstruit un `TripBundle` dans l'ordre exact du bundle
  d'origine, le revalide, et refuse (au lieu de réparer) un stockage
  incohérent.
- Le contenu binaire d'un `SourceFile` (Blob/ArrayBuffer) est stocké séparément
  du modèle métier (`source-file-repository.ts`), jamais encodé en JSON ni posé
  en `localStorage` ; `saveTripImportAtomically` (`atomic-import.ts`) écrit
  bundle + payloads + `importJob` dans une seule transaction, pour qu'un
  `importJob` ne passe jamais `ready` sans que son voyage ait réellement été
  commité.
- `activeTripId` reste la seule donnée de voyage tolérée en `localStorage`
  (`bike-trip-dashboard.active-trip-id.v1`, voir `active-trip.ts`) — pas encore
  connecté au démarrage ni à l'interface.
- Testé avec [`fake-indexeddb`](https://github.com/dumbmatter/fake-indexeddb)
  (devDependency, jamais importé depuis `src/`) : Node n'expose nativement
  aucune implémentation IndexedDB. Le round-trip du vrai `TripBundle` RGA
  (12 journées, 10 étapes/routes/fichiers source, 46 `RoutePoint`, 1 705 lieux
  pratiques, 10 logements) est testé de bout en bout dans
  `tests/storage/indexeddb/rga-storage-roundtrip.test.mjs`.

## Pipeline d'import GPX générique (`src/import/gpx/`, phase 6)

La phase 6 du CDC ajoute un pipeline d'import générique qui transforme un ou
plusieurs fichiers GPX utilisateur en `TripBundle` v1 valide, sauvegardé
atomiquement dans la fondation IndexedDB (phase 5) — **toujours pas branché
sur l'interface** : aucun sélecteur de fichiers, aucun glisser-déposer, aucun
gestionnaire de voyages visible, `src/main.ts` inchangé.

- **Un GPX = une étape, plusieurs GPX = plusieurs étapes**, dans l'ordre exact
  du tableau fourni ; aucune fusion ni subdivision automatique.
- Parsing GPX générique (1.0/1.1, namespaces variables, `trk`/`trkseg`,
  `rte`/`rtept` en repli si aucun `trk`, `wpt`) : traversée DOM propre à ce
  module (`gpx-xml.ts`), mais qui réutilise directement les algorithmes
  historiques de distance et de D+/D− (`calculateHaversineDistanceKm`,
  `calculateSegmentMetrics` de `src/gpx/parser.ts`) plutôt que de les
  réimplémenter — voir `tests/import/gpx/rga-compatibility.test.mjs`, qui
  vérifie que les dix GPX canoniques de la RGA produisent exactement les
  mêmes distances/D+/D−/altitudes/comptages que le pipeline historique.
- Calcul local uniquement : géométrie, distance, D+/D−, altitude min/max et
  profil altimétrique rééchantillonné (50 m) sont dérivés du GPX lui-même,
  jamais d'un service externe.
- Voyage daté ou non daté (`GpxTripImportOptions.startDate` facultatif) : sans
  date, `calendar`/`TripDay.date` restent `null` (aucune date inventée, aucune
  météo) ; avec une date, une journée civile consécutive par étape, sans
  dépendance au fuseau ou à l'horloge de la machine.
- Sauvegarde atomique unique via `saveTripImportAtomically` (phase 5) :
  `TripBundle`, payloads binaires des GPX et `ImportJob` final commités
  ensemble, avec des transitions déterministes
  (`pending → parsing → validating → writing → ready`, ou `→ failed`).
- Chaque id et chaque horodatage est fourni par l'appelant
  (`idFactory`/`now`) — aucun `Date.now()`, `new Date()` ou `Math.random()`
  implicite dans le pipeline.
- API publique unique : `importGpxTrip({ files, options, database, idFactory,
  now })` (`import-gpx-trip.ts`), retournant soit `{ ok: true, bundle,
  importJob, issues }`, soit `{ ok: false, importJob, issues, error }` avec
  des codes d'erreur structurés (`invalid-file`, `duplicate-file`,
  `invalid-xml`, `no-route-points`, `invalid-coordinate`,
  `unsupported-content`, `storage-error`, `validation-error`).

Le pipeline GPX produit maintenant localement (`src/analysis/`, phase 6B) :

- profils (pente lissée, dérivée de l'altitude GPX) ;
- montées (détection générique, seuils CDC section 13) ;
- durées (roulée, pauses, totale) ;
- ETA relatives (départ + timeline par étape, jamais de continuité entre deux étapes).

Aucun nouvel écran n'est encore exposé.

## Stack

- [Vite](https://vite.dev/) + TypeScript strict, sans framework UI (rendu en
  chaînes de caractères injectées dans le DOM).
- Aucun backend : l'application est statique, tout le calcul (GPX, itinéraire,
  appariement roadbook, météo) tourne dans le navigateur.
- Aucune clé API : le fournisseur météo [Open-Meteo](https://open-meteo.com/)
  est appelé anonymement en HTTPS.
- Tests unitaires avec le test runner natif de Node (`node:test`). Une seule
  dépendance de test, [`fake-indexeddb`](https://github.com/dumbmatter/fake-indexeddb)
  (devDependency), pour les tests de `src/storage/indexeddb/` — Node n'expose
  aucune implémentation IndexedDB native ; jamais importée depuis `src/`.

## Prérequis

- Node.js 24 (voir `.github/workflows/deploy-pages.yml` pour la version utilisée
  en CI).
- Aucune installation globale requise : toutes les dépendances sont locales au
  projet (`devDependencies`).

## Installation

```bash
npm install
```

Si l'environnement impose une inspection TLS (proxy d'entreprise), exporter
`NODE_USE_SYSTEM_CA=1` avant les commandes `npm`/`node` pour que Node utilise le
magasin de certificats du système plutôt que son propre bundle. Cette variable
est déjà configurée dans `.vscode/settings.json` pour le terminal intégré.

## Démarrage local

```bash
npm run dev
```

Le serveur Vite démarre avec `server.watch.usePolling = true` (voir
`vite.config.ts`) : le rechargement à chaud repose sur un scrutin périodique du
système de fichiers plutôt que sur les événements natifs, utile sur les lecteurs
réseau ou certains environnements virtualisés où les notifications de
changement de fichier ne remontent pas de façon fiable.

## Build

```bash
npm run build
```

Exécute la vérification TypeScript (`tsc`, aucune émission) puis le build de
production Vite dans `dist/`. Le déploiement GitHub Pages
(`.github/workflows/deploy-pages.yml`) lance cette même commande à chaque push
sur `main` et publie `dist/`.

## Tests

```bash
npm test
```

Équivalent à `node --test "tests/**/*.test.mjs"`. Les fichiers de test importent
directement les modules `.ts` sous `src/` (support TypeScript natif de Node) ;
aucun framework de test ni compilateur intermédiaire n'est nécessaire.

- `tests/weather/weather-core.test.mjs` — normalisation Open-Meteo, cache,
  coordinateur de requêtes météo, rendu des panneaux météo.
- `tests/weather/weather-display-policy.test.mjs` — sélection du mode
  d'affichage météo (seuils, couverture réelle, progression théorique du jour
  en cours) et rendu associé par mode.
- `tests/trip/roadbook-resolution.test.mjs` — classification éditoriale des
  points roadbook résiduels (actif / informatif / exclu / décision requise).

## Structure des dossiers

```text
src/
  gpx/          Lecture et analyse des traces GPX (profil, points nommés)
  route/        Moteur d'itinéraire (vitesse, pauses, ETA, waypoints)
  trip/         Plan de voyage, calendrier, roadbook (types, chargement,
                validation, appariement GPX, résolutions éditoriales)
  weather/      Fournisseur Open-Meteo, cache local, coordinateur de requêtes,
                politique d'affichage par échéance (src/weather/display-policy.ts)
  ui/           Rendu HTML par section du tableau de bord
  storage/      Réglages utilisateur persistés en localStorage
  trip-core/    TripBundle v1 générique (modèle, validation, migrations,
                sélecteurs) — voir « TripBundle v1 » ci-dessus ; pas encore
                branché sur l'application
  storage/indexeddb/  Fondation IndexedDB (base, migrations, repositories
                TripBundle/fichiers sources/imports, activeTripId,
                persistance navigateur) — voir « Fondation IndexedDB »
                ci-dessus ; pas encore branchée sur l'application
  import/gpx/   Pipeline d'import GPX générique (parsing, analyse, TripBundle,
                sauvegarde IndexedDB atomique) — voir « Pipeline d'import GPX
                générique » ci-dessus ; pas encore branché sur l'application
  main.ts       Point d'entrée : orchestration et écouteurs d'événements
public/data/
  gpx/          Les 10 traces GPX sources (non modifiées par l'application)
  trip/         roadbook.json (source éditoriale) et roadbook-overrides.json
                (curation manuelle des appariements et résolutions)
docs/sources/    Roadbook et cahier des charges au format Markdown
tests/           Tests `node:test`, un dossier par domaine
```

## GPX

Les 10 traces (`public/data/gpx/*.gpx`, une par journée roulée) sont la source
géométrique de vérité : distance, dénivelé, profil altimétrique et ETA en
dérivent. Elles ne sont ni modifiées ni régénérées par l'application.

## Roadbook

`public/data/trip/roadbook.json` est la version structurée du roadbook éditorial
(`docs/sources/roadbook-rga-2026.md`) : cols, passages/ravitaillements, pauses
explicites, options et logistique par journée. Ce fichier n'est pas modifié par
l'application ; il reste la source éditoriale de référence.

## Overrides

`public/data/trip/roadbook-overrides.json` porte la curation manuelle qui relie
chaque point du roadbook à une projection précise sur le GPX (statut `matched`,
`needs-review` ou `unmatched`, méthode de rattachement, justification). C'est le
seul fichier de données destiné à être édité au fil de l'audit du roadbook.

Au-dessus de ce statut géométrique, `src/trip/roadbook-resolutions.ts` porte une
classification éditoriale distincte (`matched` / `informational` / `excluded` /
`user-decision-required`) pour les points dont le statut brut ne reflète pas la
bonne décision produit — par exemple une option non parcourue (Cime de la
Bonette) ou une pause éditoriale combinant deux localités déjà appariées
individuellement. Seuls les points résolus `matched` sont transmis au
fournisseur météo.

## Corriger manuellement un point documenté

Si un point du roadbook affiche une position, une altitude ou une projection
incorrecte, la correction se fait sans toucher aux index du GPX à la main :

1. **Identifier le point** — son `pointId` déterministe (ex. `j01-col-col-du-feu`)
   apparaît dans `public/data/trip/roadbook-overrides.json`, dans le rapport
   `docs/point-data-audit-2026-07-28.json`/`.md`, et dans le panneau *Sources et
   données* de l'application.
2. **Renseigner ou corriger son ancre** — dans `roadbook-overrides.json`, éditer
   uniquement `sourceAnchor.latitude` / `sourceAnchor.longitude` (la position
   géographique réelle et validée du point). Ne jamais éditer `gpxProjection`,
   `matchDistanceM`, `segmentIndex`/`pointIndex` à la main : ces champs sont
   calculés, pas saisis.
3. **Exécuter le reconstructeur** :
   ```bash
   python scripts/rebuild-point-projections.py
   ```
   Le script reprojette `sourceAnchor` sur le GPX définitif du jour concerné,
   régénère `gpxProjection`, `anchorDistanceM` et le commentaire de justification
   pour les 53 overrides, puis régénère `docs/point-data-audit-2026-07-28.json`
   et `.md`.
4. **Contrôler le rapport** — relire `docs/point-data-audit-2026-07-28.md` pour
   vérifier que le point corrigé n'a pas d'anomalie inattendue (distance à la
   trace, altitude, rôle).
5. **Lancer les tests** :
   ```bash
   npm test
   ```
   `tests/trip/point-data-audit.test.mjs` et `tests/trip/roadbook-validation.test.mjs`
   vérifient que les 53 overrides restent valides et que le contrat de
   `matchMethod` (`manual-anchor-reprojected-current-gpx`) est respecté.

Si le point ne doit pas être un waypoint géographique actif (option non
parcourue, pause éditoriale combinant deux lieux, passage jugé trop éloigné de
la trace), la décision se prend dans `src/trip/roadbook-resolutions.ts` plutôt
que dans `roadbook-overrides.json` : voir la section *Overrides* ci-dessus.

Une entrée d'override individuellement invalide (ex. `matchMethod` inconnu) ne
bloque plus le chargement de l'ensemble du roadbook : elle est ignorée
localement, journalisée dans `RoadbookOverridesDocument.skippedOverrides`, et
remontée comme anomalie locale dans le panneau *Sources et données* — le point
concerné retombe sur ses autres méthodes d'appariement (point nommé du GPX,
candidat de profil) plutôt que de disparaître.

## Calendrier confirmé

`src/trip/calendar.ts` centralise la seule date pivot du voyage :

```ts
const TRIP_CALENDAR = {
  startDate: '2026-08-12', // J1 : Thonon-les-Bains → Morzine
  timezone: 'Europe/Paris',
  status: 'confirmed',
}
```

Toutes les dates de journée (J1 à J12) sont dérivées de `startDate`, jamais
dupliquées ailleurs dans le code.

## Réglages localStorage

Chacune des dix journées roulées (J1–J4, J6–J7, J9–J12 ; jamais les journées
OFF J5/J8) a ses propres réglages — vitesse moyenne, heure de départ, durée
totale des pauses — enregistrés dans `localStorage` sous la clé
`bike-trip-dashboard.ride-day-settings.v2` (voir
`src/storage/ride-day-settings.ts`). Modifier une étape ne recalcule que son
ETA et sa météo ; les neuf autres restent inchangées, sauf action explicite
« Appliquer ces valeurs à toutes les étapes ».

L'ancien réglage global unique (`bike-trip-dashboard.settings.v1`, voir
`src/storage/settings.ts`) reste lu une seule fois, au premier chargement
suivant cette mise à jour, comme valeur initiale commune aux dix étapes — il
n'est plus jamais écrit ni utilisé ensuite. Ces préférences ne quittent jamais
le navigateur. Ce namespace de stockage (`bike-trip-dashboard.*`) est propre à
ce dépôt et ne partage aucune clé avec l'application `rga-2026-dashboard`
d'origine, bien que les deux soient publiées sur le même origin GitHub Pages
(`cgi-1991.github.io`).

## Cache météo

Les réponses Open-Meteo sont mises en cache dans `localStorage` sous la clé
`bike-trip-dashboard.weather.v1` (voir `src/weather/cache.ts`), avec une durée
de fraîcheur courte (30 minutes) : la dernière réponse valide reste affichée en
cas d'échec réseau, et une actualisation automatique est tentée quand le cache
devient périmé — sauf pour une journée déjà passée, qui n'est plus interrogée.

## GitHub Pages

Le site est statique et publié sur GitHub Pages via
`.github/workflows/deploy-pages.yml` à chaque push sur `main`. `vite.config.ts`
fixe `base: '/bike-trip-dashboard/'` pour que les chemins des assets soient
corrects sous ce sous-chemin.

## Fuseau horaire

Toutes les dates, heures et requêtes météo raisonnent dans le fuseau
`Europe/Paris`, quel que soit le fuseau du navigateur ou de la machine
d'exécution (voir `getDateInTimezone` dans `src/trip/calendar.ts`).
