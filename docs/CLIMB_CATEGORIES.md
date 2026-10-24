# Catégories de montées et randonnée — 2026.10.24.8

> Depuis le [lot de nettoyage 2026.10.24.10](LEAN_COURSE_DETAIL.md), le filtre ci-dessous est le seul réglage visible, dans Informations juste après l’allure. Détection avancée est retirée de l’interface ; les calibrations historiques restent conservées.

Le filtre **Montées retenues** possède cinq positions, dans la création et la modification d’une activité. Il complète la sensibilité historique, conservée dans **Détection avancée**. Cette demande directe remplace les anciennes règles excluant tout filtre de catégorie.

| Position | Vélo | Randonnée |
| --- | --- | --- |
| 1 | Toutes | Toutes |
| 2 | Cat. 4 et plus | Effort 1 et plus |
| 3 | Cat. 3 et plus | Effort 2 et plus |
| 4 | Cat. 2 et plus | Effort 3 et plus |
| 5 | Cat. 1 et HC | Effort 4 et 5 |

À vélo, le score indicatif est longueur en mètres × pente moyenne nette en %. Les seuils Cat. 4 / 3 / 2 / 1 / HC sont 8 000 / 16 000 / 32 000 / 64 000 / 80 000 ; les ascensions plus petites portent « Côte ». Il ne s’agit pas d’un classement officiel de course ou d’une garantie de correspondance avec un compteur Garmin.

À pied, l’indicateur est longueur en km + D+/100, avec seuils 2 / 4 / 8 / 12 / 20 pour les efforts 1 à 5. En dessous, « Petite montée ». Cet effort décrit la montée, sans estimer la technicité du sentier, l’exposition, la charge ou la fatigue. La méthode se lit en ouvrant la vignette, sans texte supplémentaire permanent dans le Parcours.

## Détecter puis filtrer

Les catégories sont dérivées des métriques, jamais copiées dans un second champ persistant. `settings.global.climbCategoryMinimum` est facultatif : absent ou zéro signifie **Toutes**, sans changement des anciennes activités au chargement. Les valeurs entières 0 à 4 sont vérifiées à l’import, à l’enregistrement et à la restauration.

Le filtre projette les identifiants retenus dans `RideStage.climbIds`, communs aux points, profils, cartes, compteurs et échantillons météo. Le réservoir complet de montées reste dans `bundle.climbs` : **identifiants, noms et overrides conservés**. Passer entre les cinq positions ne relance ni la détection, ni les fournisseurs ; les ensembles sont emboîtés et revenir à Toutes restaure les mêmes montées. Les montées créées manuellement, les montées portant une pause active et les segments manuels sont conservés. Les ancres géographiques de recherche POI utilisent le réservoir complet, indépendamment du filtre.

Un changement de la sensibilité avancée relance toujours la vraie détection. Changer explicitement de sport la relance également, ce qui manquait auparavant. Les identifiants de montées correspondant sans ambiguïté à des bornes proches sont réutilisés ; les noms réels restent transférés selon les règles existantes. Une activité sauvegardée n’est pas recalculée automatiquement à son ouverture.

## Seuils de marche

La détection vélo conserve ses seuils et son comportement historique. La marche utilise des profils adaptés : 600 m / 100 m D+ / 3 %, ou 300 m / 60 m D+ / 8 %, ou 150 m / 35 m D+ / 10 %. Les cinq sensibilités avancées modulent ces seuils, avec planchers de 100 m, 20 m D+ et 3 %. Une courte descente intermédiaire est tolérée jusqu’à 10 m de perte et 150 m de longueur au niveau standard. Les pentes de marche gardent leur plafond de calcul à 60 %, distinct du vélo. Ces seuils restent une calibration initiale à confronter aux sorties réelles.

Aucun changement de vitesse, de GPX, de limites de course, de segments ou d’identité PWA dans ce lot. Les calculs d’ETA et d’allure font l’objet du lot suivant. Les instantanés de pauses automatiques dépendant des montées sont réévalués après modification du réglage.

## Vérification

`npm run build` puis `npm test` : **2 267 tests réussis**, aucun échec ni test ignoré. Six nouveaux scénarios vérifient les seuils des catégories, les cinq ensembles emboîtés et réversibles, les noms/identifiants/pauses manuelles conservés, la montée courte et raide à pied sans faux positif sur bruit, le changement de sport, la persistance IndexedDB, les sources/segments et le refus de valeurs invalides. Les tests vélo/RGA existants restent conservés.

Chromium tactile **320 et 390 × 844**, application compilée et Service Worker : création GPX réelle, catégorie vélo, enregistrement du filtre, ajout d’un Sprint, passage à pied, deux montées dont une courte, mini-profil et explication, balise MAJ, rechargement et modification du filtre hors connexion. Les octets GPX et le segment manuel sont conservés, le vent est absent à pied, aucun débordement ni erreur JavaScript. Météo indisponible et tuiles bloquées ; l’essai iPhone physique reste à réaliser après déploiement.
