# RGA 2026 — Tableau de bord

Tableau de bord mobile-first pour suivre, jour par jour, la traversée cyclotouriste
de la Route des Grandes Alpes 2026 (Thonon-les-Bains → Nice, 12 jours, 10 journées
roulées et 2 journées OFF) : chronologie et ETA calculés depuis les traces GPX
réelles, croisement avec le roadbook éditorial, et météo Open-Meteo adaptée à
l'échéance de chaque journée.

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

Les préférences utilisateur (vitesse moyenne, heure de départ, durée totale des
pauses par journée roulée) sont enregistrées dans `localStorage` sous la clé
`rga-2026-dashboard.settings.v1` (voir `src/storage/settings.ts`). Elles ne
quittent jamais le navigateur.

## Cache météo

Les réponses Open-Meteo sont mises en cache dans `localStorage` sous la clé
`rga-2026-dashboard.weather.v1` (voir `src/weather/cache.ts`), avec une durée de
fraîcheur courte (30 minutes) : la dernière réponse valide reste affichée en cas
d'échec réseau, et une actualisation automatique est tentée quand le cache
devient périmé — sauf pour une journée déjà passée, qui n'est plus interrogée.

## GitHub Pages

Le site est statique et publié sur GitHub Pages via
`.github/workflows/deploy-pages.yml` à chaque push sur `main`. `vite.config.ts`
fixe `base: '/rga-2026-dashboard/'` pour que les chemins des assets soient
corrects sous ce sous-chemin.

## Fuseau horaire

Toutes les dates, heures et requêtes météo raisonnent dans le fuseau
`Europe/Paris`, quel que soit le fuseau du navigateur ou de la machine
d'exécution (voir `getDateInTimezone` dans `src/trip/calendar.ts`).
