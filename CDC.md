# CDC — Dashboard RGA 2026
## Version de cadrage pour Codex / Claude Code

---

## 0. Objet

Développer une application web mobile-first, simple, rapide et gratuite, servant de tableau de bord de voyage pour la Route des Grandes Alpes 2026.

La météo est la fonction principale. L’application doit convertir les prévisions météo disponibles le long de chaque étape en informations immédiatement exploitables pendant une itinérance à vélo.

L’application est destinée à deux personnes, principalement sur iPhone, via un simple lien web et éventuellement un raccourci ajouté à l’écran d’accueil.

La priorité absolue est la RGA 2026. L’architecture doit néanmoins permettre une généralisation future à d’autres itinéraires.

---

# 1. Objectifs utilisateur

## 1.1 Avant le départ de l’itinérance

Permettre d’obtenir une vue synthétique de la météo sur l’ensemble du voyage :

- température minimale par étape ;
- température maximale par étape ;
- précipitations ;
- risques météo significatifs ;
- vent moyen ;
- éventuels risques forts : orage, neige, froid, chaleur, brouillard, rafales.

L’application ne doit pas décider des bagages ou vêtements. Elle fournit les informations ; l’utilisateur prend lui-même la décision.

## 1.2 Chaque matin

Permettre de comprendre en moins de quelques secondes :

- si le départ prévu à 09:00 reste adapté ;
- si un départ avancé ou différé semble préférable ;
- quels cols ou secteurs sont les plus exposés ;
- quand l’utilisateur devrait atteindre les points clés ;
- quelle météo est attendue à ces heures ;
- si un abri ou une pause stratégique pourrait être utile ;
- où se trouvent les principaux passages ou services utiles.

## 1.3 Pendant l’étape

Permettre de modifier discrètement :

- l’heure réelle de départ ;
- la vitesse moyenne estimée ;
- les pauses prévues ;
- éventuellement la durée globale estimée.

Après modification, les heures estimées de passage et les prévisions associées doivent être recalculées.

---

# 2. Périmètre V1

## 2.1 Inclus

- application web statique ;
- fonctionnement sur iPhone et navigateur desktop ;
- interface en français ;
- affichage mobile-first ;
- données des étapes RGA 2026 préconfigurées ;
- prévisions météo en temps réel ;
- prévisions horaires ;
- aperçu global par étape ;
- détail d’une étape ;
- estimation des heures de passage ;
- alertes météo contextualisées ;
- page discrète de réglages ;
- accès rapide à l’étape du jour ;
- actualisation à l’ouverture ;
- bouton d’actualisation manuelle ;
- possibilité d’intégrer ou lier une Google My Maps ;
- déploiement gratuit sur GitHub Pages ;
- aucun compte utilisateur ;
- aucune notification ;
- aucune base de données distante ;
- aucun serveur personnel.

## 2.2 Hors périmètre V1

- moteur universel d’import GPX depuis l’interface ;
- comptes utilisateurs ;
- synchronisation entre appareils ;
- notifications push ;
- décisions automatiques sur les bagages ;
- paiement ;
- backend ;
- administration complexe ;
- édition complète de l’itinéraire depuis le téléphone ;
- application native iOS.

---

# 3. Utilisateurs et appareils

## 3.1 Utilisateurs

- Corentin ;
- sa compagne.

## 3.2 Supports

Priorité :

1. iPhone ;
2. Chrome ou Safari mobile ;
3. navigateur desktop moderne.

L’application doit pouvoir être ajoutée à l’écran d’accueil de l’iPhone.

Une PWA légère pourra être ajoutée si cela ne complexifie pas excessivement la V1.

---

# 4. Principes UX

## 4.1 Priorités

- lisibilité ;
- rapidité ;
- peu d’interactions ;
- aucune surcharge visuelle ;
- compréhension immédiate ;
- affichage utile même avec un écran étroit ;
- réglages secondaires et discrets.

## 4.2 Navigation cible

Navigation principale proposée :

- Aujourd’hui ;
- Voyage ;
- Carte ;
- Réglages.

Sur mobile, utiliser une barre de navigation basse ou une structure équivalente très simple.

## 4.3 Page d’accueil

La page d’accueil doit privilégier l’étape du jour.

Contenu minimal :

- numéro et nom de l’étape ;
- lieu de départ ;
- lieu d’arrivée ;
- heure de départ estimée ;
- heure d’arrivée estimée ;
- température minimale et maximale ;
- risque principal ;
- vent ;
- précipitations ;
- résumé météo ;
- bouton « Voir le détail » ;
- accès direct aux autres étapes.

