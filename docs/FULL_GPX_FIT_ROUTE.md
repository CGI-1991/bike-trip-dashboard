# Même parcours en GPX et FIT — 2026.10.24.7

La demande directe précise que **GPX et FIT doivent garder le même parcours**, les segments et alertes ajoutant des informations. Elle remplace le découpage FIT aux limites de course des lots précédents. Les documents sources restent conservés sans modification.

## Règle d’export

- Le GPX d’origine conserve ses octets ; le GPX enrichi conserve la trace complète, les extensions tierces et les annotations de préparation.
- Le FIT conserve **chaque point de la géométrie GPX importée, dans le même ordre** : départ GPX, approche avant course, course et portion après l’arrivée réelle. Aucune simplification, suppression de points coïncidents ou modification des coordonnées pour placer une alerte.
- Les distances du FIT et de ses Course Points sont les kilomètres absolus du GPX, à partir de zéro. Déplacer une limite ou ajouter un segment ne redécoupe plus la géométrie exportée.
- Les limites explicites ajoutent **RACE START / RACE FINISH**, entre **START GPX / FINISH GPX**. Leurs coordonnées interpolées et les points d’alerte sont des repères supplémentaires ; ils ne remplacent aucun sommet de la trace.

Le format FIT représente les coordonnées en semicircles, les distances au centimètre et l’altitude à 0,2 m : l’égalité du parcours est contrôlée avec cette précision de format. Une altitude absente ou non représentable reste inconnue. Le FIT reste un fichier Course, sans activité enregistrée fictive ni copie des timestamps historiques du GPX.

## Temps, statistiques et alertes

L’heure de référence de l’application reste celle du départ GPX. Le FIT décrit un rythme théorique à partir de l’instant de l’export : approche vélo à référence −3 km/h, course à l’allure normale, puis fin du GPX à l’allure normale de terrain. À pied, le modèle de marche s’applique partout. Le temps reste continu au départ et à l’arrivée réels.

La durée et la distance du fichier FIT décrivent **le parcours intégral**. Les statistiques sportives de l’application restent celles de la course ; cette continuation du FIT après l’arrivée ne rajoute pas d’ETA opérationnelle aux points hors course dans l’interface.

Les réglages d’alertes existants sont conservés : avant/début/fin selon chaque segment. Une alerte préalable avant le départ réel reste omise et signalée ; la présence de l’approche dans le FIT ne crée pas une alerte de course sur cette portion. Les limites obsolètes ou segments à replacer/hors course continuent de bloquer l’export enrichi.

Le bouton indique **Tracé GPX complet + alertes**, avec une nouvelle balise MAJ et une entrée Nouveautés. La mention **essai Garmin** reste nécessaire jusqu’au test physique sur **Edge Explore 2** : une vérification de fichier ne prouve pas les notifications sur le compteur.

## Vérification

`npm run build`, puis `npm test` : **2 261 tests réussis**, aucun échec ni test ignoré. Trois nouveaux scénarios couvrent la comparaison de tous les points entre GPX original/enrichi/FIT à vélo et à pied, les temps complets approche/course/fin de trace, et les boucles avec points coïncidents aux extrémités. Les contrôles existants vérifient désormais les repères réels en kilomètres GPX et les sommets complets en League/Tour. Le parcours dense de **166 km / 15 001 sommets** garde ses points et rend la main pendant l’encodage.

Sur l’application compilée, Chromium tactile **320 et 390 × 844**, Service Worker actif : premier chargement FIT hors connexion, trois formats téléchargés, nouvel export puis rechargement hors connexion, deux segments et configuration conservés ; randonnée après changement de déplacement et rechargement hors connexion. Aucun débordement horizontal ni erreur JavaScript. Prévisions indisponibles et tuiles bloquées ; aucun essai physique iPhone/Garmin annoncé.

Lecture indépendante avec `fitdecode 0.11.0` et le parseur XML Python : **101 points et 3 335,85 m** dans le FIT, identiques aux points du GPX original et enrichi à la précision du format, à vélo et à pied. **7 Course Points** : départ GPX 0 m, départ réel 200 m, Sprint START 600 m, Flandrien 500m 1 000 m, Flandrien START 1 500 m, arrivée réelle 3 300 m et fin GPX 3 335,85 m. La comparaison réussit après nouvel export et rechargement ; elle échoue volontairement si un point GPX est supprimé ou déplacé.

Commande reproductible après installation de `fitdecode==0.11.0` :

```sh
python scripts/check-fit-course.py parcours.fit --gpx parcours.gpx
```

Aucune modification d’origine, d’identité PWA ou du stockage ; aucune réinstallation ni modification des activités enregistrées.
