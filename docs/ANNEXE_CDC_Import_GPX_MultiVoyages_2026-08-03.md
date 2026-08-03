# Annexe fonctionnelle — Import GPX, préparation d’itinéraire et gestion multi-voyages

**Projet :** `CGI-1991/bike-trip-dashboard`  
**Statut :** décisions fonctionnelles consolidées après cadrage utilisateur  
**Date :** 2026-08-03  
**Rôle :** annexe au `CDC.md`. En cas de divergence sur l’UX d’import ou la gestion des voyages, cette annexe précise l’intention produit actuelle.

---

## 1. Priorités produit

Ordre de priorité retenu :

1. **Simplicité de l’import**
2. **Possibilités d’édition**
3. **Enrichissement automatique**
4. **Sophistication de la carte et des aperçus visuels**

Conséquence : l’application doit faire un maximum automatiquement, tout en laissant l’utilisateur corriger simplement ce qui doit l’être. Les fonctions de préparation ne doivent pas devenir un éditeur complexe d’itinéraires.

---

## 2. Premier flux de création d’un voyage

Le flux de création démarre directement par l’import des GPX.

L’écran de préparation initial doit permettre, dans une même séquence :

- ajouter un ou plusieurs fichiers GPX ;
- renseigner le **Nom du voyage** ;
- renseigner la **date de départ** ;
- ordonner les étapes ;
- insérer éventuellement des **journées OFF** ;
- insérer éventuellement des **transferts** ;
- confirmer la structure générale du voyage ;
- lancer ensuite l’analyse complète de l’application.

La date de départ fait partie du cadrage initial de l’itinéraire dans l’interface, même si le moteur garde la capacité technique de gérer un voyage non daté.

---

## 3. Ordonnancement automatique des GPX

### 3.1. Principe

Lorsqu’un lot de GPX est ajouté, l’application tente automatiquement de proposer un ordre pertinent.

La stratégie recommandée est hiérarchique :

1. exploiter un ordre numérique explicite dans les noms de fichiers (`01`, `02`, `03`, etc.) lorsqu’il est cohérent ;
2. analyser la proximité géographique entre l’arrivée d’une trace et le départ des autres traces ;
3. proposer la chaîne présentant la meilleure continuité géographique ;
4. ne jamais imposer silencieusement un ordre lorsque plusieurs solutions sont plausibles.

### 3.2. Boucles et première étape

Les itinéraires en boucle constituent un cas particulier : toutes les étapes peuvent former une chaîne cohérente sans première étape évidente.

Dans ce cas :

- l’application propose un ordre cohérent ;
- l’utilisateur doit pouvoir choisir facilement **la première étape** ;
- le reste de l’ordre est recalculé à partir de ce choix si cela améliore la continuité.

### 3.3. Correction manuelle

L’ordre proposé reste toujours modifiable.

Préférence UX :

- **drag & drop** si robuste sur mobile et desktop ;
- sinon boutons **Monter / Descendre** simples et fiables ;
- un fallback boutons reste souhaitable même si le drag & drop est disponible pour l’accessibilité.

---

## 4. Pré-analyse pendant la configuration

Une pré-analyse légère est autorisée si elle reste rapide et utile.

Informations minimales possibles par GPX :

- nom du fichier ;
- distance ;
- D+ ;
- D− ;
- état de validité ;
- alerte éventuelle ;
- doublon éventuel.

Pas de carte obligatoire à cette étape.

Pas de profil détaillé obligatoire.

L’objectif de cette pré-analyse est uniquement d’aider à :

- reconnaître les fichiers ;
- détecter une erreur ;
- détecter un doublon ;
- vérifier rapidement l’ordre.

L’analyse complète démarre après validation de la configuration du voyage.

---

## 5. Continuité et doublons

### 5.1. Rupture de continuité

Si l’arrivée d’une étape est éloignée du départ de la suivante :

- afficher un signalement simple ;
- ne pas bloquer automatiquement ;
- permettre la validation volontaire de cette rupture.

Une rupture peut correspondre à un transfert volontaire ou à une organisation réelle du voyage.

### 5.2. Doublons stricts

