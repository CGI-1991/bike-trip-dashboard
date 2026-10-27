# Feuille de route Trip(+)

État au 27 octobre 2026 : repères d’interaction `2026.10.27.2` fusionnés ; lecture des montées, segments et course `2026.10.27.3` proposée en PR. Les demandes directes de l’utilisateur priment sur les documents sources conservés dans `specs/`.

Livraison : une PR par lot cohérent et validé. Fusion et déploiement sont des étapes distinctes. Chaque changement d’usage porte une entrée Nouveautés et une petite balise MAJ locale, accessible au toucher sur iPhone. Conserver l’origine du site, l’identité de la PWA et les activités locales : aucune réinstallation à demander.

## Réalisé

| Chantier | État et référence |
| --- | --- |
| POI | Recherche progressive, sauvegardée et reprenable, couverture du tracé et gestion des fournisseurs. Le premier essai iPhone communiqué par l’utilisateur est rapide, fluide et résiste à l’extinction de l’écran. [Fiabilité](POI_RELIABILITY.md), [fournisseurs](POI_PROVIDER_RESILIENCE.md). |
| Vent | Moyenne de l’étape dans les statistiques : vitesse et provenance cardinale. Vent local relatif sur le profil, aux points et sur les segments/montées ; modes Neutre/Pente/Vent en consultation. Disponible à vélo dans chaque détail Voyage/League/Tour ; masqué en randonnée, avec les autres prévisions météo conservées. **Aucune moyenne globale sur plusieurs parcours ou une saison.** [Règles actuelles](STAGE_WIND_AND_SEGMENT_DISPLAY.md), [calcul](RELATIVE_WIND.md). |
| Randonnée et vélo | Déplacement par activité, références de vitesse et modèle de marche tenant compte de la pente ; recalcul cohérent des temps, pauses et ETA météo. [Déplacements](TRAVEL_MODES.md). |
| Allure | Cinq niveaux **Chill / Tempo / Normal / Soutenu / Sportif**, plus Manuel. Normal reste à **18 km/h à vélo**, **4,5 km/h à pied**, avant correction du terrain ; anciennes vitesses conservées. Import/recalcul/profil/météo/FIT partagent le même relief ; moyenne en mouvement et altitude insuffisante explicites. [Calibration et contrôles](PACE_AND_ETA_CALIBRATION.md). |
| Montées | Catégories vélo Cat. 4 à HC et effort marche 1 à 5. Un seul filtre en cinq positions, réversible, en haut des réglages après l’allure ; second curseur retiré, anciennes calibrations conservées. Segments prioritaires sur les montées qu’ils chevauchent, compteur cohérent. [Lecture et réglage](LEAN_COURSE_DETAIL.md), [critères](CLIMB_CATEGORIES.md). |
| League / Tour | Calendrier League indépendant, dates et départs explicites, navigation Voyage/Calendrier/Étapes ; limites de course facultatives (GPX entier par défaut), heure au départ GPX, approche vélo à référence −3 km/h, statistiques de course distinctes et segments Sprint/Grimpeur/Flandrien. [Départs et approche](GPX_DEPARTURE_AND_WALKING_WIND.md). [Cadrage](LEAGUE.md). |
| Lecture et édition | Vignettes ouvrant les mini-profils ; limites et segments édités dans **Course**, à côté de Météo, sur le profil neutre. Pochage des segments uniquement en Neutre ; portions colorées sur la carte du détail et en plein écran. [Comportement actuel](STAGE_WIND_AND_SEGMENT_DISPLAY.md). |
| Nettoyage avant refonte | Vent sans volet d’explications, boutons GPX/FIT côte à côte en compétition, segments compacts comme les montées, suppression des doublons de lecture et réglage de montées unique. [Règles et vérification](LEAN_COURSE_DETAIL.md). |
| Interface Trip+ | Maquette approuvée le 26 octobre et intégrée : surfaces allégées, statistiques complètes conservées, onglets uniques, commandes au pouce, profils lisibles et vent fixe, filtres et étapes colorées/sélectionnables. Nom visible Trip+, identité PWA et données conservées. [Règles et contrôles](TRIPPLUS_INTERFACE.md). |
| Retours iPhone et Tour | Champs natifs contenus, en-tête et onglets sous l’encoche, lecture temporaire des profils, pictogrammes communs ; repères J1a/J1b et alertes de continuité limitées aux liaisons explicites du Tour. [Correctifs et vérifications](IPHONE_POLISH.md). |
| Repères d’interaction | Bleu commun pour les actions et champs éditables, crayon pour l’édition, chevron pour les profils/volets à déplier, suppressions rouges et focus visible. Les valeurs informatives restent distinctes des contrôles. [Règles et captures](INTERACTION_CUES.md). |
| Informations de parcours | Palette de pente commune, grisé hors course léger, prévisions anciennes signalées après six heures. Le raccourci Prochaine eau est retiré dans le lot du 27 octobre ; les points d’eau restent dans Services. En League/Tour, fiches de montée/segment sur la carte à la place de Calques. [Règles et contrôles](ROUTE_INFORMATION_POLISH.md). |
| Montées, segments et repères | Conversion réversible en Grimpeur en League/Tour, sommets nommés conservés, montées orange, bulles de segment au milieu, drapeaux de course et villes GPX préservées. Lecture sous les mini-profils, fiches de points/services alignées et carte compacte recadrée. Bannières Voyage/Tour/League dans Mes activités. [Comportements et contrôles](CLIMBS_COURSE_REPRESENTATION.md). |
| Passe de contrôle globale | Fiche unique de carte, destruction des cartes remplacées et déverrouillage aux fermetures natives, protection des navigations rapides, erreurs de lecture/export explicites, archives ZIP sans collision de noms et durées arrondies. Contrôle mobile/hors connexion étendu aux sauvegardes, rejets d’archives endommagées et restaurations en copies. [Constats, preuves et limites](QUALITY_AUDIT_2026_10.md). |
| Export GPX enrichi | Lot `2026.10.24.3` : trace d’origine conservée, limites, noms, segments et réglages réimportables ; waypoints standards et extension versionnée. **Ce GPX ne garantit pas d’alertes Garmin.** [Format et vérifications](ENRICHED_GPX.md). |
| Export FIT Course — essai | Lot `2026.10.24.7` : tracé GPX intégral dans le FIT, limites et alertes ajoutées comme repères, comparaison indépendante GPX/FIT et premier export hors connexion vérifiés. [Même parcours](FULL_GPX_FIT_ROUTE.md). **Validation sur appareil Garmin encore nécessaire.** [Format, limites et essai terrain](FIT_COURSE.md). |
| Sauvegardes et mises à jour | Sauvegarde/restauration ZIP complète, originaux conservés, copies sans écrasement ; historique Nouveautés et balises MAJ. [Sauvegarde](TRIP_BACKUP.md), [mises à jour](RELEASE_NOTES.md). |

