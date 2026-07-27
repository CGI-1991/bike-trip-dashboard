# CDC — Dashboard RGA 2026
## Version consolidée après mise en place de l’environnement, de l’interface, des GPX et du moteur d’itinéraire

---

## 0. Statut du document

Ce document remplace les versions antérieures du cahier des charges.

Il constitue la référence fonctionnelle et technique du projet `rga-2026-dashboard` pour Codex, Claude Code et toute intervention manuelle ultérieure.

Les décisions prises pendant le développement priment sur les hypothèses initiales devenues obsolètes.

### Décisions désormais figées

- Le voyage comporte **12 jours calendaires**.
- Il comporte **10 journées roulées** et **2 journées OFF**.
- Les journées OFF sont intégrées dans la chronologie du voyage :
  - **J5 — OFF à Bourg-Saint-Maurice** ;
  - **J8 — OFF à Briançon**.
- Les 10 journées roulées correspondent aux 10 fichiers GPX réels déjà fournis.
- Il ne faut plus parler de 8 étapes.
- La destination finale de la version RGA 2026 est **Nice**, pas Menton.
- Les fichiers GPX constituent la source géométrique de référence.
- Le roadbook constitue la source métier de référence pour les journées, les noms, les cols, les passages, les ravitaillements, les notes et les jours OFF.
- Les statistiques GPX calculées peuvent différer des statistiques éditoriales du roadbook, notamment pour le D+ et le D−. Les deux valeurs doivent rester distinguables et leur origine documentée.

---

# 1. Objet

Développer une application web mobile-first, rapide, gratuite et autonome servant de tableau de bord de voyage pour la Route des Grandes Alpes 2026.

La météo reste la fonction principale. L’application doit transformer les prévisions disponibles le long de chaque journée roulée en informations immédiatement exploitables pendant une itinérance à vélo.

L’application doit également structurer le voyage complet : journées roulées, journées OFF, progression, heures estimées de passage, cols, villages, ravitaillements, alertes et accès aux informations pratiques.

Elle est destinée à deux personnes et utilisée principalement sur iPhone via un lien web, avec possibilité d’ajout à l’écran d’accueil.

La priorité absolue est la RGA 2026. L’architecture doit rester suffisamment claire pour permettre une généralisation future, sans transformer la V1 en moteur universel.

---

# 2. Chronologie de référence du voyage

Le voyage comprend **12 jours calendaires**, dans l’ordre suivant.

| Jour | Type | Parcours / lieu | Source GPX |
|---:|---|---|---|
| J1 | Roulé | Thonon-les-Bains → Morzine | GPX 01 |
| J2 | Roulé | Morzine → Le Grand-Bornand | GPX 02 |
| J3 | Roulé | Le Grand-Bornand → Beaufort-sur-Doron | GPX 03 |
| J4 | Roulé | Beaufort-sur-Doron → Bourg-Saint-Maurice | GPX 04 |
| J5 | OFF | Bourg-Saint-Maurice | aucun GPX |
| J6 | Roulé | Bourg-Saint-Maurice → Val-Cenis | GPX 05 |
| J7 | Roulé | Val-Cenis → Briançon | GPX 06 |
| J8 | OFF | Briançon | aucun GPX |
| J9 | Roulé | Briançon → Barcelonnette | GPX 07 |
| J10 | Roulé | Barcelonnette → Saint-Étienne-de-Tinée, variante Bonette | GPX 08 |
| J11 | Roulé | Saint-Étienne-de-Tinée → Saint-Martin-Vésubie, variante | GPX 09 |
| J12 | Roulé | Saint-Martin-Vésubie → Nice | GPX 10 |

## 2.1 Conséquences fonctionnelles

- Une journée OFF est une vraie journée du voyage.
- Elle doit apparaître dans les vues Aujourd’hui et Voyage.
- Elle ne possède ni GPX, ni distance roulée, ni ETA cycliste.
- Elle peut posséder : lieu, hébergement, météo locale, checklist, activités, services et notes logistiques.
- Le lendemain d’une journée OFF, les horaires repartent du nouvel horaire de départ configuré ; aucun temps de roulage ne traverse une nuit ou une journée OFF.
- Les numéros GPX et les numéros de jours ne coïncident plus après J4 : GPX 05 correspond à J6, GPX 06 à J7, GPX 07 à J9, etc.

---

# 3. Objectifs utilisateur

