# Départ GPX, approche et vent à vélo — 2026.10.24.6

> Précision **2026.10.24.7** : le [FIT conserve le même parcours complet que le GPX](FULL_GPX_FIT_ROUTE.md), approche et fin de trace comprises. Les limites restent des repères et définissent les statistiques de course, sans découper les exports. Cette règle remplace les anciens choix de découpage FIT décrits ci-dessous.

Ce lot applique la dernière précision directe de l’utilisateur. Elle remplace les règles historiques imposant deux limites en League, affectant l’heure saisie au départ réel ou affichant le module vent en randonnée. Les documents sources dans `specs/` restent conservés sans modification.

## Randonnée

Le module vent est réservé au vélo, dans les trois organisations Voyage/League/Tour : moyenne d’étape, flèches relatives aux points, segments et montées, lecture locale du profil, mode Vent et détails associés sont masqués en randonnée. Les modes Neutre et Pente restent accessibles. Les prévisions météo ordinaires restent disponibles.

Cette règle passe par le sélecteur commun des capacités ; aucun modèle de vent relatif n’est construit pour une randonnée. Changer de déplacement conserve prévisions, sources, limites et segments. Une préférence de profil Vent est temporairement affichée en Neutre à pied, sans écraser la préférence enregistrée ; une sélection explicite d’un autre mode reste enregistrable.

## Départ et heure de référence

Sans limites explicites, **le départ et l’arrivée du GPX définissent la course**, en League comme en Tour. Les statistiques, ETA et exports sont disponibles immédiatement. Une limite déjà enregistrée mais obsolète ou invalide reste bloquante : elle ne redevient pas silencieusement une course sur le GPX complet.

L’**heure saisie est toujours celle du départ GPX**. Ce réglage de l’activité ne vient ni de l’heure actuelle ni des timestamps historiques du fichier. Les dates League restent explicites et indépendantes ; ce lot ne déduit aucune nouvelle date depuis le GPX.

Si le départ réel est plus loin dans la trace, le Parcours distingue **Départ GPX** et **Départ de course**, chacun avec son horaire. Les statistiques affichent **Départ GPX**, **Départ réel estimé**, **Arrivée estimée** et **Durée de course**. Les distances, dénivelés et la durée sportive concernent la portion de course ; l’arrivée estimée inclut aussi le temps d’approche.

Les champs de Course utilisent les kilomètres du GPX original. Un départ effacé vaut zéro ; une arrivée effacée vaut la fin exacte du GPX. Modifier un seul champ conserve la précision de l’autre, même si sa valeur affichée est arrondie. **Trace entière** supprime les limites explicites.

## Allure avant le départ réel

À vélo, la référence sur l’approche est **référence active −3 km/h**, choix au milieu de la fourchette −2 à −4 demandée. Ce n’est pas un nouveau réglage d’allure et cela ne modifie pas la référence enregistrée. Le moteur de terrain, son lissage et ses bornes locales de vitesse restent appliqués ; une simple multiplication de la durée par un ratio serait incorrecte aux vitesses bornées.

À pied, l’approche garde la référence et le modèle de marche. Les arrêts restent désactivés en compétition.

La courbe de temps exprime les minutes depuis le départ GPX : approche à allure réduite jusqu’au départ réel, puis déplacement à l’allure de course. Profil, points, POI sur l’approche, prévisions, arrivée effective et résolution des conflits entre étapes liées réutilisent cette courbe. Les points après l’arrivée de course ne reçoivent pas d’ETA de course. La moyenne du vent à vélo continue de porter uniquement sur la portion de course.

Les prévisions suivent les dates des ETA, y compris après minuit. Le changement d’heure réassocie les prévisions horaires en cache ; les protections contre une réponse tardive pour d’anciennes limites restent actives. Les séries de terrain vélo sont partagées par géométrie immuable pour éviter de relisser le même tracé à chaque calcul de référence.

## Exports et conservation

Le **FIT Course** reste limité à la course réelle : géométrie et distances commencent au départ réel, et le temps d’approche est retranché des timestamps et de la durée du fichier. Le FIT commence toujours à l’instant théorique de l’export, sans reprendre l’horaire du calendrier ni les timestamps GPX. Il garde son étiquette essai jusqu’à la validation physique sur **Garmin Edge Explore 2**.

Le GPX enrichi conserve la trace complète et ses annotations ; l’export d’origine conserve les octets exacts. Les dates, horaires et déplacement restent des choix indépendants lors d’un nouvel import. Aucune migration de stockage, modification d’origine ou d’identité PWA : les activités restent sur l’iPhone sans réinstallation.

## Vérification

`npm run build` puis `npm test` : **2 258 tests réussis**, aucun échec ni test ignoré. Cinq nouveaux scénarios couvrent une approche sans altitude à 15 km/h suivie d’une course à 18 km/h, les bornes du moteur sur forte pente, les ETA météo et la fin après minuit, le retrait du vent à pied dans les trois organisations et la conservation du modèle de marche. Les scénarios existants sont adaptés aux limites facultatives, au préfixe GPX, aux prévisions en cache, aux conflits d’étapes liées et à la durée FIT limitée à la course.

Chromium tactile **320 et 390 × 844**, assistant GPX, IndexedDB et Leaflet réels : disponibilité immédiate des exports sans limites, enregistrement du départ seul sans arrondir la fin, champs vides, retour à la trace entière, deux départs avec horaires cohérents, changement vélo/marche/vélo et conservation exacte des sources/limites/segments. Vent absent à pied et présent à vélo, modes du profil et segments colorés conservés. Export FIT et aller-retour GPX enrichi hors connexion ; sérialisation XML native et lecture indépendante du FIT avec `fitdecode 0.11.0`.

Application compilée avec Service Worker : premier chargement du module FIT hors connexion, rechargement et nouvel export, changement en randonnée hors connexion, nouveau rechargement et conservation des deux segments, des limites, du départ GPX et du fichier source. Aucun débordement horizontal ni erreur JavaScript. Prévisions déterministes ou indisponibles et tuiles bloquées ; essais physiques iPhone et Garmin à réaliser après fusion/déploiement.

Entrée Nouveautés et balises MAJ au déplacement, au départ GPX et aux limites : **2026.10.24.6**.
