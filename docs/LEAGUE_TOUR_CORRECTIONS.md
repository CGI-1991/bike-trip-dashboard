# Ajustements League / Tour — 2026.10.24.1

> La [précision sur le vent et le panneau Course](COURSE_WIND_AND_EDITING.md) rétablit le vent dans chaque détail, retire la moyenne sur un voyage entier et sépare lecture des segments et édition.

Ce lot applique le [document de corrections fourni](specs/league-tour-corrections-source.md), avant les exports GPX enrichis et Garmin. Il remplace les choix d’interface décrits dans les lots précédents lorsqu’ils diffèrent de ce cadrage.

## Organisation et statistiques

`ORGANIZATION_CAPABILITIES` centralise le libellé de navigation, l’activation du vent relatif et l’exigence de limites réelles. L’onglet est **Voyage / Calendrier / Étapes** selon Voyage / League / Tour. **Mes activités** remplace Mes voyages dans la navigation et les titres de la bibliothèque.

L’Aperçu League conserve la progression, la carte et la prochaine course, sans calendrier des courses ni vent relatif. Aucun vent relatif n’est calculé ou affiché dans ses détails ; les prévisions météo ordinaires restent accessibles. Le calendrier se trouve uniquement dans son onglet.

En League, aucune statistique de course n’est affichée sans deux limites explicites et valides, correspondant au GPX actuel. Le formulaire commence avec deux champs vides : renseigner uniquement le départ ne remplace pas une arrivée manquante par la fin du fichier. Effacer les limites masque les statistiques. Les GPX historiques restent intacts et leurs métriques sources sont conservées.

Une fois les deux limites définies, le bloc Stat supérieur du Détail présente distance, dénivelés, temps et montées entre ces limites. La carte de configuration des limites ne duplique plus ce bloc. Les totaux de saison incluent uniquement les courses délimitées, avec un avertissement si des limites manquent. Sans aucune course délimitée, seuls les compteurs de courses apparaissent. Les ETA des cartes League sont également masquées sans limites valides. Voyage et Tour conservent l’usage historique de la trace entière si aucune limite n’est définie.

## Enregistrement et vitesse

Le curseur partagé émet `data-field="climb-sensitivity"` ; l’éditeur écoutait par erreur `data-editor-field`. Il écoute désormais l’attribut réel, sans reconstruire le curseur pendant son déplacement. Le récapitulatif « Modifications non enregistrées » et les deux actions Enregistrer (haut/bas) sont actualisés ensemble. L’enregistrement utilise le recalcul existant et conserve les segments manuels. Un retour au réglage initial rend l’activité à nouveau inchangée.

Les valeurs de référence sur terrain plat sont centralisées dans `trip-core/model/reference-speed.ts`. Elles sont appliquées avant les facteurs de terrain :

| Allure | Vélo (km/h) | Randonnée (km/h) |
| --- | ---: | ---: |
| Chill | 12 | 3 |
| Tempo | 15 | 3,8 |
| Normal | 18 | 4,5 |
| Soutenu | 23 | 5,3 |
| Sportif | 28 | 6,2 |
| Manuel | saisie de 8 à 40 | saisie de 2 à 7 |

La création et la modification utilisent le même contrôle. Le champ en km/h est modifiable en Manuel. Le choix manuel est mémorisé même si sa valeur égale celle d’un preset. Sur les anciens enregistrements, le mode est déduit de la vitesse existante ; aucune vitesse n’est modifiée à l’ouverture. Le champ optionnel `referenceSpeedMode` est validé et conservé dans les sauvegardes et les éditions structurelles, sans migration.

## Segments et montées

Une seule liste Parcours combine les points de passage, les montées automatiques et les segments explicites. Chaque segment porte son nom, son type et la position de ses limites ; toucher la ligne ouvre son édition. Les segments devenus hors course ou à replacer restent accessibles dans cette même liste avec un avertissement. Aucun panneau de liste « Segments » n’est créé.

Le rapprochement utilise les distances absolues du GPX, jamais la seule proximité géographique, afin de distinguer les passages répétés dans une boucle. Une montée automatique est remplacée si l’intersection couvre au moins **80 % des deux intervalles**, ou si les deux extrémités sont à **150 m maximum** avec **60 % de recouvrement mutuel**. Un sprint court dans une longue montée ne masque donc pas cette montée. Les cols nommés restent des repères géographiques, sans seconde carte de montée quand celle-ci est remplacée. Les montées non couvertes restent présentes. Cette consolidation est dérivée : elle ne supprime aucun objet enregistré, ni montée ni segment.

L’édition d’un segment se fait uniquement sur le profil (toucher, glissement, clavier) ou par champs numériques en **0,1 km**. Les changements d’une limite actualisent son aperçu et son champ. Les valeurs historiques plus précises sont conservées tant que la limite n’est pas modifiée. Les réglages d’alerte restent en mètres, pour un futur export, sans notifications actives.

Le tracé et le remplissage sont colorés directement à l’intérieur du profil : Sprint vert, Grimpeur rouge, Flandrien jaune. Les couleurs des segments restent présentes quand la coloration générale change. Les chevauchements restent autorisés, avec remplissages superposés ; chaque segment reste accessible individuellement dans les points de passage. Le SVG réutilise la silhouette d’origine et des fenêtres de découpe, sans reparcourir les points GPX lors du placement. Aucune barrette séparée ne s’affiche au-dessus. Les segments et leur sélecteur ont été retirés des cartes ; les logements et transferts conservent leurs propres outils de localisation.

## Validation

`npm run build` et `npm test` passent : **2 215 tests réussis**, aucun échec ni test ignoré. Les tests couvrent les 24 critères du document : politiques par mode, limites absentes/partielles/obsolètes/effacées, statistiques bornées, non-régression Voyage/Tour, consolidation, ambiguïtés et chevauchements, segments hors course, conservation au recalcul, cinq presets par sport, vitesse manuelle et restauration IndexedDB.

Contrôle navigateur Chromium avec interactions tactiles à **320 et 390 × 844** : import réel de deux GPX League, ordre indépendant du calendrier, statistiques avant/après limites explicites, saisie au dixième, placement sur profil, édition depuis les points de passage, couleurs tracé/remplissage, absence de contrôle ou repère de segment sur carte, absence de liste séparée, modification réelle du curseur de détection, sauvegarde depuis le haut, vitesse manuelle, réouverture et navigation de l’application complète. Aucune erreur JavaScript ni débordement horizontal. Les tuiles sont bloquées pour vérifier aussi le repli sans fond de carte ; les prévisions sont déterministes. L’essai physique sur iPhone reste à réaliser après fusion et déploiement.

Aucune modification de l’origine, de l’identité PWA, du schéma IndexedDB ou des données GPX. Aucune réinstallation nécessaire.
