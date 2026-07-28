# Audit des points documentés — 28 juillet 2026

## Résumé global

- **78 objets documentés dans la source historique** (roadbook.json / roadbook-rga-2026.md, jamais modifiés), dont **71 opérationnels** et **7 supprimés par décision utilisateur** (RGA_DASHBOARD_21).
- **10 GPX définitifs**, 10 journées roulées, 2 journées OFF, calendrier inchangé.
- **53 overrides reconstruits** depuis `sourceAnchor` ; 53 snapshots techniques antérieurs invalides et 0 encore compatibles avant reconstruction.
- **0 lieu(x) géographique(s) opérationnel(s) non résolu(s)** ; les groupes éditoriaux restent volontairement sans géométrie propre.

## Suppressions (décision utilisateur)

7 points retirés définitivement du voyage opérationnel. Ils restent listés ici pour la traçabilité documentaire, mais l'application les filtre avant toute construction de modèle (appariement, météo, carte, profil, pauses) — voir `src/trip/roadbook-suppressions.ts`.

| Jour | ID | Nom |
|---|---|---|
| J1 | `j01-passage-bellevaux` | Bellevaux |
| J3 | `j03-passage-crest-voland` | Crest-Voland |
| J4 | `j04-passage-areches` | Arêches |
| J4 | `j04-passage-les-chapieux` | Les Chapieux |
| J6 | `j06-passage-tignes` | Tignes |
| J9 | `j09-passage-chateau-queyras` | Château-Queyras |
| J10 | `j10-option-cime-de-la-bonette` | Cime de la Bonette |

## Compteurs (opérationnels — après suppression)

- Par type : col=17, end=10, option=1, passage=28, pause=5, start=10.
- Par rôle : information=5, route-point=66.

## Compteurs (historiques — source complète, y compris supprimés)

- Par type : col=17, end=10, option=2, passage=34, pause=5, start=10.
- Par rôle : information=5, not-ridden-option=1, route-point=66, weather-reference=6.

## Inventaire exhaustif

