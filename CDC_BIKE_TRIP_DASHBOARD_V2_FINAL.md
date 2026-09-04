# Cahier des charges — Bike Trip Dashboard

**Projet :** `CGI-1991/bike-trip-dashboard`  
**Statut :** source de vérité produit et fonctionnelle  
**Version :** 2.0 — consolidation finale  
**Date :** 3 septembre 2026  
**Application de référence historique :** RGA 2026  
**Langue de l’interface :** français  
**Priorité UX :** mobile / iPhone, puis desktop  

---

# 0. Statut documentaire et hiérarchie des sources

Ce document remplace le CDC historique du 30 juillet 2026 comme **source de vérité principale** du projet.

Il consolide les décisions fonctionnelles, UX et techniques prises pendant les jalons successifs R1, R2, R2.1, R3, RC2 et le closeout final.

## 0.1. Hiérarchie de confiance

En cas de contradiction :

1. **ce fichier `CDC.md` actualisé** ;
2. les tests de non-régression et fixtures validés ;
3. le comportement explicitement validé sur le terrain ;
4. le code actuel ;
5. les anciens prompts, annexes, commentaires de jalons et documents historiques.

Les documents plus anciens peuvent être utiles pour comprendre l’historique, mais **ne doivent jamais réintroduire une règle contredite par ce CDC**.

En particulier :

- `docs/ANNEXE_CDC_Import_GPX_MultiVoyages_2026-08-03.md` devient une **archive historique** ;
- les références anciennes du type `CDC section X`, `C2.5`, `R2.1`, `DER-DES-DER`, etc. dans les commentaires du code sont des traces d’implémentation, pas une autorité fonctionnelle supérieure ;
- toute règle ancienne autorisant une pause synthétique temporaire, un fallback `Service`, un Postpass relancé automatiquement à chaque ouverture, ou un Retry utilisateur comme mécanisme normal de fonctionnement est **obsolète**.

## 0.2. Principe général

Le produit doit viser :

> **moins visible ≠ moins fonctionnel**

L’application doit conserver sa richesse fonctionnelle tout en réduisant le bruit, les états techniques visibles, les choix inutiles et les mécanismes internes exposés.

---

# 1. Objet du produit

Créer une PWA locale, multi-voyages, capable de préparer et consulter un voyage à vélo à partir d’un ou plusieurs fichiers GPX.

L’application doit :

- fonctionner sans compte utilisateur ;
- fonctionner sans backend applicatif ;
- stocker les voyages localement ;
- fonctionner hors ligne après préparation ;
- enrichir le parcours à partir de sources externes quand elles sont disponibles ;
- conserver les GPX originaux inchangés ;
- générer les profils, montées, horaires et pauses localement ;
- gérer les journées roulées, OFF et Transfert ;
- offrir une lecture terrain simple et fiable ;
- conserver la RGA 2026 comme cas de référence de non-régression.

---

# 2. Périmètre fonctionnel

## 2.1. Inclus

- import d’un ou plusieurs GPX ;
- un GPX = une étape par défaut ;
- multi-voyages ;
- structure Ride / OFF / Transfert ;
- profil altimétrique ;
- détection de montées ;
- détection et nommage de cols ;
- départs / arrivées ;
- villes / villages / localités ;
- timing, ETA et durée ;
- budget de pauses ;
- pauses automatiques et manuelles ;
- météo ;
- comparaison de scénarios d’heure de départ ;
- alertes météo contextualisées ;
- POI pratiques ;
- carte Aperçu ;
- carte Étape plein écran ;
- GPS `Vous êtes ici` ;
- itinéraire Google Maps depuis un POI ou un Transfert ;
- logement / réservation / billet / notes ;
- OFF consécutifs ;
- transferts simples et multiples ;
- téléchargement du GPX original ;
- fonctionnement offline ;
- PWA ;
- export / sauvegarde si déjà prévu par l’application ;
- modification du voyage après création ;
- recalcul manuel avancé des données enrichies.

## 2.2. Hors périmètre

Ne pas développer dans cette version :

- navigation turn-by-turn ;
- activity tracking ;
- historique GPS ;
- ETA recalculée en continu depuis le GPS ;
- cloud sync ;
- comptes ;
- social ;
- notifications push ;
- backend applicatif ;
- transport public temps réel ;
- réservation intégrée ;
- moteur randonnée ;
- road-trip voiture générique ;
- généralisation multimodale profonde ;
- MBTiles ;
- téléchargement massif de tuiles offline ;
- IA opaque de recommandation ;
- nouvelle taxonomie POI ;
- nouvelle architecture framework ;
- refonte visuelle globale.

---

# 3. Stack et architecture

Conserver :

- TypeScript strict ;
- Vite ;
- PWA ;
- IndexedDB ;
- service worker unique ;
- Leaflet pour la cartographie ;
- HTML/CSS locaux ;
- GitHub Pages ;
- application sans backend ;
- fonctionnement mobile-first.

Le modèle de données principal reste `TripBundle`.

Le projet doit rester local-first.

---

# 4. Modèle conceptuel

