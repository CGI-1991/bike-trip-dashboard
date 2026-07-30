# Cahier des charges — Moteur générique de voyages à vélo

**Projet cible :** nouveau dépôt dérivé de `CGI-1991/rga-2026-dashboard`
**Nom de travail recommandé :** `CGI-1991/bike-trip-dashboard`
**Version du CDC :** 1.0
**Date :** 30 juillet 2026

---

## 1. Objet du projet

Créer une application web progressive générique capable de générer, préparer et consulter un voyage à vélo à partir d’un ou plusieurs fichiers GPX, tout en conservant le niveau fonctionnel déjà atteint par l’application RGA 2026.

Le nouveau projet doit :

- partir de la base technique et visuelle stable de l’application RGA 2026 ;
- être développé dans un nouveau dépôt ;
- conserver la RGA 2026 comme voyage de référence et cas de non-régression ;
- devenir multi-voyages ;
- accepter un apport externe minimal ;
- fonctionner en priorité avec un ou plusieurs GPX ;
- enrichir automatiquement les données à partir de sources ouvertes ;
- permettre l’ajout de compléments après import ;
- rester utilisable hors ligne ;
- ne dépendre d’aucune image externe pour les profils de cols ou de montées ;
- ne pas imposer de serveur applicatif ni de compte utilisateur pour la V1.

---

## 2. Stratégie de dépôt

### 2.1. Dépôt actuel

Le dépôt actuel reste dédié à l’application opérationnelle RGA 2026 :

`CGI-1991/rga-2026-dashboard`

Il conserve :

- la version stable utilisée pour la RGA ;
- les correctifs ciblés ;
- le déploiement GitHub Pages actuel ;
- la référence visuelle et métier ;
- un historique restaurable.

Aucune refonte générique lourde ne doit être développée dans ce dépôt.

### 2.2. Nouveau dépôt

Créer un nouveau dépôt, par exemple :

`CGI-1991/bike-trip-dashboard`

Ce dépôt doit être initialisé à partir du dernier commit stable de l’application RGA 2026.

Le nouveau dépôt devient :

- le moteur générique ;
- l’application multi-voyages ;
- le laboratoire de migration ;
- la future application principale.

### 2.3. Historique Git

La méthode recommandée est de conserver l’historique Git du dépôt RGA.

Créer des tags de séparation :

Dans le dépôt RGA :

```text
rga-stable-before-generic-engine
```

Dans le nouveau dépôt :

```text
inherited-rga-dashboard-baseline
```

Premier commit spécifique au nouveau projet :

```text
chore: initialize generic cycling trip engine
```

---

## 3. Vision produit

L’utilisateur doit pouvoir :

1. importer un ou plusieurs GPX ;
2. obtenir immédiatement un voyage exploitable ;
3. laisser l’application générer :
   - les étapes ;
   - les statistiques ;
   - les profils altimétriques ;
   - les montées ;
   - les cols ;
   - les durées ;
   - les ETA ;
   - les points météo ;
   - les lieux pratiques ;
   - les cartes ;
   - les pauses ;
4. compléter ensuite :
   - les dates ;
   - les jours OFF ;
   - les logements ;
   - les notes ;
   - les horaires ;
   - les points imposés ;
   - les corrections ;
5. utiliser le voyage dans la même logique d’interface que la RGA actuelle ;
6. utiliser l’application hors ligne ;
7. exporter le voyage ;
8. réimporter le voyage sur un autre appareil.

---

## 4. Principes directeurs

### 4.1. Local-first

Le fonctionnement principal doit rester local :

- import local des GPX ;
- calculs géométriques locaux ;
- stockage local ;
- profils générés localement ;
- enrichissements externes facultatifs ;
- consultation hors ligne ;
- export de sauvegarde.

### 4.2. Enrichissements non bloquants

Une indisponibilité d’OSM, Open-Meteo ou d’un autre fournisseur ne doit jamais empêcher :

- l’import ;
- le calcul du parcours ;
- le calcul de la durée ;
- l’affichage du profil ;
- l’enregistrement du voyage ;
- la consultation hors ligne.

### 4.3. Sources, enrichissements et dérivés séparés

Les données doivent être organisées en trois niveaux.

#### Sources utilisateur

- GPX originaux ;
- dates ;
- logements ;
- notes ;
- overrides ;
- réglages.

#### Données enrichies

