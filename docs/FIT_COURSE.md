# FIT Course pour Garmin — essai 2026.10.24.7

Le détail League/Tour propose **FIT Garmin · essai**, à côté des téléchargements GPX. Le fichier est vérifié avec un lecteur indépendant, mais **l’import, l’affichage et les alertes sur Garmin réel restent à confirmer**. Modèle indiqué par l’utilisateur le 24 octobre : **Garmin Edge Explore 2**. Le chemin de transfert reste à valider. Ne pas annoncer une compatibilité Garmin générale avant cet essai.

## Comportement

- Exporter **le même tracé complet que le GPX**, y compris l’approche et la portion après l’arrivée réelle. Les limites de course ajoutent des repères et ne découpent plus le FIT. Des limites enregistrées obsolètes restent bloquantes. [Règle actuelle et vérifications](FULL_GPX_FIT_ROUTE.md).
- Conserver **tous les sommets du GPX dans leur ordre**, même les points coïncidents et les passages répétés. Les distances FIT commencent à zéro au départ GPX. Les repères interpolés de limites et de segments sont des Course Points supplémentaires ; ils ne remplacent aucun sommet du tracé.
- Créer START GPX / FINISH GPX et, si des limites sont définies, RACE START / RACE FINISH, puis uniquement les alertes avant/début/fin activées pour chaque segment. Par défaut : 500 m avant et au début, sans alerte de fin. Une alerte préalable avant le départ est omise avec un avertissement, jamais rabattue sur un faux « 500 m ».
- Bloquer les limites obsolètes et segments hors course/à replacer avec les mêmes contrôles que l’export GPX enrichi.
- Utiliser le modèle de temps du profil, avec l’allure et le déplacement actifs, sans pause en compétition. Les timestamps FIT commencent à l’instant de l’export et décrivent un rythme théorique, pas une activité enregistrée ni une nouvelle date de calendrier. Les timestamps du GPX source ne sont pas utilisés. Le FIT inclut l’approche à référence vélo réduite de 3 km/h, puis la course et la fin du GPX à l’allure normale de terrain. Sa durée décrit le GPX complet ; les statistiques sportives de l’application restent limitées à la course. [Règles du départ GPX](GPX_DEPARTURE_AND_WALKING_WIND.md).

Le bouton prépare et télécharge un fichier local ; il n’envoie rien au compteur ou à Garmin Connect. Vérifier l’enregistrement dans Fichiers sur iPhone. Aucun réseau POI/météo n’est nécessaire. Les GPX d’origine, l’[export enrichi réimportable](ENRICHED_GPX.md) et la [sauvegarde ZIP complète](TRIP_BACKUP.md) restent disponibles. Le FIT n’est pas un format de réimportation de la préparation dans l’application.

Les noms de points sont compacts : `SPRINT1 500m`, `CLIMB1 START`, `FLAND1 END`, etc. La numérotation distingue les segments d’un même type ; leurs noms complets restent dans le GPX enrichi et la sauvegarde. Les noms FIT sont limités à 15 octets UTF-8 plus un terminateur nul pour les appareils anciens, sans couper un accent/emoji.

## Format et dépendance

Encodeur **`fit-file-parser@6.2.3`**, entrée `fit-file-parser/encoder`, licence MIT reproduite dans `public/licenses/fit-file-parser.txt`. Cette entrée est chargée à la demande ; le décodeur, le profil sémantique et son polyfill Buffer ne sont pas inclus dans le module d’export envoyé au navigateur. Le SDK officiel a été examiné ; sa licence de redistribution est distincte, il n’est pas intégré à l’application.

Le fichier utilise le protocole FIT **1.0 (`0x10`)** et les messages standards suivants :

| Message | Contenu |
| --- | --- |
| `file_id` | Type Course (`6`), fabricant development (`255`), produit applicatif, identifiant aléatoire non nul et date de création. Deux exports dans la même seconde restent distincts, sans usurper l’identité d’un appareil Garmin. |
| `course` | Nom compact, sport cycling/hiking, capacités temps/distance/position/navigation. |
| `lap` | Début/fin, durée théorique et distance du GPX complet. |
| `event` | Démarrage et arrêt du timer théorique. |
| `record` | Géométrie, temps et distances ; coordonnées en semicircles, distance au centimètre, altitude à 0,2 m. |
| `course_point` | Limites et points d’alerte triés par distance. Les départs/fins de segments portent les types standards `segment_start`/`segment_end`. Aucun classement de montée fictif n’est inventé. |