```text
TripBundle
├── metadata
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

## 4.1. Types de jours

```text
ride
off
transfer
```

### Ride

Déplacement déterminé par le GPX.

### Transfer

Déplacement explicite entre une origine et une destination.

### OFF

Aucun déplacement. Le voyage reste au même endroit.

---

# 5. Sources de vérité des données

## 5.1. Géométrie

Le GPX original est la source de vérité pour :

- départ ;
- arrivée ;
- géométrie ;
- profil ;
- distance projetée ;
- position sur la trace.

## 5.2. Données utilisateur

Les données manuelles ont priorité sur toute régénération automatique :

- notes ;
- logements ;
- liens ;
- réservations ;
- heures ;
- pauses custom ;
- overrides ;
- localisation explicitement corrigée.

## 5.3. Enrichissements

Les enrichissements automatiques doivent conserver :

- provider ;
- date ;
- engineVersion ;
- provenance ;
- état de complétion ;
- fingerprint de route si pertinent.

## 5.4. IndexedDB

IndexedDB est la source de vérité locale pour le voyage préparé.

`localStorage` reste limité aux préférences légères et à l’identification du voyage actif.

---

# 6. Création d’un voyage

Le flux standard commence par **Créer un voyage**.

L’utilisateur peut :

- saisir le nom ;
- saisir la date de départ ;
- définir la vitesse de référence ;
- ajouter un ou plusieurs GPX ;
- les réordonner ;
- insérer des OFF ;
- insérer des Transferts ;
- choisir le terrain `Normal` ou `Montagne`.

Le système peut faire une pré-analyse locale pour afficher :

- nom du fichier ;
- validité ;
- distance ;
- D+ ;
- D− ;
- continuité ;
- doublons éventuels.

---

# 7. Import local — Phase 0

L’import est local et atomique.

Il doit :

1. lire les GPX ;
2. valider ;
3. parser ;
4. conserver les fichiers originaux ;
5. construire la géométrie ;
6. calculer distance / D+ / D− ;
7. générer le profil ;
8. détecter les montées ;
9. calculer le timing roulant ;
10. calculer le **budget total de pauses** ;
11. construire Ride / OFF / Transfert ;
12. construire le `TripBundle` ;
13. valider ;
14. sauvegarder dans IndexedDB.

## 7.1. Règle fondamentale sur les pauses

À l’import :

> **le budget de pauses peut être calculé, mais aucune pause automatique ne doit encore être placée.**

Exemple :

```text
budgetPause = 75 min
```

est valide.

En revanche, il ne doit pas exister à ce stade :

- `Pause du matin` ;
- `Pause principale` ;
- `Pause de l’après-midi` ;
- waypoint `pause` synthétique ;
- `Service` ;
- `waypointId = null` utilisé comme vraie pause utilisateur.

---

# 8. Budget de pauses et plan de pauses

Séparer explicitement deux concepts.

## 8.1. Budget

Combien de minutes de pause sont raisonnables pour l’étape.

Il dépend notamment de :

- distance ;
- durée estimée ;
- difficulté ;
- D+.

Il est calculable localement.

## 8.2. Plan

Où ont lieu les pauses et combien de minutes sur chaque lieu.

Le plan automatique ne peut être finalisé qu’après enrichissement géographique et pratique suffisant.

Durées :

- toujours multiples de 5 minutes.

---

# 9. Ouverture d’un voyage

Au clic **Ouvrir** :

1. le voyage devient actif ;
2. Aperçu s’affiche immédiatement depuis les données locales ;
3. l’enrichissement automatique démarre ensuite en arrière-plan si nécessaire.

Une étape reste ouvrable dès que son core local est valide.

Aucune donnée externe ne doit bloquer :

- Aperçu ;
- Voyage ;
- Étape ;
- profil ;
- GPX ;
- timing local.

---

# 10. Orchestration d’enrichissement — ordre métier

L’ordre cible est :

```text
PHASE 0 — Import local
PHASE 1 — Départs / arrivées globaux
PHASE 2 — Structure géographique globale
PHASE 3 — Météo en parallèle
PHASE 4 — POI de E1
PHASE 5 — Pauses de E1
→ E1 finalisée
PHASE 4 — POI de E2
PHASE 5 — Pauses de E2
→ E2 finalisée
...
```

La météo fonctionne en parallèle dès que possible et n’est jamais bloquante.

---

# 11. Phase 1 — Départs / arrivées

Pour toutes les étapes roulées, dans l’ordre chronologique :

```text
E1
E2
E3
...
```

faire le reverse-geocoding du premier et du dernier point GPX.

Résultat :

- `startLocationName` ;
- `endLocationName`.

Après la passe globale :

- sauvegarde ;
- reconciliation / refresh contrôlé.

Ne pas reconstruire toute l’interface à chaque réponse réseau.

---

# 12. Phase 2 — Structure géographique

Après les endpoints, enrichir toutes les étapes avec :

- `city` ;
- `town` ;
- `village` ;
- `mountain-pass` ;
- `saddle`.

Puis :

- projeter sur le GPX ;
- filtrer par distance à la trace ;
- dédupliquer ;
- associer les cols aux montées ;
- renommer une montée générique si un col cohérent est trouvé.

Une montée valide sans col peut rester :

```text
Montée
```

ou conserver son nom générique.

Elle ne doit pas être masquée uniquement parce qu’aucun col n’a été trouvé.

---

# 13. Affichage structurel

Hiérarchie utilisateur :

1. cols nommés ;
2. montées génériques ;
3. villes / villages.

Les villes et villages sont secondaires et peuvent être affichés via le niveau `Détail` / calque existant.

Ne pas saturer la carte par défaut.

---

# 14. Robustesse Postpass — principe

L’application ne doit plus traiter :

> « tentative terminée »

comme synonyme de :

> « enrichissement réussi ».

Un enrichissement est complet uniquement lorsque toutes les unités nécessaires ont réellement obtenu un résultat valide ou un résultat vide confirmé.

## 14.1. États de micro-job

Conceptuellement :

```text
pending
running
success
empty
waiting-for-network
```

Un timeout n’est pas un état final réussi.

## 14.2. Une étape n’est structurellement complète que si

tous ses micro-jobs structurants sont :

```text
success
ou
empty
```

Tant que ce n’est pas le cas :

- ne pas lancer la phase POI de cette étape ;
- ne pas finaliser ses pauses.

---

# 15. Longues étapes — segmentation adaptative

La longueur brute n’est pas un bon prédicteur de la difficulté d’une requête Postpass.

Une route urbaine dense de 60 km peut être beaucoup plus coûteuse qu’une route alpine de 60 km.

La stratégie cible est donc **adaptative**.

## 15.1. Taille initiale recommandée

Commencer autour de :

```text
20 km
```

par microsegment.

## 15.2. Subdivision automatique

En cas de timeout / erreur de charge :

```text
20 km
→ 10 km
→ 5 km
→ 2,5 km
```

jusqu’à un plancher raisonnable.

Un microsegment déjà réussi n’est jamais refait inutilement.

## 15.3. Recouvrement

Prévoir un léger overlap cohérent entre segments voisins pour éviter les trous aux frontières.

Les résultats sont ensuite fusionnés et dédupliqués.

## 15.4. Persistence progressive

Après chaque micro-job réussi :

- sauvegarder son résultat ;
- sauvegarder son état ;
- continuer.

Une fermeture d’app, un changement de voyage ou une perte réseau ne doit pas annuler le travail déjà acquis.

## 15.5. Reprise

Lors de la prochaine ouverture du même voyage :

- reprendre uniquement les micro-jobs encore incomplets ;
- ne jamais recommencer les unités déjà terminées.

---

# 16. Philosophie Retry

Le fonctionnement normal ne doit pas dépendre d’un bouton `Réessayer`.

L’application doit viser une reprise automatique résiliente.

Si le réseau ou Postpass est indisponible :

- conserver l’état ;
- suspendre ;
- reprendre plus tard sur le voyage actif ;
- ne pas marquer l’étape comme définitivement échouée.

Le bouton `Réessayer`, s’il subsiste temporairement pendant la transition technique, doit être considéré comme un **fallback de diagnostic**, pas comme le fonctionnement cible.

L’objectif final est de pouvoir le supprimer de l’usage normal.

---

# 17. Multi-voyages

Un seul voyage peut avoir une orchestration d’enrichissement active.

## 17.1. Changement de voyage

Si Voyage A s’enrichit et que l’utilisateur ouvre Voyage B :

1. arrêter A proprement ;
2. conserver tout ce qui est déjà persisté ;
3. ne rien rollback ;
4. démarrer B ;
5. A reprendra uniquement ses unités manquantes lors d’une prochaine ouverture.

Ne jamais enrichir A et B en parallèle.

---

# 18. Phase 3 — Météo

La météo fonctionne en parallèle.

Elle utilise :

- date ;
- heure ;
- points significatifs ;
- ETA ;
- Open-Meteo ;
- cache local.

Elle ne doit jamais bloquer l’enrichissement structurel ou pratique.

Si elle n’est pas disponible :

- le voyage reste fonctionnel ;
- les pauses restent calculables avec un signal météo neutre.

---

# 19. Météo — scénarios d’heure de départ

Pour une journée roulée, conserver exactement :

```text
-2 h
-1 h
Actuel
+1 h
+2 h
```

Le moteur peut indiquer un scénario recommandé uniquement s’il existe un gain réel.

Ne pas afficher `Recommandé` sur `Actuel` par défaut.

## 19.1. UX cible

Quand l’utilisateur ouvre **Météo** :

afficher directement :

- synthèse ;
- alertes utiles ;
- recommandation éventuelle ;
- comparaison des cinq scénarios.

Supprimer l’étape intermédiaire :

```text
Comparer les horaires
```

Il ne doit pas être nécessaire d’ouvrir un second accordéon.

---

# 20. Phase 4 — POI pratiques

Les POI sont recherchés **après la structure géographique**, et avant les pauses.

## 20.1. Règle absolue

La recherche POI ne doit jamais dépendre d’une pause automatique préexistante.

Flux correct :

```text
vrais lieux
→ POI
→ pauses
```

Jamais :

```text
pause théorique
→ POI autour
→ amélioration de la pause
```

---

# 21. Catégories POI

Exactement six catégories :

- Vélo ;
- Supermarché ;
- Boulangerie ;
- Eau ;
- Abris ;
- Toilettes.

`Essentiels` :

- Eau ;
- Supermarché ;
- Toilettes.

Ne pas ajouter de nouvelles catégories.

---

# 22. Stratégie POI

## 22.1. Corridor continu

Pour :

- Eau ;
- Abris ;
- Toilettes ;

recherche continue autour de la trace.

## 22.2. Autour de vrais anchors

Pour :

- Vélo ;
- Supermarché ;
- Boulangerie ;

rechercher autour de :

- départ ;
- arrivée ;
- villes ;
- towns ;
- villages ;
- autres points structurels pertinents.

Aucune position théorique 25/50/75 % n’est autorisée comme anchor pratique.

---

# 23. POI par étape

Après la structure globale :

```text
POI E1
→ save
→ pauses E1
→ ready E1