- noms de localités ;
- points OSM ;
- cols OSM ;
- prévisions météo ;
- altitude corrigée ;
- hébergements suggérés.

#### Données dérivées

- distance ;
- D+ ;
- D− ;
- profils ;
- montées ;
- durée ;
- ETA ;
- progression ;
- pauses automatiques.

Les données dérivées doivent pouvoir être recalculées sans altérer les sources.

### 4.4. Provenance

Chaque donnée enrichie doit conserver :

- sa source ;
- sa date de récupération ;
- la version du moteur ;
- son niveau de confiance ;
- son éventuelle modification manuelle.

Toute correction manuelle doit toujours primer sur une régénération automatique.

---

## 5. Format de l’application

### 5.1. Technologie

Conserver :

- TypeScript strict ;
- Vite ;
- PWA installable ;
- service worker unique ;
- interface responsive ;
- fonctionnement sur GitHub Pages ;
- navigation compatible mobile ;
- fonctionnement sans compte ;
- aucune dépendance obligatoire à un serveur.

### 5.2. Navigation principale

Conserver exactement trois entrées principales :

1. Aperçu
2. Voyage
3. Réglages

Le gestionnaire de voyages et l’assistant d’import sont accessibles depuis Réglages.

### 5.3. Deux modes

#### Mode consultation

- Aperçu ;
- liste des jours ;
- détail étape ;
- Parcours ;
- Météo ;
- Infos ;
- cartes ;
- profils de montées ;
- lieux pratiques ;
- GPX ;
- réglages.

#### Mode préparation

- nouveau voyage ;
- import GPX ;
- réordonnancement ;
- calendrier ;
- enrichissement ;
- contrôle ;
- logements ;
- corrections ;
- export.

---

## 6. Apport externe minimal

### 6.1. Mode express

Entrée obligatoire :

- un ou plusieurs fichiers GPX.

Le moteur doit générer immédiatement :

- le voyage ;
- une étape par GPX ;
- la carte générale ;
- les statistiques ;
- les profils ;
- les montées ;
- les durées ;
- les réglages par défaut ;
- les pauses automatiques ;
- les ETA relatives.

La date peut rester indéfinie.

Dans ce cas :

- aucune météo réelle ;
- aucun faux état temporel ;
- affichage `Date du voyage à définir` ;
- le reste de l’application reste utilisable.

### 6.2. Compléments facultatifs

- nom du voyage ;
- date de départ ;
- fuseau horaire ;
- jours OFF ;
- heure de départ ;
- vitesse de référence ;
- logement ;
- lien Maps ;
- site web ;
- notes ;
- point de passage ;
- point à masquer ;
- profil visuel personnalisé.

### 6.3. Plan B enrichi

Apport conseillé :

- GPX ;
- date de départ ;
- éventuels jours OFF ;
- lien Maps de chaque logement.

Tout le reste reste généré ou complété dans l’application.

---

## 7. Import GPX

### 7.1. Fonctions attendues

Prévoir :

- sélection multiple ;
- glisser-déposer sur ordinateur ;
- import depuis Fichiers sur mobile ;
- affichage du nom et de la taille ;
- contrôle du format ;
- ordre manuel ;
- suppression avant validation ;
- détection des doublons ;
- prévisualisation ;
- rapport d’erreurs.

### 7.2. Cas standards

#### Plusieurs GPX

Par défaut :

- un GPX = une étape ;
- l’ordre affiché = l’ordre du voyage ;
- aucune fusion silencieuse ;
- aucune subdivision silencieuse.

#### Un GPX unique

Créer une étape unique.

#### Un GPX long

Proposer un découpage automatique facultatif.

Le GPX original reste intact.

#### Plusieurs tracks ou segments

Afficher les éléments détectés et proposer :

- conserver comme une étape ;
- créer une étape par track ;
- créer une étape par segment ;
- ignorer certains segments.

#### Waypoints

Importer comme candidats :

- cols ;
- sommets ;
- pauses ;
- ravitaillements ;
- hébergements ;
- notes ;
- points de passage.

---

## 8. Modèle de données générique

Créer un format versionné `TripBundle`.

Structure conceptuelle :

```text
TripBundle
├── schemaVersion
├── metadata
├── calendar
├── days
├── stages
├── sourceFiles
├── routes
├── climbs
├── routePoints
├── practicalPlaces
├── accommodations
├── weather
├── settings
├── overrides
├── enrichmentMetadata
└── generatedMetadata
```

