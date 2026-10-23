# Sauvegarder et restaurer les voyages

Dans **Mes voyages**, ouvrir **Sauvegarder / restaurer mes voyages**, puis **Préparer une sauvegarde complète**. Le bouton **Sauvegarder** de chaque carte prépare uniquement ce voyage. Une fois l’archive prête, utiliser **Partager / enregistrer dans Fichiers** si le téléphone le permet, ou **Télécharger la sauvegarde**. Vérifier ensuite la présence du fichier ZIP dans Fichiers : préparer l’archive seule ne l’enregistre pas durablement.

Pour restaurer, choisir l’archive, lire le récapitulatif, puis toucher **Restaurer**. La vérification et le récapitulatif n’écrivent rien ; **Annuler** ne crée aucun voyage. La restauration ajoute des **copies** portant la mention « restauré » ; elle ne remplace pas les voyages existants et ne change pas la sélection du voyage actif.

## Contenu et compatibilité

- Chaque `TripBundle` complet : journées, étapes, géométrie, altitudes, montées, points de passage, logements, notes, réglages, pauses manuelles, corrections, lieux masqués/épinglés, données météo sauvegardées et progression des recherches.
- Les fichiers d’origine disponibles, copiés octet pour octet, avec leur type Blob/ArrayBuffer et le type MIME du Blob. Les métadonnées conservent leurs noms d’origine.
- Si un ancien voyage ne possède plus certains GPX d’origine, le nombre manquant est annoncé à la préparation et avant restauration. Les données de voyage disponibles sont sauvegardées ; aucun fichier manquant n’est inventé ou masqué.
- Les caches de réponses réseau et les préférences propres à l’appareil, dont la lecture des balises MAJ et le voyage actif, ne sont pas exportés. Les prévisions pourront être actualisées à la consultation.

Une seule transaction de lecture réunit les voyages et leurs fichiers d’origine, pour éviter un mélange entre les anciennes et nouvelles valeurs pendant une édition ou une recherche POI. Une seule transaction d’écriture restaure toutes les copies : erreur de quota, collision d’identifiant ou écriture en échec annulent le lot entier. Les références internes restent stables et les clés des collections sont isolées par le nouvel identifiant du voyage.

Le format est une archive ZIP32 sans compression, contenant `manifest.json` et les binaires référencés. Le manifeste porte le format `trip-plus-backup`, sa version 1 et une date de création. Les intégrités ZIP/CRC et SHA-256 des originaux, les références et les versions de voyages sont vérifiées avant tout ajout. Les versions futures non prises en charge, fichiers manquants, doublons, références invalides et archives altérées sont refusés. Le lecteur accepte les archives produites par l’application ; recompresser l’archive avec un autre outil peut la rendre incompatible.

Les limites actuelles sont de **64 Mio par archive**, **32 Mio de manifeste**, **200 voyages** et **5 000 entrées**. Si une bibliothèque dépasse cette taille, utiliser la sauvegarde individuelle. Ces limites réduisent le risque de pression mémoire sur téléphone ; elles ne garantissent pas un quota de stockage disponible. L’assemblage utilise les parties binaires directement, sans concaténation supplémentaire de toute l’archive dans un grand tampon.

Le nom et la version de la base IndexedDB, l’origine du site et l’identité de la PWA restent inchangés. Aucune réinstallation n’est nécessaire. Une balise **MAJ** près de la sauvegarde et l’entrée **Nouveautés** expliquent cette fonction.

## Vérification

Les tests couvrent le transfert vers une base vide, deux voyages aux mêmes identifiants internes, la conservation des valeurs manuelles et de la progression POI, les types et octets des sources, la restauration répétée sans écrasement, un snapshot pendant une édition, les sources absentes annoncées, les versions futures, la corruption, les références invalides et l’annulation totale sur quota ou collision. Le partage démarre directement sur un second toucher après préparation pour conserver l’activation utilisateur nécessaire sur iPhone.

La validation complète et le scénario navigateur sont consignés dans la PR. Le sélecteur Fichiers et le partage natif nécessitent encore un essai sur l’iPhone réel ; un contrôle Chromium tactile ne remplace pas WebKit/PWA iOS.
