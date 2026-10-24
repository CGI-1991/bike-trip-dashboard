# Feuille de route Trip(+)

État au 24 octobre 2026, avec le lot `2026.10.24.3` proposé en PR. Les demandes directes de l’utilisateur priment sur les documents sources conservés dans `specs/`.

Livraison : une PR par lot cohérent et validé. Fusion et déploiement sont des étapes distinctes. Chaque changement d’usage porte une entrée Nouveautés et une petite balise MAJ locale, accessible au toucher sur iPhone. Conserver l’origine du site, l’identité de la PWA et les activités locales : aucune réinstallation à demander.

## Réalisé

| Chantier | État et référence |
| --- | --- |
| POI | Recherche progressive, sauvegardée et reprenable, couverture du tracé et gestion des fournisseurs. Le premier essai iPhone communiqué par l’utilisateur est rapide, fluide et résiste à l’extinction de l’écran. [Fiabilité](POI_RELIABILITY.md), [fournisseurs](POI_PROVIDER_RESILIENCE.md). |
| Vent relatif | Repère compact, direction et vitesse, lecture tactile sur le profil et aux points de passage, moyenne du parcours et des segments/montées, modes Neutre/Pente/Vent. Disponible dans chaque détail Voyage/League/Tour. **Aucune moyenne globale sur plusieurs parcours ou une saison.** [Règles actuelles](COURSE_WIND_AND_EDITING.md), [calcul](RELATIVE_WIND.md). |
| Randonnée et vélo | Déplacement par activité, références de vitesse et modèle de marche tenant compte de la pente ; recalcul cohérent des temps, pauses et ETA météo. [Déplacements](TRAVEL_MODES.md). |
| Allure | Cinq niveaux **Chill / Tempo / Normal / Soutenu / Sportif**, plus Manuel. Normal reste à **18 km/h à vélo**, **4,5 km/h à pied**, avant correction du terrain ; anciennes vitesses conservées. [Références et conservation](LEAGUE_TOUR_CORRECTIONS.md). |
| Montées | Cinq sensibilités déjà présentes ; enregistrement du curseur corrigé. Recalcul indépendant des segments manuels, conservation des valeurs sources. La lisibilité des catégories et la calibration marche restent à améliorer. [Contrôles](LEAGUE.md#détection-des-montées--point-de-contrôle). |
| League / Tour | Calendrier League indépendant, dates et départs explicites, navigation Voyage/Calendrier/Étapes ; limites de course, statistiques et horaires cohérents, segments Sprint/Grimpeur/Flandrien. [Cadrage](LEAGUE.md). |
| Lecture et édition | Vignettes de segments ouvrant leur mini-profil en lecture ; limites et segments édités dans **Course**, à côté de Météo, avec le même profil principal. [Comportement actuel](COURSE_WIND_AND_EDITING.md). |
| Export GPX enrichi | Lot `2026.10.24.3` : trace d’origine conservée, limites, noms, segments et réglages réimportables ; waypoints standards et extension versionnée. **Ce n’est pas encore un export FIT ni une garantie d’alertes Garmin.** [Format et vérifications](ENRICHED_GPX.md). |
| Sauvegardes et mises à jour | Sauvegarde/restauration ZIP complète, originaux conservés, copies sans écrasement ; historique Nouveautés et balises MAJ. [Sauvegarde](TRIP_BACKUP.md), [mises à jour](RELEASE_NOTES.md). |

« Réalisé » décrit le code des lots livrés/proposés ; l’utilisateur retrouve une version sur son téléphone après fusion et déploiement. Nouveautés indique la version effectivement chargée.

## Suite proposée

1. **FIT Garmin Course et alertes** : sélectionner un encodeur/licence compatible, préparer les Course Points, vérifier avec un lecteur indépendant puis avec le modèle Garmin ciblé. Conserver les alertes explicites avant/début/fin et l’omission annoncée si les 500 m ne sont pas disponibles avant un segment. Le modèle d’appareil reste à préciser ; cela ne bloque pas le GPX.
2. **Calibration terrain** : vent dans les lacets (cap/profil lissés sur 100 m, points sur 1 km), couverture météo, temps de marche et allures selon le terrain. Faire évoluer les cinq sensibilités vers des catégories de montées plus compréhensibles, avec critères distance/pente/dénivelé et adaptation à pied ; conserver les profils et segments manuels.
3. **Refonte de l’interface mobile**, prioritairement iPhone en app d’écran d’accueil : hiérarchie plus simple, lecture du parcours, navigation et formulaires cohérents, moins de texte. Préparer un lot d’interface concret avant de généraliser.
4. **Nom visible** : nom de travail **Trip(+)**, variante recommandée **Trip+**. Changer le nom et l’identité visuelle sans changer l’origine, l’identité technique de la PWA ni le stockage local.

En continu : surveiller les recherches POI longues et multi-étapes, les reprises après veille et les changements de version ; conserver des résultats partiels et des diagnostics explicites. Le suivi terrain n’impose pas une nouvelle recherche complète à chaque ouverture.

## Suggestions à cadrer ensuite

- Météo intermédiaire avec budget réseau/cache pour réduire les grandes distances entre prévisions.
- Comparaison d’horaires de départ : vent, rafales, pluie, chaleur et arrivée avant la nuit.
- Vent apparent et estimation d’effort, à relier au modèle d’allure avant de modifier les ETA.
- Autonomie eau et ravitaillement : prochain service accessible, temps pour l’atteindre et fiabilité de l’information.

Ces suggestions restent des pistes, pas des fonctions annoncées comme disponibles.