### 8.1. TripMetadata

- id ;
- slug ;
- nom ;
- description ;
- date de création ;
- date de modification ;
- date de début ;
- date de fin ;
- fuseau horaire ;
- langue ;
- unités ;
- statut ;
- version du schéma ;
- version du moteur.

### 8.2. TripDay

- id ;
- index ;
- numéro affiché ;
- date ;
- type :
  - ride ;
  - off ;
  - transfer ;
- stageId ;
- lieu de départ ;
- lieu d’arrivée ;
- logement ;
- notes ;
- réglages ;
- état d’enrichissement.

### 8.3. RideStage

- id ;
- dayId ;
- sourceRouteId ;
- nom ;
- départ ;
- arrivée ;
- distance ;
- D+ ;
- D− ;
- altitude minimale ;
- altitude maximale ;
- durée roulée ;
- pauses ;
- durée totale ;
- moyenne estimée ;
- chronologie ;
- météo ;
- montées ;
- lieux ;
- état de validation.

### 8.4. SourceFile

- id ;
- nom d’origine ;
- type MIME ;
- taille ;
- date de modification ;
- hash SHA-256 ;
- Blob ;
- date d’import ;
- statut de parsing ;
- erreurs.

### 8.5. Provenance

```ts
type DataProvenance = {
  sourceType:
    | "user"
    | "gpx"
    | "osm"
    | "open-meteo"
    | "generated"
    | "migrated";
  sourceId?: string;
  fetchedAt?: string;
  engineVersion: string;
  confidence?: "high" | "medium" | "low";
  manuallyOverridden: boolean;
};
```

---

## 9. Stockage

### 9.1. IndexedDB

Utiliser IndexedDB comme source de vérité pour :

- voyages ;
- GPX ;
- géométries ;
- montées ;
- lieux ;
- logements ;
- météo ;
- réglages ;
- overrides ;
- caches ;
- imports.

### 9.2. Object stores recommandés

```text
trips
sourceFiles
stages
routeGeometries
climbs
routePoints
practicalPlaces
accommodations
weatherCache
tripSettings
overrides
importJobs
providerCache
schemaMigrations
```

### 9.3. localStorage

Limiter localStorage à :

- activeTripId ;
- préférences légères ;
- état de navigation ;
- état de migration.

Ne pas y stocker les GPX ou les gros objets.

### 9.4. Import atomique

Pipeline :

1. créer un importJob ;
2. analyser les fichiers ;
3. construire un TripBundle provisoire ;
4. valider ;
5. écrire dans une transaction ;
6. marquer prêt ;
7. proposer comme voyage actif.

En cas d’erreur :

- rollback ;
- voyage précédent conservé ;
- rapport affiché.

### 9.5. Persistance

Demander `navigator.storage.persist()` lorsque disponible.

Afficher :

- stockage persistant ;
- stockage non garanti ;
- dernière sauvegarde ;
- recommandation d’export.

---

## 10. Export et sauvegarde

### 10.1. Export complet

Ajouter :

`Exporter le voyage`

Format recommandé :

```text
nom-du-voyage.biketrip
```

Archive ZIP contenant :

```text
manifest.json
sources/*.gpx
data/trip.json
data/stages.json
data/climbs.json
data/places.json
data/accommodations.json
data/overrides.json
data/settings.json
metadata/providers.json
```

### 10.2. Import de bundle

Ajouter :

`Importer un voyage`

Vérifier :

- version du schéma ;
- compatibilité ;
- signatures ;
- fichiers obligatoires ;
- espace disponible ;
- migrations.

Aucun contenu actif ne doit être exécuté depuis l’archive.

---

## 11. Analyse GPX

### 11.1. Compatibilité

Supporter :

- GPX 1.0 ;
- GPX 1.1 ;
- namespaces variables ;
- tracks ;
- routes ;
- segments ;
- waypoints ;
- altitude facultative ;
- timestamps facultatifs.

### 11.2. Validation

Détecter :

- XML invalide ;
- coordonnées absentes ;
- valeurs non finies ;
- trace vide ;
- doublons ;
- sauts aberrants ;
- altitude incohérente ;
- timestamps non monotones ;
- extensions inconnues.

### 11.3. Représentations

Conserver :

