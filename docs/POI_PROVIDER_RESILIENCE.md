# Fiabilisation des POI — deuxième lot

22 octobre 2026. Suite du [premier lot](POI_RELIABILITY.md), centré sur les longues recherches et la conservation des voyages installés.

## Échecs du fournisseur

Seuls un délai client dépassé et les limites HTTP explicites de durée ou de taille (408, 413, 414) permettent de subdiviser une requête. Une réponse HTML, un JSON ou GeoJSON invalide, un refus HTTP 400/401/403/404 ou une erreur inattendue arrêtent la tentative pour cette étape sans multiplier les requêtes. Le travail reste incomplet et reprenable, avec les lieux acquis conservés.

HTTP 429, toutes les erreurs HTTP 5xx et les erreurs réseau reconnues suspendent également la tentative. L'annulation externe est distinguée du délai client ; un signal déjà annulé ne démarre aucun appel. Le délai couvre aussi la lecture du corps après réception des en-têtes.

Les erreurs ne sont jamais mises en cache comme des résultats vides. Le statut du fournisseur conserve une explication, utilisée par le message de fin de recherche. Une étape suivante réussie ne doit pas effacer la dernière erreur tant que des zones restent incomplètes. Les tentatives différées existantes restent en place ; la prise en compte de `Retry-After` et une suspension partagée entre étapes par fournisseur restent à compléter.

## Cache brut et lieux du voyage

Le cache des réponses de recherche a désormais une durée de validité :

| Réponse | Durée |
| --- | --- |
| Services, avec résultats | 7 jours |
| Services, sans résultat | 1 jour |
| Géographie structurelle | 30 jours |

Ces durées concernent la réutilisation d'une réponse lors d'une recherche. **Un voyage déjà terminé n'est pas relancé automatiquement à l'expiration du cache.** Ses lieux sauvegardés restent consultables hors connexion ; l'action **Actualiser les services** récupère des données plus récentes. Ce lot ne garantit pas qu'un commerce est encore ouvert : les données OSM et leur date de collecte restent les sources disponibles.

Le budget commun aux réponses structurelles et POI est de 500 entrées et 16 Mio de taille logique UTF-8 estimée. Ce budget ne mesure pas l'occupation physique d'IndexedDB ni le quota restant de l'iPhone. Une réponse dépassant seule le budget n'est pas mise en cache ; son résultat peut être sauvegardé normalement dans le voyage.

Les réponses expirées sont supprimées lors d'une écriture de maintenance, au plus une fois par jour hors dépassement de budget. En cas de dépassement, les réponses les plus anciennes sont retirées en laissant environ 25 % de marge pour les requêtes suivantes. Des compteurs transactionnels partagés évitent de parcourir le cache à chaque tronçon et restent cohérents entre plusieurs instances du dépôt. La lecture ne charge pas tous les caches des autres fournisseurs.

Les anciennes entrées sans expiration sont évaluées à partir de leur date d'origine. Aucun changement de nom ou version de base, aucune suppression de voyage, de GPX, de logement, de réglage ou de lieu sauvegardé. Les caches météo, de géocodage et de noms de montées ne sont pas nettoyés par ce module.

## Vérification

Les tests couvrent les réponses invalides et refus HTTP via les vrais fournisseurs Postpass et moteurs sur 120 km, les annulations et les corps de réponse bloqués, les durées de cache, les anciennes entrées, les budgets de nombre et taille, les écritures concurrentes, les remplacements d'entrée, le nettoyage ciblé, l'absence de parcours du cache à chaque écriture, et la conservation des lieux d'un voyage terminé après éviction et expiration.

Les fixtures qui simulaient un délai par une erreur générique utilisent maintenant l'erreur de délai explicite du fournisseur. Le scénario hors connexion vérifie une seule requête échouée par étape, au lieu des cinq tentatives précédentes.

Validation du lot : **2 078 tests réussis, aucun échec ni test ignoré**, contrôles TypeScript, build, paquet RGA et golden master conformes. Un contrôle Chromium avec une vraie base IndexedDB vérifie les écritures concurrentes, l'éviction, l'expiration, le refus d'une réponse trop volumineuse et la conservation du voyage. Un essai sur l'iPhone réel reste nécessaire pour mesurer les performances et les contraintes de stockage propres à Safari/PWA.
