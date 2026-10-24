# Vent par parcours et panneau Course — 2026.10.24.2

Ce lot applique la précision directe de l’utilisateur du 24 octobre : conserver le vent dans le détail de chaque parcours, y compris en League, et retirer uniquement la moyenne à l’échelle d’un voyage ou d’une saison. Il remplace les règles de vent et d’accès à l’édition de la [correction précédente](LEAGUE_TOUR_CORRECTIONS.md). Le document source fourni reste conservé comme historique, sans modification.

## Lecture du parcours

Le vent relatif reste actif pour chaque étape/course en Voyage, League et Tour. La moyenne du parcours demeure visible sous le profil quand on sélectionne un point ; une seconde lecture présente le vent local. La coloration Neutre / Pente / Vent reste disponible. Les capteurs, l’orientation physique du téléphone et les requêtes météo ne changent pas : le modèle réutilise les prévisions déjà chargées, dans le sens de déplacement vers le haut.

Chaque point de passage affiche le vent relatif local, ou « Vent indisponible » lorsque les prévisions ne permettent pas de l’estimer. Pour un segment ou une montée, la lecture correspond à la moyenne sur son intervalle complet, tronqué aux limites réelles de course lorsqu’elles existent. `RouteWindModel.between` réutilise les intégrales du modèle ; aucun nouveau parcours des points GPX n’est déclenché par une lecture du profil. Les zones sans prévisions fiables restent inconnues ; une moyenne de directions opposées ne devient pas un faux vent calme.

Les écrans Aperçu et Voyage / Calendrier / Étapes n’affichent plus de vent global sur plusieurs parcours. Le bloc et son calcul d’agrégation ont été retirés du gestionnaire d’écrans. Les prévisions ordinaires des cartes restent accessibles.

## Segments en lecture

Toucher une vignette de Sprint, Grimpeur ou Flandrien ouvre son mini-profil dans les points de passage, comme pour les montées automatiques. Aucun formulaire d’édition ne s’ouvre. Les mini-profils partagent le rendu et les interactions déjà utilisés pour les montées ; leur échelle conserve les kilomètres absolus du GPX. Une altitude absente produit une indication d’indisponibilité, sans inventer un profil à zéro. La lecture tactile reste affichée après le relâchement du doigt ; la souris conserve son comportement de survol.

## Édition de course

En League/Tour, le panneau **Course** occupe la place de Pauses, à côté de **Météo**. Il rassemble le départ et l’arrivée réels, l’ajout de segments et un sélecteur pour modifier un segment existant. Les voyages ordinaires gardent leur panneau Pauses.

Le panneau emprunte le même nœud DOM de profil que la consultation. Il n’existe donc qu’un profil principal, sans copie ni géométrie dupliquée. Fermer Course, consulter Météo ou passer à Infos rend le profil à la zone de lecture et masque les contrôles d’édition. Les deux limites de segment restent synchronisées entre champs au dixième de kilomètre et placement sur le profil ; aucune édition sur carte n’est réintroduite.

Un détour par Météo conserve le brouillon. La limite en cours de placement est désarmée à la fermeture pour qu’un toucher en lecture ne déplace pas le brouillon caché. Seuls les boutons Enregistrer écrivent les changements. Les transactions, empreintes de trace et protections contre les réponses obsolètes restent ceux du moteur existant.

## Vérifications

`npm run build` puis `npm test` : **2 219 tests réussis**, aucun échec ni test ignoré. Tests automatisés de calcul du vent sur une portion, troncature aux limites, conservation de la moyenne pendant la lecture d’un point, navigation du profil unique, absence de formulaires dans les vignettes, mini-profils avec/sans altitude, panneaux selon le mode et non-régressions.

Chromium tactile à 320 et 390 × 844 : import réel de deux courses League, vent sur profil et points de passage avant/après limites, deux segments et une montée automatique, mini-profil tactile, déplacement du même profil vers Course puis retour en lecture, modification par sélecteur et toucher, détour par Météo avec brouillon conservé et désarmé, enregistrement et données GPX conservées. Aucun débordement horizontal ni erreur JavaScript. Tuiles bloquées et prévisions déterministes. L’essai iPhone physique reste à réaliser après fusion/déploiement.

Aucune migration de stockage ni changement d’identité PWA. Le travail d’export GPX enrichi déjà commencé est conservé pour le lot suivant ; ce correctif de lecture/édition est livré en priorité.