- GPX original ;
- données brutes ;
- série normalisée ;
- géométrie complète ;
- géométrie simplifiée ;
- profil rééchantillonné.

### 11.4. Rééchantillonnage

Pas initial recommandé :

- 50 m.

Créer plusieurs niveaux :

- calcul complet ;
- profil ;
- mini-carte ;
- carte générale.

---

## 12. Altitude

### 12.1. Priorité

Utiliser l’altitude du GPX lorsqu’elle est suffisamment complète.

### 12.2. Qualité

Mesurer :

- points sans altitude ;
- plateaux artificiels ;
- pics ;
- bruit ;
- valeurs impossibles ;
- résolution.

### 12.3. Correction facultative

Lorsque nécessaire :

- proposer `Améliorer les altitudes` ;
- conserver les altitudes originales ;
- stocker la correction séparément ;
- permettre le retour à la source.

### 12.4. Lissage

Créer une altitude lissée pour :

- pente ;
- D+ ;
- montées ;
- ETA.

Le lissage doit être déterministe et testé.

---

## 13. Détection des montées et cols

### 13.1. Objectif

Détecter automatiquement :

- les ascensions vers un col ;
- les montées majeures ;
- les montées finales vers un point remarquable ;
- les montées sans nom ;
- les deux versants d’un même col selon le trajet.

### 13.2. Sources

Utiliser :

1. profil altimétrique GPX ;
2. waypoints GPX ;
3. points OSM proches :
   - `mountain_pass=yes` ;
   - `natural=saddle` ;
   - sommets pertinents ;
4. overrides utilisateur.

Le GPX reste la source géométrique.

### 13.3. Méthode

Pour chaque sommet ou col :

1. projeter sur la trace ;
2. déterminer le kilomètre ;
3. parcourir la trace vers l’arrière ;
4. rechercher la séquence ascendante finale ;
5. tolérer de courtes descentes ;
6. tolérer de courts replats ;
7. détecter le point bas cohérent ;
8. calculer longueur, D+, pente ;
9. valider selon les seuils.

### 13.4. Règles initiales

Montée valide :

- longueur ≥ 1,5 km ;
- D+ ≥ 100 m ;
- pente moyenne ≥ 2 %.

Valeurs à calibrer :

- fenêtre de tendance : 500 m ;
- pente de maintien : 1 à 1,5 % ;
- perte tolérée : 20 à 30 m ;
- replat maximal : 1 km.

### 13.5. Cas particuliers

Gérer :

- faux sommet ;
- montée en paliers ;
- balcon ;
- courte descente intermédiaire ;
- arrivée en montée ;
- boucle ;
- passage répété ;
- col légèrement hors trace ;
- montée sans nom ;
- variante.

### 13.6. Confiance

Statut :

- confirmé ;
- probable ;
- incertain.

Les détections incertaines doivent être proposées à validation.

---

## 14. Profils de montées générés localement

### 14.1. Suppression de la dépendance aux images externes

Les liens Alpes4ever ou Route des Grandes Alpes ne doivent plus être nécessaires.

Le moteur doit générer lui-même le profil de chaque montée depuis le GPX.

### 14.2. Contenu

Afficher :

- nom ;
- longueur ;
- D+ ;
- altitude de départ ;
- altitude d’arrivée ;
- pente moyenne ;
- pente maximale lissée ;
- position sur l’étape.

### 14.3. Découpage

Découper le profil en tronçons fixes de 500 m.

Classes de pente :

#### Montée

- 0 à 1 % ;
- 1 à 4 % ;
- 4 à 8 % ;
- 8 à 12 % ;
- 12 % et plus.

#### Descente

- 0 à -7 % ;
- moins de -7 %.

### 14.4. Rendu

Privilégier SVG :

- responsive ;
- net ;
- accessible ;
- exportable ;
- sans réseau ;
- sans bibliothèque lourde.

### 14.5. Interaction

Au clic sur un col ou une montée :

ouvrir un dialogue interne avec :

- nom ;
- profil ;
- statistiques ;
- position sur l’étape ;
- `Voir sur la carte` ;
- `Fermer` en haut à droite.

---

## 15. Découpage automatique en étapes

### 15.1. Plusieurs GPX

Une étape par GPX par défaut.

### 15.2. GPX long

Créer des points de coupure candidats à partir de :

