# FIT Course pour Garmin — essai 2026.10.24.4

Le détail League/Tour propose **FIT Garmin · essai**, à côté des téléchargements GPX. Le fichier est vérifié avec un lecteur indépendant, mais **l’import, l’affichage et les alertes sur Garmin réel restent à confirmer**. Modèle indiqué par l’utilisateur le 24 octobre : **Garmin Edge Explore 2**. Le chemin de transfert reste à valider. Ne pas annoncer une compatibilité Garmin générale avant cet essai.

## Comportement

- Exporter uniquement la portion entre les limites de course. Depuis **2026.10.24.6**, League et Tour utilisent le GPX entier en l’absence de limites. Des limites enregistrées obsolètes restent bloquantes.
- Conserver les sommets de cette portion et interpoler ses extrémités. Les distances FIT commencent à zéro au départ de course ; positions des points et distances restent issues du chaînage original, y compris aux passages répétés dans une boucle.
- Créer les points de départ/arrivée, puis uniquement les alertes avant/début/fin activées pour chaque segment. Par défaut : 500 m avant et au début, sans alerte de fin. Une alerte préalable avant le départ est omise avec un avertissement, jamais rabattue sur un faux « 500 m ».
- Bloquer les limites obsolètes et segments hors course/à replacer avec les mêmes contrôles que l’export GPX enrichi.
- Utiliser le modèle de temps du profil, avec l’allure et le déplacement actifs, sans pause en compétition. Les timestamps FIT commencent à l’instant de l’export et décrivent un rythme théorique, pas une activité enregistrée ni une nouvelle date de calendrier. Les timestamps du GPX source ne sont pas utilisés. Depuis **2026.10.24.6**, les ETA de l’application incluent l’approche avant le départ réel ; le FIT reste limité à la course et retranche cette approche de ses timestamps et de sa durée. [Règles du départ GPX](GPX_DEPARTURE_AND_WALKING_WIND.md).

Le bouton prépare et télécharge un fichier local ; il n’envoie rien au compteur ou à Garmin Connect. Vérifier l’enregistrement dans Fichiers sur iPhone. Aucun réseau POI/météo n’est nécessaire. Les GPX d’origine, l’[export enrichi réimportable](ENRICHED_GPX.md) et la [sauvegarde ZIP complète](TRIP_BACKUP.md) restent disponibles. Le FIT n’est pas un format de réimportation de la préparation dans l’application.

Les noms de points sont compacts : `SPRINT1 500m`, `CLIMB1 START`, `FLAND1 END`, etc. La numérotation distingue les segments d’un même type ; leurs noms complets restent dans le GPX enrichi et la sauvegarde. Les noms FIT sont limités à 15 octets UTF-8 plus un terminateur nul pour les appareils anciens, sans couper un accent/emoji.

## Format et dépendance

Encodeur **`fit-file-parser@6.2.3`**, entrée `fit-file-parser/encoder`, licence MIT reproduite dans `public/licenses/fit-file-parser.txt`. Cette entrée est chargée à la demande ; le décodeur, le profil sémantique et son polyfill Buffer ne sont pas inclus dans le module d’export envoyé au navigateur. Le SDK officiel a été examiné ; sa licence de redistribution est distincte, il n’est pas intégré à l’application.

Le fichier utilise le protocole FIT **1.0 (`0x10`)** et les messages standards suivants :

| Message | Contenu |
| --- | --- |
| `file_id` | Type Course (`6`), fabricant development (`255`), produit applicatif, identifiant aléatoire non nul et date de création. Deux exports dans la même seconde restent distincts, sans usurper l’identité d’un appareil Garmin. |
| `course` | Nom compact, sport cycling/hiking, capacités temps/distance/position/navigation. |
| `lap` | Début/fin, durée théorique et distance de la course. |
| `event` | Démarrage et arrêt du timer théorique. |
| `record` | Géométrie, temps et distances ; coordonnées en semicircles, distance au centimètre, altitude à 0,2 m. |
| `course_point` | Limites et points d’alerte triés par distance. Les départs/fins de segments portent les types standards `segment_start`/`segment_end`. Aucun classement de montée fictif n’est inventé. |

Les altitudes absentes ou hors de l’intervalle représentable par le champ standard utilisent la valeur FIT invalide, jamais zéro. Les altitudes hors intervalle sont signalées. Les valeurs qui dépassent les autres capacités du format refusent l’export. Le CRC d’en-tête et le CRC du fichier sont générés par l’encodeur.

Les longs tracés rendent la main au navigateur tous les 2 048 sommets pour permettre l’affichage du statut. L’état d’encodeur est propre à chaque fichier. Le module séparé, d’environ 11 ko (4 ko gzip), est inclus dans le précache de la PWA ; un premier export reste possible hors connexion après installation complète du cache.

## Validation reproductible

`npm ci`, `npm run build`, puis `npm test` : **2 246 tests réussis**, aucun échec ni test ignoré, dont **13 nouveaux scénarios**. League/Tour, mode marche, géométrie bornée, cohérence des temps, réglages par segment, chevauchement, départ trop proche, alertes désactivées, altitudes inconnues/hors intervalle, noms UTF-8, boucles, méridien 180°, fichiers simultanés et CRC altéré. Un parcours dense de **166 km et 15 001 sommets** conserve ses points et rend la main pendant la préparation.

Pour une lecture indépendante de l’encodeur JavaScript, installer `fitdecode==0.11.0` dans un environnement Python puis exécuter :

```sh
python scripts/check-fit-course.py chemin/vers/course.fit
```

Le script lève une erreur de structure/CRC, vérifie le type Course, les positions, l’ordre et les limites des distances/temps, les résumés et événements, puis liste les points décodés. Le fichier téléchargé pendant l’essai navigateur donne **3 100 m, 95 records et 5 Course Points** : départ à 0 m, Sprint START à 400 m, Flandrien 500m à 800 m, Flandrien START à 1 300 m, arrivée à 3 100 m. L’alerte préalable du Sprint est omise car son segment commence trop près du départ.

Contrôles Chromium tactiles **320 et 390 × 844** : véritable assistant GPX/IndexedDB/Leaflet, bouton activé après enregistrement des limites, téléchargement FIT hors connexion, vérification de l’activité inchangée et non-régression du GPX enrichi. Sur l’application compilée, Service Worker actif : premier chargement du module FIT directement hors connexion, téléchargement, rechargement hors connexion et second export avec les segments conservés. Aucun débordement ni erreur JavaScript. Les essais utilisent des prévisions déterministes ou indisponibles et des tuiles bloquées.

## Essai sur appareil restant

Après fusion/déploiement, tester sur le **Garmin Edge Explore 2** indiqué et confirmer un moyen de transfert qui conserve les Course Points. Sur les Edge compatibles, le dossier USB `Garmin/NewFiles` peut servir de test direct depuis un ordinateur ; aucun transfert mobile universel n’est promis. Une conversion par un service tiers peut modifier les points et doit être vérifiée séparément.

Vérifier la présence du parcours et de son profil, les positions départ/arrivée, les noms/icônes, les alertes avant/début/fin et les réglages de notifications du compteur. Tester aussi un segment proche du départ, des segments chevauchants et un parcours long avec de nombreux points. Les limites de points et la présentation varient selon les appareils ; aucun point n’est supprimé silencieusement pour deviner une capacité matérielle. Garder l’étiquette **essai** jusqu’à cette validation.

Aucun changement d’origine, d’identité PWA ou de schéma IndexedDB. Aucune réinstallation de l’application iPhone.
