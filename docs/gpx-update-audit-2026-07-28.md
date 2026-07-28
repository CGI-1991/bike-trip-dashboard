# Audit des exports Komoot finaux

Les dix fichiers du dossier Drive `1nvr6EuoDTyKL4GvKHVSnKGniHHNRpqnE` ont été téléchargés, validés comme XML GPX non vide puis associés aux dix journées roulées. Les noms de production sont conservés.

| Jour | Nouveau fichier Drive | Points ancien → nouveau | Distance km ancien → nouveau | D+ m ancien → nouveau | D− m ancien → nouveau | Écart départ / arrivée |
|---|---|---:|---:|---:|---:|---:|
| J1 | RGA_01_Thonon-les-Bains _ Morzine.gpx | 1881 → 1514 | 49,96 → 49,65 | 1962 → 1557 | 1430 → 1030 | 626 m / 325 m |
| J2 | RGA_02_Morzine-Avoriaz _ Le-Grand-Bornand.gpx | 3413 → 2251 | 78,09 → 77,90 | 2854 → 2291 | 2891 → 2336 | 325 m / 654 m |
| J3 | RGA_03_Le Grand-Bornand _ Beaufort-sur-Doron.gpx | 5031 → 1706 | 56,97 → 57,75 | 3206 → 1729 | 3386 → 1904 | 654 m / 108 m |
| J4 | RGA_04_Beaufort-sur-Doron _ Bourg-Saint-Maurice.gpx | 2372 → 1177 | 39,69 → 40,75 | 2137 → 1501 | 2071 → 1422 | 108 m / 983 m |
| J6 | RGA_05_Bourg-Saint-Maurice _ Val-Cenis.gpx | 4464 → 2245 | 82,75 → 90,59 | 4382 → 2841 | 3798 → 2376 | 985 m / 5378 m |
| J7 | RGA_06_Val-Cenis _ Briançon.gpx | 6258 → 2771 | 111,30 → 104,92 | 4260 → 2727 | 4435 → 2762 | 5378 m / 629 m |
| J9 | RGA_07_Briançon _ Barcelonnette.gpx | 3973 → 3305 | 127,64 → 131,46 | 3574 → 3229 | 3658 → 3290 | 629 m / 1746 m |
| J10 | RGA_08_Barcelonnette _ Saint-Etienne-de-Tinée.gpx | 4308 → 1637 | 55,74 → 54,49 | 2959 → 1694 | 2949 → 1740 | 1746 m / 238 m |
| J11 | RGA_09_Saint-Etienne-de-Tinée _ Saint-Martin Vésubie.gpx | 3231 → 1466 | 58,84 → 57,88 | 3390 → 1522 | 3611 → 1716 | 238 m / 406 m |
| J12 | RGA_10_Saint-Martin-Vesubie _ Nice.gpx | 6413 → 3561 | 103,40 → 105,71 | 6356 → 3528 | 7261 → 4469 | 406 m / 921 m |

Les amplitudes altimétriques restent cohérentes. Les écarts importants de D+/D− proviennent surtout de la densité et du bruit altimétrique des anciens exports ; l’application continue d’utiliser son calcul GPX existant, sans substitution des statistiques éditoriales.

## Analyse du cœur des tracés

Les cinq premiers et cinq derniers kilomètres ont été exclus avant comparaison. J1, J3, J4, J6, J7, J10, J11 et J12 ne montrent pas d’écart durable supérieur à 500 m. J2 présente quelques écarts courts. J9 présente des écarts au cœur du parcours atteignant environ 2,3 km : le nouveau GPX est conservé comme source de vérité, mais il ne doit pas être décrit comme un simple raccordement local.

## Extrémités et hébergements

- J1 part à `46.368516, 6.482164`, premier point réel de l’export Komoot à la gare de Thonon-les-Bains.
- J4 arrive à environ 20 m des coordonnées confirmées de l’Airbnb de Bourg-Saint-Maurice.
- J7 arrive à environ 80 m des coordonnées confirmées de l’Airbnb de Briançon.
- J6 termine à Termignon, ce qui explique le changement d’extrémité de plus de 5 km.
- Les autres adresses restent la source des liens Maps ; aucune coordonnée n’a été inventée.

## Overrides

Aucun override éditorial n’a été modifié. Les projections sont recalculées au chargement depuis la nouvelle géométrie. La Cime de la Bonette reste `excluded` tant que la trace ne parcourt pas la boucle.
