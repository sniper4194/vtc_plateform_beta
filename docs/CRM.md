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

## Phase 3 — devis et contrats commerciaux
Devis B2B en EUR à une ligne, quantité, prix unitaire HT en centimes, taux de TVA explicitement saisi, coefficient de tarif partenaire, coordonnées de l'émetteur et du client, validité et conditions. Les devis enregistrés sont immuables (nouvelle version = nouveau devis). Statuts : brouillon, envoyé (confirmation manuelle), accepté, refusé, contrat signé (signature externe enregistrée, aucune signature électronique). Les échéances de renouvellement sont visibles à 60 jours et tant que le contrat n'est pas terminé. Un contrat signé en cours permet de créer explicitement un nouveau partenaire avec une clé sandbox, jamais une clé de production. Les partenaires existants ne sont pas retarifés automatiquement. Le PDF est obtenu par impression navigateur du devis, aux couleurs CliCab. La raison sociale, le SIRET, l'adresse, la TVA et les clauses doivent être validés avant envoi ; ce document n'est pas une facture et ne constitue pas un contrat type validé juridiquement. Les devis et contrats empêchent la suppression de la fiche CRM pour préserver les documents commerciaux : définir une procédure de conservation/purge avant production. Aucun envoi automatique ni signature électronique.

## Phase 4 — communications et agenda
Modèles réutilisables (variables {{company}} et {{contact}}), brouillons prévisualisables, envoi unitaire après confirmation et autorisation documentée. CRM_EMAIL_ENABLED=1 et EMAIL_PROVIDER=resend, RESEND_API_KEY et EMAIL_FROM requis ; par défaut aucun envoi. Opposition conservée par adresse normalisée, indépendamment de la fiche. Surveiller la boîte de réponse et traiter les oppositions ; ne réautoriser qu'après vérification. ACCEPTED signifie accepté par le prestataire, pas livré. SENDING/UNKNOWN nécessitent un rapprochement manuel sans réessai automatique. Les devis sont transmis en texte, PDF à joindre manuellement hors application. Agenda des rendez-vous, relances et renouvellements à 60 jours, échéances passées incluses. Pas de synchronisation de boîte entrante, de calendrier externe, de campagne de masse ni de relance envoyée automatiquement. Valider les motifs d'autorisation, l'information des contacts, les durées de conservation et la procédure d'opposition avant activation.

## Phase 5 — SAV
Tickets internes ADMIN, liens métier, journal, contrôle de version, SLA calendaires (prise en charge interne, pas preuve de réponse client). Satisfaction déclarée 1–5. Une demande financière par ticket, décision d'un autre administrateur nominatif, sans paiement ni modification de course. Vérifier les remboursements antérieurs et justificatifs avant décision externe. Pas de portail client ou notification externe. Définir rétention et accès avant production. En cas de danger immédiat appeler le 112.
