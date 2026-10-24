# Cadrage League et Tour

> Depuis **2026.10.24.6**, la [règle de départ GPX et de vent à vélo](GPX_DEPARTURE_AND_WALKING_WIND.md) prime sur les comportements historiques décrits ci-dessous : limites facultatives en League/Tour, heure au départ GPX, approche incluse dans les ETA et module vent masqué en randonnée.


Document de développement, à partir du [cadrage fourni par l’utilisateur](specs/league-source.md), conservé sans modification. Ce fichier adapte la proposition à l’application existante. Le [calendrier](LEAGUE_CALENDAR.md), les [limites avec statistiques distinctes](RACE_BOUNDS.md), le [recalage des horaires, météo et vent](RACE_COURSE_TIMING.md), les [segments manuels](RACE_SEGMENTS.md) et l’[export/réimport GPX enrichi](ENRICHED_GPX.md) sont réalisés. Le [FIT Course](FIT_COURSE.md) est disponible en essai, vérifié avec un lecteur indépendant ; sa validation sur appareil Garmin reste à faire.

La [précision directe du 24 octobre](COURSE_WIND_AND_EDITING.md) conserve le vent dans chaque détail League/Tour, retire uniquement sa moyenne sur plusieurs parcours et regroupe l’édition dans Course, à côté de Météo. Elle prime sur les anciennes règles d’interface des documents sources.

## Intention et vocabulaire

La demande directe est un mode **League**, utilisé notamment pour BCF, avec un calendrier de courses. Le nom League remplace BCF dans la navigation ; le modèle doit rester réutilisable pour d’autres compétitions. Le document fourni décrit aussi la préparation détaillée d’une course et les exports Garmin.

Recommandation : conserver **Voyage / League / Tour** comme trois organisations visibles, avec un socle de compétition partagé par League et Tour.

| Organisation | Calendrier | Arrêts dans une étape | Outils de compétition |
| --- | --- | --- | --- |
| Voyage | Journées d’itinérance, OFF et transferts | Automatiques ou manuels | Facultatifs à terme |
| League | Courses indépendantes, chacune à sa date | Désactivés pendant la course | Limites de course, segments et exports |
| Tour | Étapes ordonnées ; conserver les étapes liées sur un même jour | Désactivés pendant la course | Même moteur de limites, segments et exports |

Fusionner entièrement League et Tour ferait perdre la différence entre un calendrier d’épreuves indépendantes et une suite d’étapes. En revanche, il faut mutualiser les composants, calculs et capacités de compétition, sans recopier les écrans ou multiplier des conditions BCF.

Le choix **Vélo / Randonnée** est un axe distinct : il choisit le déplacement et le calcul des temps, pas l’organisation du calendrier. Le booléen actuel `raceMode` porte déjà le mode Tour ; les anciennes valeurs doivent garder ce sens lors d’une future évolution du modèle. Ne pas renommer ni réinterpréter les voyages existants pour introduire League.

## Premier lot League à rendre utilisable

Le calendrier fait partie du premier lot demandé, même si la proposition jointe le place en phase 6.

- Collection League et épreuves avec identifiant, nom, **date d’épreuve explicite**, heure de départ et parcours associé. Une course du 14 mars et une autre du 28 mars ne deviennent pas deux jours consécutifs d’un Tour.
- La date ne vient jamais de l’import, du fichier ou des timestamps GPX. Les dates des autres épreuves ne changent pas lorsqu’on déplace une course.
- Vue de calendrier/liste chronologique adaptée à l’iPhone ; ouverture d’une épreuve, modification et conservation locale.
- Capacités partagées de compétition : les arrêts dans la course sont désactivés. La logistique et les lieux utiles peuvent rester consultables séparément ; ne pas supprimer les POI sauvegardés en entrant dans League ou Tour. Le chargement de nouveaux POI doit rester explicite et respecter le moteur progressif existant.
- Début et fin de course stockés par **distance le long de la trace source**, avec empreinte de géométrie, puis points projetés pour la carte. Garder le GPX complet comme source, avec statistiques complètes et statistiques de course distinctes.

