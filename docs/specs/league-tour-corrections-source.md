# Bike Trip — Correctifs et ajustements fonctionnels League / Tour

Ce document complète la note précédente sur l’intégration des modes de course\.

Objectif : corriger plusieurs choix d’interface et de logique métier avant de poursuivre l’implémentation\.

---

## 1\. Pas de calendrier des courses dans l’écran Aperçu

En **mode League**, ne pas afficher de calendrier des courses dans l’écran **Aperçu**\.

L’écran Aperçu doit rester synthétique et centré sur l’activité / la saison / les statistiques globales, sans dupliquer le contenu de l’onglet dédié aux courses\.

---

## 2\. Supprimer le vent relatif en mode League

En **mode League**, ne pas afficher de vent relatif :

- ni dans **Aperçu** ;
- ni dans l’onglet actuellement nommé **Voyage** ;
- ni sur les pages de détail des courses si cette information provient de la logique Bike Trip classique\.

La logique de vent relatif reste disponible pour les modes où elle est pertinente, mais elle est désactivée pour l’ensemble des courses League\.

---

## 3\. Renommer dynamiquement l’onglet Voyage

Le nom de l’onglet dépend du mode :

```text
Mode League  → Calendrier
Mode Tour    → Étapes
Mode neutre  → Voyage
```

Le contenu fonctionnel peut rester basé sur le même composant si possible, mais le libellé et les éléments affichés doivent être adaptés au contexte\.

---

## 4\. Corriger la détection des montées en modification de voyage

Problème actuel :

Lorsque l’utilisateur modifie le mode / les paramètres de détection des montées depuis l’écran de modification d’un voyage, le changement n’est pas correctement traité comme une modification enregistrable\.

### Comportement attendu

Toute modification de la détection des montées doit :

1. être considérée comme une modification du voyage ;
2. marquer la fiche comme modifiée / non enregistrée ;
3. être visible dans le récapitulatif des modifications ;
4. faire apparaître l’action d’enregistrement en haut de l’écran de modification ;
5. recalculer les montées automatiques avec la nouvelle configuration ;
6. mettre à jour profil, statistiques et points de passage concernés ;
7. être persistée après enregistrement ;
8. être correctement restaurée après reload\.

Important :

- les **montées automatiques** peuvent être recalculées ;
- les **segments League / Tour explicitement définis** ne doivent jamais être supprimés ou déplacés par ce recalcul\.

---

## 5\. Renommer « Mes voyages » en « Mes activités »

Renommer globalement l’onglet / écran :

```text
Mes voyages
```

en :

```text
Mes activités
```

Le nouveau nom doit être utilisé dans la navigation et les titres correspondants\.

---

## 6\. Améliorer la vitesse de référence

Revoir l’échelle actuelle afin d’obtenir une progression plus intuitive et plus utile\.

Nouvelle échelle :

```text
Chill
Tempo
Normal
Soutenu
Sportif
Manuel
```

Ajouter un mode :

```text
Manuel → vitesse saisie en km/h
```

### Attendu

Les presets doivent représenter une progression cohérente de vitesse de référence\.

Éviter que plusieurs niveaux soient trop proches ou difficiles à distinguer\.

Prévoir une structure centralisée, par exemple :

```ts
type ReferenceSpeedMode =
  | "chill"
  | "tempo"
  | "normal"
  | "sustained"
  | "sporty"
  | "manual";
```

Les valeurs numériques associées aux presets doivent être centralisées et facilement ajustables\.

Le mode manuel permet une saisie explicite en **km/h**\.

---

## 7\. Stats League : ne rien afficher sans départ / arrivée réels

En **mode League** :

Si aucun `raceStart` et/ou `raceFinish` réel n’est défini, ne pas afficher de statistiques de course calculées\.

Ne pas remplacer implicitement les limites manquantes par :

- le début du GPX ;
- la fin du GPX\.

Autrement dit :

```text
pas de START réel
ou
pas de FINISH réel
→ pas de bloc stats de course
```

---

## 8\. Stats League : affichage dans le bloc Stat de la page Détail

Lorsque le départ réel ET l’arrivée réelle sont définis :

- calculer les statistiques uniquement entre ces deux limites ;
- afficher ces statistiques dans le **bloc Stat situé en haut de la page Détail**\.

Éviter de créer un bloc supplémentaire spécifique League si le bloc Stat existant peut être réutilisé\.

Les statistiques peuvent notamment inclure :

- distance ;
- D\+ ;
- éventuellement D\- ;
- autres métriques déjà supportées dans le bloc existant\.

---

## 9\. Configuration des segments uniquement sur le profil ou par valeur numérique

En mode League / Tour, les segments ne doivent **jamais être configurés sur la carte**\.

Deux modes de configuration uniquement :

### A\. Directement sur le profil

L’utilisateur sélectionne / déplace :

- début ;
- fin\.

### B\. Par champs numériques

Exemple :

```text
Début : 34,6 km
Fin   : 35,2 km
```

Précision utilisateur :

```text
0,1 km
```

Toutes les valeurs affichées et éditées doivent être arrondies au **0,1 km**\.

Le stockage interne peut conserver une précision supérieure si nécessaire, mais l’UI doit travailler au dixième de kilomètre\.

---

## 10\. Représentation des segments sur le profil

Ne pas afficher de barrettes / bandes de segments au\-dessus du profil\.

### Affichage souhaité

Le segment doit être directement intégré au profil\.

#### Mode avec tracé visible

Colorer le tracé du profil sur la portion correspondant au segment :

```text
Climb      → rouge
Sprint     → vert
Flandrien  → jaune
```

#### Mode neutre / profil avec remplissage