## 4.4 Réglages

Les réglages doivent exister dans une page dédiée, mais rester discrets.

Réglages V1 :

- heure de départ ;
- vitesse moyenne de base ;
- pause avant midi ;
- pause de midi ;
- pause après midi ;
- éventuellement un coefficient prudent / normal.

Valeurs par défaut :

- départ : 09:00 ;
- pause avant midi : 15 min ;
- pause midi : 30 min ;
- pause après midi : 15 min ;
- allure : randonnée prudente.

Les réglages doivent être modifiables directement dans l’interface et sauvegardés localement avec `localStorage`.

---

# 5. Données de l’itinéraire

## 5.1 Sources initiales

- GPX RGA 2026 fourni ;
- roadbook RGA fourni ;
- éventuellement Google My Maps pour les POI.

## 5.2 Stratégie V1

Ne pas développer immédiatement un importateur GPX universel dans l’application.

Créer lors du développement un script de préparation qui :

1. lit le GPX complet ;
2. segmente les étapes ;
3. extrait distance, altitude et dénivelé ;
4. associe les points clés du roadbook ;
5. produit des fichiers JSON statiques ;
6. valide les points et données manuellement.

Les données finales sont ensuite figées dans le dépôt pour la V1.

## 5.3 Structure suggérée

```text
data/
  trip.json
  stages/
    stage-01.json
    stage-02.json
    ...
  pois.json
```

## 5.4 Données minimales d’une étape

```json
{
  "id": "J1",
  "dayNumber": 1,
  "type": "ride",
  "name": "Thonon-les-Bains → Morzine",
  "start": {
    "name": "Thonon-les-Bains",
    "lat": 0,
    "lon": 0,
    "elevation": 0
  },
  "end": {
    "name": "Morzine",
    "lat": 0,
    "lon": 0,
    "elevation": 0
  },
  "distanceKm": 49.96,
  "elevationGainM": 1250,
  "elevationLossM": 720,
  "defaultStartTime": "09:00",
  "keyPoints": [],
  "track": []
}
```

## 5.5 Points clés

Chaque étape doit contenir les points utiles :

- départ ;
- pied des cols principaux ;
- sommets ;
- villages principaux ;
- ravitaillements importants ;
- éventuels abris ou passages stratégiques ;
- arrivée.

Ne pas échantillonner la météo à chaque point GPX.

Approche recommandée :

- points clés explicites ;
- complétés au besoin par quelques points d’échantillonnage automatiques selon la longueur de l’étape ;
- maximum raisonnable par étape afin de limiter les appels API et la surcharge d’affichage.

---

# 6. Météo

## 6.1 Fournisseur principal

Utiliser Open-Meteo comme source principale.

L’implémentation doit isoler le fournisseur météo derrière un module, afin de pouvoir le remplacer ou le compléter plus tard.

## 6.2 Modèle météo

Sélectionner le modèle ou l’option la plus fiable disponible pour les Alpes françaises, sans exposer inutilement ce choix dans l’interface.

Le fournisseur et le modèle utilisés doivent être documentés dans le README.

## 6.3 Informations récupérées

Selon disponibilité :

- température ;
- température ressentie ;
- précipitations ;
- probabilité de précipitation ;
- pluie ;
- neige ;
- code météo ;
- couverture nuageuse ;
- vent moyen ;
- rafales ;
- visibilité ;
- humidité ;
- isotherme 0 °C ou données équivalentes si disponibles ;
- risque d’orage via code météo et variables disponibles.

## 6.4 Actualisation

- appel météo lors de l’ouverture ;
- bouton manuel « Actualiser » ;
- affichage de la date et heure de dernière mise à jour ;
- cache local court pour éviter les appels inutiles ;
- gestion explicite des erreurs réseau ;
- conservation du dernier résultat valide si l’API est indisponible.

## 6.5 Horizons

L’application doit gérer les différents niveaux de fiabilité :

- prévisions court terme : données détaillées et horaires ;
- prévisions plus lointaines : aperçu synthétique ;
- au-delà de la période réellement couverte : afficher clairement « prévision non disponible » ou une indication de tendance si une source légitime est intégrée.

Ne jamais fabriquer une météo longue échéance.

---

# 7. Estimation horaire de progression

## 7.1 But

Associer chaque point clé de l’étape à une heure estimée de passage, puis utiliser cette heure pour sélectionner la météo pertinente.

## 7.2 Paramètres

- heure de départ ;
- vitesse moyenne de base ;
- profil altimétrique ;
- distance ;
- difficulté ;
- pauses ;
- coefficient prudent.

