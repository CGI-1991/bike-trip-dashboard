# Bike Trip — Intégration du mode BCF / Course

## Objectif

Ajouter à Bike Trip un **mode BCF / Course** permettant de préparer un parcours de compétition directement dans l’application.

L’utilisateur doit pouvoir :

1. importer le GPX officiel de la course ;
2. définir le **départ réel** et l’**arrivée réelle** de la course ;
3. créer et modifier les segments spécifiques :
   - 🔴 Grimpeur ;
   - 🟢 Sprint ;
   - 🟡 Flandrien ;
4. visualiser ces informations sur la carte et sur le profil altimétrique ;
5. comparer les statistiques du GPX complet avec celles de la course réellement parcourue ;
6. exporter :
   - un **GPX enrichi**, réimportable dans Bike Trip ;
   - un **FIT Garmin**, destiné à la navigation et aux alertes sur le GPS ;
7. générer automatiquement des alertes Garmin avant les segments, par défaut **500 m avant**.

Le mode Bike Trip classique doit continuer à fonctionner sans régression.

---

# 1. Architecture générale

Éviter de disperser des conditions du type :

```ts
if (mode === "bcf")
```

dans toute l'application.

Introduire plutôt un concept de mode/capabilities.

Exemple :

```ts
type TripMode = "trip" | "race";
```

UI :

```text
Mode Bike Trip
Mode BCF / Course
```

Même si l'interface parle de « BCF », utiliser si possible `race` dans le modèle interne afin de pouvoir réutiliser le système pour d'autres compétitions.

Exemple de configuration :

```ts
const MODE_CAPABILITIES = {
  trip: {
    poiDetection: true,
    pauseManagement: true,
    raceSegments: false,
    raceBounds: false,
  },

  race: {
    poiDetection: false,
    pauseManagement: false,
    raceSegments: true,
    raceBounds: true,
  },
};
```

---

# 2. Données d'une course

Chaque course doit être un objet distinct avec notamment une **date propre**.

Ne pas utiliser :

- la date d'import ;
- la date du fichier ;
- un timestamp présent éventuellement dans le GPX

comme date officielle de la course.

Prévoir par exemple :

```ts
interface RaceEvent {
  id: string;

  name: string;
  eventDate: string;

  routeId: string;

  startOffsetM: number;
  finishOffsetM: number;

  officialDistanceM?: number;
  officialElevationGainM?: number;

  createdAt: string;
  updatedAt: string;
}
```

`startOffsetM` et `finishOffsetM` représentent la distance le long de la trace GPX.

---

# 3. Départ et arrivée réels

Le fichier GPX peut commencer avant le départ officiel ou continuer après l'arrivée.

L'utilisateur doit pouvoir placer :

```text
START COURSE
FINISH COURSE
```

directement :

- sur la carte ;
- idéalement également sur le profil altimétrique.

Le point sélectionné doit être automatiquement projeté sur la trace GPX.

Stocker principalement :

```ts
offsetM
```

et éventuellement en complément :

```ts
lat
lon
trackPointIndex
```

Ne pas utiliser uniquement latitude/longitude comme référence, car deux parties de parcours peuvent être géographiquement très proches.

---

# 4. Éditeur de segments BCF

Ajouter une action :

```text
+ Ajouter un segment
```

Types disponibles :

```ts
type RaceSegmentType =
  | "climb"
  | "sprint"
  | "flandrien";
```

Couleurs UI :

```text
climb      → rouge
sprint     → vert
flandrien  → jaune
```

Workflow :

```text
+ Segment
   ↓
Sprint / Grimpeur / Flandrien
   ↓
clic début
   ↓
clic fin
   ↓
segment créé
```

L'édition doit ensuite permettre :

- déplacer le début ;
- déplacer la fin ;
- supprimer le segment ;
- modifier son nom ;
- changer son type ;
- modifier les paramètres d'alerte.