- villes ;
- villages ;
- hébergements ;
- campings ;
- gares ;
- services ;
- ravitaillements ;
- vallées ;
- fins de descentes ;
- fins de montées ;
- waypoints ;
- distances régulières.

### 15.3. Profil standard

Profil `Itinérance équilibrée` :

- durée cible : 5 h 30 ;
- plage confortable : 4 h à 7 h ;
- alerte : 8 h ;
- D+ cible : 1 200 m ;
- alerte D+ : 2 500 m ;
- départ : 08:00 ;
- vitesse de référence configurable ;
- pauses automatiques.

### 15.4. Score

Évaluer :

- durée ;
- D+ ;
- équilibre ;
- ravitaillement ;
- hébergement ;
- services ;
- arrivée au sommet ;
- étape trop courte ;
- étape trop longue ;
- nombre de jours ;
- continuité.

### 15.5. Propositions

Afficher au maximum :

- équilibrée ;
- journées courtes ;
- journées longues.

Permettre :

- accepter ;
- déplacer une coupure ;
- ajouter ;
- supprimer ;
- fusionner ;
- insérer un OFF ;
- renommer.

---

## 16. Calendrier

### 16.1. Date facultative

Sans date :

- aucune météo ;
- aucune fausse progression ;
- état de préparation ;
- ETA relatives seulement.

### 16.2. Date issue du GPX

Les timestamps peuvent servir de suggestion, jamais d’application silencieuse.

### 16.3. Fuseau horaire

Initialiser avec le fuseau de l’appareil.

Permettre la modification.

### 16.4. Jours OFF

Un jour OFF :

- garde la position à l’arrivée précédente ;
- ne crée aucun déplacement ;
- affiche le logement ;
- affiche les lieux locaux ;
- ne produit pas d’ETA roulée.

---

## 17. Durée, vitesse et ETA

### 17.1. Modèle

Conserver le principe :

```text
vitesse locale = vitesse de référence × facteur de terrain
temps local = distance locale / vitesse locale
```

Ne jamais renormaliser vers :

```text
distance / vitesse moyenne imposée
```

### 17.2. Réglage

Chaque voyage possède :

- une vitesse de référence globale.

Chaque journée possède :

- heure de départ ;
- pauses ;
- plan de pause.

### 17.3. Résultats

Calculer :

- durée roulée ;
- pauses ;
- durée totale ;
- ETA ;
- moyenne résultante ;
- position théorique ;
- progression ;
- D+ parcouru ;
- D− parcouru.

### 17.4. Profils initiaux

- balade ;
- itinérance ;
- sportif ;
- personnalisé.

Ces profils initialisent uniquement les réglages.

---

## 18. Pauses

Conserver :

- mode automatique ;
- mode personnalisé.

Le plan automatique utilise :

- durée ;
- cols ;
- sommets ;
- lieux ;
- ravitaillements ;
- heure ;
- espacement minimal.

Actions :

- Enregistrer ;
- Restaurer le plan automatique ;
- Annuler.

---

## 19. Lieux pratiques

### 19.1. Catégories

Conserver :

- Abris ;
- Boulangeries ;
- Cafés et glaces ;
- Eau / boissons ;
- Restauration rapide ;
- Service vélo ;
- Supermarchés ;
- Toilettes.

### 19.2. Source

Utiliser une interface de fournisseur OSM.

### 19.3. Corridor

Valeur initiale :

- 6 km autour de la trace.

Découper les requêtes en sous-zones.

### 19.4. Données

Pour chaque lieu :

- coordonnées ;
- catégorie ;
- nom ;
- distance à la trace ;
- kilomètre projeté ;
- détour ;
- horaires ;
- source ;
- date.

### 19.5. Déduplication

Par :

- id OSM ;
- coordonnées ;
- nom ;
- proximité ;
- catégorie.

### 19.6. Modifications utilisateur

Permettre :

- masquer ;
- épingler ;
- renommer ;
- recatégoriser ;
- ajouter manuellement.

---

## 20. Géocodage

Créer une interface :

```ts
interface ReverseGeocodingProvider {
  reverseGeocode(input: {
    lat: number;
    lon: number;
  }): Promise<GeocodedPlace>;
}
```

Règles :

- cache ;
- limitation du débit ;
- attribution ;
- fournisseur remplaçable ;
- aucune dépendance UI directe.

Sans géocodage :

