# League — premier lot : calendrier des courses

Version `2026.10.23.6`. Le [cadrage League/Tour](LEAGUE.md) prévoit plusieurs lots ; celui-ci livre le calendrier et le socle de modes, sans annoncer les segments ou les exports Garmin comme disponibles.

## Utilisation sur iPhone

1. Dans Mes voyages, choisir **Créer un voyage**, puis **League** dans le sélecteur Voyage / League / Tour.
2. Donner un nom au calendrier, ajouter un GPX par course, puis renseigner pour chacune un nom facultatif, sa **date** et son **heure de départ**. Ces dates ne sont jamais reprises de la date d’import, du fichier ou des timestamps GPX.
3. Ouvrir la League : les courses sont classées par date puis heure et regroupées par mois/année. Une carte ouvre directement le parcours, son profil, sa météo et son vent selon les données disponibles.
4. Dans Modifier le voyage, changer les dates/départs, ajouter, remplacer ou retirer un GPX. Changer une course ne décale pas les autres. Le classement peut changer ; les identifiants, noms, fichiers et données restent associés à leur course.

Les repères `C1`, `C2` indiquent l’ordre du calendrier, pas un nombre de jours consécutifs. Deux courses peuvent avoir la même date et des départs différents sans être des étapes liées. La météo suit chaque date d’épreuve, dans les limites habituelles de disponibilité des prévisions.

Les balises MAJ figurent près du sélecteur et du calendrier. Une League peut être sauvegardée/restaurée avec la sauvegarde complète existante. Aucune réinstallation de l’app n’est nécessaire.

## Modèle et compatibilité

Le modèle existant contient déjà un identifiant de journée, une étape et son parcours. Une course League réutilise ces identités ; ses dates ne sont pas dupliquées dans un second objet indépendant qui pourrait diverger du parcours.

- `settings.global.organizationMode` accepte `voyage`, `league`, `tour`. Son absence reprend le comportement historique de `raceMode` : Voyage si faux/absent, Tour si vrai.
- Les capacités d’organisation centralisent dates indépendantes, arrêts planifiés, étapes liées et recherche automatique des POI. Le déplacement Vélo / Randonnée reste un choix distinct.
- Une League exige au moins une course datée, uniquement des journées `ride`, aucune liaison entre courses et aucun budget d’arrêt pendant la course. `raceMode: true` reste cohérent avec ce mode de compétition.
- `TripDay.date` est la date explicite de la course ; son départ vient de `settings.days`. Les bornes du calendrier et leurs projections dans les métadonnées deviennent l’enveloppe de ces dates. Elles ne servent pas à dériver les dates suivantes.
- Voyage et Tour gardent leurs dates continues et leurs règles existantes. Il n’y a ni migration au chargement, ni nouvelle version IndexedDB, ni changement d’origine ou d’identité PWA.

Une modification de date/départ seule utilise la voie légère avec une écriture atomique, sans nouveau calcul GPX ni requête POI. Seules les prévisions persistées de la course modifiée sont invalidées. Le nom du calendrier, les lieux et les autres courses restent conservés.

L’édition structurelle réutilise le pipeline existant. Comme les dates peuvent trier les courses avant la fusion, la conservation d’identité s’appuie sur l’association fichier → route → étape → course, et non sur la position de la ligne. Les octets des fichiers conservés restent identiques.

## POI et réseau

Une nouvelle League ne lance pas automatiquement la recherche de services pour toutes ses courses. Les lieux déjà enregistrés restent lisibles. **Réglages avancés → Actualiser les services** active explicitement cette recherche pour le calendrier : le choix est persisté dans `leaguePoiSearchEnabled` et les travaux incomplets peuvent reprendre au retour dans l’app, avec le moteur progressif existant.

La préparation d’une course ne reste pas bloquée sur une recherche POI qui n’a pas été demandée. Les enrichissements de parcours et la météo conservent leur fonctionnement existant ; ce réglage concerne la recherche de services. Aucun arrêt planifié n’est ajouté à la course par un POI.

## Limites de ce lot

- League se choisit à la création. La conversion d’une itinérance ou d’un Tour en calendrier indépendant, et l’opération inverse, ne sont pas proposées : leurs dates et journées OFF/transferts ne sont pas transformées silencieusement.
- Un GPX par course et au moins une course conservée. Le contrôle des GPX strictement identiques reste actif ; la duplication d’une course avec réutilisation du même fichier appartient à un lot ultérieur.
- Les départs/arrivées de course limités à une sous-partie du GPX, les statistiques correspondantes et les segments Grimpeur/Sprint/Flandrien arrivent ensuite. Les statistiques actuelles concernent le parcours complet.
- Les téléchargements GPX existants restent disponibles, sans promettre la conservation de métadonnées de compétition qui ne sont pas encore implémentées. GPX enrichi réimportable, FIT Garmin et alertes Course Points sont des lots distincts.
- Le calendrier est une liste chronologique regroupée par mois, adaptée au toucher. La refonte visuelle globale reste planifiée.

## Validation

Tests d’import GPX réel, dates explicites/gaps/même jour, validation stricte, changement indépendant d’une date ou d’un départ, invalidation météo ciblée, no-op, ajout/suppression avec changement d’ordre, préservation des GPX et d’un lieu épinglé, sauvegarde/restauration et choix POI volontaire. Les contrôles Voyage/Tour/Randonnée et RGA restent dans la suite complète.

Contrôle Chromium tactile 390 × 844, Europe/Brussels, avec vrais IndexedDB et import GPX : deux courses importées dans l’ordre inverse de leurs dates, ouverture du profil, modification d’une date, ajout d’une course antérieure, conservation des identifiants/fichiers après rechargement du navigateur et absence d’erreurs JavaScript ou de débordement horizontal. Météo déterministe injectée ; carte remplacée par un contrôleur dans ce scénario. L’essai iPhone physique après déploiement reste à réaliser.

Le contrôle mobile a aussi permis de corriger le sélecteur de fichiers de l’éditeur : une copie des fichiers est prise avant de vider le champ, car son `FileList` est vivant et pouvait se retrouver vide avant l’ajout. Ce correctif a sa propre balise MAJ près du bouton d’ajout de GPX et son entrée Nouveautés.

Validation : build TypeScript/Vite et contrôles paquet/golden RGA, **2 168 tests réussis**, aucun échec ni test ignoré.
