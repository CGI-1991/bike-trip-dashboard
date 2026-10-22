# Fiabilisation des POI — premier lot

22 octobre 2026. Cas prioritaire : trajet de plus de 100 km et itinérance multi-étapes, consultés sur iPhone en application d’écran d’accueil. Objectif : résultats progressifs conservés et reprenables, sans réinstallation.

## Changements réalisés

- Le découpage utilise le chaînage de la trace complète, avec interpolation des frontières. La simplification intervient ensuite, par tronçon, avec une tolérance géométrique de 100 m pour la géographie et 25 m pour les POI. La collecte POI possède une marge de rappel de 30 m ; le filtre final reste à 500 m du tracé.
- La géographie et les POI s’enchaînent par étape. Une étape incomplète diffère ses propres recherches autour des localités ; les autres peuvent continuer.
- Chaque tronçon POI réussi est fusionné et sauvegardé avant la requête suivante. Les réponses partielles restent dans le voyage et dans le cache. Une reprise réutilise les réponses acquises.
- Les marqueurs des services sont actualisés dans une carte plein écran ouverte, sans reconstruire la carte Leaflet ni réinitialiser son zoom. La progression identifie la journée par son identifiant et affiche les zones traitées.
- Un index spatial réutilisable remplace le parcours exhaustif de tous les segments pour chaque candidat POI. Le chaînage de projection reste celui de la trace, indépendant de la latitude du candidat.
- Les stations vélo sans nom conservent le tag nécessaire à leur reconnaissance. Les requêtes et les entrées de cache sont comptées par tronçon, avec un comptage distinct des erreurs de stockage.
- Une écriture locale en échec ne déclenche plus de subdivision réseau. Les mises à jour de fond s’appliquent atomiquement aux dernières données sauvegardées et écrivent seulement les collections modifiées ; elles ne recréent pas un voyage supprimé.
- Le retour au premier plan et `pageshow` déclenchent la même reprise temporisée que le retour du réseau.
- L’action de l’éditeur devient **Actualiser les services**. Elle utilise une nouvelle génération de recherche POI, conserve les lieux déjà affichés, la géographie et les pauses, et demande immédiatement la reprise. Une réponse d’une génération précédente ne peut pas écraser cette demande.

## Conservation des voyages installés

Le nom et la version de la base IndexedDB restent inchangés. Il n’y a ni suppression de base, ni recréation des voyages, ni changement d’origine ou d’identité PWA. Les traces sources, logements, réglages, notes et pauses manuelles sont conservés.

Le plan de recherche possède désormais une version additive. Les anciennes marques « terminé » ne prouvaient pas la couverture géométrique : elles sont revalidées une fois. Les résultats déjà affichés restent disponibles pendant ce travail. Un plan courant sauvegardé est réutilisé aux ouvertures suivantes.

Cette compatibilité concerne les données automatiques de recherche. La sauvegarde/restauration complète des voyages reste un chantier séparé à réaliser avant une future migration du schéma des voyages ; l’export GPX existant ne remplace pas une telle sauvegarde.

## Vérifications

- Suite complète : **2 051 tests réussis, aucun échec ni test ignoré** lors de la validation de ce lot.
- TypeScript, compilation Vite, contrôle du paquet RGA et golden master conformes.
- Nouvelles régressions : géométrie clairsemée et dernier tronçon, POI situé dans une ancienne lacune, chaîne réelle de décodage d’une station vélo anonyme, persistance avant la requête suivante, reprise après HTTP 503, quota de cache, édition simultanée, conservation du GPX original, ancienne version de plan, actualisation demandée pendant une requête et voyage supprimé pendant une recherche.
- Comparaison de l’index avec la projection exhaustive sur une trace sinueuse et vérification du chaînage aux points connus.
- Contrôle Chromium au format mobile 390 × 844, avec réponses des API simulées : arrivée des POI dans une carte Leaflet restant ouverte, même instance de carte conservée, voyage conservé après rechargement, aucune requête de recherche à la réouverture, puis sept nouvelles requêtes POI sans nouvelle requête structurelle après « Actualiser les services ». Aucune erreur JavaScript pendant ce scénario. Ce contrôle ne remplace pas un essai sur iPhone réel.
- Échantillonnage des dix GPX RGA : distance maximale des points échantillonnés aux lignes de recherche comprise entre **92 et 99 m** selon l’étape, avec **zéro échantillon au-delà de 500 m**. Avant correction, le maximum atteignait 1 749 m. Ce contrôle porte sur la géométrie ; il ne mesure pas l’exhaustivité des données OSM.
- Mesure synthétique sur la machine cloud, médiane de trois passages du filtrage/projection/dédoublonnage : **25 ms** pour 50 000 points et 1 000 candidats, contre environ **1 542 ms** avant correction. Le résultat n’est pas une mesure sur iPhone.

Commandes de contrôle :

```sh
npm test
npm run check:rga-trip-package
npm run check:rga-golden
npm exec -- tsc
npm exec -- vite build
```

`npm run build` exécute aussi la régénération des données pratiques en précommande. Les commandes ci-dessus permettent de vérifier le build sans réécrire ces données suivies.

## Suite du chantier

- Valider sur l’iPhone réel : verrouillage, fermeture, changement de réseau, conservation des voyages après mise à jour et absence de gel perceptible.
- Ajouter la sauvegarde/restauration complète et un parcours explicite de mise à jour de la PWA. Aucun effacement ni réinstallation ne doit être proposé pour corriger un cache.
- Définir la fraîcheur et la taille maximale du cache ; distinguer plus finement les réponses non valides, les indisponibilités fournisseur et les erreurs permanentes.
- Permettre aux catégories de corridor de progresser avant la fin des localités de leur propre étape ; actuellement, seule l’indépendance entre étapes est livrée.
- Distinguer proximité géométrique et accès/détour réellement praticable. Étendre ensuite cette politique à la marche.
- Introduire un worker de calcul si les mesures sur les appareils cibles montrent encore des tâches longues. L’index spatial est la première réduction du coût.

La [feuille de route Trip(+)](ROADMAP.md) mémorise les évolutions de nom, de modes de déplacement, d’allure et de montées. Ce lot ne les active pas et ne constitue pas une publication du site.
