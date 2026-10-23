# Rendre les mises à jour visibles

Chaque lot modifiant l'usage de l'application ajoute une entrée datée dans `src/releases.ts`, avec une version unique, un identifiant de fonctionnalité stable et une explication courte destinée à l'utilisateur.

Une petite balise **MAJ** est placée au niveau de la fonctionnalité concernée avec `renderFeatureUpdateBadge(feature)`. Elle ouvre au toucher ou au clavier une fenêtre expliquant ce changement et les précédents à cet endroit. La balise est visuellement compacte avec une cible tactile de 44 × 44 pixels.

Après fermeture, la lecture est mémorisée sur cet appareil et les balises de cette version disparaissent. Une nouvelle entrée pour la même fonctionnalité réaffiche sa balise. Le bouton **Nouveautés** dans l'en-tête conserve l'historique et indique la version effectivement chargée. Il ne prétend pas qu'une version plus récente a été téléchargée.

Les préférences de lecture sont séparées des voyages. Un stockage de préférences indisponible ne doit ni bloquer l'application ni modifier les voyages. La fenêtre peut s'ouvrir au-dessus de la carte plein écran sans fermer cette carte, changer le zoom ni lancer de recherche.

Pour les prochains lots :

1. Ajouter la version et les changements réellement livrés dans `APP_RELEASES`, du plus récent au plus ancien.
2. Réutiliser l'identifiant de la fonctionnalité si elle existe déjà, ou ajouter une balise à son emplacement si elle est nouvelle.
3. Décrire le comportement utile à l'utilisateur, sans détails de code ou promesse de déploiement.
4. Vérifier sur petit écran l'ouverture, la fermeture, le retour du focus et le maintien de la carte ou du formulaire sous-jacent.