- coordonnées affichées ;
- nom générique ;
- renommage manuel.

---

## 21. Météo

### 21.1. Prérequis

La météo exige :

- une date ;
- une heure de départ ;
- une chronologie.

### 21.2. Points

Générer :

- départ ;
- arrivée ;
- cols ;
- montées ;
- points intermédiaires.

### 21.3. Données

- température ;
- pluie ;
- vent ;
- rafales ;
- condition ;
- heure ;
- provenance.

### 21.4. États

- non configurée ;
- hors horizon ;
- disponible ;
- cache ;
- obsolète ;
- indisponible ;
- hors ligne.

### 21.5. Cache

Conserver :

- réponse brute ;
- réponse normalisée ;
- date ;
- durée de validité ;
- fournisseur.

---

## 22. Logements

### 22.1. Données

- nom ;
- adresse ;
- coordonnées ;
- Maps ;
- site ;
- téléphone ;
- type ;
- réservation ;
- note.

### 22.2. Ajout minimal

Autoriser uniquement le collage d’un lien Maps.

Ne pas promettre une extraction complète automatique.

### 22.3. Suggestions

Rechercher près des arrivées :

- hôtel ;
- auberge ;
- camping ;
- refuge ;
- hostel ;
- guest house.

Distinguer clairement :

- logement prévu ;
- suggestions.

---

## 23. Roadbook automatique

Générer localement un contenu factuel :

- étape ;
- distance ;
- D+ ;
- D− ;
- durée ;
- départ ;
- ETA ;
- cols ;
- montées ;
- ravitaillements ;
- logement ;
- alertes ;
- notes.

Le texte utilisateur ne doit jamais être remplacé automatiquement.

---

## 24. Aperçu général

Conserver :

- nom ;
- état temporel ;
- progression ;
- distance ;
- D+ ;
- D− ;
- étapes ;
- jours OFF ;
- carte globale ;
- prochaine étape ;
- ETA ;
- position théorique ;
- météo synthétique ;
- alertes ;
- Voir l’étape ;
- GPX.

La carte globale reste volontairement sobre.

---

## 25. Écran Voyage

Supporter :

- 1 à 100 étapes ;
- jours OFF ;
- étapes sans date ;
- étapes sans logement ;
- enrichissement partiel ;
- erreurs isolées.

Ne jamais dépendre d’un nombre fixe de jours.

---

## 26. Écran Réglages

Sections :

### Voyage

- nom ;
- date ;
- fuseau ;
- unités.

### Performance

- vitesse de référence ;
- plafond de descente ;
- profil.

### Étapes

- heure ;
- pauses ;
- plan automatique.

### Données

- enrichir ;
- recalculer ;
- cache ;
- fournisseurs.

### Logements

- compléments.

### Gestion

- Mes voyages ;
- Nouveau ;
- Dupliquer ;
- Exporter ;
- Importer ;
- Supprimer.

### Stockage

- espace ;
- persistance ;
- dernière sauvegarde.

---

## 27. Gestion multi-voyages

Pour chaque voyage :

- nom ;
- dates ;
- nombre de jours ;
- distance ;
- statut ;
- modification ;
- disponibilité hors ligne ;
- sauvegarde.

Actions :

- ouvrir ;
- dupliquer ;
- renommer ;
- exporter ;
- archiver ;
- supprimer.

La RGA 2026 doit apparaître comme un voyage normal.

---

## 28. Fournisseurs externes

Créer des interfaces :

```text
ElevationProvider
WeatherProvider
ReverseGeocodingProvider
PlacesProvider
PassesProvider
MapTileProvider
```

Chaque fournisseur expose :

- id ;
- version ;
- attribution ;
- limites ;
- disponibilité ;
- méthode ;
- normalisation ;
- erreurs.

Aucun composant visuel ne doit appeler directement un fournisseur.

---

## 29. PWA et hors ligne

Conserver un service worker unique.

Mettre en cache :

- shell ;
- JS ;
- CSS ;
- icônes ;
- données de démarrage.

Ne pas mettre dans le précache de build :

- voyages dynamiques ;
- GPX importés ;
- tuiles OSM ;
- météo externe ;
- images externes.

Les voyages résident dans IndexedDB.

Le service worker ne doit jamais renvoyer `index.html` pour :

- GPX ;
- JSON ;
- images ;
- bundles ;
- exports.

