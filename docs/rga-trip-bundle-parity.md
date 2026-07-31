# RGA 2026 — parité TripBundle vs pipeline historique

Ce document résume l'écart mesuré, à la phase 4, entre le pipeline
opérationnel historique de la Route des Grandes Alpes 2026
(`src/trip/*`, `src/route/*`, `src/gpx/*`, `src/weather/*`, servant
aujourd'hui l'application réelle sans changement) et le `TripBundle` v1
produit par `loadRgaLegacyTrip()` (`src/trips/rga-2026/`).

Le détail machine-lisible (snapshots + matrice complète) vit dans
[`tests/golden/rga-2026/rga-2026-golden.json`](../tests/golden/rga-2026/rga-2026-golden.json),
régénéré par `npm run generate:rga-golden` et vérifié sans jamais rien
réécrire par `npm run check:rga-golden`. Ce document n'en duplique pas le
contenu — il explique comment le lire et ce que chaque statut signifie.

## Statuts

| Statut | Signification |
|---|---|
| `exact` | La donnée historique et la donnée `TripBundle` correspondent exactement, vérifié par un test qui échoue si ce n'est plus le cas. |
| `source-preserved` | La donnée existe intacte dans `public/trips/rga-2026/` (copie byte-identique ou sémantiquement identique de la source historique) mais n'est pas encore modélisée dans `TripBundle`. |
| `dynamic-excluded` | La donnée est par nature dynamique (dépend de la date, du réseau, du cache) et ne doit jamais être figée dans un instantané statique. |
| `deferred` | La donnée reste volontairement absente de `TripBundle` (`null` ou tableau vide) ; la cible et la phase future nécessaire sont documentées. |
| `mismatch` | Écart réel et non classé. **Aucun domaine du golden master actuel n'est dans cet état** — son apparition fait échouer `rga-golden-master.test.mjs`. |

## Domaines en parité exacte

- **Métadonnées et calendrier** — id, slug, nom, langue, unités, fuseau, dates de début/fin, 12 dates journalières.
- **Journées** — 12 journées (10 ride, 2 off), ordre, J5 OFF à Bourg-Saint-Maurice, J8 OFF à Briançon, destination finale Nice, notes structurées (jointure déterministe `\n`, `ambiance` jamais incluse).
- **Étapes** — 10 `RideStage`, relations journée↔étape↔route, nom/départ/arrivée, statistiques éditoriales (`distanceKm`/`elevationGainM`/`elevationLossM`) avec leur `metricsProvenance` propre (`sourceType:'migrated'`, `confidence:'medium'`).
- **Fichiers GPX** — 10 `SourceFile`, noms exacts, tailles, hashes SHA-256, unicité, correspondance route↔fichier.
- **Paquet canonique** — 16 fichiers sous `public/trips/rga-2026/`, aucun manquant/surnuméraire, hashes stables, `check:rga-trip-package` vert.
- **Points documentés** — voir le tableau ci-dessous.
- **Lieux pratiques** — 1 705 lieux, 8 catégories, identifiants/noms/coordonnées/catégories/descriptions/`dayIds` identiques (449 lieux multi-journées), sélectionnables via `selectPracticalPlacesForDay`.
- **Logements** — 10 logements, associations journalières, noms/types/adresses/coordonnées/URLs/statut confirmé.
- **Réglages** — vitesse de référence 18 km/h, stratégie de pauses automatique, 10 réglages journaliers, jamais de lecture `localStorage`.
- **Offline** — toutes les ressources historiques restent précachées, les 16 fichiers du paquet canonique sont découverts automatiquement et précachés, aucun doublon, aucun chemin Windows, aucune URL absolue.

### Points documentés — comptes exacts

| Grandeur | Valeur | Relation vérifiée |
|---|---:|---|
| Candidats documentés (cols+passages+options des 10 journées ride) | 53 | = 46 + 4 + 3 |
| Overrides `matched` | 46 | |
| Overrides `needs-review` | 4 | |
| Overrides `unmatched` | 3 | |
| Supprimés (décision utilisateur, `roadbook-suppressions.ts`) | 7 | = 4 + 3 (exactement les `needs-review` + `unmatched`) |
| Objets documentés (candidats + 10 départs + 10 arrivées + 5 pauses éditoriales) | 78 | |
| Objets opérationnels (pipeline réel, `buildRoadbookMatchReport().summary.pointCount`) | 71 | = 78 − 7, confirmé par le pipeline réel (66 actifs + 5 informationnels) |
| `RoutePoint` dans TripBundle | 46 | = exactement les 46 overrides `matched` — jamais un `needs-review`/`unmatched` |