## 3.1 Avant le voyage

Obtenir une vue synthétique de l’ensemble des 12 jours :

- distinction claire entre journée roulée et journée OFF ;
- température minimale et maximale par jour ;
- précipitations ;
- vent moyen et rafales ;
- risques météo significatifs ;
- niveau de confiance ou disponibilité de la prévision ;
- cols, secteurs exposés et journées longues ;
- principales informations logistiques des jours OFF.

L’application informe. Elle ne décide pas des bagages ni des vêtements.

## 3.2 Chaque matin d’une journée roulée

Permettre de comprendre rapidement :

- si l’horaire de départ reste adapté ;
- si un départ avancé ou différé réduit un risque ;
- quels cols ou secteurs sont exposés ;
- les heures estimées aux points clés ;
- la météo attendue à ces heures ;
- les principaux points de ravitaillement ;
- la durée estimée de roulage et de pauses ;
- l’heure d’arrivée estimée.

## 3.3 Chaque matin d’une journée OFF

Afficher :

- lieu de la journée OFF ;
- météo locale ;
- récupération et logistique prévues ;
- check vélo ;
- courses, lessive ou activités éventuelles ;
- aperçu de la journée roulée suivante.

## 3.4 Pendant une journée roulée

Permettre de modifier discrètement :

- l’heure réelle de départ ;
- la vitesse moyenne de base ;
- les durées de pauses ;
- éventuellement le profil prudent / normal ;
- éventuellement la journée active.

Après modification, les ETA et la météo associée doivent être recalculées.

---

# 4. Périmètre V1

## 4.1 Inclus

- application web statique ;
- interface française ;
- mobile-first, iPhone prioritaire ;
- fonctionnement desktop ;
- déploiement GitHub Pages ;
- 12 jours de voyage préconfigurés ;
- 10 GPX réels ;
- 2 journées OFF intercalées ;
- parsing GPX côté navigateur ;
- données statiques du roadbook ;
- moteur d’itinéraire ;
- ETA par journée roulée ;
- points clés ;
- météo réelle via Open-Meteo ;
- vue Aujourd’hui ;
- vue Voyage ;
- détail d’une journée ;
- alertes contextualisées ;
- réglages persistants ;
- carte légère ou lien cartographique ;
- actualisation à l’ouverture et manuelle ;
- cache local du dernier résultat valide ;
- aucun compte ;
- aucun backend ;
- aucune notification push.

## 4.2 Hors périmètre V1

- import GPX universel depuis l’interface ;
- éditeur complet d’itinéraire ;
- synchronisation multi-appareils ;
- comptes utilisateurs ;
- notifications ;
- backend ;
- base de données distante ;
- application native ;
- recommandations automatiques de bagages ;
- moteur physiologique avancé ;
- navigation turn-by-turn ;
- remplacement d’un GPS vélo.

---

# 5. État technique déjà réalisé

Le projet dispose déjà des éléments suivants :

- dépôt GitHub public `CGI-1991/rga-2026-dashboard` ;
- projet Vite Vanilla TypeScript ;
- TypeScript strict ;
- Node portable fonctionnel ;
- compatibilité lecteur réseau Windows avec watcher Vite en polling ;
- compatibilité certificats d’entreprise via `NODE_USE_SYSTEM_CA=1` ;
- workflow GitHub Pages ;
- base Vite configurée sur `/rga-2026-dashboard/` ;
- interface mobile-first initiale ;
- réglages avec `localStorage` ;
- 10 GPX placés sous `public/data/gpx/` ;
- manifeste GPX statique ;
- parser GPX sans dépendance externe ;
- analyse des 10 traces ;
- moteur d’itinéraire initial avec correction de vitesse selon la pente ;
- waypoints automatiques ;
- build et serveur local fonctionnels.

Toute nouvelle intervention doit préserver ces acquis sauf demande explicite.

---

# 6. Sources et hiérarchie des données

## 6.1 Sources

1. **GPX découpés 01 à 10** : géométrie et profil altimétrique.
2. **Roadbook RGA** : ordre des journées, jours OFF, noms, cols, villages, ravitaillements, notes et logique du voyage.
3. **GPX global** : contrôle de continuité éventuel.
4. **Google My Maps / POI** : enrichissement secondaire.

## 6.2 Hiérarchie de confiance