Deux fichiers strictement identiques doivent :

- être détectés par hash ;
- produire un signalement minimal ;
- **bloquer la validation** tant qu’un des doublons n’est pas supprimé ou explicitement remplacé.

### 5.3. Doublons géométriques

L’application doit également pouvoir signaler deux GPX différents mais représentant pratiquement la même trace.

Ce contrôle doit rester simple et non bloquant, par exemple sur la base de :

- départ/arrivée très proches ;
- distance très proche ;
- géométrie fortement similaire.

---

## 6. Fichier, track et segment

Règle par défaut :

> **1 fichier GPX = 1 étape**

Cette règle n’est pas irréversible.

Pour un GPX contenant plusieurs tracks ou segments :

- le comportement par défaut reste une seule étape ;
- l’utilisateur doit pouvoir, dans un mode avancé, choisir de conserver l’ensemble ou de créer plusieurs étapes à partir des tracks/segments ;
- cette possibilité ne doit pas alourdir le parcours standard.

Le découpage automatique d’un long GPX n’est pas prioritaire.

---

## 7. Waypoints GPX

Les waypoints présents dans les GPX ne doivent pas encombrer l’assistant initial.

Ils peuvent être importés techniquement et utilisés ensuite par le moteur, mais ils n’ont pas besoin d’être affichés pendant la configuration de base.

Les timestamps historiques contenus dans les GPX sont ignorés pour définir la date du voyage.

---

## 8. Journées OFF et transferts

L’assistant initial doit permettre d’insérer :

- une journée **OFF** ;
- une journée **Transfert**.

Ces journées doivent être positionnables entre deux étapes roulées.

Une journée OFF :

- ne contient pas de GPX roulé ;
- conserve le lieu atteint la veille comme position de référence ;
- pourra recevoir ensuite logement, notes, activités, etc.

Un transfert :

- représente un déplacement hors logique cycliste normale ;
- ne doit pas être traité comme une étape roulée ;
- doit pouvoir posséder départ, arrivée et notes.

---

## 9. Nom des étapes

Après validation initiale et lorsque l’enrichissement géographique est disponible :

- l’application cherche le lieu approximatif de départ et d’arrivée ;
- le nom d’étape est généré automatiquement, par exemple `Namur → Dinant` ;
- ce nom reste toujours modifiable.

Avant enrichissement :

- un nom temporaire simple est acceptable ;
- aucune fausse localité ne doit être inventée.

---

## 10. Statistiques

L’interface principale doit présenter **une seule valeur fiable** par métrique.

Pas de double affichage permanent « source vs recalculé ».

Le moteur peut conserver les valeurs sources et dérivées en interne pour la provenance et le diagnostic, mais l’utilisateur voit une valeur principale.

En cas de qualité altimétrique insuffisante :

- afficher un signalement minimal du type `Altitude à vérifier` ;
- éviter de présenter un D+ douteux comme totalement fiable.

---

## 11. Montées

### 11.1. Sélection

Ne présenter automatiquement que les **montées significatives**.

L’application doit éviter de transformer chaque ondulation en « montée ».

### 11.2. Nommage

Priorité :

1. point de passage / col / sommet connu proche du sommet ;
2. enrichissement externe fiable ;
3. nom générique simple : `Montée 1`, `Montée 2`, etc.

Toutes les montées ne correspondent pas à des cols. Le modèle ne doit donc jamais supposer qu’une montée doit obligatoirement porter un nom de col.

### 11.3. Correction utilisateur

Permettre, sans créer un éditeur complexe :

- garder ;
- masquer ;
- éventuellement renommer.

L’application doit faire la détection automatiquement dans la majorité des cas.

---

## 12. Vitesse, durée et pauses

### 12.1. Vitesse

Un seul réglage de **vitesse de référence pour le voyage**.

Pas de profils `Balade / Sportif / etc.` dans la V1 ciblée.

### 12.2. Pauses automatiques

Le budget de pauses ne doit pas être fixé uniformément à 60 minutes pour toutes les étapes.

Il doit dépendre au minimum :

