# Vent relatif au parcours

> Ce document décrit le premier lot. Les [règles actuelles de lecture](STAGE_WIND_AND_SEGMENT_DISPLAY.md) conservent le vent local par parcours, y compris en League, et placent la moyenne cardinale de l’étape dans les statistiques. La moyenne globale sur plusieurs parcours est retirée. Le repère mobile est depuis simplifié ; les calculs de base décrits ici restent utilisés.

Livraison `2026.10.23.4`, dans les voyages ouverts depuis **Mes voyages**. La balise MAJ se trouve à côté des modes du profil ; Nouveautés conserve l’explication après lecture.

## Lecture sur téléphone

- Toucher ou faire glisser le doigt sur le profil affiche le vent au point exploré, synchronisé avec le repère de la carte. La valeur reste lisible après avoir levé le doigt. Sur ordinateur, le survol et les flèches du clavier fonctionnent aussi.
- Le mini cycliste roule toujours **vers le haut de l’écran**. La flèche se place du côté d’où arrive le vent et pointe vers le cycliste : elle représente le **déplacement de l’air**. Un vent de face apparaît donc au-dessus, flèche vers le bas. L’orientation physique du téléphone n’intervient pas.
- Chaque point affiché dans le Parcours reçoit une lecture relative sur une fenêtre plus large. Le profil revient à la moyenne de l’étape lorsque la sélection est effacée.
- Aperçu et Voyage proposent une section repliable « Vent relatif sur l’ensemble du voyage ». Les parts face/dos/latéral complètent la direction moyenne : un aller-retour peut avoir autant de vent de face que de dos, sans que le vent soit calme.

Le profil propose **Neutre**, **Pente** et **Vent**. Neutre est le choix initial ; le dernier choix est mémorisé localement et reste utilisable si le stockage des préférences est bloqué. Pente reprend les classes de pente existantes, avec les descentes en violet. Vent utilise six nuances de bleu pour la composante de face : `<1`, `1–5`, `5–10`, `10–20`, `20–30`, `≥30 km/h`. Le vent favorable est bleu très clair ; une estimation absente ou variable reste grise. Les rafales et la composante latérale sont indiquées séparément.

## Calcul et limites

Les prévisions déjà chargées aux points météo et associées aux ETA servent de source. Explorer ou recolorer le profil **ne déclenche aucune requête météo**. Une prévision du jour présent utilisée comme simple référence pour un voyage trop éloigné n’est jamais présentée comme une estimation relative de ce futur voyage. Les journées passées restent sans estimation relative.

1. Les directions météorologiques décrivent la provenance du vent (`0°` = vent du nord). Elles sont converties en vecteurs nord/est, interpolés entre les points météo disponibles, puis tournés dans le repère local du parcours.
2. Le cap suit la géométrie réelle, lissée sur **100 m**. La lecture du profil moyenne les composantes relatives sur **100 m** ; celle d’un point du Parcours sur **1 000 m**, fenêtres réduites aux extrémités de la trace. Ce sont des valeurs initiales à évaluer sur le terrain, en particulier dans les lacets.
3. La composante de face est positive lorsqu’elle s’oppose au déplacement ; la composante latérale est positive lorsque le vent vient de la droite. Les moyennes sont pondérées par la **distance parcourue**, indépendamment du nombre de sommets GPS. Les étapes sont agrégées par leurs distances couvertes.
4. Une moyenne vectorielle presque annulée par des orientations opposées est « variable », jamais « calme ». Une transition entre prévisions opposées qui annule artificiellement le vecteur interpolé reste indisponible.
5. Les prévisions manquantes forment des trous ; aucune extrapolation ne prolonge la première ou la dernière prévision. Un point isolé peut afficher sa propre prévision, explicitement marquée « prévision au point », sans créer de couverture du reste du parcours. Une fenêtre partiellement couverte est signalée.

Les proportions face/dos/latéral utilisent la composante dominante, soit des secteurs de 90° autour de face et dos et les deux secteurs latéraux. Elles sont rapportées à la **distance totale**, avec la fraction couverte indiquée à côté. Une partie sans prévision ne devient donc pas du vent favorable. Le vent calme est compté séparément lorsqu’il est présent.

Le détail indique le plus grand espacement entre les points météo qui contribuent à l’estimation. La maille de calcul et le lissage ne créent pas une prévision météo à résolution de 100 m. Les rafales latérales sont des estimations utilisant la **direction du vent moyen** ; leur direction instantanée n’est pas fournie par la source. Une rafale inconnue ne devient pas zéro.

La coloration représente la composante de vent de face en km/h. Elle ne modélise pas encore le vent apparent lié à la vitesse du cycliste, l’abri du terrain, la puissance nécessaire ni une correction du temps de parcours.

## Performance et conservation

La géométrie est indexée et mise en cache ; une grille de 50 m, plafonnée à 5 000 cellules, prépare les moyennes. Des intégrales cumulées permettent la lecture locale sans parcourir à nouveau tout le GPX à chaque mouvement. Les rafales maximales sont recherchées seulement dans la fenêtre concernée. Le modèle est réutilisé tant que géométrie et prévisions ne changent pas ; les mises à jour météo rafraîchissent le panneau et la coloration sans remonter le profil.

Aucune modification du schéma IndexedDB, de l’identité PWA, de l’origine ou des voyages enregistrés. Aucune réinstallation n’est nécessaire. Le profil historique RGA conserve sa présentation existante ; la nouvelle interface concerne le moteur générique de Mes voyages.

## Validation

- Tests du repère physique, passage 359°/1°, cap, demi-tour, densité GPS, calme et valeurs manquantes, trous de couverture, fenêtres différentes, rafales et agrégation multi-étapes.
- Test de non-parcours de la géométrie lors de 1 000 lectures successives et test tactile de conservation de la sélection après relâchement.
- Contrôle Chromium en écran tactile 390 × 844 avec vrais IndexedDB et gestionnaire de voyages, météo déterministe injectée : trois boutons tactiles, changement face/dos lors d’un glissement tactile, synchronisation des coordonnées du repère de carte, vent aux points du Parcours, clavier, absence de requête supplémentaire et de débordement horizontal. Le rendu Leaflet est remplacé par un contrôleur de repère dans ce scénario.
- Le contrôle navigateur ne remplace pas un essai sur iPhone physique : à vérifier après déploiement, en conservant l’app installée et ses voyages.

## Améliorations suivantes proposées

- Échantillonnage météo intermédiaire adapté à la longueur et aux changements de relief, avec budget réseau et cache explicites, pour réduire les longues interpolations.
- Comparaison de plusieurs horaires de départ selon vent de face, rafales, pluie, chaleur et lumière du jour, avec signalement des données manquantes.
- Estimation du vent apparent et de l’effort, calibrée avec le futur modèle d’allure et le mode vélo, avant d’en déduire un effet sur l’ETA.
- Autonomie eau/ravitaillement : distance et temps jusqu’au prochain service réellement accessible, avec incertitude sur les horaires et la disponibilité.