Modèle proposé :

```ts
interface RaceSegment {
  id: string;
  raceEventId: string;

  type: "climb" | "sprint" | "flandrien";

  name: string;

  startOffsetM: number;
  endOffsetM: number;

  source: "manual" | "gpx" | "strava";

  sourceId?: string;

  alertBeforeM?: number;

  alertAtStart?: boolean;
  alertAtEnd?: boolean;
}
```

Valeurs par défaut :

```ts
alertBeforeM = 500;
alertAtStart = true;
alertAtEnd = false;
```

---

# 5. Édition graphique

L'objectif est que la configuration soit suffisamment simple pour ne plus devoir passer par Komoot, Garmin Connect ou gpx.studio.

## Carte

Afficher :

- départ réel ;
- arrivée réelle ;
- début et fin des segments ;
- couleur/type du segment.

## Profil altimétrique

Ne pas remplacer toute la courbe altimétrique par une couleur.

Conserver le profil principal neutre et ajouter des **bandes colorées de segments** :

```text
              🔴 GRIMPEUR
        █████████████████

 🟢 SPRINT                      🟡 FLANDRIEN
 █████                          ███████████

────╱╲────╱╲────────╱╲────────────╱╲────
 START                                      FINISH
```

Avant START et après FINISH :

- atténuer/griser le profil.

Ajouter des repères verticaux pour :

```text
START
FINISH
```

Les limites des segments devraient idéalement pouvoir être déplacées directement par drag-and-drop.

Prévoir également une indication autre que la couleur :

```text
C = Climb
S = Sprint
F = Flandrien
```

afin que l'information ne repose pas uniquement sur la couleur.

---

# 6. Statistiques

Afficher clairement trois notions différentes.

## Trace GPX

Statistiques du fichier complet :

```text
Trace GPX
127,8 km
1 540 m D+
```

## Course calculée

Recalcul entre :

```text
START COURSE
↓
FINISH COURSE
```

Exemple :

```text
Course calculée
121,4 km
1 487 m D+
```

## Données officielles

Optionnelles et saisies manuellement si disponibles :

```text
Distance officielle
120,8 km

D+ officiel
1 500 m
```

Ne pas appeler la valeur recalculée « réelle ».

Utiliser :

```text
Trace GPX
Course calculée
Officiel
```

---

# 7. Statistiques des segments

Calculer automatiquement selon le type.

Exemple Sprint :

```text
Sprint 1
km 34,62 → 35,18
560 m
```

Grimpeur :

```text
Grimpeur 2
km 67,80 → 71,42
3,62 km
+184 m
5,1 %
```

Flandrien :

```text
Flandrien 1
km 92,10 → 94,70
2,60 km
```

Les statistiques doivent être recalculées automatiquement lorsque l'utilisateur déplace une limite.

---

# 8. Format maître

Bike Trip doit rester la **source de vérité**.

Ne pas rendre le mode BCF dépendant :

- de Strava ;
- de Garmin Connect ;
- de Komoot ;
- d'une API externe.

Le modèle interne doit être utilisable entièrement hors ligne après import du GPX.

---

# 9. Export GPX enrichi

Ajouter :

```text
Exporter GPX BCF
```

Le GPX doit conserver :

- trace ;
- départ réel ;
- arrivée réelle ;
- segments ;
- type des segments ;
- noms ;
- alertes.

Utiliser si possible des waypoints GPX standards pour assurer un minimum d'interopérabilité.

Exemple logique :

```text
BCF_START
BCF_FINISH

SPRINT_01_ALERT
SPRINT_01_START
SPRINT_01_END

CLIMB_01_ALERT
CLIMB_01_START
CLIMB_01_END

FLANDRIEN_01_ALERT
FLANDRIEN_01_START
FLANDRIEN_01_END
```

Prévoir éventuellement une extension XML Bike Trip pour conserver les métadonnées complètes.