## 7.3 Approche V1 recommandée

Ne pas utiliser une vitesse constante pure.

Créer une estimation simple mais crédible :

- vitesse de base utilisateur ;
- correction selon pente moyenne locale ;
- correction pour les ascensions longues ;
- vitesse plafonnée en descente ;
- pauses injectées à des moments cohérents ;
- temps calculé cumulativement le long du tracé.

Le modèle doit rester compréhensible et ajustable.

## 7.4 Valeurs de référence

Le couple roulait entre environ 16 et 20 km/h de moyenne sur les étapes de Vendée.

Pour la RGA, utiliser par défaut une estimation prudente et plus lente selon le dénivelé.

La valeur exacte devra être calibrée avec quelques étapes du roadbook.

## 7.5 Pauses par défaut

- 15 min avant midi ;
- 30 min à midi ;
- 15 min après midi.

L’algorithme peut placer automatiquement les pauses près d’un village ou d’un point clé, tout en restant simple.

---

# 8. Vues

## 8.1 Vue Aujourd’hui

Affiche :

- étape sélectionnée comme étape du jour ;
- résumé météo ;
- principaux risques ;
- heure de départ ;
- ETA ;
- prochain point clé ;
- heure estimée au prochain col ;
- accès au détail ;
- bouton actualiser.

## 8.2 Vue Voyage — matrice synthétique

Pour chaque étape :

- numéro ;
- nom court ;
- température minimale ;
- température maximale ;
- précipitations ;
- risque principal ;
- vent moyen ;
- niveau de vigilance.

Un sélecteur permet de passer à la deuxième matrice.

## 8.3 Vue Voyage — matrice points clés

Pour chaque étape ou étape sélectionnée :

- pied des cols ;
- sommets ;
- heure estimée ;
- température ;
- pluie ;
- rafales ;
- risque météo principal.

## 8.4 Détail d’étape

Affiche :

- résumé ;
- distance ;
- D+ ;
- D- ;
- heure de départ ;
- ETA ;
- profil ou représentation simplifiée ;
- chronologie des points clés ;
- météo prévue à chaque point ;
- prévisions heure par heure dépliables ;
- alertes contextuelles ;
- éventuels POI ;
- lien vers la carte.

## 8.5 Carte

V1 légère :

- tracé de l’étape ;
- points clés ;
- POI ;
- centrage sur l’étape ;
- lien facultatif vers Google My Maps.

Leaflet peut être utilisé si l’intégration reste légère.

## 8.6 Réglages

Page secondaire et discrète.

Elle contient les paramètres de progression et éventuellement :

- réinitialiser les valeurs ;
- activer/désactiver certains détails ;
- sélectionner manuellement l’étape du jour.

---

# 9. Alertes contextualisées

## 9.1 Principe

Les alertes ne doivent pas être de simples seuils isolés.

Elles doivent tenir compte du contexte :

- orage pendant une ascension ou au sommet ;
- pluie avant ou pendant une descente ;
- froid au sommet ;
- combinaison pluie + froid + vent ;
- fortes rafales sur un col ;
- chaleur en vallée ;
- brouillard ou faible visibilité ;
- neige ou gel ;
- fenêtre météo plus favorable avec un départ avancé ou différé.

## 9.2 Niveaux

Trois niveaux suffisent :

- vert : conditions normales ;
- orange : vigilance / adaptation utile ;
- rouge : risque important.

## 9.3 Exemples

- « Orage possible au Galibier autour de votre passage estimé. »
- « Un départ 60 min plus tôt réduit l’exposition au risque d’orage. »
- « Descente probablement froide et humide après le sommet. »
- « Rafales fortes attendues au col. »
- « Forte chaleur prévue en vallée dans l’après-midi. »
- « Prévoir un abri possible avant le point suivant. »

Les formulations doivent rester informatives, non alarmistes et concises.

---

# 10. Conseils contextuels

L’application peut générer quelques conseils opérationnels :

- avancer ou différer le départ ;
- envisager une pause à l’abri ;
- anticiper une descente froide ;
- garder la protection pluie accessible ;
- surveiller l’évolution avant un col.

Les conseils liés au matériel doivent rester secondaires et ne pas créer une vue « bagages ».

---

# 11. POI et Google My Maps

## 11.1 Priorité

Fonction secondaire.

## 11.2 Options

Ordre recommandé :

1. bouton ouvrant la Google My Maps existante ;
2. import KML/KMZ ou JSON des POI dans l’application ;
3. intégration directe éventuelle d’une carte embarquée.