POI E2
→ save
→ pauses E2
→ ready E2
```

Les résultats de E1 ne doivent pas attendre E2 pour être persistés.

---

# 24. Hard gate avant pauses

Une étape ne peut calculer ses pauses automatiques qu’après :

1. structure géographique complète ;
2. POI de l’étape complets ou explicitement confirmés comme vides ;
3. météo disponible si elle l’est déjà, sinon signal neutre.

Une étape partiellement enrichie ne doit pas produire un plan de pauses final.

---

# 25. Phase 5 — pauses automatiques

Les pauses automatiques sont calculées avec le contexte complet disponible :

- distance ;
- profil ;
- D+ ;
- terrain ;
- montées ;
- cols ;
- villes ;
- villages ;
- budget de pauses ;
- heure de départ ;
- POI ;
- détours ;
- opening_hours ;
- météo si disponible.

---

# 26. Vrais lieux uniquement

Une pause automatique visible doit être liée à un vrai waypoint.

Candidats :

- city ;
- town ;
- village ;
- mountain-pass ;
- saddle.

Un POI peut améliorer le score d’un lieu, mais ne devient pas lui-même le nom géographique de la pause.

---

# 27. Suppression définitive des fallbacks synthétiques

Interdits comme résultats utilisateur :

- `Pause du matin` ;
- `Pause principale` ;
- `Pause de l’après-midi` ;
- `Service` ;
- waypoint synthétique `pause` ;
- `waypointId = null` comme pause finale.

Les slots temporels idéaux peuvent exister en interne pour le scoring, mais ne sont jamais matérialisés comme lieux.

---

# 28. Si le moteur trouve moins de pauses que prévu

Exemple :

le budget souhaiterait trois pauses, mais seulement deux vrais lieux sont pertinents.

Alors :

- créer deux pauses ;
- redistribuer raisonnablement le budget entre elles ;
- conserver des durées multiples de 5 minutes.

La qualité géographique prime sur l’égalité exacte du budget.

---

# 29. ETA, horaires d’ouverture et pauses

Pour éviter une circularité :

## Pass A

Calculer une ETA de sélection :

- heure de départ ;
- temps roulant ;
- pauses déjà consommées en amont si nécessaire.

Utiliser cette ETA pour :

- opening_hours ;
- météo ;
- scoring.

## Pass B

Choisir les pauses.

Puis recalculer :

- timeline ;
- ETA finales ;
- arrivée ;
- état d’ouverture final ;
- météo associée.

Pas de boucle itérative infinie.

---

# 30. C3 — moteur de recommandation de pauses

C3 reste :

- local ;
- déterministe ;
- explicable ;
- sans réseau.

Il intervient **après** que les données nécessaires sont disponibles.

Il peut utiliser :

- vrai lieu ;
- terrain ;
- timing ;
- montée ;
- POI ;
- ouverture ;
- météo.

C3 ne crée jamais un anchor.

Les raisons et scores restent visibles uniquement dans les surfaces dédiées aux pauses / édition, pas dans la timeline normale.

---

# 31. Pauses manuelles

L’éditeur manuel propose uniquement de vrais anchors :

- city ;
- town ;
- village ;
- mountain-pass ;
- saddle.

Une pause custom enregistrée prime toujours sur l’automatique.

Modifier seulement la durée :

- aucun Postpass ;
- recalcul local du timing.

Modifier l’anchor :

- peut déclencher un refresh POI ciblé de cette étape si nécessaire ;
- ne relance jamais le structural global.

---

# 32. Postpass one-shot

Une étape finalisée ne doit plus relancer automatiquement son enrichissement.

Ne provoquent aucun Postpass :

- ouverture de l’app ;
- Aperçu ;
- Voyage ;
- Étape ;
- fullscreen ;
- calques ;
- GPS ;
- météo ;
- changement d’heure de départ ;
- changement de durée pause ;
- Infos ;
- offline / reconnect.

---

# 33. Invalidations réelles

Une étape redevient à enrichir uniquement si :

- GPX remplacé ;
- géométrie réellement modifiée ;
- structure de l’étape modifiée ;
- action explicite `Recalculer les données du parcours`.

Le statut de complétion doit être fondé sur des fingerprints / états persistés explicites.

---

# 34. Recalcul manuel avancé

Dans :

```text
Modifier le voyage
→ Réglages avancés
```

prévoir :

```text
Recalculer les données du parcours
```

Cette action sert notamment si le voyage a été préparé longtemps à l’avance.

Elle peut rafraîchir :

- localités ;
- cols ;
- POI ;
- pauses automatiques.

Elle doit demander confirmation.

Elle ne doit pas écraser :

- pauses custom ;
- notes ;
- logement ;
- réservation ;
- transferts ;
- overrides ;
- heure de départ utilisateur.

---

# 35. Aperçu

Aperçu doit rester lisible immédiatement grâce aux données locales.

Il présente notamment :

- route globale ;
- étapes ;
- stats ;
- marqueurs structurels ;
- cols ;
- montées ;
- pauses si disponibles.

Les POI pratiques ne sont pas affichés dans Aperçu.

Les détails structurels restent activables avec le comportement `Détail` existant.

---

# 36. Carte Étape plein écran

Les POI pratiques sont visibles uniquement dans :

```text
Étape
→ carte plein écran
→ Calques
```

Le bouton d’ouverture plein écran ne doit jamais déclencher un Postpass.

La carte ouverte ne doit pas être reconstruite agressivement quand des données arrivent en arrière-plan.

Les nouveautés peuvent apparaître au prochain rendu / prochaine ouverture.

---

# 37. GPS terrain

Conserver :

- `Vous êtes ici` ;
- `watchPosition` ;
- un watcher partagé ;
- aucun historique ;
- aucune persistance de trajectoire ;
- aucun envoi au provider ;
- pas de recentrage permanent.

Z-order :

```text
route
< structural markers
< POI
< GPS
< profile marker
```

---

# 38. Profil et marqueur temporaire

Le point rouge issu du survol / interaction profil doit rester au-dessus des autres marqueurs.

Il est temporaire et ne devient pas une donnée persistée.

---

# 39. Bouton GPX

Dans l’écran Étape :

le bouton de téléchargement GPX doit être intégré au bloc :

```text
Carte + Relief
```

Graphiquement :

```text
[ Carte ]
[ Profil / Relief ]
[ Télécharger GPX                    ]
```

Le bouton prend la largeur du bloc.

Il télécharge le GPX original, inchangé.

Il doit fonctionner offline si le source file est local.

---

# 40. Écran Voyage

Voyage sert de table des matières du trip.

Les cartes doivent distinguer clairement :

- Ride ;
- OFF ;
- Transfert.

Pendant préparation :

- seule l’étape réellement active peut afficher un spinner ;
- une étape en attente reste silencieuse ;
- une étape prête reste silencieuse.

Les états techniques doivent être réduits au strict minimum.

---

# 41. Mes voyages

Un seul voyage est actif.

Pendant une préparation réelle, sa vignette peut afficher discrètement :

```text
Préparation du roadbook · N/M
```

Les autres voyages restent silencieux.

---

# 42. UX d’édition — principe général

Un seul contexte éditable / développé à la fois.

Concerne notamment :

- Météo ;
- Pauses ;
- Infos ;
- OFF ;
- Transfert ;
- petits éditeurs locaux.

---

# 43. Sortie d’un mode édition

## 43.1. Aucune modification

Clic sur autre chose :

- quitter le mode ;
- refermer le contenu ;
- poursuivre l’action.

## 43.2. Modifications non enregistrées

Afficher :

- `Enregistrer` ;
- `Abandonner` ;
- `Rester`.

### Enregistrer

- persister ;
- refermer ;
- poursuivre la navigation.

### Abandonner

- restaurer ;
- refermer ;
- poursuivre.

### Rester

- annuler la navigation ;
- conserver l’éditeur ouvert.

---

# 44. Interactions concernées

La sortie propre s’applique notamment lors de :

- Pauses → Météo ;
- Météo → Pauses ;
- Parcours → Infos ;
- Infos → Parcours ;
- précédent ;
- suivant ;
- Aperçu ;
- Voyage ;
- changement de jour ;
- retour ;
- changement d’écran.

Ne pas full-render la page uniquement pour fermer un panneau.

---

# 45. Météo — comportement d’édition

Ouvrir Météo :

- ouvre directement la synthèse et les scénarios de départ ;
- aucun sous-accordéon `Comparer les horaires`.

Appliquer un scénario :

- sauvegarder l’heure ;
- recalculer timing et météo localement ;
- refermer le panneau.

---

# 46. OFF — principe géographique

Un OFF ne déplace jamais le voyage.

Il hérite du lieu logique atteint ou à atteindre selon son contexte.

---

# 47. OFF après une Ride

```text
Ride A
→ OFF
```

OFF.location = RideA.end.

Il peut reprendre :

- logement ;
- réservation ;
- adresse ;
- notes de séjour.

---

# 48. OFF consécutifs

```text
Ride
→ OFF
→ OFF
→ OFF
```

Tous les OFF utilisent la même source logique de séjour.

Ne pas dupliquer trois objets divergents.

Une modification du logement doit rester cohérente sur la chaîne.

---

# 49. OFF au début

Cas rare mais autorisé :

```text
OFF
→ Ride1
```

Sans jour précédent, le OFF peut reprendre les informations utiles du jour suivant :

OFF.location = Ride1.start.

Même logique pour plusieurs OFF en tête.

---

# 50. OFF en fin de voyage

Cas autorisé même s’il est peu utile :

```text
RideN
→ OFF
```

OFF reprend RideN.end et le séjour associé.

---

# 51. Transfert — principe

Un Transfert représente un déplacement explicite.

Il possède :

- origine ;
- destination ;
- mode ;
- horaires ;
- durée ;
- opérateur ;
- billet ;
- réservation ;
- itinéraire ;
- éventuellement un séjour / logement propre.

---

# 52. Endpoint lié vs manuel

Chaque extrémité d’un Transfert est soit :

### Liée

Déduite de la chronologie.

- non éditable ;
- aucun picker ;
- microtexte du type `Lié à l’étape précédente`.

### Manuelle

Aucune relation fiable ne permet de la déduire.

- choix via carte ;
- reverse-geocoding automatique ;
- fallback texte si nécessaire.

---

# 53. Transfert entre deux Rides

```text
Ride A
→ Transfer
→ Ride B
```

Toujours :

- origine = RideA.end ;
- destination = RideB.start.

Les deux sont non éditables.

Cela reste vrai même si le Transfert est marqué `independent`.

Le logement du Transfert peut rester indépendant s’il est encodé.

---

# 54. Transfert avant la première Ride

```text
Transfer
→ Ride1
```

- destination = Ride1.start, non éditable ;
- origine = manuelle via picker.

---

# 55. Transfert après la dernière Ride

```text
RideN
→ Transfer
```

- origine = RideN.end, non éditable ;
- destination = manuelle via picker.

---

# 56. Transfert + OFF + Ride

```text
Transfer
→ OFF
→ Ride1
```

Le OFF ne déplace rien.

Donc :

- Transfer.destination = Ride1.start ;
- OFF.location = Transfer.destination.

Le resolver doit traverser les OFF.

---

# 57. Ride + Transfer + OFF + Ride

```text
Ride A
→ Transfer
→ OFF
→ Ride B
```

- Transfer.origin = RideA.end ;
- Transfer.destination = RideB.start ;
- OFF.location = Transfer.destination.

---

# 58. Ride + OFF + Transfer + Ride

```text
Ride A
→ OFF
→ Transfer
→ Ride B
```

- OFF.location = RideA.end ;
- Transfer.origin = RideA.end ;
- Transfer.destination = RideB.start.

---

# 59. Double Transfert avant Ride

Exemple réel :

```text
Maison
→ voiture
→ chez un ami
→ train
→ départ du voyage
```

Modèle :

```text
Transfer1
→ Transfer2
→ Ride1
```

### Transfer1

- origine manuelle ;
- destination manuelle.

### Transfer2

- origine = Transfer1.destination ;
- destination = Ride1.start.

Le point intermédiaire n’est saisi qu’une fois.

---

# 60. Double Transfert entre deux Rides

```text
RideA
→ T1
→ T2
→ RideB
```

- T1.origin = RideA.end ;
- T1.destination = handoff manuel ;
- T2.origin = T1.destination ;
- T2.destination = RideB.start.

La destination de T1 et l’origine de T2 doivent partager une seule source logique.

---

# 61. Plusieurs Transferts consécutifs

La logique doit fonctionner naturellement pour :

```text
T1
→ T2
→ T3
```

Chaque handoff intermédiaire est défini une seule fois.

Un endpoint dérivé est lecture seule.

---

# 62. Transfert indépendant sans contexte

Si aucune extrémité n’est déductible :

- origine manuelle ;
- destination manuelle.

Ne jamais inventer une relation.

---

# 63. OFF + séjour et Transfert

Un OFF après un Transfert se place à la destination du Transfert.

Si le Transfert possède un logement / séjour encodé :

le OFF peut reprendre ce séjour.

---

# 64. Présentation Transfert

Séparer visuellement :

## Trajet

- origine ;
- destination ;
- mode ;
- départ ;
- arrivée ;
- durée ;
- opérateur ;
- billet ;
- réservation transport ;
- itinéraire.

## Séjour

si pertinent :

- lieu ;
- logement ;
- adresse ;
- réservation ;
- notes.

---

# 65. Présentation OFF

OFF est principalement un séjour.

Afficher :

- lieu ;
- météo ;
- logement ;
- réservation ;
- adresse ;
- notes.

Pas de faux bloc Trajet.

---

# 66. Picker carte

Pour un endpoint manuel :

- clic/tap carte ;
- latitude/longitude ;
- marker ;
- reverse-geocoding ponctuel.

Si le provider renvoie un lieu fiable :

```text
Dijon
```

Un libellé :

```text
À proximité de Dijon
```

n’est autorisé que si les données permettent réellement de le justifier.

Sinon :

- conserver les coordonnées ;
- proposer un fallback manuel.

---

# 67. Viewport initial du picker

Si contexte voisin connu :

- centrer sur le point lié.

Exemples :

- avant prochaine étape → départ prochain GPX ;
- après précédente → arrivée précédente.

Sans contexte :

- vue globale France + Belgique minimum.

---

# 68. Google Maps — Transferts

Le bouton `Itinéraire` utilise les coordonnées réelles.

Travelmode :

- Train → transit ;
- Bus → transit ;
- Voiture → driving ;
- Taxi/Navette → driving ;
- Vélo → bicycling ;
- Ferry → aucun mode forcé ;
- Autre → aucun mode forcé.

Modifier le mode met immédiatement à jour le lien.

Le bouton n’existe que si origine et destination sont résolues.

---

# 69. Google Maps — logements / lieux

Pour un lieu ou logement, ordre de priorité :

1. URL Google Maps explicite ;
2. adresse texte ;
3. coordonnées.

Ne pas afficher de bouton vide.

---

# 70. Liens actionnables

Les données réellement actionnables doivent rester directement accessibles :

- Réservation ;
- Billet ;
- Itinéraire ;
- Logement.

Si deux liens distincts `Logement` et `Réservation` existent, afficher les deux.

S’ils sont identiques, n’en afficher qu’un.

---

# 71. Terrain

Conserver exactement :

```text
Normal
Montagne
```

Ne pas renommer.

Le mode influence les règles de filtrage des montées mais ne supprime pas une montée utile uniquement parce qu’elle n’a pas de nom.

---

# 72. Timeline Parcours

La timeline doit rester sobre.

Ne pas afficher dans la timeline normale :

- score C3 ;
- raisons de recommandation ;
- `Bon choix` ;
- `★ Recommandé` ;
- jargon technique.

Une pause y apparaît de manière compacte.

---

# 73. Cadran pause

Le cadran affiche uniquement le nombre :

```text
75
```

et non :

```text
75'
```

La notion de minutes reste disponible dans l’accessibilité (`aria-label`).

---

# 74. Alertes météo dans Étape

Dans `Étape → Parcours`, un bloc `Alertes météo` peut apparaître entre :

- Map + Relief ;
- timeline.

Il apparaît uniquement s’il existe une information météo réellement actionnable.

Pas de :

```text
Aucune alerte
```

inutile.

---

# 75. Opening hours

L’état d’ouverture d’un POI se raisonne par rapport à l’ETA.

Valeurs UX possibles :

- Ouvert ;
- Fermé ;
- Horaires inconnus.

Ne jamais inventer un horaire.

---

# 76. Offline

Après un voyage chargé en ligne, doivent rester disponibles offline autant que possible :

- app shell ;
- Mes voyages ;
- Aperçu ;
- Voyage ;
- Étape ;
- route ;
- profil ;
- montées ;
- pauses ;
- météo cached ;
- POI cached ;
- OFF ;
- Transfert ;
- notes ;
- logement ;
- réglages ;
- GPX original.

La carte de base peut perdre ses tuiles si elles ne sont pas en cache.

Ce n’est pas un blocker.

Ne pas développer de downloader de cartes offline.

---

# 77. Reconnexion

La reconnexion ne doit pas provoquer :

- reload forcé ;
- doublons de watcher GPS ;
- tempête Postpass ;
- perte de contexte ;
- recomputation de données déjà finalisées.

---

# 78. Performance

L’application doit rester fluide sur mobile.

Les warnings de bundle >500 kB peuvent être acceptés s’ils ne correspondent pas à un problème runtime démontré.

Ne pas augmenter artificiellement `chunkSizeWarningLimit` uniquement pour masquer le warning.

Le warning `vite:prepare-out-dir` est build-time et non bloquant sauf preuve contraire.

---

# 79. Stabilité des rendus

Préserver les améliorations déjà validées :

- pas de full-page refresh lors d’un enrichissement ;
- Aperçu stable ;
- Voyage stable ;
- Étape stable ;
- fullscreen stable ;
- scroll stable ;
- zoom stable ;
- accordéons stables.

Les enrichissements doivent persister en arrière-plan, puis apparaître lors d’un rendu normal si un hot-patch risquerait de perturber l’usage.

---

# 80. Accessibilité

Maintenir :

- cibles tactiles suffisantes ;
- focus visible ;
- boutons sémantiques ;
- aria-label ;
- spinner non verbeux ;
- cadran pause accessible ;
- formulaires utilisables au clavier.

---

# 81. Tests obligatoires — principes

Toute modification fonctionnelle doit couvrir :

- tests unitaires ;
- tests de pipeline ;
- tests de persistence ;
- tests de non-régression ;
- `npm test` ;
- `npx tsc --noEmit` ;
- `npm run build` ;
- `git diff --check`.

Si un flake apparaît :

- identifier sa cause ;
- préférer l’attente sur condition ;
- éviter les sleeps fixes.

---

# 82. Tests — enrichissement long trajet

Couvrir notamment :

- route courte ;
- route urbaine dense ;
- route >200 km ;
- subdivision adaptative ;
- succès partiels intermédiaires ;
- reprise après interruption ;
- absence de répétition des micro-jobs réussis ;
- déduplication entre overlaps ;
- disparition du cas `60 premiers km seulement`.

---

# 83. Tests — hard gates

Vérifier :

- structure incomplète → pas de POI final ;
- structure incomplète → pas de pauses finales ;
- POI incomplets → pas de pauses finales ;
- tout complet → pauses calculées.

---

# 84. Tests — absence de synthétique

Vérifier explicitement l’absence de :

- Pause du matin ;
- Pause principale ;
- Pause de l’après-midi ;
- Service ;
- waypoint pause synthétique ;
- pause finale sans vrai anchor.

---

# 85. Tests — one-shot

Une étape finalisée :

- reopen trip → 0 provider call ;
- open Étape → 0 provider call ;
- weather refresh → 0 Postpass ;
- heure départ → 0 Postpass ;
- durée pause → 0 Postpass ;
- Infos → 0 Postpass.

---

# 86. Tests — multi-voyages

Couvrir :

```text
A en cours
→ ouvrir B
→ A s’arrête
→ B démarre
```

Puis :

```text
retour A
→ reprise uniquement des unités manquantes
```

---

# 87. Tests — OFF / Transfert

Couvrir au minimum :

1. Ride → OFF ;
2. Ride → OFF → OFF ;
3. OFF → Ride1 ;
4. RideN → OFF ;
5. RideA → Transfer → RideB ;
6. Transfer → Ride1 ;
7. RideN → Transfer ;
8. Transfer → OFF → Ride1 ;
9. RideA → Transfer → OFF → RideB ;
10. RideA → OFF → Transfer → RideB ;
11. T1 → T2 → Ride1 ;
12. RideA → T1 → T2 → RideB ;
13. T1 → T2 → T3.

---

# 88. Tests — Maps

Couvrir :

- transit ;
- driving ;
- bicycling ;
- Ferry sans mode forcé ;
- endpoint incomplet ;
- coords exactes ;
- changement dynamique de mode.

---

# 89. Tests — météo UX

Vérifier :

- ouverture Météo → scénarios immédiatement visibles ;
- aucun accordéon `Comparer les horaires` supplémentaire ;
- recommandation uniquement si gain réel ;
- application du scénario ;
- fermeture du panneau après application.

---

# 90. Tests — édition dirty

Couvrir :

- Pauses dirty → navigation ;
- Infos dirty → navigation ;
- Enregistrer ;
- Abandonner ;
- Rester ;
- un seul panneau ouvert ;
- fermeture après save.

---

# 91. Tests — GPX

Vérifier :

- bouton dans Map + Relief ;
- pleine largeur ;
- ancien emplacement absent ;
- téléchargement original ;
- offline.

---

# 92. Méthode de développement

Pour chaque intervention :

1. lire ce CDC ;
2. inspecter le code réel ;
3. identifier les règles historiques contradictoires ;
4. ne pas supposer que les anciens commentaires sont encore vrais ;
5. modifier uniquement le périmètre demandé ;
6. ajouter/adapter les tests ;
7. lancer les validations ;
8. produire un rapport précis ;
9. ne pas merger / tagger / créer PR sans demande explicite.

---

# 93. Git / workflow

Avant développement :

```text
git status
git branch --show-current
git fetch origin --prune
git log
git diff --stat
git diff --check
```

Une branche par jalon fonctionnel.

Ne jamais supposer que `main` est le HEAD fonctionnel le plus récent.

Toujours partir du dernier commit réellement validé.

---

# 94. Critères de freeze fonctionnel

Le produit peut être considéré comme figé lorsque :

- création multi-GPX stable ;
- import local fiable ;
- endpoints fiables ;
- structure complète même sur longues routes ;
- aucune étape partiellement enrichie traitée comme complète ;
- POI fiables ;
- pauses uniquement sur vrais lieux ;
- météo et scénarios stables ;
- multi-voyages sans concurrence ;
- Postpass one-shot ;
- OFF / Transfert cohérents ;
- double transfert cohérent ;
- édition dirty cohérente ;
- offline utilisable ;
- GPS stable ;
- Maps stable ;
- GPX stable ;
- tests verts ;
- TypeScript vert ;
- build vert ;
- validation terrain iPhone réussie.

---

# 95. Dette acceptable après freeze

Acceptable si non bloquant :

- chunk >500 kB ;
- pas de fond de carte complet offline ;
- amélioration future du cache de tuiles ;
- quelques optimisations internes ;
- généralisation future vers randonnée / multimodal ;
- améliorations visuelles mineures non fonctionnelles.

Non acceptable :

- enrichissement structurel partiel considéré comme terminé ;
- pause sans vrai lieu ;
- Postpass qui abandonne définitivement un segment à cause d’un timeout ;
- relance réseau à chaque ouverture ;
- deux voyages enrichis simultanément ;
- incohérence OFF / Transfert ;
- régression terrain.

---

# 96. Consignes finales pour les agents Claude Code / Codex

Avant toute intervention :

- considérer ce CDC comme la source de vérité produit ;
- considérer les anciens prompts et annexes comme historiques ;
- ne jamais appliquer une règle ancienne qui contredit ce fichier ;
- si le code contredit ce CDC, signaler la divergence puis corriger le code ;
- si une décision n’est pas couverte ici, demander ou documenter l’hypothèse ;
- ne jamais inventer de données ;
- préserver les données manuelles ;
- préserver le GPX original ;
- préserver le local-first ;
- préserver la stabilité mobile ;
- préférer une correction causale à un patch visuel ;
- éviter les full rerenders ;
- éviter les retry storms ;
- éviter tout changement hors scope.

---

# 97. Résumé normatif du pipeline final

```text
CRÉER LE VOYAGE
↓
IMPORT LOCAL
  GPX
  profil
  montées
  timing roulant
  budget pauses
  AUCUNE PAUSE PLACÉE
