# Architecture CliCab

| Composant | Existant | Cible ou validation |
|---|---|---|
| API NestJS et PostgreSQL/Prisma | Devis, réservations, états de course, distribution, webhooks, suivi et audit | Brancher les nouveaux canaux sur les services existants |
| `packages/pricing`, `packages/shared` | Calcul tarifaire, types et transitions partagés | Valider les grilles et politiques de prix propres aux canaux |
| Next.js | Back-office, espace société, pages partenaires, suivi voyageur | Portail B2B et parcours web B2C |
| Expo | Application chauffeur | Applications passager Android/iOS |
| Intégrations | Clés sandbox, REST et webhooks signés | Adaptateurs autorisés, recette et contrat par plateforme |
| Infra | CI GitHub Actions, images Docker, guides d’exploitation | Décisions d’hébergement, secrets, supervision et ouverture selon les jalons |

Les services communs sont `BookingsService` et le moteur de prix, `DispatchService`, puis les événements de course, le suivi et les notifications. Les nouveaux points d’entrée doivent converger sur ces services pour appliquer les mêmes contrôles.

## Contrat de back-office CLI-P2-001

`POST /admin/rides/:id/assign` accepte une session nominative administrateur ou régulateur, un `driverId` UUID, `priceCents` entier (montant convenu de base, en centimes) et `verbalConsentConfirmed: true` strictement booléen. Une session invalide reçoit 401, un jeton de service valide reçoit 403, une déclaration ou un montant manquant ou invalide reçoit 422. Les conflits de course, planning, fatigue et véhicule gardent leur comportement existant.

L’événement `ride.assignment_consent_declared` réutilise `RideEvent` et est écrit dans la transaction d’attribution. `rideId` et `createdAt` portent la course et la date. Le contenu contient `dispatcherId`, `driverId`, `method: "PHONE"`, `agreedPriceCents`, `ecoBonusCents` et `driverNetCents`. La notification est déclenchée après validation de la transaction. Le schéma Prisma existant suffit. Les événements historiques gardent leurs données d’origine.

Voir le [rapport technique](RAPPORT_TECHNIQUE.md) pour la stack et les fournisseurs, et [Décisions](DECISIONS.md) pour les inconnues.