- de la longueur ;
- de la durée estimée ;
- de la difficulté / du D+.

Exemples d’ordre de grandeur à calibrer :

- étape d’environ 50 km : environ 20 minutes ;
- étape d’environ 100 km : environ 60 minutes ;
- étape longue et fortement montagneuse : davantage si nécessaire.

Ces valeurs sont des exemples fonctionnels et doivent être transformées en règles continues/testables plutôt qu’en seuils rigides isolés.

### 12.3. Placement des pauses

Dès que les enrichissements sont disponibles, les pauses automatiques doivent autant que possible être associées à des lieux réels pertinents :

- sommet / col ;
- boulangerie ;
- café ;
- ravitaillement ;
- village ;
- point d’eau ;
- autre lieu pratique.

Avant enrichissement, le moteur peut utiliser des positions théoriques temporaires.

---

## 13. Import partiellement invalide

Un fichier invalide ne doit pas condamner tout le lot.

Exemple : 9 GPX valides + 1 invalide.

L’utilisateur doit pouvoir :

- créer le voyage avec les 9 étapes valides ;
- supprimer le GPX invalide ;
- le remplacer ;
- ajouter l’étape manquante plus tard.

Le rapport doit rester simple :

> `9 fichiers prêts · 1 fichier à corriger`

Le détail est disponible à la demande.

---

## 14. Modification d’un voyage après création

Un voyage n’est jamais figé après l’import initial.

L’utilisateur doit pouvoir rouvrir un écran de structure similaire à l’assistant initial pour :

- ajouter un GPX ;
- remplacer le GPX d’une étape ;
- supprimer une étape ;
- réordonner ;
- insérer une journée OFF ;
- insérer un transfert ;
- renommer.

### 14.1. Remplacement d’un GPX

Lorsqu’un GPX est remplacé :

- recalculer automatiquement la géométrie, le profil, les montées, les statistiques, les timings et les ETA ;
- conserver autant que possible les informations ajoutées manuellement à la journée :
  - logement ;
  - lien Maps ;
  - notes ;
  - commentaires ;
  - autres données explicitement utilisateur ;
- signaler les données qui ne peuvent plus être rattachées de manière fiable.

Pas d’historique permanent des anciennes versions de GPX : un ré-import manuel suffit.

### 14.2. Suppression

Pendant une session d’édition :

- les suppressions peuvent rester réversibles tant que l’utilisateur n’a pas validé ;
- `Annuler` restaure la structure précédente ;
- `Enregistrer` applique atomiquement la nouvelle structure.

Pas besoin d’une corbeille persistante dans la V1.

---

## 15. Gestion multi-voyages

L’application doit gérer plusieurs voyages simultanément dans IndexedDB.

Chaque voyage est indépendant et entièrement supprimable.

Actions minimales :

- ouvrir ;
- modifier ;
- supprimer ;
- exporter ;
- importer.

Pas de duplication ni de gestion de variantes de voyage dans la V1.

### 15.1. Voyage actif au démarrage

Au lancement, sélectionner automatiquement le voyage le plus pertinent en fonction de la date actuelle :

1. voyage en cours ;
2. sinon prochain voyage à venir ;
3. sinon dernier voyage récemment utilisé ou liste des voyages si aucun choix évident.

Le changement de voyage doit rester rapide et visible.

### 15.2. Application vide

Aucun voyage de démonstration ou RGA préinstallé dans l’application générique.

Premier démarrage :

- application vide ;
- accès immédiat à `Créer un voyage`.

La RGA devient simplement un voyage que l’utilisateur peut recréer par import comme les autres.

---

## 16. Enrichissements externes

Après validation et création du voyage, les enrichissements peuvent démarrer automatiquement.

Objectif : éviter une succession de confirmations inutiles.

Les enrichissements externes restent non bloquants :

- géocodage ;
- noms de cols / sommets ;
- lieux pratiques ;
- météo lorsque les dates entrent dans l’horizon utile ;
- autres fournisseurs futurs.

Une préférence permettant de désactiver les enrichissements automatiques peut exister dans les réglages avancés sans encombrer l’import standard.

---

## 17. Offline et persistance