- Coordonnées et tracé : GPX.
- Ordre des 12 jours : roadbook.
- Correspondance journée ↔ GPX : table explicite du présent CDC.
- Noms des lieux et points clés : roadbook, puis validation géographique.
- Distance : valeur GPX calculée comme valeur technique principale, valeur roadbook conservée comme référence éditoriale si utile.
- D+ / D− : valeur GPX calculée avec méthode documentée ; ne pas remplacer silencieusement par une autre valeur.
- Jours OFF : roadbook, jamais déduits des GPX.

## 6.3 Aucune invention silencieuse

- Ne jamais inventer de coordonnées.
- Ne jamais faire correspondre un POI à un tracé sans contrôle de distance.
- Ne jamais transformer une journée OFF en étape roulée.
- Ne jamais fusionner ou supprimer des journées sans décision explicite.

---

# 7. Modèle de données du voyage

## 7.1 Entité principale

Le modèle principal est un `TripPlan` contenant exactement 12 `TripDay` ordonnés.

```ts
type TripDayType = 'ride' | 'off';

interface TripPlan {
  id: string;
  name: string;
  timezone: 'Europe/Paris';
  totalDays: 12;
  rideDays: 10;
  offDays: 2;
  days: TripDay[];
}
```

## 7.2 Journée roulée

```ts
interface RideDay {
  id: 'J1' | 'J2' | 'J3' | 'J4' | 'J6' | 'J7' | 'J9' | 'J10' | 'J11' | 'J12';
  dayNumber: number;
  type: 'ride';
  gpxNumber: number;
  gpxFile: string;
  name: string;
  startName: string;
  endName: string;
  variant?: string;
  roadbookStats?: {
    distanceKm?: number;
    elevationGainM?: number;
    elevationLossM?: number;
  };
  cols: RoadbookPoint[];
  resupplyPoints: RoadbookPoint[];
  notes: string[];
}
```

## 7.3 Journée OFF

```ts
interface OffDay {
  id: 'J5' | 'J8';
  dayNumber: 5 | 8;
  type: 'off';
  locationName: string;
  title: string;
  logistics: string[];
  activities: string[];
  notes: string[];
  nextRideDayId: string;
}
```

## 7.4 Point du roadbook

```ts
interface RoadbookPoint {
  id: string;
  type: 'start' | 'end' | 'col' | 'summit' | 'village' | 'resupply' | 'shelter' | 'lodging' | 'poi';
  name: string;
  elevationM?: number;
  latitude?: number;
  longitude?: number;
  matchedTrackDistanceKm?: number;
  matchDistanceM?: number;
  source: 'roadbook' | 'gpx' | 'manual';
  status: 'matched' | 'unmatched' | 'needs-review';
}
```

---

# 8. Données GPX

## 8.1 Fichiers

Les 10 GPX restent des ressources statiques dans :

```text
public/data/gpx/
```

Le catalogue reste externe au TypeScript :

```text
public/data/gpx/manifest.json
```

## 8.2 Parsing

Le parser doit continuer à gérer :

- namespaces GPX ;
- `trk`, `trkseg`, `trkpt`, `ele` ;
- plusieurs segments ;
- altitudes manquantes ponctuelles ;
- erreurs isolées par fichier ;
- calcul Haversine ;
- ordre numérique robuste.

## 8.3 Dénivelé

Les D+ et D− bruts sont sensibles au bruit altimétrique.

La V1 peut conserver les valeurs brutes pour transparence, mais doit prévoir une méthode de lissage documentée pour les valeurs affichées au grand public.

Toute méthode de lissage doit :

- être centralisée ;
- être testable ;
- ne jamais remplacer silencieusement les données brutes ;
- permettre d’afficher ou journaliser les deux valeurs.

---

# 9. Moteur d’itinéraire et ETA

## 9.1 Principe fondamental

Le calcul se fait **séparément pour chaque journée roulée**.

Il est interdit de produire une chronologie continue sur plusieurs jours comme si les cyclistes roulaient sans dormir.

Chaque journée roulée :

- commence à son horaire de départ ;
- applique ses pauses ;
- se termine à son ETA d’arrivée ;
- ne transmet aucun temps écoulé à la journée suivante.

Les journées OFF interrompent explicitement la séquence de roulage.

## 9.2 Paramètres

- heure de départ ;
- vitesse moyenne de base ;
- profil altimétrique ;
- pente locale lissée ;
- pauses ;
- mode prudent / normal éventuel ;
- plafonds de vitesse.