---

## 30. Confidentialité

Les GPX peuvent révéler :

- domicile ;
- habitudes ;
- dates ;
- logements.

Prévoir un mode :

`Analyse locale uniquement`

Dans ce mode :

- aucune coordonnée envoyée ;
- aucun géocodage ;
- aucun lieu OSM ;
- aucune météo ;
- calculs locaux disponibles.

Avant enrichissement externe, informer l’utilisateur.

---

## 31. Performance

Utiliser un Web Worker pour :

- parsing ;
- validation ;
- rééchantillonnage ;
- lissage ;
- pentes ;
- montées ;
- simplification ;
- statistiques.

Afficher les phases :

- Lecture ;
- Validation ;
- Analyse ;
- Étapes ;
- Montées ;
- Enrichissement ;
- Enregistrement.

Permettre l’annulation avant publication.

---

## 32. Mobile et accessibilité

Conserver :

- largeur minimale 320 px ;
- portrait ;
- paysage ;
- safe areas ;
- dialogues fermables ;
- retour système ;
- focus restauré ;
- aucun scroll arrière ;
- navigation au-dessus des cartes compactes ;
- carte plein écran au-dessus de la navigation ;
- clavier ;
- labels ;
- contraste.

---

## 33. Migration de la RGA dans le nouveau dépôt

### Phase 0 — Geler la référence

Dans le repo RGA :

- finir la version stable ;
- merger ;
- tester ;
- taguer ;
- conserver le build.

### Phase 1 — Créer le nouveau repo

- copier l’historique ;
- changer le nom ;
- changer le base path Vite ;
- changer le manifest PWA ;
- changer les caches ;
- créer une nouvelle URL Pages ;
- vérifier que le rendu RGA est identique.

### Phase 2 — Définir TripBundle

Créer :

- schéma ;
- types ;
- validateurs ;
- migrations ;
- sélecteurs.

### Phase 3 — Adapter la RGA

Créer :

```text
public/trips/rga-2026/
```

Y placer :

- manifest ;
- GPX ;
- roadbook ;
- logements ;
- lieux ;
- overrides ;
- réglages.

Créer un adaptateur temporaire :

```ts
loadRgaLegacyTrip(): TripBundle
```

### Phase 4 — Golden master

Tester :

- 12 jours ;
- 10 rides ;
- 2 OFF ;
- statistiques ;
- ETA ;
- logements ;
- 71 points ;
- 1 705 lieux ;
- 8 catégories ;
- météo ;
- cartes ;
- GPX ;
- offline.

### Phase 5 — IndexedDB

Ajouter :

- base ;
- migrations ;
- voyage actif ;
- gestionnaire ;
- import/export ;
- RGA préinstallée.

### Phase 6 — Import GPX

Ajouter :

- un GPX ;
- plusieurs GPX ;
- ordre ;
- calcul ;
- profils ;
- montées ;
- durée ;
- voyage sans date.

### Phase 7 — Enrichissements

Ajouter progressivement :

- localités ;
- cols OSM ;
- lieux ;
- météo ;
- altitude ;
- logements ;
- segmentation.

### Phase 8 — Parité

Comparer la RGA générique à la RGA historique.

### Phase 9 — Décision

Choisir ensuite :

- conserver les deux apps ;
- archiver l’ancienne ;
- remplacer l’ancienne URL ;
- garder la RGA préinstallée dans le moteur générique.

---

## 34. Architecture cible

```text
src/
├── app/
│   ├── bootstrap.ts
│   ├── router.ts
│   └── active-trip.ts
├── trip-core/
│   ├── model/
│   ├── schema/
│   ├── migrations/
│   ├── validation/
│   └── selectors/
├── gpx/
│   ├── parser.ts
│   ├── validator.ts
│   ├── normalize.ts
│   ├── resample.ts
│   └── simplify.ts
├── analysis/
│   ├── route-summary.ts
│   ├── elevation-quality.ts
│   ├── terrain-profile.ts
│   ├── climb-detection.ts
│   ├── stage-segmentation.ts
│   ├── timing.ts
│   └── progress.ts
├── enrichment/
│   ├── providers/
│   ├── elevation/
│   ├── geocoding/
│   ├── places/
│   ├── passes/
│   └── weather/
├── storage/
│   ├── database.ts
│   ├── repositories/
│   ├── migrations/
│   └── backup.ts
├── import/
│   ├── import-job.ts
│   ├── gpx-import.ts
│   ├── bundle-import.ts
│   └── trip-builder.ts
├── export/
│   ├── bundle-export.ts
│   └── gpx-export.ts
├── ui/
│   ├── overview/
│   ├── journey/
│   ├── settings/
│   ├── trip-manager/
│   ├── trip-builder/
│   ├── maps/
│   ├── profiles/
│   └── dialogs/
└── workers/
    └── route-analysis.worker.ts
```

