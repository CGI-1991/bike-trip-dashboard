# Feuille de route Trip(+)

Demandes confirmées le 22 octobre 2026.

Livraison : une PR par lot cohérent, suffisamment abouti et validé. La fusion et la publication restent des étapes distinctes.
Chaque mise à jour doit être expliquée dans Nouveautés et signalée par une petite balise MAJ à l’endroit de la fonctionnalité concernée, accessible au toucher sur iPhone.

## Priorités confirmées le 23 octobre 2026

1. **POI** : les deux premiers lots sont livrés ; le premier essai iPhone communiqué par l’utilisateur est rapide, fluide et résiste à l’extinction de l’écran. Garder les contrôles de non-régression et le suivi terrain.
2. **Vent relatif au déplacement** : premier lot réalisé, documenté dans [RELATIVE_WIND.md](RELATIVE_WIND.md). Mini cycliste vers le haut, flèche suivant le déplacement de l’air, lecture sur le profil et aux points du Parcours, moyennes étape/voyage, parts face/dos/latéral, couverture et rafales latérales estimées. Trois modes : neutre, pente, composante de vent de face en bleu. Lissage initial 100 m sur le profil et moyenne 1 km aux points ; à calibrer sur iPhone et dans les lacets. La résolution réelle des prévisions reste explicite.
3. **Modes randonnée et vélo** : premier lot réalisé, [TRAVEL_MODES.md](TRAVEL_MODES.md). Choix par voyage, temps de marche selon la pente, ETA cohérentes, liens à pied et repère du vent adapté. Calibration terrain, allure à cinq niveaux et filtres de montées dédiés restent à poursuivre.
4. **League (usage BCF)** : calendrier de courses à dates indépendantes, distinct du voyage itinérant et du Tour. [Cadrage adapté au dépôt](LEAGUE.md), à partir du document fourni. Recommandation : Voyage / League / Tour visibles, avec outils de compétition communs à League et Tour. Prévoir limites de course, segments manuels Grimpeur/Sprint/Flandrien, GPX enrichi réimportable puis FIT Garmin avec alertes explicites 500 m avant. Le calendrier reste dans le premier lot League.
5. **Vitesse / effort** : cinq niveaux de Chill à Sportif, avec un niveau central de référence stable pour le mode choisi.
6. **Montées**, sauvegarde/restauration complète, repères MAJ et future refonte mobile restent dans le périmètre. Les montées à cinq niveaux avaient déjà été demandées et ne doivent pas disparaître de la feuille de route.

- Nom de travail : **Trip(+)**. Variante suggérée : **Trip+**, plus simple à lire et à rechercher. Le changement de nom visible ne doit pas changer l’origine du site, l’identité de l’app installée ni la base des voyages.
- Ajouter l’**itinérance à pied**, en complément du vélo : mode de déplacement par voyage, estimation des durées et services pertinents adaptés. Prévoir des voyages d’un jour, multi-étapes et sportifs.
- Remplacer la saisie principale de vitesse par **cinq niveaux d’allure**, de **Chill** à **Sportif**. Le niveau 3 correspond à une vitesse de référence standard stable pour le mode choisi. Les cinq intitulés et les coefficients restent à définir ; préserver les réglages existants à la migration. Distinguer l’allure choisie de l’estimation tenant compte du terrain.
- Faire évoluer les **cinq niveaux de détection des montées déjà présents** (Montagne → Pays plat) vers une détection/filtration plus lisible, inspirée du principe des catégories Garmin : permettre de voir davantage de petites montées ou seulement les plus significatives. Clarifier les critères distance, pente, dénivelé et catégorie et les adapter à la marche ; conserver le profil et les altitudes sources.
- Après la fiabilisation du moteur : **refonte complète de l’interface mobile**, plus simple, agréable et cohérente, avec priorité à l’utilisation sur iPhone en app d’écran d’accueil.

## Chantier engagé : fiabilité des POI

1. Couverture continue du tracé, y compris les frontières et subdivisions.
2. Résultats partiels visibles, sauvegardés et reprenables après interruption.
3. Dépendances par étape ; une étape éloignée ne doit pas bloquer toutes les autres.
4. Projection géographique accélérée, erreurs réseau/stockage distinctes et diagnostics honnêtes.
5. Reprise au retour au premier plan ; mise à jour de l’app sans réinstallation et conservation des voyages, GPX, logements, réglages et pauses manuelles.
6. Actualisation ciblée des services, fraîcheur du cache et contrôle des accès/détours réels.
7. Sauvegarde/restauration complète des voyages et validation de mise à jour sur iPhone.

L’allure à cinq niveaux, le filtrage des montées et le nouveau nom restent mémorisés ici ; leur interface ne fait pas partie du correctif POI. Le premier lot marche est documenté séparément.

## Suggestions pour la qualité de l’information

- Météo intermédiaire avec budget réseau/cache pour réduire les grandes distances entre prévisions.
- Comparaison d’horaires de départ : vent, rafales, pluie, chaleur et arrivée avant la nuit.
- Vent apparent et estimation d’effort, à relier au futur modèle d’allure avant de modifier les ETA.
- Autonomie eau et ravitaillement : prochain service accessible, temps pour l’atteindre et fiabilité de l’information.

La sauvegarde/restauration complète est réalisée dans le lot `2026.10.23.3` ([TRIP_BACKUP.md](TRIP_BACKUP.md)). Les repères de mise à jour restent une exigence de chaque livraison. La validation terrain du vent et de la marche, le calendrier League, l’allure à cinq niveaux, le filtrage des montées et la refonte mobile suivent les priorités ci-dessus.
