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