Après import et enregistrement IndexedDB :

- géométrie ;
- GPX originaux ;
- statistiques ;
- profils ;
- montées ;
- réglages ;
- données manuelles

doivent être disponibles sans réseau.

Les enrichissements externes ne peuvent être garantis hors ligne que s’ils ont déjà été récupérés et mis en cache.

L’interface peut indiquer discrètement l’état :

- `Disponible hors ligne`
- ou `Certaines données externes nécessitent une connexion`

---

## 18. Sauvegarde et export

Prévoir un format de sauvegarde complet `.biketrip`.

Il doit permettre de transférer un voyage d’un appareil à un autre avec :

- GPX originaux ;
- structure ;
- dates ;
- journées OFF / transferts ;
- réglages ;
- logements ;
- notes ;
- corrections ;
- enrichissements pertinents ;
- autres données utilisateur.

L’application peut signaler discrètement qu’un voyage n’a jamais été exporté, sans bloquer l’utilisation.

Chaque GPX original doit également pouvoir être téléchargé individuellement.

---

## 19. Immutabilité des GPX

Principe figé :

> **Le fichier GPX original n’est jamais modifié.**

Toute opération est dérivée et réversible :

- lissage ;
- simplification ;
- profil ;
- correction d’altitude ;
- détection de montée ;
- renommage ;
- enrichissement.

Le payload original reste conservé byte-identique dans le stockage local et dans les exports.

---

## 20. Progression et annulation des imports

Pour un import suffisamment long, afficher une progression compréhensible :

1. Lecture
2. Validation
3. Analyse
4. Étapes
5. Montées
6. Enrichissement
7. Enregistrement

Prévoir une annulation propre.

En cas :

- d’annulation volontaire ;
- de fermeture du dialogue ;
- d’erreur ;
- de fermeture de page avant validation ;

aucun voyage partiel ne doit devenir actif ni être présenté comme prêt.

Les transactions persistantes restent atomiques.

---

## 21. Premier jalon d’interface testable

Le premier prototype utilisateur doit permettre au minimum :

1. ouvrir `Mes voyages` ;
2. `Créer un voyage` ;
3. sélectionner plusieurs GPX ;
4. saisir le nom ;
5. saisir la date de départ ;
6. obtenir un ordre proposé automatiquement ;
7. choisir la première étape si nécessaire ;
8. réordonner ;
9. insérer OFF / transfert ;
10. voir les alertes minimales (doublon, continuité, fichier invalide) ;
11. lancer la création ;
12. suivre la progression ;
13. ouvrir le voyage ;
14. recharger la page ;
15. retrouver le voyage ;
16. revenir dans la structure et ajouter/remplacer/supprimer une étape ;
17. basculer entre plusieurs voyages ;
18. supprimer complètement un voyage.

Ce jalon doit être livré **avant** de complexifier davantage les enrichissements ou le rendu cartographique.

---

## 22. Décisions explicitement non prioritaires

Pour la V1 actuelle :

- pas de carte pendant la préconfiguration initiale ;
- pas de prévisualisation graphique lourde avant import ;
- pas de découpage automatique d’un GPX long ;
- pas de variantes multiples attachées à une journée ;
- pas de duplication de voyage ;
- pas d’historique automatique des anciennes versions de GPX ;
- pas de profils cyclistes prédéfinis ;
- pas d’exposition des waypoints dans l’assistant standard ;
- pas de RGA préinstallée ;
- pas d’obligation de conserver un voyage non daté dans l’UX standard.

---

## 23. Points techniques à calibrer par tests

Les décisions suivantes sont fonctionnellement fixées mais les seuils exacts restent à calibrer :

- score d’ordonnancement géographique ;
- seuil de rupture de continuité ;
- seuil de similitude entre deux traces ;
- qualité altimétrique minimale ;
- critères de « montée significative » ;
- association d’un waypoint / col au sommet d’une montée ;
- fonction continue du budget de pauses selon distance, durée et D+ ;
- sélection du voyage automatique au démarrage.

Ces seuils doivent rester centralisés, testés et modifiables sans réécrire l’UI.