## 9.3 Modèle de vitesse initial existant

Le moteur utilise actuellement des coefficients de pente centralisés.

Ils peuvent rester comme base provisoire, mais doivent être calibrables et documentés.

Les coefficients ne doivent pas être dispersés dans l’interface.

## 9.4 Pauses

Valeurs actuelles de l’interface :

- vitesse moyenne : 18 km/h ;
- départ : 08:00 ;
- pauses totales : 60 min.

Cible fonctionnelle détaillée du CDC :

- pause avant midi : 15 min ;
- pause midi : 30 min ;
- pause après midi : 15 min.

La transition peut être progressive. Les données de stockage existantes doivent être migrées sans casser les réglages utilisateurs.

Les pauses doivent à terme être rattachées à des lieux réels ou points clés, pas uniquement à 25 %, 50 % et 75 % du parcours.

## 9.5 Waypoints

Les 41 000 points GPX ne doivent pas tous devenir des points météo.

Le moteur produit un ensemble réduit et ordonné :

- départ ;
- arrivée ;
- cols et sommets réels ;
- villages et ravitaillements importants ;
- points de pause ;
- repères temporels automatiques ;
- changements de pente utiles ;
- points météo.

La cible n’est pas un nombre fixe. La lisibilité et la pertinence priment.

---

# 10. Roadbook métier

## 10.1 Données à intégrer

Pour chaque journée roulée :

- texte court d’ambiance ;
- cols ;
- altitude des cols ;
- villages et passages ;
- ravitaillements ;
- notes terrain ;
- hébergements ou liens éventuels ;
- variante si applicable.

Pour les journées OFF :

- lieu ;
- récupération ;
- lessive ;
- courses ;
- check vélo ;
- activités possibles ;
- aperçu de la prochaine étape.

## 10.2 Appariement au tracé

Les points du roadbook doivent être appariés au GPX avec une méthode explicite :

1. coordonnées connues et validées ;
2. projection sur le point ou segment GPX le plus proche ;
3. conservation de la distance d’appariement ;
4. statut `matched`, `needs-review` ou `unmatched` ;
5. aucun appariement automatique au-delà d’un seuil raisonnable sans validation.

---

# 11. Météo

## 11.1 Fournisseur

Open-Meteo est le fournisseur principal.

Le fournisseur doit être isolé derrière une interface afin de pouvoir évoluer.

## 11.2 Variables utiles

Selon disponibilité :

- température ;
- température ressentie ;
- précipitations ;
- probabilité de précipitation ;
- pluie ;
- neige ;
- code météo ;
- couverture nuageuse ;
- vent ;
- rafales ;
- visibilité ;
- humidité ;
- isotherme 0 °C ou équivalent ;
- indicateurs d’orage.

## 11.3 Association ETA / météo

Pour une journée roulée :

- calculer l’ETA du waypoint ;
- sélectionner l’heure météo pertinente ;
- conserver le décalage temporel entre ETA et donnée choisie ;
- afficher clairement les données indisponibles.

Pour une journée OFF :

- utiliser une ou plusieurs coordonnées locales ;
- afficher une météo journalière et éventuellement horaire simplifiée ;
- ne pas produire d’ETA cycliste.

## 11.4 Actualisation et cache

- actualiser à l’ouverture ;
- bouton manuel ;
- date et heure de dernière mise à jour ;
- cache local court ;
- dernier résultat valide conservé ;
- erreur réseau non bloquante ;
- aucune météo inventée au-delà de l’horizon disponible.

---

# 12. Alertes contextualisées

## 12.1 Niveaux

- vert : conditions normales ;
- orange : adaptation utile ;
- rouge : risque important.

## 12.2 Cas

- orage pendant une montée ou au sommet ;
- pluie avant ou pendant une descente ;
- froid au sommet ;
- pluie + froid + vent ;
- rafales sur un col ;
- chaleur en vallée ;
- brouillard ;
- neige ou gel ;
- fenêtre plus favorable avec départ avancé ou différé.

Les messages doivent rester concis, informatifs et non alarmistes.

---

# 13. Vues et navigation

## 13.1 Navigation cible

- Aujourd’hui ;
- Voyage ;
- Carte ;
- Réglages.

## 13.2 Vue Aujourd’hui — journée roulée

