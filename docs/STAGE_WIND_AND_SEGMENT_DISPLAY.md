# Vent des statistiques et affichage des segments — 2026.10.24.5

Ce lot applique la demande directe du 24 octobre : vent moyen de l’étape dans les statistiques, configuration des segments sur profil neutre et segments colorés sur la carte. Il complète les [règles de lecture et d’édition](COURSE_WIND_AND_EDITING.md) ; les anciennes restrictions d’affichage des segments sur carte ne s’appliquent plus à ces lignes de consultation.

## Vent moyen de l’étape

La cellule **Vent moyen** du bloc Statistiques affiche par exemple **20 km/h · NE**. La direction indique la **provenance météorologique** : NE signifie « venant du nord-est ». Les huit secteurs sont N, NE, E, SE, S, SO, O, NO. La direction n’est pas déduite d’une moyenne des orientations du cycliste.

Le modèle existant calcule aussi la moyenne dans le repère géographique, dans sa même boucle de préparation limitée à 5 000 cellules. Vecteurs nord/est, vitesse et couverture sont pondérés par la distance couverte entre les limites actives. Une modification du sens de roulage ne change donc pas la provenance du vent ; sur un aller-retour, la moyenne relative peut être variable alors que la provenance météorologique reste N. Aucun angle n’est moyenné directement autour de 0/360°.

Une couverture partielle est indiquée. Des directions opposées ne deviennent pas un faux calme ; une vitesse suffisante sans direction valide reste inconnue. Une moyenne nulle/faible des vecteurs peut être variable, avec la vitesse moyenne conservée. Une prévision indisponible, passée ou utilisée seulement comme référence du jour pour un départ lointain affiche **—**. Les règles de disponibilité et d’interpolation restent celles du moteur de vent existant.

La valeur est actualisée avec les données météo et les limites de course, sans requête supplémentaire ni recalcul du GPX à chaque toucher. En League, le bloc de statistiques reste soumis aux deux limites explicites. Il n’y a toujours aucune moyenne de vent globale sur un voyage ou une saison.

Le profil n’affiche plus une seconde moyenne permanente. Son exploration affiche le vent **local relatif au déplacement** ; les points de passage et les moyennes des segments/montées conservent cette même lecture relative. Détails du vent garde les informations complémentaires du parcours.

## Profil et configuration

Le panneau **Course** utilise le profil principal en **Neutre**, sans sélecteur Neutre/Pente/Vent ni légende de coloration pendant la configuration. Fermer Course ou consulter Météo rend le profil à sa zone de lecture et rétablit le mode de consultation précédent. Ce changement temporaire n’écrit pas la préférence de lecture et ne recrée pas le profil.

En consultation, Neutre, Pente et Vent restent disponibles. Le tracé/remplissage coloré des segments Sprint/Grimpeur/Flandrien apparaît **uniquement en Neutre**. En Pente et Vent, cette superposition est masquée pour lire les valeurs de pente ou de vent sans couleur de segment par-dessus. Les données, vignettes et mini-profils des segments restent conservés.

Les interactions de placement, la saisie au dixième, les brouillons et l’enregistrement utilisent le moteur existant. Les mises à jour météo et les enregistrements d’un segment gardent le mode neutre tant que Course est ouvert.

## Carte

La carte du détail et sa version plein écran montrent les portions **Sprint vert, Grimpeur rouge, Flandrien jaune**, avec un nom/type au survol. Le découpage utilise le chaînage de la trace originale et des extrémités interpolées, pas une recherche du sommet GPS le plus proche. Les passages répétés restent distincts.

Les portions chevauchantes sont dessinées avec des épaisseurs différentes, de la plus large à la plus fine, pour conserver leurs bords colorés sans décaler les lignes hors du parcours. Il s’agit d’un affichage en lecture : aucun marqueur de limite ni outil d’édition sur carte n’est réintroduit. Les segments hors course ou obsolètes ne dessinent pas une ancienne position ; ils restent disponibles et signalés dans le parcours et le sélecteur d’édition.

La carte réutilise la géométrie et l’analyse des segments déjà en mémoire. L’actualisation du vent ne remonte pas la carte. Les fonds de carte indisponibles n’empêchent pas l’affichage des lignes.

## Appareil Garmin indiqué

L’utilisateur a précisé **Garmin Edge Explore 2**. Ce modèle est désormais la cible du prochain essai physique décrit dans [FIT_COURSE.md](FIT_COURSE.md). L’export générique garde la mention **essai** : le renseignement du modèle ne valide ni l’import ni les alertes sur l’appareil.

## Vérification

`npm run build` puis `npm test` : **2 253 tests réussis**, aucun échec ni test ignoré. Sept scénarios supplémentaires couvrent la distinction vent géographique/relatif dans un demi-tour, le passage par le nord, les limites de course, les états de couverture/calme/variable, les huit directions françaises, la conservation du mode de lecture, les lignes de carte avec chevauchements et le refus des anciennes positions. Les tests existants de vent, placement et mini-profils sont conservés et adaptés aux nouveaux emplacements.

Chromium tactile **320 et 390 × 844**, avec assistant GPX, IndexedDB et Leaflet réels : moyenne **20 km/h · N** dans les statistiques, vent local conservé, aucune seconde moyenne sous le profil, superpositions visibles uniquement en Neutre, panneau Course sans choix de coloration et retour au mode précédent, deux lignes colorées dans la vignette et la carte plein écran. Exports FIT/GPX et réimportation hors connexion, sources et configurations conservées. Application compilée avec Service Worker : modes de lecture/édition, valeur inconnue explicite, lignes de carte, premier chargement FIT hors connexion puis rechargement et second export. Aucun débordement horizontal ni erreur JavaScript. Prévisions déterministes ou indisponibles, tuiles bloquées ; l’essai physique iPhone/Edge Explore 2 reste à faire après déploiement.

Version et balises MAJ locales : **2026.10.24.5**. Aucun changement d’origine, d’identité PWA ou de schéma de stockage ; aucune réinstallation.