---

## 35. Tests

### 35.1. Fixtures

Conserver la RGA comme fixture principale.

Ajouter :

- GPX plat ;
- GPX montagne ;
- GPX sans altitude ;
- GPX bruité ;
- GPX multi-segments ;
- GPX avec temps ;
- GPX sans temps ;
- GPX invalide ;
- GPX volumineux ;
- boucle ;
- multi-jours.

### 35.2. Tests unitaires

- parsing ;
- validation ;
- distance ;
- D+ ;
- D− ;
- lissage ;
- montées ;
- profils ;
- segmentation ;
- timing ;
- ETA ;
- pauses ;
- stockage ;
- cache ;
- migration ;
- export/import.

### 35.3. Tests de parité RGA

Toute différence doit être explicitement validée.

### 35.4. Tests E2E

Scénarios :

1. premier démarrage avec RGA ;
2. import un GPX ;
3. import dix GPX ;
4. création sans date ;
5. ajout date ;
6. enrichissement ;
7. ajout logement ;
8. offline ;
9. export ;
10. suppression ;
11. réimport ;
12. transfert ordinateur vers téléphone.

---

## 36. Critères d’acceptation V1

La V1 est acceptée lorsque :

1. la RGA fonctionne via TripBundle ;
2. aucun écran principal n’utilise de données RGA codées en dur ;
3. un GPX crée un voyage ;
4. plusieurs GPX créent plusieurs étapes ;
5. l’ordre est modifiable ;
6. les statistiques sont locales ;
7. les profils sont générés ;
8. les montées sont détectées ;
9. les profils de montées sont générés localement ;
10. aucune image externe n’est nécessaire ;
11. la vitesse de référence alimente toutes les étapes ;
12. les ETA sont calculées ;
13. les lieux peuvent être enrichis ;
14. la météo fonctionne après ajout d’une date ;
15. les logements peuvent être ajoutés plus tard ;
16. le voyage fonctionne hors ligne ;
17. le voyage est exportable ;
18. le voyage est réimportable ;
19. les données précédentes ne sont pas perdues ;
20. les tests RGA sont verts.

---

## 37. Hors périmètre V1

Ne pas inclure :

- compte utilisateur ;
- cloud automatique ;
- collaboration ;
- modification du tracé ;
- recalcul turn-by-turn ;
- import direct Garmin/Komoot ;
- suivi GPS en arrière-plan ;
- navigation vocale ;
- tuiles hors ligne ;
- paiement ;
- publication publique ;
- IA obligatoire ;
- fatigue multi-jours automatique ;
- synchronisation temps réel.

---

## 38. Décision d’architecture finale

Le socle retenu est :

- nouveau repo ;
- base issue de la RGA stable ;
- PWA conservée ;
- moteur générique local-first ;
- TripBundle versionné ;
- IndexedDB ;
- un service worker ;
- import GPX standard ;
- Web Worker ;
- profils de montées générés depuis le GPX ;
- fournisseurs interchangeables ;
- enrichissements facultatifs ;
- export obligatoire ;
- RGA comme fixture de référence ;
- remplacement éventuel de l’ancienne app seulement après parité complète.

---

## 39. Ordre de développement recommandé

Le développement doit commencer par :

1. figer la RGA actuelle ;
2. créer le nouveau repo ;
3. faire fonctionner la copie sans changement visible ;
4. définir TripBundle v1 ;
5. créer le bundle RGA ;
6. créer les tests de parité ;
7. migrer l’application actuelle vers TripBundle ;
8. ajouter IndexedDB ;
9. ajouter le gestionnaire de voyages ;
10. ajouter l’import GPX ;
11. ajouter les profils de montées générés ;
12. ajouter les enrichissements ;
13. ajouter l’export/import ;
14. atteindre la parité complète ;
15. décider du remplacement ou de la coexistence des deux applications.
