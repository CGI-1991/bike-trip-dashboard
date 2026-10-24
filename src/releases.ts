/** Add one release and mark the affected features for every user-visible lot.
 * Stable feature ids let a later update show a fresh badge in the same place. */
export interface ReleaseChange {
  readonly feature: string
  readonly title: string
  readonly description: string
}

export interface AppRelease {
  readonly version: string
  readonly date: string
  readonly changes: readonly ReleaseChange[]
}

export const APP_RELEASES: readonly AppRelease[] = [
  { version: '2026.10.24.4', date: '2026-10-24', changes: [
    { feature: 'fit-course', title: 'Un FIT de course à essayer sur Garmin', description: 'En League ou Tour, FIT Garmin · essai exporte la portion de course avec son départ, son arrivée et les points d’alerte de vos segments. Une alerte préalable trop proche du départ est omise et signalée. Le fichier est vérifié avec un lecteur indépendant ; son import et les alertes sur votre Garmin restent à confirmer sur appareil. Les GPX et les activités enregistrées sont conservés.' },
  ] },
  { version: '2026.10.24.3', date: '2026-10-24', changes: [
    { feature: 'enriched-gpx', title: 'Un GPX qui conserve votre préparation de course', description: 'En League ou Tour, Exporter GPX enrichi conserve la trace d’origine, les limites, noms, segments et réglages d’alerte. Réimportez ce fichier pour retrouver la configuration. Les paramètres à revoir bloquent cet export ; le GPX d’origine reste disponible. Les waypoints standards ne garantissent pas d’alertes sur Garmin : l’export FIT reste à venir.' },
  ] },
  { version: '2026.10.24.2', date: '2026-10-24', changes: [
    { feature: 'relative-wind', title: 'Le vent reste disponible sur chaque parcours', description: 'Le vent relatif est présent en League comme en Voyage et Tour : profil, points de passage, segments et montées. La moyenne du parcours reste visible pendant la lecture d’un point. Seule la moyenne globale sur un voyage ou une saison est retirée.' },
    { feature: 'course-editor', title: 'Un panneau Course pour préparer votre parcours', description: 'À côté de Météo, ouvrez Course pour définir le départ, l’arrivée et vos segments. Le profil y sert au placement ; il reprend sa place en lecture quand vous fermez le panneau. Les réglages ne chargent plus la page de lecture.' },
    { feature: 'race-segments', title: 'Les vignettes ouvrent un mini-profil', description: 'Touchez un segment dans les points de passage pour consulter son profil, comme pour une montée. Pour le modifier, utilisez le choix de segment du panneau Course. Le vent affiché sur un segment ou une montée est moyenné sur sa portion du parcours.' },
  ] },
  { version: '2026.10.24.1', date: '2026-10-24', changes: [
    { feature: 'league-calendar', title: 'League et Tour : navigation adaptée', description: 'Mes activités regroupe vos voyages, League et Tours. L’onglet devient Calendrier en League et Étapes en Tour. L’Aperçu League reste synthétique, sans calendrier ni vent relatif.' },
    { feature: 'race-bounds', title: 'League : statistiques entre les limites réelles', description: 'Définissez le départ et l’arrivée réels. Les statistiques apparaissent alors dans le bloc supérieur du Détail, uniquement entre ces limites. Aucune course entière n’est supposée à partir du GPX.' },
    { feature: 'climb-detection', title: 'La détection des montées s’enregistre correctement', description: 'Changer le curseur marque l’activité comme modifiée et affiche le récapitulatif avec Enregistrer en haut. Le recalcul conserve vos segments manuels.' },
    { feature: 'reference-speed', title: 'Cinq allures et une vitesse manuelle', description: 'Chill, Tempo, Normal, Soutenu ou Sportif règlent la vitesse sur le plat à vélo ou à pied. Choisissez Manuel pour saisir vos km/h. Normal conserve les références de 18 km/h à vélo et 4,5 km/h à pied.' },
    { feature: 'race-segments', title: 'Les segments rejoignent le parcours et son profil', description: 'Éditez les segments depuis les points de passage, sur le profil ou en kilomètres au dixième. Leur portion colore directement le tracé et son remplissage. Les montées automatiques clairement couvertes cèdent leur place au segment ; les autres restent visibles. L’édition et l’affichage des segments sur carte sont retirés.' },
  ] },
  { version: '2026.10.23.9', date: '2026-10-23', changes: [
    { feature: 'elevation-profile', title: 'Un GPX sans altitude garde des valeurs inconnues', description: 'Un fichier dépourvu d’altitudes n’affiche plus un faux profil plat à zéro mètre. Les segments restent éditables sur la carte ou par leurs kilomètres, avec pente et dénivelé inconnus.' },
    { feature: 'race-segments', title: 'Vos segments Sprint, Grimpeur et Flandrien', description: 'Dans League et Tour, ajoutez des segments nommés, placez leurs limites sur le profil ou sur une carte interactive et ajustez leurs kilomètres. Les bandes et repères S/G/F acceptent les chevauchements. Les segments manuels, leurs statistiques et réglages pour les futurs exports sont sauvegardés localement, indépendamment des montées automatiques. Après remplacement du GPX, leurs positions doivent être vérifiées.' },
  ] },
  { version: '2026.10.23.8', date: '2026-10-23', changes: [
    { feature: 'race-bounds', title: 'Les horaires et la météo suivent la course', description: 'Dans League et Tour, l’heure de départ s’applique au départ de course choisi. Profil, points de passage, arrivée estimée et prévisions utilisent les mêmes temps, y compris après minuit. La bibliothèque, le calendrier et l’aperçu affichent les distances de course. Les limites périmées suspendent ces estimations ; le GPX complet reste conservé.' },
    { feature: 'relative-wind', title: 'Le vent moyen porte sur la portion de course', description: 'Avec des limites de course, le vent moyen est calculé uniquement entre départ et arrivée. Les zones grisées avant et après restent explorables, sans ETA ni estimation de vent de course. Déplacer une heure de départ réutilise les prévisions horaires en cache quand leurs lieux et dates restent identiques.' },
  ] },
  { version: '2026.10.23.7', date: '2026-10-23', changes: [
    { feature: 'relative-wind', title: 'Un vent plus lisible sur téléphone', description: 'Un repère vélo minimaliste remplace le cycliste détaillé. La lecture affiche la direction relative et la vitesse du vent en km/h ; rafales et précisions restent dans Détails du vent. Le profil et les points du parcours gardent leurs moyennes lissées.' },
    { feature: 'race-bounds', title: 'Départ et arrivée de course', description: 'Dans League et Tour, définissez les limites au toucher sur le profil ou en kilomètres. La course calculée a ses propres distance et dénivelés ; la trace GPX complète est conservée, avec les portions hors course grisées. Après remplacement du GPX, les anciennes limites doivent être redéfinies. Les horaires et prévisions restent ceux de la trace complète dans ce lot.' },
  ] },
  { version: '2026.10.23.6', date: '2026-10-23', changes: [
    { feature: 'gpx-editor-add', title: 'L’ajout de GPX dans l’éditeur est fiabilisé', description: 'Le bouton Ajouter des GPX conserve la sélection avant de réinitialiser le sélecteur de fichiers. Les fichiers choisis sont bien ajoutés, pour une course League comme pour une étape de voyage.' },
    { feature: 'league-calendar', title: 'League : votre calendrier de courses', description: 'Choisissez League à la création, ajoutez un GPX par course et indiquez chaque date et heure de départ. Le calendrier se classe automatiquement ; modifier une course ne décale pas les autres. Les parcours, météo et vent restent accessibles. Aucun arrêt n’est planifié pendant une course ; les POI peuvent être recherchés explicitement depuis les réglages avancés. Les segments de compétition et les exports Garmin arriveront dans les prochains lots.' },
  ] },
  { version: '2026.10.23.5', date: '2026-10-23', changes: [
    { feature: 'travel-mode', title: 'Vos voyages à vélo ou à pied', description: 'Choisissez Vélo ou Randonnée à la création ou dans Modifier le voyage. La randonnée utilise un calcul des temps selon la pente, une vitesse de référence sur le plat et des liens de guidage à pied. Les pauses automatiques sont réévaluées au changement de mode ; vos pauses manuelles, lieux et fichiers GPX sont conservés. Les voyages existants restent à vélo.' },
  ] },
  { version: '2026.10.23.4', date: '2026-10-23', changes: [
    { feature: 'relative-wind', title: 'Le vent se lit dans votre sens de roulage', description: 'Touchez le profil pour voir le vent relatif autour du cycliste, orienté vers le haut. Les points du Parcours présentent une moyenne locale et le parcours indique ses parts face, dos et latéral. Choisissez un profil neutre, coloré par pente ou par composante de vent de face en bleu. Les estimations utilisent les prévisions déjà chargées ; les zones sans estimation fiable restent grises.' },
  ] },
  { version: '2026.10.23.3', date: '2026-10-23', changes: [
    { feature: 'trip-backup', title: 'Vos voyages peuvent être sauvegardés et restaurés', description: 'Dans Mes voyages, préparez une sauvegarde complète à enregistrer dans Fichiers, ou sauvegardez un seul voyage depuis sa carte. Elle conserve les réglages, pauses, logements, lieux et GPX d’origine disponibles. La restauration ajoute des copies sans écraser vos voyages actuels.' },
  ] },
  { version: '2026.10.23.2', date: '2026-10-23', changes: [
    { feature: 'app-updates', title: 'Les changements deviennent visibles', description: 'Les petites balises MAJ expliquent ce qui a changé à cet endroit. Touchez-les pour lire le détail ; le bouton Nouveautés garde tout l’historique.' },
  ] },
  { version: '2026.10.23.1', date: '2026-10-23', changes: [
    { feature: 'poi-search', title: 'Une recherche de services plus fiable', description: 'Les réponses invalides et les refus du service ne multiplient plus les recherches. Le cache est limité et les lieux déjà enregistrés restent disponibles, même hors connexion. Sur la carte plein écran, ouvrez Calques pour afficher les services.' },
  ] },
  { version: '2026.10.22.1', date: '2026-10-22', changes: [
    { feature: 'poi-search', title: 'Les services arrivent progressivement', description: 'Les longs trajets sont recherchés par zones. Les lieux trouvés sont sauvegardés au fur et à mesure et la recherche peut reprendre après interruption. Une étape ne bloque plus toutes les autres.' },
    { feature: 'poi-refresh', title: 'Actualiser uniquement les services', description: 'Dans les réglages avancés du voyage, Actualiser les services relance leur recherche en conservant les lieux déjà trouvés, vos traces, logements, réglages et pauses.' },
  ] },
]

export const CURRENT_APP_VERSION = APP_RELEASES[0]!.version