Le GPX exporté doit pouvoir être réimporté dans Bike Trip sans perdre la configuration BCF.

---

# 10. Export Garmin FIT

Ajouter :

```text
Exporter pour Garmin
```

Générer un fichier :

```text
.fit
```

de type Course.

Utiliser le SDK FIT Garmin si possible directement côté TypeScript/JavaScript.

Le FIT doit contenir :

- le parcours ;
- les Course Points nécessaires ;
- départ ;
- arrivée ;
- alertes de segments ;
- début des segments ;
- éventuellement fin des segments.

---

# 11. Alertes Garmin

Important :

Ne pas dépendre d'un système Garmin spécifique permettant de demander « avertir 500 m avant ».

Bike Trip doit créer explicitement un Course Point situé :

```text
segment.startOffsetM - alertBeforeM
```

Exemple :

```text
Sprint
START = km 34,620
alerte = 500 m

Course Point :
km 34,120
"SPRINT 500m"
```

Puis :

```text
km 34,620
"SPRINT START"
```

Éventuellement :

```text
km 35,180
"SPRINT END"
```

Même logique pour les grimpeurs et Flandrien.

Exemple :

```text
km 67,300   CLIMB 500m
km 67,800   CLIMB START
km 71,420   CLIMB END
```

---

# 12. Paramétrage des alertes

Ajouter une configuration globale :

```text
Alertes segments Garmin

Avant segment : [500] m

[x] alerte avant
[x] alerte au départ
[ ] alerte à la fin
```

Puis permettre éventuellement une surcharge par segment.

Exemple :

```text
Sprint final

Alerte avant :
[1000] m
```

---

# 13. Gestion des cas limites

### Segment situé à moins de 500 m du départ

Ne jamais générer une position négative.

Utiliser éventuellement START comme point d'alerte ou supprimer l'alerte préalable.

### Segments qui se chevauchent

Les accepter.

Le profil doit pouvoir afficher plusieurs bandes/lignes si nécessaire.

### Segment hors START/FINISH

Afficher un warning et empêcher éventuellement son export course.

### Segment très court

Ne pas imposer arbitrairement une longueur minimale sans raison fonctionnelle.

### Modification du parcours

Si la géométrie GPX change :

- tenter de remapper les offsets ;
- sinon signaler que les segments doivent être vérifiés.

Ne pas déplacer silencieusement les segments vers une position incorrecte.

---

# 14. Strava — optionnel uniquement

Prévoir l'architecture pour permettre ultérieurement :

```text
Importer un segment Strava
```

Mais ce n'est pas une dépendance du mode BCF.

Workflow potentiel :

```text
segment Strava
↓
géométrie
↓
projection sur le GPX
↓
validation utilisateur
↓
RaceSegment local
```

Strava peut éventuellement suggérer qu'un segment est une montée.

En revanche, ne pas essayer de déduire automatiquement :

```text
Sprint
Flandrien
```

depuis Strava.

Une fois importé, le segment doit être enregistré localement dans le modèle Bike Trip.

---

# 15. Distinction importante : segments de course / montées automatiques

Ne jamais confondre :

```text
montées détectées automatiquement
```

et :

```text
segments Grimpeur BCF
```

Un Grimpeur BCF est une donnée explicitement configurée pour la course.

Il ne doit jamais disparaître ou être déplacé parce que l'utilisateur change l'algorithme de détection automatique des montées.

---

# 16. Bug existant à corriger

Bug actuellement constaté :

> Après import d'un GPX, modifier le mode de détection des montées ne semble pas répercuter correctement le changement.

Ne pas supposer le symptôme précis avant inspection du code.

Vérifier notamment :

- si le mode de détection n'est lu qu'au moment de l'import initial ;
- si les résultats de détection sont mis en cache ;
- si la configuration de détection manque dans une dependency list / cache key ;
- si les montées générées sont persistées puis jamais invalidées.

