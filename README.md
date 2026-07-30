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

La migration vers le modèle générique `TripBundle` décrit dans `CDC.md` n'a pas
encore commencé : l'application fonctionne aujourd'hui exactement comme
l'application RGA 2026 d'origine, avec une identité technique (nom de paquet,
base GitHub Pages, manifeste PWA, préfixe de cache, clés de stockage) propre à
ce nouveau dépôt. L'import GPX générique, IndexedDB et le multi-voyages ne sont
pas implémentés.

## Stack

- [Vite](https://vite.dev/) + TypeScript strict, sans framework UI (rendu en
  chaînes de caractères injectées dans le DOM).
- Aucun backend : l'application est statique, tout le calcul (GPX, itinéraire,
  appariement roadbook, météo) tourne dans le navigateur.
- Aucune clé API : le fournisseur météo [Open-Meteo](https://open-meteo.com/)
  est appelé anonymement en HTTPS.
- Tests unitaires avec le test runner natif de Node (`node:test`), sans
  dépendance de test supplémentaire.

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