La V1 peut commencer avec un simple lien puis évoluer.

## 11.3 Types de POI

- eau ;
- alimentation ;
- café / restaurant ;
- pharmacie ;
- atelier vélo ;
- hébergement ;
- camping ;
- abri ;
- transport ;
- point touristique.

---

# 12. Architecture technique

## 12.1 Choix recommandé

Application web statique sans framework lourd.

Option recommandée :

- Vite ;
- TypeScript ;
- HTML/CSS ;
- modules JavaScript ;
- Leaflet pour la carte ;
- tests avec Vitest ;
- ESLint ;
- Prettier.

Une application sans framework UI est acceptable.

React n’est pas nécessaire pour la V1, sauf justification claire.

## 12.2 Pourquoi Vite + TypeScript

- démarrage rapide ;
- build simple ;
- code organisé ;
- déploiement statique ;
- détection de nombreuses erreurs ;
- bonne compatibilité avec Codex et Claude Code.

## 12.3 Organisation suggérée

```text
rga-dashboard/
  public/
    icons/
    manifest.webmanifest
  src/
    api/
      weather.ts
    components/
    data/
    domain/
      alerts.ts
      timing.ts
      weather.ts
    pages/
    styles/
    main.ts
  data-source/
    gpx/
    roadbook/
  scripts/
    build-trip-data.py
  tests/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  README.md
  CDC.md
```

---

# 13. Stockage local

Utiliser `localStorage` pour :

- réglages ;
- étape du jour sélectionnée ;
- dernier résultat météo valide ;
- date de dernière actualisation ;
- préférences d’affichage.

Aucune donnée sensible.

---

# 14. PWA légère

Option souhaitable si simple :

- manifest ;
- icône ;
- mode standalone ;
- ajout à l’écran d’accueil ;
- cache du shell de l’application ;
- dernier aperçu météo disponible hors connexion.

Ne pas bloquer la livraison V1 si la PWA crée des bugs.

---

# 15. Hébergement et dépôt

## 15.1 GitHub

Créer un dépôt public, par exemple :

```text
rga-2026-dashboard
```

Le dépôt public est nécessaire pour utiliser gratuitement GitHub Pages avec GitHub Free.

## 15.2 GitHub Pages

Déployer automatiquement la branche principale avec GitHub Actions.

L’URL finale sera du type :

```text
https://<utilisateur>.github.io/rga-2026-dashboard/
```

## 15.3 Branches

Pour une V1 développée seul avec une IA :

- `main` : stable ;
- branches courtes facultatives pour les fonctionnalités.

Ne pas complexifier avec une stratégie Git avancée.

---

# 16. Qualité

## 16.1 Critères de réussite

1. L’application fonctionne.
2. Toutes les étapes sont correctement répertoriées.
3. Les points importants sont présents.
4. La météo actuelle et les prévisions sont accessibles.
5. L’information importante est accessible sans chercher.
6. Les modifications d’heure, vitesse et pauses recalculent les horaires.
7. Aucun bug bloquant sur iPhone.
8. L’application reste lisible et rapide.
9. Les erreurs API sont gérées proprement.
10. Le déploiement GitHub Pages fonctionne.

## 16.2 Tests minimaux

- calcul d’ETA ;
- insertion des pauses ;
- sélection de l’heure météo la plus proche ;
- calcul des alertes ;
- lecture des données d’étape ;
- absence de données météo ;
- API indisponible ;
- affichage mobile ;
- navigation directe vers une étape ;
- fonctionnement sous le sous-chemin GitHub Pages.

## 16.3 Tests manuels

- iPhone portrait ;
- Chrome desktop ;
- Safari mobile si disponible ;
- réseau lent ;
- mode hors connexion partiel ;
- données météo indisponibles ;
- réglages modifiés puis rechargement de la page.

---

# 17. Contraintes

- gratuit ;
- aucune clé API payante ;
- aucune infrastructure serveur ;
- pas de compte ;
- interface française ;
- développement possible dans VS Code ;
- Codex ou Claude Code réalise l’essentiel du code ;
- code lisible par un développeur débutant ;
- README explicite ;
- commandes simples ;
- aucun secret dans le dépôt ;
- ne jamais surinterpréter une prévision lointaine.

---

# 18. Méthode de développement

## Phase 0 — Préconfiguration

Objectif : environnement fiable.

- installer Git ;
- installer Node.js LTS ;
- installer VS Code ;
- connecter VS Code à GitHub ;
- installer Codex ou Claude Code ;
- créer le dépôt ;
- cloner le dépôt ;
- créer la structure Vite TypeScript ;
- lancer le serveur local ;
- effectuer un premier commit.