- jour calendrier, par exemple J6 ;
- type `Roulé` ;
- départ et arrivée ;
- distance ;
- D+ ;
- heure de départ ;
- ETA ;
- résumé météo ;
- prochain point clé ;
- principaux cols ;
- alertes ;
- actualisation.

## 13.3 Vue Aujourd’hui — journée OFF

- jour calendrier, par exemple J5 ;
- type `OFF` ;
- lieu ;
- météo locale ;
- checklist logistique ;
- activités ;
- aperçu de la journée suivante ;
- aucun faux kilométrage ni faux ETA.

## 13.4 Vue Voyage

Afficher les 12 jours dans l’ordre.

Chaque ligne doit distinguer clairement :

- journée roulée ;
- journée OFF ;
- jour actif ;
- météo disponible ou non ;
- principaux risques.

Les journées roulées affichent distance et D+.

Les journées OFF affichent le lieu et le type de journée.

## 13.5 Détail journée roulée

- résumé ;
- distance, D+, D− ;
- départ et ETA ;
- profil ;
- chronologie ;
- cols ;
- villages ;
- ravitaillements ;
- météo par point clé ;
- alertes ;
- carte.

## 13.6 Détail journée OFF

- météo locale ;
- logistique ;
- récupération ;
- check vélo ;
- activités ;
- hébergement ;
- aperçu du lendemain.

## 13.7 Carte

V1 légère :

- tracé de la journée roulée ;
- points clés ;
- POI ;
- aucun tracé pour une journée OFF ;
- lien My Maps possible.

---

# 14. Réglages et stockage local

## 14.1 Réglages V1

- journée active ;
- heure de départ ;
- vitesse moyenne de base ;
- pauses ;
- éventuellement mode prudent / normal ;
- réinitialisation.

## 14.2 Persistance

Utiliser `localStorage` pour :

- réglages ;
- journée active ;
- dernier résultat météo valide ;
- dernière mise à jour ;
- préférences d’affichage.

Prévoir une version du schéma de stockage et une migration minimale pour éviter de casser les données existantes.

---

# 15. UX

## 15.1 Principes

- mobile-first ;
- lisible en quelques secondes ;
- peu d’actions ;
- pas de grands espaces inutiles ;
- pas d’emoji obligatoires ;
- contraste suffisant ;
- cibles tactiles adaptées ;
- réglages discrets ;
- états de chargement et d’erreur clairs.

## 15.2 Données de démonstration

Les données fictives doivent disparaître progressivement.

Toute donnée encore fictive doit être explicitement marquée comme telle.

La cible est zéro donnée fictive dans la V1 publiée.

---

# 16. Architecture technique

## 16.1 Stack

- Vite ;
- TypeScript strict ;
- HTML ;
- CSS local ;
- modules natifs ;
- pas de React ;
- pas de backend ;
- pas de dépendance inutile.

Leaflet peut être ajouté plus tard pour la carte si justifié.

## 16.2 Organisation cible indicative

```text
public/
  data/
    gpx/
      manifest.json
      *.gpx
    trip/
      trip.json
      roadbook.json
src/
  data/
  gpx/
  route/
  trip/
  weather/
  alerts/
  storage/
  ui/
  main.ts
```

L’organisation réelle peut différer si elle reste cohérente.

## 16.3 GitHub Pages

- dépôt : `rga-2026-dashboard` ;
- base Vite : `/rga-2026-dashboard/` ;
- déploiement automatique à chaque push sur `main` ;
- URL attendue : `https://cgi-1991.github.io/rga-2026-dashboard/`.

---

# 17. PWA

Option légère, non bloquante :

- manifest ;
- icône ;
- mode standalone ;
- cache du shell ;
- dernier aperçu disponible hors connexion.

Ne pas introduire de service worker instable avant que les fonctions métier principales soient validées.

---

# 18. Qualité et tests

## 18.1 Tests minimaux

- chargement des 10 GPX ;
- correspondance exacte 10 GPX ↔ 10 journées roulées ;
- présence exacte de J5 et J8 en OFF ;
- ordre exact des 12 jours ;
- aucune ETA sur une journée OFF ;
- remise à zéro des horaires à chaque journée roulée ;
- calcul ETA ;
- insertion des pauses ;
- waypoints ordonnés ;
- appariement roadbook / GPX ;
- météo absente ;
- API indisponible ;
- cache ;
- alertes ;
- sous-chemin GitHub Pages ;
- `localStorage` et migration ;
- affichage mobile.

