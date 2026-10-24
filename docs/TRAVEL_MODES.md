# Vélo et randonnée

> Les [cinq allures et le mode Manuel](LEAGUE_TOUR_CORRECTIONS.md#enregistrement-et-vitesse) sont désormais réalisés. Le présent document décrit le premier lot marche ; la [feuille de route actuelle](ROADMAP.md) distingue calibration restante et fonctions livrées.

Lot `2026.10.23.5`, dans Mes voyages. Le choix **Déplacement : Vélo / Randonnée** apparaît à la création et dans Modifier le voyage, accompagné d’une balise MAJ. Une randonnée est identifiée dans la bibliothèque et l’aperçu.

Les voyages existants sans réglage de déplacement restent à vélo : aucun recalcul ni migration au simple chargement. Le mode Voyage/Tour demeure indépendant du déplacement ; le cadrage [League](LEAGUE.md) prépare une future organisation des courses.

## Estimation des temps

- Vélo : référence initiale **18 km/h**, réglable de 8 à 40 km/h ; calcul historique conservé.
- Randonnée : référence initiale **4,5 km/h sur le plat**, réglable de 2 à 7 km/h. La pente est appliquée ensuite, avec un modèle de Tobler normalisé au plat. Une petite descente peut faciliter la marche ; une descente raide ralentit, contrairement au modèle vélo. Les vitesses locales sont bornées à 0,5–8 km/h et la pente de calcul à ±60 %.
- Altitudes insuffisantes : estimation à vitesse constante, sans pente inventée. Lorsque l’altitude est suffisante, import, recalcul, Parcours, courbe interactive, ETA météo et temporalité utilisent le même modèle de marche et les mêmes règles de profil.

Ces temps décrivent un terrain régulier. Ils ne modélisent pas la technicité d’un sentier, la charge, le revêtement, la fatigue ou la neige. Les seuils des cinq sensibilités de détection des montées restent ceux existants ; leur calibration pour la marche et la future échelle Chill → Sportif sont des lots suivants.

Un changement explicite de déplacement propose sa vitesse de référence, visible avant enregistrement. Pendant la même édition, revenir au déplacement précédent retrouve sa vitesse saisie. Ce rappel par mode concerne la session d’édition ; le voyage conserve ensuite un mode et une vitesse de référence actifs.

## Données et pauses

Le changement de déplacement recalcule localement les durées et invalide les prévisions persistées associées aux anciennes ETA. Il ne relit pas les fichiers GPX et ne relance pas la détection des POI.

Les pauses manuelles et leurs durées sont conservées. Les plans de pauses automatiques sont réévalués aux nouvelles ETA, uniquement pour les étapes suffisamment enrichies ; les pauses proposées peuvent donc changer. Les règles de stabilité lors d’un simple rafraîchissement météo ou changement de départ restent celles existantes. Les jours OFF, transferts, logements, notes, lieux et sources restent conservés.

Les étapes liées passent de nouveau par la résolution des conflits de départ. Un départ incompatible est décalé au quart d’heure suivant l’arrivée précédente ; les ajustements et dépassements de minuit sont signalés avant de quitter l’éditeur. Aucun horaire fictif ne contourne un groupe qui ne tient plus dans la journée.

Limite préexistante : le budget théorique de pauses agrégé peut différer du plan réellement placé si aucun lieu n’est disponible, ou par normalisation à cinq minutes. Le mode Randonnée ne crée pas de faux lieu pour consommer ce budget.

## Carte et vent

Les liens de guidage vers les POI passent en mode marche, y compris lorsqu’une position GPS est ajoutée à l’ouverture de la popup. Les lieux restent issus de la recherche existante le long de la trace ; ce choix ne certifie pas qu’un chemin d’accès est praticable à pied.

Depuis **2026.10.24.6**, le module vent est réservé au vélo : pas de vent moyen dans les statistiques, de flèche relative aux points/segments/montées, ni de mode Vent ou de détails du vent sur le profil en randonnée. Neutre et Pente restent disponibles. Les prévisions météo ordinaires sont conservées. Le passage en marche ne supprime aucune donnée météo ni préférence de profil ; revenir à vélo retrouve les contrôles vent. [Départ GPX et approche](GPX_DEPARTURE_AND_WALKING_WIND.md).

## Conservation et vérification

Aucun changement d’origine, d’identité PWA ou de version de la base IndexedDB. Le réglage optionnel `settings.global.travelMode` accepte `cycling` et `walking` ; son absence signifie vélo. Les sauvegardes complètes conservent ce choix et la vitesse. Aucune réinstallation n’est nécessaire.

Les tests couvrent le comportement physique du modèle, la conservation exacte du vélo, les pentes raides, l’altitude manquante, la cohérence import/recalcul/ETA, les pauses, la persistance, les entrées invalides, la restauration, les liens Maps et le repère du vent. Un contrôle navigateur tactile avec un vrai import GPX complète ces tests ; l’essai iPhone physique après déploiement reste à réaliser.

Validation du lot : `npm run build` (TypeScript et contrôles RGA inclus), **2 156 tests réussis**, aucun échec ni test ignoré. Chromium tactile 390 × 844, fuseau Europe/Brussels : import GPX réel, blocage des vitesses invalides, changement de déplacement seul puis avec modification de structure, conservation des octets GPX, retour dans l’éditeur et absence d’erreurs JavaScript/débordement horizontal. Météo déterministe injectée et contrôleur de carte substitué pour ce scénario.
