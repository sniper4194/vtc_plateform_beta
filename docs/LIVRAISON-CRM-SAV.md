# Livraison CRM / SAV — Hostinger

Branche de livraison : release/crm-sav. Elle réunit l'historique de la branche CRM et de la branche chauffeur publiée. La CI exécute les migrations sur PostgreSQL de test, la compilation et les tests avant de construire et publier les trois images sur GHCR. Sur cette branche, seules les étiquettes correspondant au SHA du commit sont publiées. Le tag pilote n'est pas modifié ; aucun déploiement Hostinger n'est lancé.

## Avant toute mise à jour volontaire
1. Vérifier la réussite de CI et des trois publications GHCR pour le même SHA (voir Actions). Vérifier le parcours Android no-show séparément, si déclenché.
2. Sauvegarder PostgreSQL, noter la configuration et le tag actuels (idéalement les digests exacts), conserver les volumes et secrets. Tester la migration sur une copie isolée de la base. Ne jamais supprimer les volumes.
3. Dans hPanel > VPS > Gestionnaire Docker > projet clicab, définir IMAGE_TAG au SHA complet validé, puis mettre à jour le projet. Si les trois services ont des tags codés en dur, utiliser le même SHA pour clicab-api, clicab-backoffice et clicab-suivi. Les migrations s'appliquent au démarrage de l'API.
4. Contrôler la santé API, les connexions, les courses, l'espace chauffeur, et les onglets CRM / SAV avec un administrateur. Ne pas activer CRM_EMAIL_ENABLED sans vérification des autorisations et de la messagerie.
5. En cas d'échec : arrêter la mise à jour et suivre la procédure de restauration ; un retour au tag précédent ne suffit pas nécessairement après une migration. Prévoir une sauvegarde vérifiée et une fenêtre de maintenance ; restaurer la base si nécessaire, en tenant compte des écritures postérieures.

La publication des images ne prouve pas que les fonctionnalités sont validées en production. Les tests métier manuels, les mentions légales, la conservation des données et les contrôles financiers restent à valider.