## Phase 1 — Squelette fonctionnel

Livrable :

- application démarrable ;
- navigation mobile ;
- pages vides ;
- thème simple ;
- données fictives ;
- build sans erreur ;
- déploiement GitHub Pages opérationnel.

## Phase 2 — Données RGA

Livrable :

- JSON des étapes ;
- points clés ;
- tracés ;
- validation des 10 étapes roulées et 2 jours OFF ;
- script de génération documenté.

## Phase 3 — Météo

Livrable :

- module Open-Meteo ;
- cache ;
- chargement ;
- erreurs ;
- aperçu météo par étape ;
- détail horaire.

## Phase 4 — Calcul de progression

Livrable :

- ETA ;
- heures de passage ;
- pauses ;
- réglages ;
- recalcul immédiat ;
- sauvegarde locale.

## Phase 5 — Alertes

Livrable :

- règles contextuelles ;
- niveaux vert/orange/rouge ;
- conseils courts ;
- comparaison départ actuel / départ avancé ou différé.

## Phase 6 — Carte et POI

Livrable :

- carte légère ;
- tracé ;
- points clés ;
- lien ou intégration My Maps.

## Phase 7 — Finition

Livrable :

- PWA légère ;
- tests ;
- correction mobile ;
- README ;
- publication stable.

---

# 19. Préconfiguration détaillée

## 19.1 Comptes

Nécessaires :

- compte GitHub ;
- compte ChatGPT pour Codex ou compte Anthropic pour Claude Code.

Pas nécessaire :

- compte météo ;
- hébergeur payant ;
- base de données ;
- nom de domaine.

## 19.2 Logiciels

Installer :

- VS Code ;
- Git ;
- Node.js LTS ;
- Python 3 si le script GPX est écrit en Python.

## 19.3 Extensions VS Code utiles

- Codex ou Claude Code ;
- ESLint ;
- Prettier ;
- GitHub Pull Requests and Issues, facultatif.

Éviter d’installer trop d’extensions.

## 19.4 Commandes initiales suggérées

```bash
npm create vite@latest rga-2026-dashboard -- --template vanilla-ts
cd rga-2026-dashboard
npm install
npm run dev
```

Puis :

```bash
git init
git add .
git commit -m "Initialise le dashboard RGA"
```

## 19.5 Variables et secrets

Open-Meteo ne nécessite normalement pas de secret pour l’usage prévu.

Ne jamais placer de token GitHub, OpenAI ou Anthropic dans le code ou le dépôt.

---

# 20. Règles données et météo

- conserver toutes les unités en métrique ;
- heure locale Europe/Paris pour l’itinéraire ;
- gérer correctement l’heure d’été ;
- afficher les valeurs arrondies ;
- conserver les données brutes séparées des valeurs présentées ;
- documenter les seuils d’alerte ;
- éviter les appels API redondants ;
- respecter les limites du fournisseur ;
- ne pas prétendre qu’une prévision est certaine.

---

# 21. Définition de “terminé” pour la V1

La V1 est terminée lorsque :

- une URL GitHub Pages fonctionne ;
- l’application s’ouvre correctement sur iPhone ;
- les étapes RGA sont toutes présentes ;
- une étape peut être ouverte en un clic ;
- la météo se charge ;
- la vue globale fonctionne ;
- la vue points clés fonctionne ;
- l’heure de départ peut être modifiée ;
- la vitesse moyenne peut être modifiée ;
- les pauses peuvent être modifiées ;
- les heures de passage sont recalculées ;
- les alertes sont visibles ;
- un échec de l’API ne casse pas l’application ;
- le README permet de relancer le projet.

---

# 22. Consignes permanentes pour l’IA de développement

- lire le CDC avant chaque phase ;
- ne modifier que le périmètre demandé ;
- expliquer les fichiers modifiés ;
- lancer les tests ;
- lancer le build ;
- ne pas ajouter de dépendance sans justification ;
- privilégier le code simple ;
- ne pas créer un backend ;
- ne pas développer un import GPX universel dans la V1 ;
- ne pas intégrer une fonction bagages ;
- maintenir l’interface française ;
- maintenir la compatibilité GitHub Pages ;
- signaler explicitement toute hypothèse ;
- créer un commit logique à la fin de chaque phase ;
- ne jamais écraser les données source ;
- conserver le fonctionnement mobile-first.

---

# PROMPTS À DONNER À CODEX OU CLAUDE