## 18.2 Contrôles manuels

- iPhone portrait ;
- largeur 390 px ;
- Chrome desktop ;
- Safari mobile si disponible ;
- réseau lent ;
- hors connexion partiel ;
- changement journée active ;
- journée OFF ;
- réglages puis rechargement ;
- absence de 404 sur les ressources utiles.

---

# 19. Contraintes permanentes

- gratuit ;
- pas de clé payante ;
- pas de serveur ;
- pas de compte ;
- français ;
- unités métriques ;
- fuseau `Europe/Paris` ;
- gestion heure d’été ;
- aucun secret dans le dépôt ;
- pas de donnée inventée ;
- pas de dépendance sans justification ;
- pas de modification directe des GPX source ;
- build vert à chaque étape ;
- aucune régression GitHub Pages ;
- aucune régression de la configuration du lecteur réseau ou des certificats d’entreprise.

---

# 20. Méthode de développement

Chaque phase doit respecter le cycle :

1. lire le CDC ;
2. inspecter l’existant ;
3. modifier uniquement le périmètre demandé ;
4. lancer les validations ;
5. produire un compte rendu ;
6. ne pas commit ni push sauf demande explicite ;
7. contrôle manuel ;
8. commit logique ;
9. push ;
10. vérifier GitHub Actions.

Ne pas travailler en parallèle sur le clone local et Codespaces sans synchronisation.

Avant de changer d’environnement : commit + push.

Dans l’autre environnement : pull ou recréation du Codespace depuis `main`.

---

# 21. Phases restantes

## Phase A — Consolidation voyage

- remplacer la notion erronée de 8 étapes ;
- créer le plan de voyage à 12 jours ;
- intégrer les 2 journées OFF ;
- relier chaque journée roulée à son GPX ;
- réinitialiser les ETA par journée ;
- afficher les 12 jours.

## Phase B — Enrichissement roadbook

- cols ;
- villages ;
- ravitaillements ;
- notes ;
- appariement au tracé ;
- rapport des points à valider.

## Phase C — Météo

- Open-Meteo ;
- cache ;
- météo par waypoint ;
- météo des journées OFF ;
- mise à jour et erreurs.

## Phase D — Alertes

- seuils ;
- contexte relief / ETA ;
- comparaison des horaires de départ.

## Phase E — UI finale

- navigation complète ;
- vue Aujourd’hui ;
- Voyage ;
- détail ;
- réglages détaillés ;
- suppression des données fictives.

## Phase F — Carte, POI et PWA

- carte ;
- POI ;
- My Maps ;
- PWA légère ;
- tests finaux.

---

# 22. Définition de terminé pour la V1

La V1 est terminée lorsque :

- l’URL GitHub Pages fonctionne ;
- les 12 jours sont présents dans le bon ordre ;
- J5 et J8 sont des journées OFF ;
- les 10 journées roulées chargent leur GPX correct ;
- aucune chronologie de roulage ne traverse les nuits ou jours OFF ;
- l’ETA est calculée par journée ;
- les réglages recalculent les ETA ;
- la météo se charge ;
- les points clés sont enrichis par le roadbook ;
- les alertes sont visibles ;
- les journées OFF ont une vue adaptée ;
- l’échec de l’API ne casse pas l’application ;
- l’application fonctionne sur iPhone ;
- aucune donnée de démonstration non signalée ne subsiste ;
- le README permet de relancer et déployer le projet.

---

# 23. Consignes permanentes pour l’IA de développement

- Lire intégralement ce CDC avant chaque intervention.
- Ne jamais réintroduire la notion de 8 étapes.
- Toujours raisonner en 12 jours : 10 roulés + 2 OFF.
- Respecter J5 OFF à Bourg-Saint-Maurice et J8 OFF à Briançon.
- Respecter l’arrivée finale à Nice.
- Ne jamais calculer une ETA cycliste pour une journée OFF.
- Ne jamais maintenir une chronologie continue sur plusieurs jours.
- Signaler toute hypothèse.
- Ne pas inventer de coordonnées.
- Conserver les GPX sources inchangés.
- Préserver TypeScript strict, GitHub Pages, le polling Vite et `NODE_USE_SYSTEM_CA`.
- Ne pas ajouter de dépendance sans justification.
- Ne pas créer de backend.
- Lancer `npm run build` à la fin.
- Ne pas commit ni push sans instruction explicite.
