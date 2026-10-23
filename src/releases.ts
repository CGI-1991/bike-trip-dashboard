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