## Prompt 00 — Initialisation et audit environnement

```text
RGA_DASHBOARD_00_ENV_SETUP

Tu vas m’aider à développer une application web mobile-first appelée « RGA 2026 Dashboard ».

Commence par lire intégralement le fichier CDC.md présent à la racine du projet. Il est la référence fonctionnelle et technique.

Contexte :
- je débute ;
- je travaille dans VS Code sous Windows ;
- le projet doit être gratuit ;
- le site sera publié sur GitHub Pages ;
- la V1 est une application statique Vite + TypeScript ;
- aucun backend ;
- aucune base de données ;
- météo via Open-Meteo ;
- priorité à une version fonctionnelle aujourd’hui.

Tâche actuelle :
1. Inspecte l’environnement et le contenu du dossier.
2. Vérifie Git, Node, npm et Python.
3. Indique clairement ce qui manque.
4. Si le projet n’existe pas encore, initialise un projet Vite « vanilla-ts » dans le dossier courant sans créer de sous-dossier inutile.
5. Configure ESLint, Prettier et Vitest uniquement si cela reste simple.
6. Crée une structure minimale conforme au CDC.
7. Crée un README avec les commandes exactes.
8. Lance l’application, les tests et le build.
9. Ne développe encore aucune fonctionnalité métier.
10. À la fin, résume :
   - fichiers créés ou modifiés ;
   - commandes exécutées ;
   - erreurs restantes ;
   - prochaine étape recommandée.

Ne fais aucune modification hors du dépôt.
Ne crée aucun backend.
Ne publie rien sans me l’indiquer.
```

## Prompt 01 — Squelette UI et navigation

```text
RGA_DASHBOARD_01_UI_SHELL

Lis CDC.md avant toute modification.

Objectif de cette phase :
créer le squelette mobile-first du dashboard, sans intégrer encore la vraie météo ni les données GPX.

Implémente :
- navigation principale : Aujourd’hui, Voyage, Carte, Réglages ;
- barre de navigation mobile discrète ;
- page Aujourd’hui avec données fictives ;
- page Voyage avec switch entre deux matrices fictives ;
- page Détail d’étape ;
- page Carte avec espace réservé ;
- page Réglages ;
- design clair, sobre et très lisible sur iPhone ;
- aucune bibliothèque UI lourde ;
- composants simples ;
- routes fonctionnant aussi sur GitHub Pages ;
- données fictives centralisées, pas dispersées dans le HTML.

Contraintes :
- français uniquement ;
- mobile-first ;
- pas de backend ;
- pas de météo réelle ;
- pas encore de Leaflet ;
- pas de PWA à ce stade ;
- ne surcharge pas l’interface ;
- les réglages doivent rester secondaires.

Ajoute des tests simples de navigation ou de fonctions si pertinent.
Lance les tests et le build.
Explique chaque fichier modifié.
```

## Prompt 02 — Déploiement GitHub Pages

```text
RGA_DASHBOARD_02_GITHUB_PAGES

Lis CDC.md et inspecte la configuration actuelle.

Objectif :
rendre le projet déployable automatiquement sur GitHub Pages.

Tâches :
- configurer correctement le base path Vite pour un dépôt nommé rga-2026-dashboard ;
- créer le workflow GitHub Actions officiel ou standard pour build et déploiement Pages ;
- ajouter .nojekyll si utile ;
- vérifier les chemins d’assets ;
- vérifier qu’un rechargement ou une navigation ne crée pas de 404 ;
- documenter dans README les étapes exactes pour activer GitHub Pages ;
- ne stocker aucun secret ;
- lancer le build local.

Ne suppose pas que le dépôt distant est déjà configuré : indique-moi clairement les actions manuelles à faire sur GitHub.
```

## Prompt 03 — Extraction et modèle de données RGA

```text
RGA_DASHBOARD_03_TRIP_DATA

Lis CDC.md avant toute modification.

Les fichiers source GPX et roadbook sont placés dans data-source/.

Objectif :
produire les données statiques propres des étapes RGA 2026 sans développer un importateur GPX dans l’interface.

Tâches :
1. Inspecter les fichiers source.
2. Proposer une méthode fiable de segmentation des étapes.
3. Créer ou compléter scripts/build-trip-data.py.
4. Générer :
   - data/trip.json ;
   - un JSON par étape ;
   - les tracés simplifiés ;
   - distances cumulées ;
   - altitudes ;
   - points clés.
5. Associer les points du roadbook :
   - départ ;
   - arrivée ;
   - cols ;
   - pied et sommet ;
   - villages et ravitos importants.
6. Ne pas inventer de coordonnées.
7. Produire un rapport de validation listant :
   - étapes trouvées ;
   - étapes ambiguës ;
   - points non appariés ;
   - distances GPX versus roadbook.
8. Conserver les sources intactes.
9. Ajouter des tests de cohérence.
10. Ne modifier l’UI que pour charger les JSON générés.

Avant de coder massivement, inspecte et explique la structure réelle du GPX.
Si une segmentation est ambiguë, utilise une configuration manuelle claire plutôt qu’une heuristique opaque.
```