↓
OUVRIR LE VOYAGE
↓
ENDPOINTS GLOBAUX
  E1...En
  complets
↓
STRUCTURE GLOBALE
  micro-jobs adaptatifs
  cols
  montées
  villes/villages
  tous réellement complets
↓
MÉTÉO EN PARALLÈLE
↓
POI E1
  micro-jobs
  complets
↓
PAUSES E1
  vrais lieux uniquement
  ETA / opening_hours / météo
↓
READY E1
↓
POI E2
↓
PAUSES E2
↓
READY E2
...
↓
VOYAGE FINALISÉ
↓
AUCUN NOUVEAU POSTPASS
sauf invalidation réelle
ou
Recalculer les données du parcours
```

---

# 98. Principe ultime

L’application ne doit jamais demander à l’utilisateur de comprendre ou réparer son pipeline d’enrichissement.

Le comportement attendu est :

> **je crée un voyage, l’application le prépare progressivement, elle n’invente rien, elle n’abandonne pas silencieusement un tronçon, elle reprend si nécessaire, et lorsqu’elle dit qu’une étape est prête, elle est réellement prête.**

---

# 99. Polish final — détection des montées adaptative

La détection de montée reste un algorithme géométrique local (profil altimétrique GPX), jamais garanti de trouver une montée simplement parce que le D+ total est élevé.

Elle devient adaptative au relief propre de CHAQUE étape (jamais celui du voyage entier) :

- une étape « montagne » (D+/km élevé) conserve exactement l’ancienne calibration — tolérance de fusion des faux-plats, profils de significativité — aucun changement de comportement ;
- une étape « mixte » ou « roulante » (D+/km plus faible) reçoit une tolérance de fusion plus stricte (pour ne pas dissoudre plusieurs ondulations réelles dans un seul faux-plat dilué) et un profil de qualification supplémentaire, calibré à l’échelle du relief local, jamais un profil « montagne » assoupli globalement.

Ne jamais fabriquer une montée pour éviter un `0`. Une route réellement plate reste à `0` montée quel que soit son D+ cumulé (le D+ peut être fait de milliers de micro-ondulations).

Non-régression obligatoire sur les grandes ascensions RGA (Galibier, Bonette, Télégraphe, Joux Plane, etc.) : verrouillée par une fixture dédiée sur les GPX RGA réels (`public/data/gpx/*.gpx`), jamais seulement synthétique.

---

# 100. Polish final — météo sur tous les points affichés

Le module météo (sample points) doit utiliser exactement le même calcul de placement automatique des pauses que l’écran Étape/Parcours (`day-detail-view.ts`) — jamais un second calcul divergent.

Concrètement : les deux consommateurs partagent la même fonction de projection POI/météo/jour-de-semaine (`analysis/waypoint-timeline.ts::buildAutomaticPauseEnrichment`) avant d’appeler le placement des pauses automatiques. Sans cela, l’écran pouvait choisir un lieu de pause (score explicable : timing + POI + météo) que le module météo ignorait (placement brut par priorité de type de lieu), laissant ce lieu affiché sans aucune météo.

Règle cible : tout waypoint effectivement affiché dans la timeline Parcours d’une Ride (départ, arrivée, cols, montées affichées, pauses, villages/localités affichés), avec coordonnées valides et ETA calculable, reçoit une météo dès que les données météo du jour sont disponibles.

---

# 101. Polish final — traçabilité des alertes météo

Une alerte météo globale actionnable doit rester traçable à un point/secteur concret de la timeline affichée. La cause principale d’une alerte « fantôme » était la même divergence qu’en section 100 (le point porteur de l’alerte n’était pas dans l’ensemble affiché) — corrigée par le même alignement des deux moteurs.

Ne jamais recopier artificiellement l’alerte globale sur tous les waypoints : seuls les points/horaires réellement concernés portent l’alerte inline.

---

# 102. Polish final — Pauses = édition directe

Le bouton/onglet `Pauses` ouvre directement la liste des vrais candidats de pause — plus de sous-bloc `Gestion automatique`, plus de bouton `Manuel` intermédiaire. L’ouverture du panneau EST l’intention d’éditer.

Enregistrer avec zéro case cochée est un état valide (`pausePlanMode: 'custom'`, liste de pauses vide) — jamais bloqué.

Le bouton `Pauses` est aussi un toggle : recliquer dessus pendant qu’il est ouvert (même avec des modifications locales non enregistrées) ferme le panneau silencieusement, sans confirmation — c’est un geste explicite d’abandon. Basculer vers un AUTRE panneau (Météo) pendant que Pauses est dirty, en revanche, déclenche la confirmation.

---

# 103. Infos = lecture puis édition (CORRIGE la version précédente de cette section)

> **Décision annulée par le hardening d'intégrité (section 109) : « Infos = édition directe » ci-dessous était une régression produit, pas une amélioration. Cette section est réécrite ; ne pas se fier à une copie antérieure de ce document.**

L'onglet/panneau `Infos` s'ouvre par défaut en **lecture seule** : notes affichées en texte simple (ou « Aucune note pour cette étape. » si vide), logement affiché en lecture (nom, adresse, référence de réservation, liens rapides Maps/site), et un bouton `Modifier` visible. Cliquer sur `Modifier` révèle le formulaire d'édition existant (mêmes champs, même picker, même logique de sauvegarde, même garde de sortie) à la place de la vue lecture.

La simple consultation (sans cliquer sur `Modifier`) n'arme JAMAIS le garde-fou d'édition — zéro contexte dirty, zéro modale de confirmation tant que `Modifier` n'a pas été cliqué explicitement.

`Annuler` dans le formulaire abandonne le brouillon local et revient à la vue lecture immédiatement, sans confirmation.

Un jour OFF/Transfert (qui n'a pas d'onglet Parcours/Infos séparé, Infos y est la seule section) suit exactement le même contrat lecture → `Modifier` → édition — il n'ouvre plus son contexte d'édition dès le rendu de l'écran.

Le contrat de toggle explicite de la section 102 (Pauses) reste, lui, inchangé et propre à Pauses — il ne s'applique pas à Infos, qui n'a plus de bouton/onglet cliquable de façon idempotente au même sens (l'ouverture se fait via `Modifier`, jamais en recliquant sur l'onglet Infos lui-même).

---

# 104. Polish final — dirty guard centralisé et immédiat

La confirmation `Modifications non enregistrées` doit apparaître AVANT la première action qui quitte le contexte édité, jamais après coup sur l’action suivante.

Le point de fuite historique : la navigation bas-de-page (Aperçu / Voyage / Mes voyages, `main.ts`) appelait directement `goToOverviewForActiveTrip` / `goToDetailForActiveTrip` / `goToList`, en dehors du gestionnaire de clic délégué du conteneur (`EXTERNAL_ACTIONS`) — elle contournait donc totalement le garde-fou.

Corrigé par un point de passage unique, `attemptLeaveEditContext`, que ces trois fonctions traversent désormais systématiquement avant de naviguer — exactement le même contrat que la navigation interne au conteneur.

---

# 105. Polish final — heure de départ validée par ✓

Le contrôle d’heure de départ (case Départ de l’écran Étape) porte désormais un petit bouton ✓ à côté de l’`<input type="time">`.

Contrat :

- modifier l’heure ne persiste rien tant que ✓ (ou Entrée) n’a pas été cliqué ;
- perdre le focus sans ✓/Entrée (clic ailleurs, Échap) revient toujours à la dernière heure persistée — jamais de sauvegarde implicite au blur ;
- cliquer ✓ (ou Entrée) sauvegarde, recalcule ETA/opening_hours/météo/timeline, et referme le contrôle vers l’affichage simple — un patch ciblé, jamais un Postpass.

---

# 106. Polish final — zéro bouton manuel d’enrichissement standard

Le bouton `Identifier les lieux de départ et d’arrivée` (Voyage) est supprimé. Le moteur automatique (`automatic-enrichment.ts`) gère seul le geocoding des extrémités — le bouton était strictement redondant avec lui.

Plus aucun contrôle utilisateur standard (Identifier / Enrichir / Relancer / Réessayer / Compléter / Rechercher les POI / Postpass) ne déclenche manuellement un provider géographique (geocoding, structural, practical).

Exception unique, volontaire et confirmée par une boîte de dialogue : `Modifier le voyage → Réglages avancés → Recalculer les données du parcours`. Cette action reste disponible mais n’apparaît jamais dans l’usage normal du Voyage.

Les fonctions de geocoding/enrichissement elles-mêmes ne sont pas supprimées — seuls leurs déclencheurs manuels le sont ; l’orchestrateur automatique continue de les appeler.

---

# 107. Polish final — édition de voyage : conservation par Ride GPX inchangée

Modifier un voyage (ajout, suppression, remplacement, réordonnancement de GPX ; ajout/suppression d’OFF ou Transfert) ne doit jamais ré-enrichir une Ride dont le GPX source n’a pas changé.

Le bug corrigé : `enrichmentMetadata.enrichmentJobs` (complétion micro-jobs par étape) était fusionné tout-ou-rien au niveau du voyage entier — un seul GPX modifié réinitialisait la préparation de TOUTES les autres étapes, y compris celles restées identiques. La fusion suit désormais la même logique déjà appliquée à `settings.stages`/`practicalPlaces`/`climbs` : chaque enregistrement de job survit si et seulement si sa propre étape fait partie des étapes inchangées (`unchangedStageIds`, identité déjà résolue via `existingSourceFileId`).

`providers` (état global par fournisseur, non ventilé par étape) reste conservé tel quel — il n’a jamais de granularité par Ride.

Conséquences attendues :

- ajout d’un GPX → seule la nouvelle Ride nécessite un enrichissement ;
- suppression d’un GPX → les autres Ride restent `ready`, zéro appel provider ;
- remplacement d’un GPX → seule la Ride remplacée est ré-enrichie ;
- réordonnancement de GPX identiques → zéro Postpass, tout reste `complete` ;
- ajout/suppression d’OFF ou Transfert → n’invalide jamais l’enrichissement géographique des Ride GPX inchangées.

---

# 108. Polish final — principe ultime (complément)

Le principe de la section 98 reste inchangé et s’étend maintenant explicitement à l’édition d’un voyage existant :

> **modifier un voyage ne doit jamais punir les étapes qu’on n’a pas touchées.**

---

# 109. Hardening d'intégrité — décisions finales

Ce jalon (« ULTIME HARDENING D'INTÉGRITÉ ») corrige sept défauts d'intégrité découverts après le polish produit précédent. Chacune des décisions ci-dessous (sections 110-115), et la correction de la section 103 ci-dessus, prévaut sur toute version antérieure de ce document, sur les commentaires de code plus anciens et sur les anciens CDC en cas de conflit.

---

# 110. Hardening d'intégrité — geocoding des extrémités strictement incrémental

`tripNeedsEndpointGeocoding` détectait déjà correctement, par étape et par extrémité, ce qui manquait — mais `enrichTripEndpoints`/`applyLookups` reconstruisaient les lookups et l'état du fournisseur pour TOUTES les étapes à chaque passe, même une étape déjà entièrement géocodée.

Corrigé :

- l'unité de validité est l'étape ET l'extrémité (`start`/`end`), jamais le voyage entier — une étape déjà complète sur ses deux extrémités ne génère plus aucun lookup, aucun appel provider, aucune mutation ;
- une étape ne manquant qu'un seul côté ne requête plus que ce côté-là ;
- `enrichmentMetadata` est préservé par spread (`...bundle.enrichmentMetadata`) et non reconstruit comme `{ providers: [...] }` — cette reconstruction effaçait silencieusement `enrichmentJobs`/`practicalPlacesStageErrors` à chaque passe d'endpoints, même une passe qui ne changeait rien d'autre ;
- l'état du fournisseur OSM (`success`/`partial`/`error`) reflète désormais la complétion RÉELLE et globale du voyage (toutes les étapes enrichissables), jamais seulement le nombre de lookups du lot traité dans cette passe.

---

# 111. Hardening d'intégrité — plan de pauses automatique stable et persisté

## Le problème

`computeStageWaypoints`/`buildAutomaticPauseEnrichment` recalculaient l'ancrage de pause automatique dynamiquement à CHAQUE rendu, à partir des données POI/météo/heure de départ/ETA vivantes (le moteur C3, `recommendAutomaticPauses`, factorise légitimement `weather`/`departureMinutes` dans son score — CDC C3 sections 25/30, ceci reste vrai). Conséquence : les mêmes données structurelles/POI pouvaient sélectionner un waypoint DIFFÉRENT comme ancrage de pause après un simple rafraîchissement météo ou une modification d'heure de départ — un ancrage affiché qui bouge sous les pieds du voyageur pour des raisons sans rapport avec la route elle-même.

## La décision

Une fois qu'une étape est structurellement et pratiquement complète (`isStageFullyEnriched`, le même verrou déjà utilisé par `stageAutomaticPausesAllowed`), son plan de pauses automatique est calculé UNE FOIS puis persisté. Les recalculs météo/heure de départ suivants ne recalculent plus que l'ETA/l'état d'ouverture/l'affichage — ils ne déplacent JAMAIS l'ancrage choisi.

## Le mécanisme

- `TripEnrichmentMetadata.automaticPausePlans?: readonly StageAutomaticPausePlan[]` (nouveau champ, optionnel et additif — absent sur tout voyage antérieur à cette fonctionnalité) : un enregistrement par étape, `{ stageId, routeFingerprint, pauses }`, `pauses` réutilisant exactement la forme `StagePauseSetting` (toujours `origin: 'automatic'`) — le même mécanisme de clé/fingerprint que `StageEnrichmentJobs`, jamais un système parallèle.
- Lecture (`route-enrichment/automatic-pause-plan.ts::resolvePersistedAutomaticPausePlan`) : un plan persisté valide (fingerprint courant de l'étape inchangé) est injecté dans `computeStageWaypoints` via son paramètre `manualPauses` existant — exactement le même pipeline à ancrage fixe déjà utilisé par `pausePlanMode: 'custom'`. C'est ce qui rend un plan automatique persisté structurellement immunisé contre la météo/l'heure de départ : `manualPauses` ne relance jamais le scoring C3, il se contente de chercher l'ancrage par id.
- Écriture (`ensureAutomaticPausePlans`) : calcule et persiste, une fois par étape éligible (mode automatique, `isStageFullyEnriched`, pas de plan valide existant), directement à la suite de la phase POI dans `runStoredTripAutomaticEnrichment` (l'équivalent code de « PHASE 5 — Pauses de Ei » du pipeline normatif, section 10/97) — sans réseau, sans provider, jamais bloquant.
- `tripNeedsAutomaticEnrichment` inclut désormais aussi « une étape complète attend encore son plan » (seulement quand un provider structural/practical est configuré) — un voyage déjà entièrement enrichi AVANT ce jalon reçoit donc son plan en une seule fois, sans appel réseau, à sa prochaine ouverture.
- Le panneau Pauses (édition directe, section 102) garde ses propres explications C3 (raisons/scores/alternates) toujours vivantes, indépendamment du plan persisté qui pilote l'affichage réel — jamais affamées par le même mécanisme de blocage que le mode custom.

## Invalidation — les seuls déclencheurs réels

- le GPX de l'étape change réellement (nouveau fingerprint, ou remplacement structurel qui attribue un nouvel identifiant d'étape — `unchangedStageIds` filtre alors `automaticPausePlans` exactement comme `enrichmentJobs`) ;
- `Recalculer les données du parcours` est utilisé (`resetEnrichmentForRecalculation` reconstruit `enrichmentMetadata` en ne gardant que `providers`, ce qui efface `automaticPausePlans` pour tout le voyage — cohérent avec la section 34 : cette action peut rafraîchir les pauses automatiques) ;
- jamais un changement de météo, jamais une modification d'heure de départ (section 32, inchangée), jamais trip-wide en dehors du recalcul explicite, jamais par un simple changement de `pausePlanMode`.

## Rétablir Auto

Le bouton `Rétablir Auto` (section 102) supprime toujours l'override `RideStageSettings` de l'étape. Il assure en plus qu'un plan stable existe immédiatement : un plan déjà valide est réutilisé tel quel ; un plan absent ou périmé, sur une étape déjà complète, est recalculé localement à cet instant (pur, aucun réseau, aucun Postpass) plutôt que de laisser l'écran retomber sur un calcul C3 vivant au prochain rendu.

`pausePlanMode: 'automatic'`/`'custom'` restent deux concepts strictement distincts — un plan automatique persisté et une liste de pauses custom ne sont jamais mélangés dans le même enregistrement.

---

# 112. Hardening d'intégrité — reprise automatique avec palier progressif

`classifyEnrichmentFailure` ne connaît que deux catégories (`'too-heavy'` / `'unavailable'`). Un job qui atteint le plancher de subdivision (`MINIMUM_SEGMENT_KM`, 2,5 km) ou dépasse le nombre d'échecs `'too-heavy'` autorisés en une passe est réécrit `pending` — sans AUCUN mécanisme de relance programmée : seule la réouverture du voyage ou l'événement `online` relançaient une passe. Un fournisseur en ligne mais durablement lent/erratique restait donc bloqué indéfiniment tant que personne ne rouvrait le voyage.

Corrigé par un minuteur de reprise par voyage actif (jamais par job, jamais en arrière-plan pour un voyage non affiché) :

- palier 30 s → 2 min → 5 min (plafonné) ;
- réinitialisé à 30 s dès qu'une passe fait un progrès réel (mesuré par le nombre de micro-jobs structuraux/pratiques réellement complétés — succès ou vide) ;
- annulé purement et simplement au changement de voyage affiché ou de propriétaire d'enrichissement (`enrichmentOwner`) — jamais deux minuteurs actifs, jamais un minuteur qui continue de tourner pour un voyage qu'on a quitté ;
- ne contrarie jamais le mécanisme existant de reprise sur l'événement `online` — les deux peuvent coexister, une seule passe réelle à la fois (single-flight/`enrichmentOwner` déjà en place) ;
- injectable en test (`TripsManagerDeps.automaticRetryBackoffMs`, optionnel) pour vérifier l'échelle avec de vrais minuteurs courts plutôt que d'attendre les minutes réelles — la valeur par défaut en production reste `[30_000, 120_000, 300_000]`.

---

# 113. Hardening d'intégrité — géographie météo OFF/Transfert alignée sur l'UI

`weather/generic/sample-points.ts` résolvait les coordonnées d'un jour OFF/Transfert via un second chemin, parallèle et divergent (`nearestPreviousRideStage`/`nearestNextRideStage` + résolution locale), au lieu des résolveurs mêmes que l'UI utilise déjà pour le nom (`analysis/day-location-fill.ts::resolveOffCoordinates`/`resolveTransferCoordinates`). Cette divergence reproduisait exactement les bugs déjà documentés dans les commentaires de ces résolveurs : ignorer un override manuel « Choisir sur la carte », et sauter par-dessus un Transfert intercalé (`Ride A → Transfert → OFF → Ride B` interrogeait la météo à `RideA.end` au lieu de la destination du transfert).

Corrigé en partageant le même résolveur pour le NOM et pour les COORDONNÉES — cette divergence devient structurellement impossible plutôt que corrigée au cas par cas.

---

# 114. Hardening d'intégrité — traçabilité des alertes météo (point/heure)

Les objets `WeatherAlert` portaient déjà `pointName`/`etaLocal`/`etaLocalEnd`/`firstPointName`/`lastPointName`, mais `renderRiskBanner` (panneau Météo complet) et `renderWeatherAlertsSummary` (carte résumé toujours visible) n'affichaient jamais que `title`/`summary`, perdant ce contexte en route.

Corrigé pour les deux surfaces :

- une alerte mono-point affiche son lieu et son heure d'arrivée ;
- une alerte groupée/multi-points (dont le titre mentionne déjà « … entre X et Y ») n'ajoute que la plage horaire — jamais une répétition des noms de lieux déjà dans le titre ;
- une méta-alerte (donnée périmée, couverture insuffisante) n'est jamais point-scopée et ne reçoit jamais une ligne de localisation fabriquée.

---

# 115. Hardening d'intégrité — suppression totale du repli de synthèse météo agrégée

Le polish produit précédent (section réf. antérieure) ne montrait la ligne de synthèse agrégée du panneau Étape/Météo (« 11,5–18,8 °C · Pluie 2 % · Rafales 34 km/h ») qu'en repli, quand la carte de décision était vide. Ce jalon la supprime PUREMENT ET SIMPLEMENT, sans aucun repli : un jour sans contenu décisionnel réel (mode tendance/référence-du-jour/passé, ou un jour genuinely calme) n'affiche plus rien du tout sous l'étiquette eyebrow (« Synthèse ») — jamais la ligne agrégée réinstaurée comme bouche-trou.

Exception explicite, non touchée par ce jalon : la ligne compacte Voyage (`renderGenericDayCardWeatherLine`), le bloc compact Aperçu (`renderGenericOverviewWeatherBlock`) et la météo inline Parcours (`renderInlineWaypointWeather`) restent strictement inchangées — seule la synthèse du bas du panneau Météo de l'écran Étape est concernée.