| Jour | ID | Nom | Type | Rôle | Km | ETA | Altitude | Distance trace | Source | Statut | Anomalie |
|---|---|---|---|---|---:|---|---:|---:|---|---|---|
| J1 | `j01-start` | Gare de Thonon-les-Bains | start | route-point | 0.000 | 08:00 | 442.5 m | 0.0 m | start | matched / confirmed | — |
| J1 | `j01-col-col-du-feu` | Col du Feu | col | route-point | 17.831 | 08:59 | 1120.0 m | 0.6 m | col | matched / confirmed | — |
| J1 | `j01-passage-lullin` | Lullin | passage | route-point | 20.710 | 09:09 | 849.5 m | 86.3 m | passage | matched / confirmed | — |
| J1 | `j01-passage-bellevaux` | Bellevaux | passage | weather-reference | 20.710 | 09:09 | 849.5 m | 3041.7 m | passage | unmatched / probable | Point explicitement retiré du voyage opérationnel par décision utilisateur. |
| J1 | `j01-passage-saint-jean-d-aulps` | Saint-Jean-d’Aulps | passage | route-point | 41.455 | 10:18 | 796.5 m | 149.2 m | passage | matched / confirmed | — |
| J1 | `j01-end` | Morzine | end | route-point | 49.649 | 10:45 | 969.3 m | 0.0 m | end | matched / confirmed | — |
| J2 | `j02-start` | Morzine | start | route-point | 0.000 | 08:00 | 971.6 m | 0.0 m | start | matched / confirmed | — |
| J2 | `j02-col-col-de-joux-plane` | Col de Joux Plane | col | route-point | 11.052 | 08:36 | 1691.0 m | 327.4 m | col | matched / probable | — |
| J2 | `j02-col-col-de-chatillon` | Col de Chatillon | col | route-point | 40.690 | 10:15 | 741.0 m | 0.8 m | col | matched / confirmed | — |
| J2 | `j02-col-col-de-la-colombiere` | Col de la Colombière | col | route-point | 66.476 | 11:41 | 1613.0 m | 1.0 m | col | matched / confirmed | — |
| J2 | `j02-passage-samoens` | Samoëns | passage | route-point | 24.105 | 09:20 | 706.2 m | 112.8 m | passage | matched / confirmed | — |
| J2 | `j02-passage-taninges` | Taninges | passage | route-point | 35.881 | 09:59 | 642.3 m | 7.6 m | passage | matched / confirmed | — |
| J2 | `j02-passage-cluses` | Cluses | passage | route-point | 46.716 | 10:35 | 485.4 m | 85.1 m | passage | matched / confirmed | — |
| J2 | `j02-passage-le-reposoir` | Le Reposoir | passage | route-point | 58.940 | 11:16 | 974.3 m | 104.5 m | passage | matched / confirmed | — |
| J2 | `j02-pause-cluses` | Cluses | pause | information | — | Heure indisponible | — | — | pause | editorial-group / confirmed | Groupe éditorial non géographique ; aucun waypoint supplémentaire. |
| J2 | `j02-end` | Le Grand-Bornand | end | route-point | 77.903 | 12:19 | 926.3 m | 0.0 m | end | matched / confirmed | — |
| J3 | `j03-start` | Le Grand-Bornand | start | route-point | 0.000 | 08:00 | 926.4 m | 0.0 m | start | matched / confirmed | — |
| J3 | `j03-col-col-des-aravis` | Col des Aravis | col | route-point | 13.720 | 08:45 | 1486.0 m | 0.1 m | col | matched / confirmed | — |
| J3 | `j03-col-col-des-saisies` | Col des Saisies | col | route-point | 39.941 | 10:13 | 1657.0 m | 7.2 m | col | matched / confirmed | — |
| J3 | `j03-passage-la-clusaz` | La Clusaz | passage | route-point | 6.185 | 08:20 | 1033.5 m | 197.0 m | passage | matched / confirmed | — |
| J3 | `j03-passage-flumet` | Flumet | passage | route-point | 25.138 | 09:23 | 909.5 m | 163.7 m | passage | matched / confirmed | — |
| J3 | `j03-passage-crest-voland` | Crest-Voland | passage | weather-reference | 28.553 | 09:35 | 1118.2 m | 1899.7 m | passage | needs-review / probable | Point explicitement retiré du voyage opérationnel par décision utilisateur. |
| J3 | `j03-end` | Beaufort-sur-Doron | end | route-point | 57.752 | 11:12 | 751.0 m | 0.0 m | end | matched / confirmed | — |
| J4 | `j04-start` | Beaufort-sur-Doron | start | route-point | 0.000 | 08:00 | 750.9 m | 0.0 m | start | matched / confirmed | — |
| J4 | `j04-col-cormet-de-roselend` | Cormet de Roselend | col | route-point | 20.391 | 09:07 | 1968.0 m | 0.0 m | col | matched / confirmed | — |
| J4 | `j04-passage-areches` | Arêches | passage | weather-reference | 2.207 | 08:07 | 876.3 m | 2975.1 m | passage | needs-review / probable | Point explicitement retiré du voyage opérationnel par décision utilisateur. |
| J4 | `j04-passage-les-chapieux` | Les Chapieux | passage | weather-reference | 25.613 | 09:25 | 1622.4 m | 521.1 m | passage | needs-review / probable | Point explicitement retiré du voyage opérationnel par décision utilisateur. |
| J4 | `j04-end` | Bourg-Saint-Maurice | end | route-point | 40.749 | 10:15 | 829.8 m | 0.0 m | end | matched / confirmed | — |
| J6 | `j06-start` | Bourg-Saint-Maurice | start | route-point | 0.000 | 08:00 | 830.4 m | 0.0 m | start | matched / confirmed | — |
| J6 | `j06-col-col-de-l-iseran` | Col de l’Iseran | col | route-point | 51.947 | 10:53 | 2764.0 m | 0.6 m | col | matched / confirmed | — |
| J6 | `j06-passage-tignes` | Tignes | passage | weather-reference | 27.816 | 09:32 | 1797.9 m | 3272.5 m | passage | unmatched / probable | Point explicitement retiré du voyage opérationnel par décision utilisateur. |
| J6 | `j06-passage-val-d-isere` | Val d’Isère | passage | route-point | 35.752 | 09:59 | 1831.3 m | 37.8 m | passage | matched / confirmed | — |
| J6 | `j06-passage-bonneval-sur-arc` | Bonneval-sur-Arc | passage | route-point | 65.588 | 11:38 | 1781.6 m | 136.4 m | passage | matched / confirmed | — |
| J6 | `j06-passage-bessans` | Bessans | passage | route-point | 72.737 | 12:02 | 1726.0 m | 275.8 m | passage | matched / probable | — |
| J6 | `j06-pause-tignes-val-d-isere` | Tignes / Val d’Isère | pause | information | — | Heure indisponible | — | — | pause | editorial-group / confirmed | Groupe éditorial non géographique ; aucun waypoint supplémentaire. |
| J6 | `j06-end` | Val-Cenis | end | route-point | 90.593 | 13:01 | 1295.9 m | 0.0 m | end | matched / confirmed | — |
| J7 | `j07-start` | Val-Cenis | start | route-point | 0.000 | 08:00 | 1295.7 m | 0.0 m | start | matched / confirmed | — |
| J7 | `j07-col-col-du-telegraphe` | Col du Télégraphe | col | route-point | 46.620 | 10:35 | 1566.0 m | 0.2 m | col | matched / confirmed | — |
| J7 | `j07-col-col-du-galibier` | Col du Galibier | col | route-point | 69.206 | 11:50 | 2642.0 m | 0.9 m | col | matched / confirmed | — |
| J7 | `j07-passage-modane` | Modane | passage | route-point | 17.617 | 08:58 | 1062.8 m | 204.2 m | passage | matched / confirmed | — |
| J7 | `j07-passage-saint-michel-de-maurienne` | Saint-Michel-de-Maurienne | passage | route-point | 34.564 | 09:55 | 718.2 m | 343.3 m | passage | matched / probable | — |
| J7 | `j07-passage-valloire` | Valloire | passage | route-point | 51.571 | 10:51 | 1406.6 m | 59.3 m | passage | matched / confirmed | — |
| J7 | `j07-passage-le-monetier-les-bains` | Le Monêtier-les-Bains | passage | route-point | 91.310 | 13:04 | 1485.0 m | 118.4 m | passage | matched / confirmed | — |
| J7 | `j07-pause-modane-valloire` | Modane / Valloire | pause | information | — | Heure indisponible | — | — | pause | editorial-group / confirmed | Groupe éditorial non géographique ; aucun waypoint supplémentaire. |
| J7 | `j07-end` | Briançon | end | route-point | 104.924 | 13:49 | 1260.6 m | 0.0 m | end | matched / confirmed | — |
| J9 | `j09-start` | Briançon | start | route-point | 0.000 | 08:00 | 1258.5 m | 0.0 m | start | matched / confirmed | — |
| J9 | `j09-col-col-d-izoard` | Col d’Izoard | col | route-point | 20.916 | 09:09 | 2360.0 m | 0.3 m | col | matched / confirmed | — |
| J9 | `j09-col-le-sauze-du-lac` | le Sauze-du-Lac | col | route-point | 95.299 | 13:17 | 1041.0 m | 51.2 m | col | matched / confirmed | — |
| J9 | `j09-passage-cervieres` | Cervières | passage | route-point | 11.074 | 08:36 | 1615.3 m | 70.6 m | passage | matched / confirmed | — |
| J9 | `j09-passage-arvieux` | Arvieux | passage | route-point | 31.230 | 09:44 | 1554.9 m | 48.1 m | passage | matched / confirmed | — |
| J9 | `j09-passage-chateau-queyras` | Château-Queyras | passage | weather-reference | 35.044 | 09:56 | 1346.8 m | 1573.5 m | passage | needs-review / probable | Point explicitement retiré du voyage opérationnel par décision utilisateur. |
| J9 | `j09-passage-guillestre` | Guillestre | passage | route-point | 52.085 | 10:53 | 1005.8 m | 75.2 m | passage | matched / confirmed | — |
| J9 | `j09-passage-embrun` | Embrun | passage | route-point | 74.860 | 12:09 | 868.1 m | 147.9 m | passage | matched / confirmed | — |
| J9 | `j09-pause-guillestre-embrun` | Guillestre / Embrun | pause | information | — | Heure indisponible | — | — | pause | editorial-group / confirmed | Groupe éditorial non géographique ; aucun waypoint supplémentaire. |
| J9 | `j09-end` | Barcelonnette | end | route-point | 131.459 | 15:18 | 1196.7 m | 0.0 m | end | matched / confirmed | — |
| J10 | `j10-start` | Barcelonnette | start | route-point | 0.000 | 08:00 | 1197.8 m | 0.0 m | start | matched / confirmed | — |
| J10 | `j10-col-col-de-la-bonette` | Col de la Bonette | col | route-point | 29.662 | 09:38 | 2715.0 m | 1.7 m | col | matched / confirmed | — |
| J10 | `j10-passage-jausiers` | Jausiers | passage | route-point | 6.793 | 08:22 | 1211.9 m | 99.7 m | passage | matched / confirmed | — |
| J10 | `j10-passage-sommet` | (sommet) | passage | route-point | 29.662 | 09:38 | 2685.6 m | 1.7 m | passage | matched / confirmed | — |
| J10 | `j10-passage-saint-etienne-de-tinee` | Saint-Étienne-de-Tinée | passage | route-point | 54.340 | 11:01 | 1148.9 m | 85.6 m | passage | matched / confirmed | — |
| J10 | `j10-option-cime-de-la-bonette` | Cime de la Bonette | option | not-ridden-option | 29.676 | 09:38 | 2802.0 m | 557.8 m | option | unmatched / probable | Point explicitement retiré du voyage opérationnel par décision utilisateur. |
| J10 | `j10-end` | Saint-Étienne-de-Tinée | end | route-point | 54.488 | 11:01 | 1151.7 m | 0.0 m | end | matched / confirmed | — |
| J11 | `j11-start` | Saint-Étienne-de-Tinée | start | route-point | 0.000 | 08:00 | 1153.4 m | 0.0 m | start | matched / confirmed | — |
| J11 | `j11-col-col-saint-martin` | Col Saint-Martin | col | route-point | 49.530 | 10:45 | 1503.0 m | 0.9 m | col | matched / confirmed | — |
| J11 | `j11-passage-saint-sauveur-sur-tinee` | Saint-Sauveur-sur-Tinée | passage | route-point | 29.002 | 09:36 | 494.9 m | 39.4 m | passage | matched / confirmed | — |
| J11 | `j11-passage-la-colmiane` | La Colmiane | passage | route-point | 49.251 | 10:44 | 1466.3 m | 106.1 m | passage | matched / confirmed | — |
| J11 | `j11-passage-valdeblore` | Valdeblore | passage | route-point | 42.506 | 10:21 | 1044.9 m | 11.0 m | passage | matched / confirmed | — |
| J11 | `j11-end` | Saint-Martin-Vésubie | end | route-point | 57.885 | 11:12 | 959.5 m | 0.0 m | end | matched / confirmed | — |
| J12 | `j12-start` | Saint-Martin-Vésubie | start | route-point | 0.000 | 08:00 | 957.5 m | 0.0 m | start | matched / confirmed | — |
| J12 | `j12-col-col-de-turini` | Col de Turini | col | route-point | 27.472 | 09:31 | 1607.0 m | 0.6 m | col | matched / confirmed | — |
| J12 | `j12-col-col-de-castillon` | Col de Castillon | col | route-point | 45.917 | 10:33 | 703.0 m | 8.7 m | col | matched / confirmed | — |
| J12 | `j12-col-col-d-eze` | Col d’Èze | col | route-point | 91.331 | 13:04 | 507.0 m | 3.1 m | col | matched / confirmed | — |
| J12 | `j12-passage-sospel` | Sospel | passage | route-point | 51.746 | 10:52 | 351.8 m | 20.0 m | passage | matched / confirmed | — |
| J12 | `j12-passage-option-menton` | option Menton | passage | route-point | 73.392 | 12:04 | 10.0 m | 247.4 m | passage | matched / confirmed | — |
| J12 | `j12-passage-arrivee-nice` | arrivée Nice | passage | route-point | 105.676 | 13:52 | 16.6 m | 636.2 m | passage | matched / probable | — |
| J12 | `j12-pause-sospel` | Sospel | pause | information | — | Heure indisponible | — | — | pause | editorial-group / confirmed | Groupe éditorial non géographique ; aucun waypoint supplémentaire. |
| J12 | `j12-option-menton` | Menton | option | route-point | 73.392 | 12:04 | 10.0 m | 247.4 m | option | matched / confirmed | — |
| J12 | `j12-end` | Nice | end | route-point | 105.715 | 13:52 | 16.6 m | 0.0 m | end | matched / confirmed | — |

