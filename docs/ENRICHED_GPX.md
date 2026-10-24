# Export et réimport GPX enrichi — 2026.10.24.3

> Depuis **2026.10.24.6**, la [règle de départ GPX et de vent à vélo](GPX_DEPARTURE_AND_WALKING_WIND.md) prime sur les comportements historiques décrits ci-dessous : limites facultatives en League/Tour, heure au départ GPX, approche incluse dans les ETA et module vent masqué en randonnée.


> Le lot suivant ajoute un [FIT Course en essai](FIT_COURSE.md), avec lecture indépendante validée et comportement sur appareil Garmin encore à confirmer. Le GPX enrichi garde son rôle de format réimportable.

Ce lot complète les [segments de course](RACE_SEGMENTS.md) pour League et Tour. Il préserve le [vent par parcours et le panneau Course](COURSE_WIND_AND_EDITING.md). L’export FIT Garmin reste à réaliser.

## Usage

Dans le détail d’une course/étape, sous la carte :

- **GPX d’origine** télécharge le fichier source conservé, octet pour octet.
- **Exporter GPX enrichi** prépare un fichier `_enrichi.gpx` avec la trace complète et la préparation actuelle de cette course. Une balise MAJ locale explique la fonction.

En League, renseigner d’abord les deux limites réelles dans Course. En Tour, la trace entière reste utilisable sans limites explicites. Une source absente, des limites obsolètes ou un segment hors course/à replacer bloquent l’export enrichi avec une raison visible. Le fichier d’origine reste téléchargeable lorsqu’il est disponible.

Réimporter le fichier par l’assistant habituel, puis choisir League ou Tour pour afficher les outils de compétition. Le nom de course est prérempli et peut être remplacé ou effacé. **Dates, départs, déplacement et organisation restent les choix du nouvel import** ; les timestamps GPX ne deviennent jamais des dates de calendrier. Importer en Voyage conserve les annotations, sans afficher les outils League/Tour.

L’export est local, sans requête POI ou météo. Après téléchargement, vérifier le fichier dans Fichiers sur iPhone. Il ne remplace pas la [sauvegarde ZIP](TRIP_BACKUP.md), qui conserve l’activité entière, ses étapes, logements, notes et autres réglages. Aucune réinstallation ni migration de stockage.

## Contenu et compatibilité

L’export utilise le XML source enregistré, avec ses coordonnées, altitudes, horodatages, waypoints source et extensions tierces. Il conserve les structures trace/route et les différents segments de trace ; il ne reconstruit pas une trace simplifiée depuis le profil. La sérialisation XML peut changer la mise en forme ou les déclarations de namespace ; seul le téléchargement d’origine garantit des octets identiques.

Des waypoints standards repèrent les limites réelles (`RACE_START`, `RACE_FINISH`) lorsqu’elles sont définies, puis les débuts/fins et éventuelles alertes préalables des segments (`SPRINT_01_START`, `CLIMB_01_END`, `FLANDRIEN_01_ALERT`, etc.). Les repères de début/fin sont informatifs, indépendamment de l’activation des alertes correspondantes. Les réglages exacts sont conservés dans l’extension.

Si le point d’alerte préalable serait avant le départ de course, il est **omis avec un avertissement**. Il n’est jamais rabattu au départ en prétendant annoncer 500 m. Aucune notification Garmin n’est garantie par ces waypoints : le prochain export FIT devra être validé séparément, y compris sur appareil.

GPX 1.1 utilise `<extensions><tp:race version="1">…</tp:race></extensions>`. GPX 1.0 conserve ses éléments d’extension dans un namespace distinct directement sous la racine et les waypoints, sans introduire l’enveloppe GPX 1.1. Les préfixes XML existants sont acceptés.

## Format et intégrité

Le namespace versionné est `https://cgi-1991.github.io/bike-trip-dashboard/gpx/race/1`. Le contenu JSON de `tp:data`, échappé pour XML, conserve uniquement :

- `version: 1` et `geometrySha256` ;
- le nom facultatif de course et ses limites, en mètres absolus sur le GPX complet ;
- les segments : identifiant, type, nom, limites et réglages d’alerte avant/début/fin.

L’empreinte de géométrie est calculée sur la suite numérique complète `[latitude, longitude, altitudeM]`, altitude inconnue représentée par `null`. Une modification de format XML ne l’invalide pas ; une modification géométrique refuse l’import avant toute écriture. Ce contrôle détecte les désaccords entre trace et annotations, sans constituer une signature d’authenticité. L’empreinte du nouveau fichier source est liée aux annotations seulement après validation géométrique.

Le lecteur refuse les versions futures de notre namespace, métadonnées dupliquées/illisibles, valeurs invalides, identifiants dupliqués et segments hors intervalle. Il copie une liste explicite de champs autorisés, jamais des réglages arbitraires contenus dans le fichier. Les namespaces tiers restent indépendants. Les waypoints générés par notre export ne deviennent pas des POI ordinaires ni des noms de montées à la réimportation.

Un nouvel export remplace uniquement nos anciennes annotations et waypoints : ils ne s’accumulent pas. Les identifiants sont conservés lors d’un import isolé ; une collision entre fichiers ou avec les segments d’une activité éditée renouvelle les identifiants entrants en conservant leur configuration et en signalant l’ajustement.

Après import, l’état enregistré dans l’application prévaut sur l’ancien instantané embarqué dans le GPX : une édition structurelle ne ressuscite ni un nom ni des limites effacés et conserve les modifications de segments. Les protections existantes en cas de remplacement de trace restent actives.

## Vérification

`npm run build` puis `npm test` : **2 233 tests réussis**, aucun échec ni test ignoré. Quatorze nouveaux scénarios couvrent League/Tour, les trois types et leurs alertes, limites réelles, précision conservée, altitude inconnue, identités, rechargement IndexedDB, réexport sans duplication, import refusé sans écriture, propriétés non autorisées, préremplissage/suppression du nom, éditions structurelles et ajout d’une copie dans la même League.

Chromium tactile à **320 et 390 × 844**, fuseau Europe/Brussels, avec IndexedDB réel, assistant d’import et Leaflet : limites et segments enregistrés, activation immédiate du bouton, téléchargement de l’original identique, export puis réimport dans une autre League **hors connexion**, date et départ indépendants, configurations identiques, activité initiale inchangée et réexport sans duplication. Lecture des segments, vent par parcours et panneau Course conservés. Aucun débordement horizontal ni erreur JavaScript ; prévisions déterministes et tuiles bloquées.

Le XML produit par le sérialiseur natif est vérifié aussi par un parseur XML Python indépendant : trace, timestamps, extensions tierces et CDATA conservés. Une matrice navigateur couvre GPX 1.0/1.1, balises préfixées, itinéraire `rte` et trace à plusieurs `trkseg`. Il ne s’agit pas d’une validation XSD ni d’un essai Garmin. Le téléchargement et la réimportation dans la PWA iPhone physique restent à vérifier après fusion et déploiement.