Comportement attendu :

```text
GPX déjà importé
↓
changement du mode de détection
↓
suppression/invalidation des montées AUTO
↓
nouvelle analyse depuis la trace originale
↓
mise à jour immédiate carte + profil + stats
```

Très important :

```text
montées AUTO → recalculées
segments BCF manuels → conservés
```

Ajouter des tests au minimum :

```text
mode A → mode B après import
mode B → mode A après import
reload après modification
segments BCF conservés
```

---

# 17. UX proposée

Dans une course :

```text
COURSE BCF
────────────────────────

Date
[ 14/03/2027 ]

Départ réel
[ Définir ]

Arrivée réelle
[ Définir ]

SEGMENTS
────────────────────────

🟢 Sprint 1
km 34,6 → 35,2

🔴 Grimpeur 1
km 67,8 → 71,4

🟡 Flandrien 1
km 92,1 → 94,7

[ + Ajouter un segment ]

────────────────────────

ALERTES GARMIN

Avant segment
[ 500 ] m

☑ Avant segment
☑ Début segment
☐ Fin segment

────────────────────────

[ Export GPX ]

[ Export Garmin FIT ]
```

L'édition doit rester graphique et rapide.

Éviter les formulaires longs remplis de coordonnées GPS ou de kilométrages à encoder manuellement.

---

# 18. Ordre d'implémentation recommandé

Procéder progressivement pour limiter les régressions.

## Phase 1 — modèle BCF

- `RaceEvent`
- `RaceSegment`
- `eventDate`
- START / FINISH
- stockage par `offsetM`
- capacités du mode race

## Phase 2 — éditeur

- ajout START / FINISH ;
- création des trois types de segments ;
- affichage carte ;
- affichage profil ;
- déplacement/suppression ;
- recalcul statistiques.

## Phase 3 — GPX enrichi

- export ;
- réimport ;
- conservation complète des métadonnées.

## Phase 4 — Garmin FIT

- génération Course FIT ;
- Course Points ;
- alertes à 500 m ;
- START ;
- segment START ;
- éventuellement segment END.

## Phase 5 — qualité

- corriger le bug du changement de détection des montées ;
- tests de non-régression ;
- gestion chevauchements/cas limites ;
- tests sur Garmin réel.

## Phase 6 — enrichissements futurs

- import Strava ;
- saison/calendrier BCF ;
- duplication d'une course ;
- partage d'un GPX BCF configuré.

---

# 19. Contraintes

- Pas de service payant nécessaire.
- Pas de dépendance obligatoire à Strava/Garmin/Komoot.
- Fonctionnement local/offline autant que possible.
- Ne pas casser le mode Bike Trip actuel.
- Réutiliser autant que possible les composants existants de carte, profil, GPX et calcul de distance/D+.
- Préférer une architecture générique `race` avec présentation BCF plutôt qu'une implémentation entièrement spécifique BCF.
- Avant de coder, inspecter l'architecture actuelle du repository et adapter cette proposition aux structures existantes plutôt que dupliquer les modèles/calculs.

---

# Critères de validation V1

La V1 est considérée fonctionnelle si :

1. un GPX peut être importé ;
2. le mode BCF peut être activé ;
3. une date de course peut être définie ;
4. START et FINISH peuvent être positionnés ;
5. Sprint / Grimpeur / Flandrien peuvent être créés ;
6. les segments apparaissent correctement sur carte et profil ;
7. les statistiques de la course sont recalculées entre START et FINISH ;
8. un GPX enrichi peut être exporté puis réimporté ;
9. un FIT Garmin avec Course Points peut être généré ;
10. une alerte située par défaut 500 m avant chaque segment est créée ;
11. les segments BCF ne sont pas affectés par le changement du détecteur automatique de montées ;
12. changer le mode de détection des montées après import déclenche correctement le recalcul des seules montées automatiques.