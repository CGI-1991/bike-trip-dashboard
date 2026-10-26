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
  { version: '2026.10.26.2', date: '2026-10-26', changes: [
    { feature: 'app-design', title: 'Des champs et un en-tête adaptés à l’iPhone', description: 'Les champs de date et d’heure restent dans leur cadre, y compris dans la fenêtre de départ GPX et les formulaires étroits. L’en-tête et les onglets respectent la zone de l’encoche. Des pictogrammes sobres remplacent la chaîne, le sablier et la punaise de localisation.' },
    { feature: 'relative-wind', title: 'Le profil se libère dès qu’on retire le doigt', description: 'Sur le profil général et les mini-profils, les valeurs et le curseur disparaissent au relâchement, à l’annulation du geste ou à la perte de focus. À la souris, ils restent visibles pendant le survol. La zone du vent et le bandeau gardent leur hauteur, sans décaler la page.' },
    { feature: 'elevation-profile', title: 'Une exploration temporaire des profils', description: 'Les détails s’affichent pendant le contact ou le survol puis reviennent à l’état neutre. Les flèches du clavier permettent toujours d’explorer ; Échap ou la perte de focus efface la lecture. Les limites et segments choisis dans Course restent enregistrables.' },
    { feature: 'overview-map', title: 'J1a, J1b : reconnaître les étapes d’un même jour', description: 'En Tour, les étapes d’une même journée portent un suffixe partagé par la carte, les listes et le détail. Une étape seule garde J1 et League garde C1, C2… Une distance entre étapes n’est signalée en Tour que si elles sont explicitement liées dans la même journée ; un repos ou un transfert interrompt la vérification.' },
  ] },
  { version: '2026.10.26.1', date: '2026-10-26', changes: [
    { feature: 'app-design', title: 'Trip+ prend sa nouvelle forme', description: 'L’interface reprend la maquette validée : vert profond, typographie embarquée, sections plus légères et toutes les statistiques conservées avant la carte. Parcours, Météo, Infos et Course partagent une navigation unique. Les commandes et le choix d’étape se trouvent en bas, à portée du pouce. Les filtres des points gardent l’ordre du parcours et les services déjà enregistrés restent consultables. Les données, l’identité PWA et les sauvegardes sont conservées.' },
    { feature: 'relative-wind', title: 'Le vent garde sa place dans le profil', description: 'Le repère relatif et la vitesse restent dans un emplacement réservé en haut à droite du profil. Explorer un point ne déplace plus la suite de la page. Chaque nouvelle étape s’ouvre en Neutre ; le mode choisi n’est plus mémorisé. Le vent reste masqué à pied.' },
    { feature: 'elevation-profile', title: 'Des profils lisibles sur les longues distances', description: 'La coloration des pentes et du vent s’adapte à la largeur d’écran. Les moyennes de portions remplacent les bandes trop fines, sur le profil complet et les mini-profils. Le relief, les données détaillées et les ETA restent inchangés. Des repères discrets signalent les rampes fortes.' },
    { feature: 'overview-map', title: 'Les étapes se distinguent sur la carte', description: 'La carte d’Aperçu dessine chaque étape dans sa couleur, commune aux listes et au calendrier. Les numéros restent visibles ; Détail ajoute les noms. Touchez un tracé ou son numéro en plein écran pour mettre l’étape en évidence et accéder à son détail. Les segments de compétition gardent leurs propres couleurs.' },
  ] },
  { version: '2026.10.24.10', date: '2026-10-24', changes: [
    { feature: 'race-segments', title: 'Un parcours sans doublons de montées', description: 'Les segments se lisent comme les montées : longueur, D+, pente, météo et vent, avec leur mini-profil au toucher. Un segment manuel valide a priorité sur toute montée qu’il chevauche, y compris les cols associés. Les montées masquées restent enregistrées et réapparaissent quand le segment est supprimé ou déplacé. Le compteur suit les montées représentées et les segments Grimpeur.' },
    { feature: 'climb-categories', title: 'Un seul réglage des montées, en haut', description: 'Les cinq niveaux Montées retenues se règlent dans le bloc Informations, juste après l’allure, à la création comme dans Modifier. Le second curseur de détection est retiré ; les anciennes calibrations restent conservées. En League et Tour, une montée masquée par un segment ne se compte plus une seconde fois. Chaque segment Grimpeur valide compte comme une montée.' },
    { feature: 'course-exports', title: 'GPX et FIT côte à côte', description: 'Deux boutons remplacent les exports répétés en League et Tour. GPX conserve le tracé complet avec les limites et segments réimportables ; FIT conserve le même parcours avec ses repères et alertes. Le FIT reste en essai jusqu’à validation sur votre Garmin Edge Explore 2. Le GPX d’origine reste conservé dans les sauvegardes.' },
    { feature: 'relative-wind', title: 'La lecture du vent est allégée', description: 'Le volet Détails du vent et ses explications sont retirés. Le vent moyen reste dans les statistiques, la direction relative et la vitesse restent visibles au toucher sur le profil et aux points de passage, segments et montées. La coloration Vent du profil reste disponible à vélo. Le dernier point touché reste lisible pour éviter un décalage de la page lors de l’ouverture d’un segment.' },
  ] },
  { version: '2026.10.24.9', date: '2026-10-24', changes: [
    { feature: 'reference-speed', title: 'Des ETA cohérentes avec le relief', description: 'L’import, les changements d’allure, le profil, les points météo et le FIT réutilisent la même préparation du terrain à vélo et à pied. Les cinq allures et vos vitesses manuelles sont conservées. Les statistiques distinguent la moyenne en mouvement de la référence sur le plat et signalent une altitude insuffisante. L’approche avant course reste incluse dans les ETA.' },
  ] },
  { version: '2026.10.24.8', date: '2026-10-24', changes: [
    { feature: 'climb-categories', title: 'Des montées classées et filtrables', description: 'Les montées portent une catégorie indicative Cat. 4 à HC à vélo, ou un effort 1 à 5 à pied. Un filtre en cinq positions retient les catégories souhaitées ; Toutes conserve chaque montée détectée. La détection avancée reste accessible. La randonnée détecte aussi les ascensions courtes et raides. Changer de sport recalcule les montées sans toucher aux segments manuels ni aux GPX.' },
  ] },
  { version: '2026.10.24.7', date: '2026-10-24', changes: [
    { feature: 'fit-course', title: 'GPX et FIT gardent le même parcours', description: 'Le FIT conserve désormais tous les points du GPX, y compris l’approche avant le départ réel et la portion après l’arrivée. Les limites de course, segments et alertes ajoutent des repères sans couper ni modifier le tracé. Les statistiques de course restent limitées à la course. L’essai sur votre Garmin Edge Explore 2 reste à confirmer.' },
  ] },
  { version: '2026.10.24.6', date: '2026-10-24', changes: [
    { feature: 'travel-mode', title: 'Le vent est réservé au vélo', description: 'En randonnée, le vent moyen, les flèches relatives et le mode Vent du profil sont masqués. Les autres prévisions météo restent accessibles.' },
    { feature: 'race-bounds', title: 'Le départ GPX sert de référence', description: 'Sans départ réel défini, la course commence au début du GPX. L’heure saisie correspond toujours au départ GPX. Une portion avant le vrai départ est incluse dans les ETA, avec une référence vélo réduite de 3 km/h et le terrain pris en compte. Le départ réel estimé et la durée sportive restent distincts.' },
  ] },
  { version: '2026.10.24.5', date: '2026-10-24', changes: [
    { feature: 'stage-wind-stat', title: 'Le vent moyen dans les statistiques', description: 'Le détail de l’étape affiche la vitesse moyenne du vent et sa provenance N, NE, E, SE, S, SO, O ou NO dans les statistiques. Le vent au point exploré et aux passages reste relatif au déplacement. Une prévision partielle ou une direction variable est signalée.' },
    { feature: 'course-editor', title: 'Un profil neutre pour préparer les segments', description: 'Le panneau Course utilise directement le profil neutre. En consultation, les modes Pente et Vent restent accessibles ; le pochage des segments apparaît uniquement en Neutre.' },
    { feature: 'race-segments', title: 'Les segments colorent la carte', description: 'Les portions Sprint, Grimpeur et Flandrien se dessinent dans leur couleur sur la carte et en plein écran. Les segments à replacer ou hors course restent signalés dans le parcours et l’éditeur.' },
  ] },
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
