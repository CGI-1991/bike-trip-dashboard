# Allures et cohérence des ETA — 2026.10.24.9

Ce lot corrige un écart entre préparation du relief à l’import et en consultation/recalcul vélo. Un exemple vallonné synthétique de 22,75 km donnait 6 267 s à l’import et 6 212 s après recalcul à la même référence de 18 km/h. Le recalcul utilise désormais le même profil que l’import : les deux donnent 6 267 s. Les facteurs physiques vélo et marche restent ceux existants ; ce lot ne prétend pas les avoir étalonnés sur des sorties réelles de l’utilisateur.

## Références conservées

| Allure | Vélo, plat | Randonnée, plat |
| --- | --- | --- |
| Chill | 12 km/h | 3 km/h |
| Tempo | 15 km/h | 3,8 km/h |
| Normal | **18 km/h** | **4,5 km/h** |
| Soutenu | 23 km/h | 5,3 km/h |
| Sportif | 28 km/h | 6,2 km/h |

Manuel conserve la valeur choisie, même si elle coïncide avec un palier. L’éditeur rappelle que ces références décrivent le plat : la moyenne réelle estimée sur un profil vallonné diffère. Les pauses s’ajoutent à la durée, sans réduire artificiellement cette vitesse de déplacement.

## Un seul relief pour les temps

`buildTravelTerrainProfile` applique la qualité altimétrique de l’import, son lissage de **150 m**, ses échantillons de **50 m** et sa fenêtre de pente de **200 m**. Les plafonds de pente restent distincts : 20 % pour la préparation vélo, 60 % pour la marche. La loi de vitesse du vélo et le facteur de Tobler normalisé à plat pour la marche restent inchangés, avec leurs bornes locales existantes.

Import, recalcul des agrégats, courbe interactive, points du Parcours, POI, pauses, échantillons météo et FIT réutilisent cette préparation et le même moteur temporel. Le chaînage carte/POI/segments reste celui du GPX opérationnel ; il est ramené à la distance haversine du profil pour le temps, comme la marche le faisait déjà. Aucun sommet ni offset enregistré n’est déplacé.

La série de distance et chaque profil de sport sont mis en cache par géométrie immuable. Changer d’allure réintègre le rythme sur ce terrain ; il n’alloue plus trois copies d’un profil source pour reconstruire un autre relief vélo. Remplacer la géométrie ne réutilise pas l’ancien terrain. La détection des montées utilise également le même préparateur, avec ses critères distincts de catégorie.

Une couverture d’altitude sous **50 %**, ou moins de deux altitudes, garde le calcul à vitesse constante déjà utilisé à l’import. Le détail indique **Altitude insuffisante · estimation sur le plat**. Une altitude inconnue ne devient jamais une pente ou un dénivelé inventé. Le traitement des petits trous à couverture suffisante garde les règles d’interpolation existantes.

## Moyenne et horaires

La statistique **Moyenne en mouvement** décrit la distance parcourue divisée par le temps de déplacement. Elle retranche les pauses effectivement placées avant l’arrivée, sans retrancher une pause d’arrivée que l’ETA n’a pas encore incluse. En compétition, elle décrit uniquement la course : l’approche à référence vélo −3 km/h reste incluse dans les ETA depuis le départ GPX, mais est retirée de la durée sportive et de cette moyenne.

Le FIT conserve le GPX complet, y compris approche et fin de trace ; son résumé couvre donc le parcours intégral. Le départ réel et les segments restent des repères supplémentaires. Le GPX d’origine et le GPX enrichi restent conservés ; [règles d’export](FULL_GPX_FIT_ROUTE.md).

Ralentir l’allure d’un Tour à vélo passe désormais aussi par la résolution des conflits de départs liés : un départ devenu trop tôt est ajusté au quart d’heure compatible, dans la même sauvegarde que l’allure. La marche utilisait déjà cette résolution. Les ajustements ou dépassements sont signalés selon le mécanisme existant. Les dates des courses League restent indépendantes.

Les prévisions horaires continuent d’être réassociées aux nouvelles ETA par le coordinateur météo ; les caches fournisseurs, les réponses tardives et les dates au-delà de minuit gardent leurs protections existantes. Explorer le profil ne lance aucune requête.

## Vérification

`npm run build` puis `npm test` : **2 273 tests réussis**, aucun échec ni test ignoré. Six nouveaux scénarios couvrent **48 configurations** (deux sports × quatre couvertures d’altitude × cinq paliers plus une vitesse manuelle), l’accord import/recalcul/profil/points/météo, la progression des cinq allures, les références plates, le cache par sport/géométrie, la moyenne sans pauses ni approche et le décalage atomique d’un départ lié à vélo. Les tests FIT et course tiennent compte de la conversion entre chaînage opérationnel et distance du terrain ; les contrôles RGA historiques passent.

Chromium tactile **320 et 390 × 844**, application compilée, IndexedDB et Service Worker : cinq paliers des deux sports et mode Manuel enregistrés hors connexion, moyennes croissantes, retour à Normal sans dérive de l’ETA, segments et source conservés, absence de vent à pied, rechargement hors connexion et indication explicite sur un GPX sans altitude. Exports FIT vélo/marche comparés au GPX par `fitdecode` et un lecteur XML indépendants. Aucun débordement ni erreur JavaScript ; prévisions indisponibles et tuiles bloquées. Les essais physiques iPhone/Garmin et une calibration personnelle sur sorties mesurées restent distincts de ces vérifications.

Version **2026.10.24.9**, entrée Nouveautés et balises MAJ au choix d’allure et à la moyenne en mouvement. Aucune migration, changement d’origine/PWA ou réinstallation ; aucun réimport des voyages nécessaire.