## Points correctement projetés et projections recalculées

Toutes les ancres disponibles ont été reprojetées sur chaque segment des GPX définitifs. Les index, fractions, coordonnées, altitudes, distances cumulées et distances à l’ancre ont été remplacés.

## Overrides invalides

53 des 53 snapshots techniques ne décrivaient plus le GPX courant avec les tolérances du moteur. Aucun ancien index n’a été réutilisé comme source de vérité.

## Points hors parcours

Bellevaux, Crest-Voland, Arêches, Les Chapieux, Tignes et Château-Queyras étaient des références hors parcours (position réelle et projection GPX indépendante, aucun détour ajouté). Les six sont désormais supprimées par décision utilisateur (voir la section Suppressions) et n'ont plus de rôle météo ou cartographique. La Cime de la Bonette, ancienne option non parcourue, est également supprimée.

## Groupes éditoriaux et doublons

Les cinq objets pause (Cluses, Val-d’Isère, Modane / Valloire, Guillestre / Embrun et Sospel) sont des fonctions éditoriales attachées à des lieux existants, sans waypoint géographique supplémentaire. Tignes étant supprimée, le groupe autrefois « Tignes / Val-d’Isère » n'enrichit plus que Val-d’Isère (voir `src/trip/roadbook-resolutions.ts`, `displayName`). Les bornes techniques de départ et d’arrivée ne doivent pas créer une seconde carte métier.

## Données non résolues

Aucun véritable lieu géographique ne reste non résolu.

## Décisions automatiques appliquées

- Projection orthogonale sur segment, indépendante de l’échantillonnage.
- `sourceAnchor` conservé comme géométrie réelle et source stable.
- Rôles séparés : parcours, référence météo, information, option non parcourue.
- Absence de repli implicite vers 08:00, km 0, altitude 0 ou [0, 0].

## Exploitabilité météo

Chaque lieu géographique projeté expose une position, une altitude et une heure de référence. Les références hors parcours utilisent la position réelle ; les groupes éditoriaux et la Cime de la Bonette n’alimentent pas le risque par défaut. Le moteur existant fournit température, ressenti, pluie, vent, rafales, visibilité, isotherme zéro et risque.

## Décisions utilisateur nécessaires

Aucune décision bloquante. Les niveaux `probable` restent explicitement auditables.
