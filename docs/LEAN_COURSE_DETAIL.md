# Lecture allégée du parcours — 2026.10.24.10

Ce lot prépare la refonte graphique demandée, sans modifier l’origine du site, l’identité de la PWA, le schéma IndexedDB ou les fichiers enregistrés. Aucune réinstallation n’est nécessaire. Ces règles remplacent les anciens comportements décrits dans les documents de lots précédents lorsqu’ils diffèrent.

## Un seul réglage des montées

**Montées retenues**, en cinq positions, figure dans le bloc Informations en haut de la création et de la modification, juste après l’allure, dans les trois organisations. Le second curseur **Détection avancée** est supprimé de l’interface. La création ne présente plus un volet avancé qui serait vide après ce déplacement ; l’édition conserve ses autres actions avancées, dont l’actualisation des POI.

Le contrôle conserve les catégories vélo et les niveaux d’effort marche du [lot catégories](CLIMB_CATEGORIES.md). Le filtre est réversible : il agit sur les montées retenues, sans effacer le réservoir de détection, les noms, les pauses ni les segments manuels. La calibration de détection reste interne ; les anciennes valeurs enregistrées sont conservées. Ouvrir l’éditeur ne redétecte rien.

## Segments et montées

La carte d’un segment conserve son nom, son heure et son repère coloré. Sa ligne secondaire contient uniquement **longueur · D+ · pente moyenne**, comme les montées, quel que soit son type : Sprint, Grimpeur ou Flandrien. Météo et vent restent attachés à sa portion entière ; toucher la carte ouvre le mini-profil de consultation. L’édition reste dans **Course**.

Un segment manuel **valide et dans la course** a priorité sur toute montée dont l’intervalle GPX chevauche le sien, même si les longueurs diffèrent fortement. Cela masque aussi le col nommé portant cette montée. Un simple contact à l’extrémité ne suffit pas. Les passages indépendants, le départ et l’arrivée restent présents ; un segment périmé ou hors course ne masque aucune montée. Le rapprochement utilise les distances cumulées du GPX, jamais la proximité des coordonnées, pour distinguer les passages répétés dans une boucle.

La consolidation se fait avant le rendu : points du Parcours, repères et calcul du compteur suivent la même priorité. En League et Tour, le compteur inclut les montées automatiques retenues dans la course qui restent représentées, plus chaque segment Grimpeur valide. Sprint et Flandrien ne sont pas comptés comme des montées. Les montées masquées restent enregistrées ; retirer ou déplacer le segment les rend à nouveau visibles si elles passent le filtre de catégorie.

Les états nécessitant une correction restent explicites : segment à replacer, hors course, altitude inconnue ou partielle. Aucune valeur manquante n’est remplacée par un faux zéro.

## Vent et exports

Le volet **Détails du vent** et ses explications sont retirés. La moyenne cardinale de l’étape reste dans les statistiques. Le vent relatif au point exploré, aux passages, sur les segments et les montées reste disponible, ainsi que la coloration Vent du profil. Le dernier point touché reste lisible quand le focus passe sur une autre carte : son effacement ne doit pas faire remonter le contenu entre l’appui et le clic. La sortie au clavier ou à la souris et l’annulation gardent leur effacement habituel. Le vent demeure masqué en randonnée et aucune moyenne n’est ajoutée sur un voyage entier.

En League et Tour, **GPX** et **FIT · essai** sont deux boutons côte à côte, même à 320 px. Le GPX unique est celui qui conserve la préparation réimportable ; son tracé contient tous les points d’origine. Le FIT conserve ce même parcours complet avec ses repères et alertes. Les données invalides bloquent les deux exports avec un motif visible, sans basculer silencieusement vers un GPX dépourvu de préparation. Les avertissements d’export, notamment une alerte préalable omise, restent visibles. En Voyage, l’export GPX existant est conservé. L’original demeure dans le stockage local et les sauvegardes complètes.

La validation physique des alertes sur **Garmin Edge Explore 2** reste à réaliser ; l’étiquette essai est conservée. Balises MAJ locales et Nouveautés expliquent chaque changement de ce lot.

## Vérification

`npm run build` puis `npm test` : **2 277 tests réussis**, aucun échec ni test ignoré. Les régressions couvrent notamment deux montées contenues dans un grand segment, les conflits partiels, le contact d’extrémité, les cols associés, les segments invalides, le compteur, la réversibilité, les métadonnées compactes, la stabilité après sélection tactile et la conservation de l’ancienne calibration lors de l’enregistrement du filtre unique.

Contrôles Chromium tactiles à **320 et 390 × 844** : application compilée avec Service Worker, import réel d’un GPX à trois montées, remplacement des deux premières par un Grimpeur, mini-profil, exports côte à côte, GPX/FIT téléchargés hors connexion, tracé GPX inchangé, réimport de la préparation, suppression du segment et retour des trois montées. Le filtre unique est sauvegardé et retrouvé après rechargement hors connexion. Les octets du GPX source sont relus dans IndexedDB et comparés à l’import. Un scénario avec fournisseur météo déterministe vérifie la moyenne cardinale, le vent aux points, sur montée et segment, la lecture au toucher et la coloration du profil. La comparaison FIT/GPX utilise aussi un lecteur indépendant. L’essai physique sur iPhone reste à réaliser après fusion et déploiement.