Colorer également le **pochage / remplissage sous le profil** sur la portion correspondant au segment\.

Le résultat doit donc être similaire à la logique déjà utilisée sur la carte :

```text
portion normale
→ style neutre

portion segment
→ tracé + pochage dans la couleur du segment
```

Ne pas ajouter de couche graphique séparée au\-dessus du profil\.

---

## 11\. Fusion segments \+ montées dans les points de passage

En mode **League** ou **Tour**, ne pas créer une liste séparée intitulée « Segments »\.

Les segments doivent être intégrés dans la **liste existante des points de passage du parcours**\.

### Principe

La liste doit combiner :

- points de passage habituels ;
- montées détectées automatiquement ;
- segments League / Tour\.

### Interaction segments / montées

Lorsqu’un segment défini correspond à une montée détectée automatiquement, le segment peut **remplacer** cette montée dans la liste\.

Exemple :

```text
Montée détectée automatique
km 42,3 → 45,8
```

puis définition d’un segment :

```text
GRIMPEUR 2
km 42,4 → 45,7
```

Dans la liste des points de passage :

```text
GRIMPEUR 2
```

remplace la montée automatique correspondante\.

### Montées non couvertes

Les montées détectées qui ne correspondent à aucun segment défini restent affichées normalement\.

Exemple final :

```text
POINTS DE PASSAGE

Départ réel
Sprint 1
Montée 3,2 km
Grimpeur 1
Ravitaillement
Flandrien 1
Montée 1,8 km
Sprint 2
Arrivée réelle
```

Il ne doit donc pas y avoir :

```text
POINTS DE PASSAGE
...

SEGMENTS
...
```

mais une seule liste consolidée\.

---

# Règles de priorité pour les montées et segments

Afin d’éviter les doublons :

```text
Segment explicite League / Tour
        ↓ priorité supérieure
Montée automatique
        ↓
Point de passage standard
```

Lorsqu’un segment remplace une montée automatique, cette relation doit être déterminée de manière robuste\.

Ne pas se baser uniquement sur une égalité exacte des bornes\.

Prévoir une logique de correspondance basée par exemple sur :

- chevauchement significatif des distances ;
- proximité des débuts / fins ;
- appartenance du segment à la montée détectée\.

Une montée automatique ne doit être masquée que lorsqu’il existe une correspondance suffisamment claire\.

---

# Comportement par mode

## Mode neutre / Bike Trip

```text
Onglet : Voyage
Vent relatif : actif selon logique actuelle
Montées automatiques : actif
Segments League/Tour : non pertinent
```

## Mode League

```text
Onglet : Calendrier
Calendrier dans Aperçu : NON
Vent relatif : NON
Stats course sans START/FINISH : NON
Stats course avec START/FINISH : bloc Stat de la page Détail
Segments configurables : profil + champs km uniquement
Segments sur carte : NON
Liste segments séparée : NON
Segments intégrés aux points de passage : OUI
```

## Mode Tour

```text
Onglet : Étapes
Segments configurables : profil + champs km uniquement
Segments sur carte : NON
Liste segments séparée : NON
Segments intégrés aux points de passage : OUI
```

---

# Points UX importants

## Édition d’un segment

Exemple :

```text
Sprint 1

Début
[ 34,6 km ]

Fin
[ 35,2 km ]

Type
[ Sprint ]

Alerte Garmin
[ 500 m ]
```

Les champs numériques et le profil doivent rester synchronisés :

```text
drag sur profil
→ champs mis à jour

modification champ
→ profil mis à jour
```

---

# Critères d’acceptation

L’implémentation est correcte si :

1. aucun calendrier n’apparaît dans Aperçu en mode League ;
2. aucun vent relatif n’apparaît dans les écrans League ;
3. l’onglet Voyage devient `Calendrier` en League ;
4. l’onglet Voyage devient `Étapes` en Tour ;
5. `Mes voyages` devient `Mes activités` ;
6. modifier la détection des montées déclenche correctement l’état « modification non enregistrée » ;
7. l’enregistrement de cette modification est accessible en haut de l’écran ;
8. la nouvelle configuration de détection est persistée ;
9. les segments manuels ne sont pas affectés par le recalcul des montées automatiques ;
10. les presets de vitesse sont `Chill / Tempo / Normal / Soutenu / Sportif` ;
11. une vitesse manuelle en km/h peut être définie ;
12. sans START \+ FINISH réels, aucune stat de course n’est affichée en League ;
13. avec START \+ FINISH, les stats apparaissent dans le bloc Stat supérieur de la page Détail ;
14. aucun segment ne peut être créé ou déplacé depuis la carte ;
15. les segments sont éditables sur le profil ;
16. les segments sont éditables par champs numériques au 0,1 km ;
17. aucune barrette de segment n’est affichée au\-dessus du profil ;
18. le tracé du profil est coloré sur les segments ;
19. le pochage du profil est également coloré sur les segments en mode neutre ;
20. les segments apparaissent dans les points de passage ;
21. il n’existe aucune liste séparée « Segments » ;
22. lorsqu’un segment correspond à une montée automatique, il la remplace dans la liste ;
23. les montées automatiques non remplacées restent visibles ;
24. aucune régression ne doit être introduite dans le mode Bike Trip classique\.

---

# Consigne d’implémentation

Avant de modifier le code :

1. inspecter les composants actuels de navigation, profil, points de passage, statistiques et détection des montées ;
2. réutiliser les composants existants autant que possible ;
3. éviter de dupliquer les structures League / Tour ;
4. centraliser les différences de comportement dans une configuration de mode / capabilities ;
5. proposer un plan de modification des fichiers concernés avant les changements importants ;
6. ajouter ou adapter les tests de non\-régression nécessaires\.