« Réalisé » décrit le code des lots livrés/proposés ; l’utilisateur retrouve une version sur son téléphone après fusion et déploiement. Nouveautés indique la version effectivement chargée.

## Suite proposée

1. **Validation Garmin réelle — Edge Explore 2** : modèle précisé par l’utilisateur ; confirmer le transfert, vérifier les Course Points et alertes avant/début/fin, puis les capacités sur parcours long. Le lot d’export conserve l’étiquette essai jusque-là. L’encodeur MIT, la lecture indépendante et le contrôle hors connexion sont réalisés ; les réglages globaux d’alerte héritables restent à cadrer au-delà des réglages par segment déjà présents.
2. **Calibration terrain** : vent dans les lacets (cap/profil lissés sur 100 m, points sur 1 km), couverture météo, temps de marche et allures selon le terrain. Les catégories et le filtre sont réalisés, ainsi que la cohérence des ETA ; confronter maintenant ces indicateurs et les allures à des sorties mesurées, sans annoncer une précision terrain non mesurée.
3. **Retour terrain de l’interface Trip+**, prioritairement iPhone en app d’écran d’accueil : confronter l’intégration validée aux usages et ajuster les détails utiles. Le profil revient en Neutre à chaque étape ; pas de zoom/plein écran de profil ni de frise météo supplémentaire. Une fiche POI basse n’est envisagée que si elle simplifie réellement un geste.
4. **Identité** : le nom visible **Trip+** est validé et intégré ; préserver l’origine, l’identité technique de la PWA et les activités existantes lors des évolutions suivantes.

En continu : surveiller les recherches POI longues et multi-étapes, les reprises après veille et les changements de version ; conserver des résultats partiels et des diagnostics explicites. Le suivi terrain n’impose pas une nouvelle recherche complète à chaque ouverture.

Cas technique à auditer séparément : l’import d’une trace passant de longitude +180 à −180 a fortement ralenti dans un scénario synthétique de trois points pendant les contrôles FIT, avant l’export. Ne pas confondre ce cas avec la conversion FIT de coordonnées proches de +180, couverte par un test. Reproduction : (45, 180), (45,01, 179,99999995), (45,02, −180), altitudes 200/250/300 m.

## Suggestions à cadrer ensuite

- Météo intermédiaire avec budget réseau/cache pour réduire les grandes distances entre prévisions.
- Comparaison d’horaires de départ : vent, rafales, pluie, chaleur et arrivée avant la nuit.
- Vent apparent et estimation d’effort, à relier au modèle d’allure avant de modifier les ETA.
- Ravitaillement et autonomie : étendre le repère d’eau réalisé aux autres services, puis cadrer les réserves et temps d’accès réels avec des données suffisantes.

Ces suggestions restent des pistes, pas des fonctions annoncées comme disponibles.