## Prompt 04 — Intégration Open-Meteo

```text
RGA_DASHBOARD_04_WEATHER_API

Lis CDC.md.

Objectif :
intégrer Open-Meteo proprement, sans encore générer toutes les alertes avancées.

Implémente :
- un module fournisseur météo isolé ;
- requêtes pour les points clés d’une étape ;
- température ;
- température ressentie ;
- pluie ;
- probabilité de précipitation ;
- neige si disponible ;
- vent ;
- rafales ;
- visibilité ;
- code météo ;
- prévisions horaires ;
- résumé quotidien ;
- fuseau Europe/Paris ;
- cache local ;
- date de dernière mise à jour ;
- bouton Actualiser ;
- conservation du dernier résultat valide ;
- états chargement, erreur et absence de données.

Contraintes :
- éviter les appels redondants ;
- regrouper les coordonnées lorsque l’API le permet ;
- aucune clé secrète ;
- ne jamais afficher de fausse donnée ;
- afficher clairement l’horizon réellement disponible.

Ajoute des tests avec réponses API simulées.
Lance les tests et le build.
```

## Prompt 05 — Calcul horaires et pauses

```text
RGA_DASHBOARD_05_TIMING_ENGINE

Lis CDC.md.

Objectif :
calculer l’heure estimée de passage à chaque point clé.

Implémente un moteur simple, transparent et testable tenant compte de :
- heure de départ ;
- vitesse moyenne de base ;
- distance cumulée ;
- pente ou profil local ;
- ascensions ;
- descentes ;
- coefficient prudent ;
- pauses.

Valeurs par défaut :
- départ 09:00 ;
- pause avant midi 15 min ;
- pause midi 30 min ;
- pause après midi 15 min ;
- allure randonnée prudente.

Exigences :
- ne pas utiliser une simple vitesse constante si le profil est disponible ;
- éviter un modèle trop complexe ;
- documenter les hypothèses ;
- rendre les coefficients centralisés et faciles à ajuster ;
- afficher l’ETA et les heures des points clés ;
- recalcul immédiat après modification d’un réglage ;
- sauvegarde localStorage ;
- tests unitaires détaillés.

Ne mélange pas le moteur d’estimation avec le rendu UI.
```

## Prompt 06 — Association météo / heure de passage

```text
RGA_DASHBOARD_06_WEATHER_TIMELINE

Lis CDC.md.

Objectif :
associer à chaque point clé la météo attendue à l’heure estimée de passage.

Implémente :
- sélection de l’échéance horaire la plus proche ;
- interpolation seulement si elle est raisonnable et documentée ;
- heure locale ;
- affichage chronologique ;
- résumé pied / sommet pour chaque col ;
- détail heure par heure dépliable ;
- distinction entre donnée disponible et indisponible ;
- affichage de la fiabilité selon l’échéance si possible sans faux score scientifique.

La vue doit rester lisible sur iPhone.
Ajoute des tests sur les changements de date, le passage après minuit et les heures absentes.
```

## Prompt 07 — Alertes contextualisées

```text
RGA_DASHBOARD_07_CONTEXT_ALERTS

Lis CDC.md.

Objectif :
créer des alertes météo contextualisées pour le vélo en montagne.

Créer un moteur de règles séparé couvrant au minimum :
- orage pendant ascension ou sommet ;
- pluie pendant descente ;
- froid au sommet ;
- pluie + froid + vent ;
- rafales fortes sur un col ;
- chaleur en vallée ;
- faible visibilité ou brouillard ;
- neige ou gel.

Niveaux :
- vert ;
- orange ;
- rouge.

Ajouter une comparaison simple de scénarios :
- départ actuel ;
- départ 60 min plus tôt ;
- départ 60 min plus tard.

Ne conseiller un changement d’heure que si les données montrent une amélioration claire.
Les textes doivent être courts, français, factuels et non alarmistes.

Centralise et documente tous les seuils.
Ajoute des tests unitaires pour chaque règle.
```

