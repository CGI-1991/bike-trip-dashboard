# Feuille de route Trip(+)

Demandes confirmées le 22 octobre 2026.

Livraison : une PR par lot cohérent, suffisamment abouti et validé. La fusion et la publication restent des étapes distinctes.

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

Les modes marche, l’allure à cinq niveaux, le filtrage des montées et le nouveau nom sont mémorisés ici ; leur interface ne fait pas partie du correctif POI.