Le choix final de structure doit réutiliser les entités existantes (`TripBundle`, routes, jours/étapes) lorsqu’elles expriment réellement les mêmes invariants. Un calendrier d’épreuves indépendantes ne doit pas contourner artificiellement la validation actuelle qui dérive les dates depuis le début du voyage. Évaluer un conteneur d’épreuves ou une extension versionnée dédiée avant de coder la persistance.

## Segments de compétition

Types manuels : **Grimpeur** rouge, **Sprint** vert, **Flandrien** jaune. Un identifiant stable, une référence d’épreuve, des offsets de début/fin, un nom, une provenance et des réglages d’alerte sont nécessaires.

Ils restent indépendants des montées détectées automatiquement. Un changement de sensibilité ne doit jamais les supprimer ni les déplacer. Accepter les chevauchements ; afficher lettres/symboles et libellés en plus des couleurs.

L’édition se fait sur carte et profil avec projection sur la trace, puis ajustement des limites. Aux intersections, boucles et portions parallèles, ne pas sélectionner silencieusement le mauvais passage : le chaînage doit lever l’ambiguïté. Sur téléphone, prévoir aussi un ajustement précis sans glisser-déposer obligatoire.

Les bandes de segments se superposent aux modes de profil existants Neutre/Pente/Vent sans les remplacer. Griser les parties avant le départ et après l’arrivée de course. Distinguer **Trace GPX**, **Course calculée** et **Officiel** ; la valeur calculée ne devient pas une distance « réelle » ou « officielle ».

## Exports et alertes

1. GPX enrichi réimportable réalisé : conserver trace, limites, segments, noms et réglages d’alerte. Waypoints standards pour une compatibilité minimale ; extension XML versionnée pour conserver la préparation de cette course. Le GPX ne remplace pas la sauvegarde ZIP complète et ne garantit pas de notifications Garmin. [Format et conservation](ENRICHED_GPX.md).
2. FIT de type Course : parcours et Course Points générés, lecteur indépendant vérifié. Bouton **FIT Garmin · essai** tant que l’import et les alertes n’ont pas été confirmés sur un appareil réel ; ne pas annoncer une compatibilité Garmin validée avant cet essai.
3. Par défaut, alerte **500 m avant** un segment et au début ; alerte de fin désactivée. Générer explicitement le point `début du segment − distance d’alerte` sur la trace.

L’alerte ne doit jamais passer avant le début de course, produire un offset négatif ni annoncer une fausse distance restante lorsqu’elle a été rabattue au départ. Définir une règle explicite pour ce cas. Un segment hors des limites de course doit être signalé et traité avant export. Un GPX remplacé invalide les références géométriques jusqu’à remappage vérifié, sans déplacement silencieux.

Le stockage local reste la source de vérité. Strava, Garmin Connect et Komoot ne sont pas requis ; l’import Strava est une extension facultative ultérieure. Vérifier la compatibilité du SDK/licence et des appareils ciblés avant de choisir la bibliothèque FIT.

## Livraison par PR

1. Modèle/capacités + calendrier League, compatibilité et sauvegarde/restauration, avec une interface minimale utilisable.
2. Limites de course, statistiques distinctes et éditeur graphique des segments réalisés.
3. Export/réimport GPX enrichi réalisé, avec vérification de conservation de la trace et de la préparation de course.
4. FIT Course et points d’alerte réalisés en essai ; validation sur Garmin réel restante.

Chaque lot porte une balise MAJ locale, une entrée Nouveautés et des tests des cas limites qu’il introduit. Ne pas présenter la V1 complète comme achevée avant que les critères du document source, notamment les deux exports, soient vérifiés.

## Détection des montées : point de contrôle

Le document source rapporte un changement de sensibilité non répercuté après import. Le dépôt possède déjà une voie de recalcul (`applyClimbDetectionSensitivity` / `recomputeTripClimbs`) et des tests ; il faut reproduire le cas restant avant d’attribuer une cause ou de réécrire ce mécanisme. La PR Randonnée complète la conservation des pentes raides lors de ce recalcul, mais ne constitue pas une résolution générale du symptôme rapporté.

Pour League, ajouter les scénarios aller-retour entre sensibilités, rechargement, édition structurelle et conservation des segments de compétition. Les caches de profil, carte et points doivent suivre la nouvelle géométrie ou les nouvelles montées automatiques sans toucher aux segments manuels.