## Prompt 08 — Deux matrices Voyage

```text
RGA_DASHBOARD_08_TRIP_MATRICES

Lis CDC.md.

Objectif :
finaliser les deux matrices complémentaires de la vue Voyage.

Matrice 1 — synthèse par étape :
- étape ;
- température minimale ;
- température maximale ;
- précipitations ;
- alerte principale ;
- vent moyen ;
- état de disponibilité.

Matrice 2 — points critiques :
- étape ;
- cols ;
- pied ;
- sommet ;
- heure estimée ;
- température ;
- précipitations ;
- rafales ;
- risque principal.

Ajouter un switch simple entre les deux.
Sur mobile, privilégier des cartes ou un tableau horizontal utilisable sans surcharge.
L’étape du jour doit être accessible immédiatement.
```

## Prompt 09 — Carte et POI

```text
RGA_DASHBOARD_09_MAP_POI

Lis CDC.md.

Objectif :
ajouter une carte légère sans nuire aux performances.

Implémente :
- Leaflet ;
- tracé de l’étape sélectionnée ;
- départ ;
- arrivée ;
- cols ;
- points clés ;
- POI si un fichier est disponible ;
- adaptation mobile ;
- chargement différé de la carte.

Ajouter également un bouton ouvrant la Google My Maps existante dans un nouvel onglet.

Ne tente pas de contourner les limitations d’intégration de Google My Maps.
Si l’import direct est impossible ou fragile, conserve le lien externe et documente l’alternative KML/KMZ.
```

## Prompt 10 — PWA et hors connexion léger

```text
RGA_DASHBOARD_10_PWA

Lis CDC.md.

Objectif :
permettre l’ajout à l’écran d’accueil de l’iPhone sans compromettre la stabilité.

Implémente uniquement :
- manifest web ;
- icônes ;
- mode standalone ;
- service worker simple ;
- cache du shell ;
- cache des JSON statiques ;
- conservation du dernier aperçu météo valide.

Ne cache pas agressivement les réponses météo.
Prévoir une stratégie de mise à jour claire.
Si la PWA rend le déploiement GitHub Pages fragile, privilégie la stabilité et documente ce qui est reporté.
```

## Prompt 11 — Audit final

```text
RGA_DASHBOARD_11_FINAL_AUDIT

Lis CDC.md et audite l’ensemble du projet.

Vérifie :
- respect du périmètre ;
- fonctionnement mobile-first ;
- toutes les étapes ;
- cohérence des points clés ;
- météo ;
- cache ;
- erreurs ;
- calculs horaires ;
- réglages ;
- localStorage ;
- alertes ;
- carte ;
- GitHub Pages ;
- chemins sous le base path ;
- PWA ;
- accessibilité ;
- performances ;
- tests ;
- build.

Corrige uniquement les défauts démontrés.
Ne refactorise pas massivement une partie fonctionnelle sans nécessité.

Produis :
- résultat des tests ;
- résultat du build ;
- liste des limites restantes ;
- checklist de validation manuelle iPhone ;
- instructions exactes de publication ;
- numéro de version V1.
```

---

# 23. Ordre de travail recommandé aujourd’hui

Pour obtenir une version utilisable le plus vite possible :

1. Prompt 00 ;
2. Prompt 01 ;
3. Prompt 02 ;
4. publication d’une coquille fonctionnelle ;
5. Prompt 03 ;
6. validation manuelle des étapes ;
7. Prompt 04 ;
8. Prompt 05 ;
9. Prompt 06 ;
10. Prompt 08 ;
11. Prompt 07 si le temps le permet ;
12. carte, POI et PWA ensuite.

La priorité du jour est :

- déploiement fonctionnel ;
- étapes correctes ;
- météo réelle ;
- détail par point clé ;
- réglages ;
- recalcul des heures.

La carte complète, les POI avancés et la PWA sont secondaires.

---

# 24. Choix Codex ou Claude Code

Utiliser un seul agent principal pendant une phase afin d’éviter les modifications contradictoires.

Méthode recommandée :

- Codex comme agent principal si déjà inclus dans le forfait ChatGPT ;
- Claude Code comme relecteur ou agent de correction ciblée ;
- ne pas faire travailler les deux simultanément sur les mêmes fichiers ;
- committer après chaque phase fonctionnelle ;
- revenir au dernier commit si un agent dégrade le projet.

Pour chaque phase :

1. donner le prompt ;
2. laisser l’agent inspecter ;
3. lire son résumé ;
4. tester localement ;
5. corriger ;
6. commit ;
7. passer à la phase suivante.