Les altitudes absentes ou hors de l’intervalle représentable par le champ standard utilisent la valeur FIT invalide, jamais zéro. Les altitudes hors intervalle sont signalées. Les valeurs qui dépassent les autres capacités du format refusent l’export. Le CRC d’en-tête et le CRC du fichier sont générés par l’encodeur.

Les longs tracés rendent la main au navigateur tous les 2 048 sommets pour permettre l’affichage du statut. L’état d’encodeur est propre à chaque fichier. Le module séparé, d’environ 11 ko (4 ko gzip), est inclus dans le précache de la PWA ; un premier export reste possible hors connexion après installation complète du cache.

## Validation reproductible

`npm run build`, puis `npm test` : **2 261 tests réussis**, aucun échec ni test ignoré. Le lot 2026.10.24.7 ajoute trois scénarios : égalité des points GPX original/enrichi/FIT à vélo et à pied malgré les limites, temps complets approche/course/fin de trace, et conservation des points coïncidents dans une boucle. Les scénarios League/Tour, alertes, altitude inconnue, noms UTF-8, méridien 180°, fichiers simultanés et CRC altéré restent couverts. Un parcours dense de **166 km et 15 001 sommets** conserve ses points et rend la main pendant la préparation.

Pour une lecture indépendante de l’encodeur JavaScript, installer `fitdecode==0.11.0` dans un environnement Python puis exécuter :

```sh
python scripts/check-fit-course.py chemin/vers/course.fit --gpx chemin/vers/source.gpx
```

Le script contrôle structure/CRC, type Course, positions, ordre des distances/temps, résumés et événements. Avec `--gpx`, il compare chaque sommet, dans l’ordre, au GPX original ou enrichi via un lecteur XML indépendant, en tenant compte de la précision FIT. Le fichier téléchargé dans l’essai navigateur contient désormais **101 records sur environ 3 336 m**, plus **7 Course Points** : départ GPX, départ réel à 200 m, Sprint START à 600 m, Flandrien 500m à 1 000 m, Flandrien START à 1 500 m, arrivée de course à 3 300 m, fin GPX. L’alerte préalable du Sprint reste omise car avant le départ de course.

Contrôles Chromium tactiles **320 et 390 × 844** : véritable assistant GPX/IndexedDB/Leaflet, bouton activé après enregistrement des limites, téléchargement FIT hors connexion, vérification de l’activité inchangée et non-régression du GPX enrichi. Sur l’application compilée, Service Worker actif : premier chargement du module FIT directement hors connexion, téléchargement, rechargement hors connexion et second export avec les segments conservés. Aucun débordement ni erreur JavaScript. Les essais utilisent des prévisions déterministes ou indisponibles et des tuiles bloquées.

## Essai sur appareil restant

Après fusion/déploiement, tester sur le **Garmin Edge Explore 2** indiqué et confirmer un moyen de transfert qui conserve les Course Points. Sur les Edge compatibles, le dossier USB `Garmin/NewFiles` peut servir de test direct depuis un ordinateur ; aucun transfert mobile universel n’est promis. Une conversion par un service tiers peut modifier les points et doit être vérifiée séparément.

Vérifier la présence du parcours et de son profil, les positions départ/arrivée, les noms/icônes, les alertes avant/début/fin et les réglages de notifications du compteur. Tester aussi un segment proche du départ, des segments chevauchants et un parcours long avec de nombreux points. Les limites de points et la présentation varient selon les appareils ; aucun point n’est supprimé silencieusement pour deviner une capacité matérielle. Garder l’étiquette **essai** jusqu’à cette validation.

Aucun changement d’origine, d’identité PWA ou de schéma IndexedDB. Aucune réinstallation de l’application iPhone.
