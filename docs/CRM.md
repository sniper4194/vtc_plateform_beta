# CRM CliCab — version initiale

Le CRM B2B est réservé aux administrateurs du back-office et utilise le même mécanisme d'authentification et la même base PostgreSQL que le reste de CliCab.

- Fiches d'organisation, contact professionnel et coordonnées.
- Pipeline à six étapes, recherche, pagination, filtre et compteur des relances échues.
- Historique des appels, e-mails, réunions et notes saisis manuellement.
- Association facultative à un partenaire existant (un compte CRM par partenaire), compteur de réservations. Aucun secret API ni détail passager renvoyé.
- Journal d'audit des mutations, suppression de la fiche et des notes sans modifier le partenaire.

## Mise en service
Depuis la racine du monorepo, avec les dépendances installées :
```sh
pnpm --filter @vtc/api typecheck
pnpm --filter @vtc/api test
pnpm --filter @vtc/api db:deploy
```
Déployer l'API et le back-office ensemble après sauvegarde et validation de la migration sur un environnement de test. Dans le back-office, ouvrir CRM avec un compte ADMIN.

## Recette
Créer un prospect, programmer une relance passée, vérifier le compteur, enregistrer un appel, modifier l'étape, associer un partenaire, vérifier le compteur de réservations et l'historique après rechargement. Tester l'accès refusé sans session et avec un compte DISPATCHER. Tester le doublon de partenaire, la suppression et l'absence de modification des réservations. Vérifier les journaux d'audit.

## Limites et données
Aucun e-mail ou SMS n'est envoyé automatiquement. Pas de synchronisation de messagerie, de devis CRM, de gestion passagers ni de gestion multi-contact dans cette version. Les partenaires déjà existants peuvent être associés manuellement, pas importés automatiquement. La politique de durée de conservation, la base légale et l'information des contacts doivent être validées avant exploitation de données réelles. Ne pas saisir de données sensibles dans les notes.

## Phase 2 : activité réelle et clôture des relances
- Indicateurs à 30, 90 ou 365 jours glissants, courses dont booking.confirmed contient sandbox=false. Courses terminées filtrées par pickupAt, annulations par cancelledAt. Litiges, no-show, remboursements et courses sans preuve de production exclus. Le volume d'affaires n'est pas un chiffre d'affaires comptable ; l'écart brut n'est pas un bénéfice.
- Une relance effectuée est retirée de la liste des échéances, enregistrée dans l'historique et auditée. La vérification de l'action et de la date évite de clôturer une relance modifiée simultanément.