**Ces trois derniers nombres ne se confondent jamais** : « candidat documenté » (53),
« objet opérationnel historique » (71, qui inclut aussi les 20 points de
départ/arrivée synthétiques et les 5 pauses informationnelles) et
« `RoutePoint` positionné dans `TripBundle` » (46, le sous-ensemble
géométriquement validé des seuls cols/passages/détours) sont trois concepts
distincts, chacun testé indépendamment dans `rga-golden-master.test.mjs`.

### Écart avec le CDC constaté et non résolu par une hypothèse

Le CDC (section 33/phase 4) mentionne « 30 ressources précachées ». Le
calcul programmatique réel donne aujourd'hui **20 ressources historiques +
16 fichiers du paquet canonique = 36**, sans doublon. Cette phase ne modifie
pas `CDC.md` ; le golden master fixe et teste la valeur réelle (36), pas
l'hypothèse du CDC.

## Domaines source-preserved

Présents intacts dans `public/trips/rga-2026/` (copies byte-identiques),
mais non modélisés dans `TripBundle` v1 :

- le roadbook éditorial complet (`roadbook/roadbook.json`) : ambiances, activités/logistique/récupération des journées OFF, options sans position validée (ex. Cime de la Bonette), notes éditoriales au-delà de celles mappées dans `TripDay.notes` ;
- les overrides géométriques bruts (`overrides/roadbook-overrides.json`), y compris les 7 entrées `needs-review`/`unmatched` ;
- rien n'est supprimé ni modifié silencieusement — vérifié par comparaison byte-à-byte avec la source historique.

## Météo — dynamic-excluded

La météo dépend de la date, du cache et du fournisseur Open-Meteo ; aucune
prévision réelle n'est jamais figée dans un instantané statique. Le contrat
testé :

- `TripBundle.weather` reste `[]` dans le paquet canonique initial ;
- aucun horodatage de récupération dynamique n'est gelé (`fetchedAt` toujours `null` dans les métadonnées d'enrichissement) ;
- aucune charge utile ressemblant à une prévision (`temperatureC`, `weatherCode`, etc.) n'apparaît dans le paquet canonique ou le golden JSON ;
- le pipeline météo historique (`src/weather/*`) reste inchangé et continue de servir l'application en direct.

## Domaines deferred

Regroupés sous un seul domaine `route_geometry_and_stage_timings` tant
qu'aucun n'est implémenté (voir CDC phase 4 section 8) :

- `Route.geometry` / `Route.profile` (aucun nouveau parseur GPX Node dans cette phase) ;
- `RideStage.minAltitudeM` / `maxAltitudeM` ;
- `RideStage.movingDurationSeconds` / `pauseDurationSeconds` / `totalDurationSeconds` / `estimatedAverageSpeedKph` ;
- les montées génériques (`TripBundle.climbs`) ;
- les `TripOverride` génériques ;
- l'ETA et la timeline propres à `TripBundle` ;
- les cartes et le rendu UI branchés sur `TripBundle`.

**Quand l'un de ces éléments sera implémenté**, son statut devra passer à
`exact` avec un test dédié — le test `route_geometry_and_stage_timings`
échoue déjà si l'un de ces champs redevient non nul sans reclassification
(voir `rga-golden-master.test.mjs`).

## Critères avant toute bascule du runtime

Cette phase ne bascule rien : `src/main.ts` continue de charger la RGA
exclusivement via le pipeline historique. Avant d'envisager une bascule
future, il faudra au minimum :

1. faire passer `route_geometry_and_stage_timings` à `exact` (géométrie, profils, durées, ETA) ;
2. modéliser les montées et les overrides génériques sans provenance inventée ;
3. étendre le golden master à une comparaison exhaustive (et pas seulement résumée) là où c'est nécessaire ;
4. conserver 100 % des tests actuels (RGA historique + trip-core + Phase 3/3B + golden master) verts.
