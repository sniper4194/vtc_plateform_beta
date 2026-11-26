# CliCab — Cahier des charges

État de référence TEST : `43bfbb16403f873bc9c45fc891cfec9193366ac8`. Les 18 scénarios de phase 1 sont déclarés validés dans le cadrage de la mission. Les [résultats de l’audit](AUDIT_FONCTIONNEL.md) précisent la couverture disponible.

## 1. Vision

**Existant.** CliCab distribue des transferts VTC à prix fixe réservés via l’API partenaire ou via des pages de réservation dédiées. Les chauffeurs indépendants et sociétés VTC reçoivent les offres dans l’application chauffeur.

**Cible.** Un socle commun de réservation, tarification, distribution et suivi alimente le B2B2C (plateformes externes autorisées), le B2B (portail professionnel ou API) et le B2C (web et applications Android/iOS, immédiat et programmé).

**À valider.** Contrats et accès techniques des plateformes, dont Transferz. Prix garanti, suivi de vol, multilingue, support 24/7, facturation et litiges restent des exigences commerciales. Voir la [vision stratégique](VISION_STRATEGIQUE.md).

### Acteurs
| Acteur | Rôle |
|---|---|
| Plateforme B2B2C | Intègre devis, réservation, annulation et suivi via une interface autorisée |
| Client professionnel B2B | Commande et suit ses courses via portail ou API |
| Voyageur | Réserve via partenaire ou site direct, suit sa course |
| Chauffeur indépendant | App mobile : accepte/refuse, exécute, est payé |
| Société VTC | Gère ses chauffeurs/véhicules, reçoit les paiements |
| Dispatcheur | Suit les courses et attribue manuellement après accord téléphonique explicite |
| Admin | Tarifs, partenaires, validation documents, finance |

## 2. Décisions issues du cadrage

| Sujet | Décision |
|---|---|
| Modèle | Hybride B2B2C, B2B et B2C, prix fixe pré-calculé pour les transferts |
| Chauffeurs | Indépendants avec carte VTC + sociétés VTC |
| Périmètre MVP | App chauffeur, back-office/dispatch, API B2B, site de réservation client |
| Zone | France entière (vol/gare/aéroport prioritaires, Paris en premier) |
| Statut juridique | Simple intermédiaire technique ⚠️ (voir §9) |
| Tarification | Prix fixe, forfaits aéroports/gares, tarifs négociés par partenaire, majorations (nuit, week-end, pic, bagages, attente) |
| Paiement chauffeurs | Mixte : partenaire prépayé ou facture mensuelle ; reversement chauffeurs moins commission |
| Dispatch | Bourse libre, premier chauffeur éligible qui accepte. Attribution manuelle avec accord préalable. |
| Véhicules | Berline, Berline Business, Van/Minibus 6-8 places, Électrique/Green, mise à disposition horaire, longue distance |
| Voyageur | Suivi de vol, multilingue, support 24/7, suivi live + SMS/WhatsApp, annulation/avoirs/litiges |
| Onboarding | Upload + validation manuelle des documents, notation/sanctions, contrat de sous-traitance e-signé |
| Stack | TypeScript partout |
| Budget infra | < 500 €/mois, développement en solo (avec Claude) |
| Phasage | Démo → pilote opérationnel Paris |

## 3. Fonctionnalités par module

**Existant.** API partenaire avec devis, réservation et annulation, pages dédiées, suivi par lien, bourse et exécution chauffeur, back-office et espace société, CRM et SAV. L’architecture et l’[audit](AUDIT_FONCTIONNEL.md) détaillent les capacités et limites.

**Cible.** Les listes ci-dessous conservent les exigences de cadrage. Les fonctions couvertes seulement en partie ou encore à réaliser sont recensées dans l’audit et la [feuille de route](ROADMAP.md). Les arbitrages ouverts sont suivis dans le [registre des décisions](DECISIONS.md).

### 3.1 App chauffeur (React Native / Expo) — identité et ergonomie propres
- **Cap** (accueil) : gains de la quinzaine, potentiel « à l'horizon », missions au programme, bascule En ligne / Hors ligne, véhicule actif.
- **Radar** : offres sous forme de « billets » (prix net, €/h, trajet, partenaire, vol) avec une barre-mèche de sursis ; prise de mission par **appui maintenu** (anti-erreur au volant) ou « Passer ».
- **Agenda** : missions à venir (rail en 4 étapes : Départ → Sur place → À bord → Arrivée, chaque étape validée par appui maintenu) et archives ; « Un souci ? » pour no-show ou abandon (avec avertissement fiabilité).
- Changement de véhicule : à venir.
- Exécution : en route → sur place → client à bord → terminée ; navigation (Waze/Google/Apple Maps) ; no-show avec preuve (attente chronométrée).
- Compte : documents, véhicules et services, comptabilité (relevés, factures, gains), notifications (push), messages.
- Plus tard : Tap to Pay, offres partenaires.

### 3.2 Back-office / dispatch (Next.js)
- Liste des courses (filtres statut/date/partenaire), carte temps réel, relance bourse et réassignation d’urgence. Toute attribution manuelle, y compris en urgence, exige un accord téléphonique préalable sur la course et sa rémunération. Le dispatch ne crée aucune course.
- Gestion chauffeurs/sociétés/véhicules : validation des documents, suspension, notes, sanctions.
- Gestion partenaires B2B : clés API, webhooks, grille tarifaire, commissions, facturation.
- Moteur de tarification (zones, forfaits, majorations, véhicule).
- Finance : encaissements, reversements, factures, avoirs, export comptable.
- Support : litiges, remboursements, objets perdus, journal d'audit.

### 3.3 Site/app de réservation client
- Devis immédiat (départ, arrivée, date, passagers, bagages, n° de vol), choix catégorie, paiement carte, e-mail/SMS de confirmation, page de suivi (lien magique), annulation/modification, multilingue (FR/EN d'abord, AR/ES ensuite).

### 3.4 API B2B partenaires
- REST + OpenAPI, authentification par clé/OAuth2 client-credentials, **idempotence** sur les réservations, **sandbox**.
- Endpoints : `POST /quotes`, `POST /bookings`, `GET /bookings/{id}`, `PATCH /bookings/{id}`, `DELETE /bookings/{id}` (annulation + frais), `GET /vehicle-categories`.
- Webhooks signés (HMAC) : `booking.confirmed`, `driver.assigned`, `driver.en_route`, `driver.arrived`, `ride.started`, `ride.completed`, `booking.cancelled`, `flight.delayed`.
- SLA documenté, versioning (`/v1`), limites de débit, logs consultables par le partenaire.
- ⚠️ Booking.com et Trip.com ont leurs propres spécifications d'intégration (ex. Booking Taxi / connectivité) : prévoir une couche d'adaptateurs après avoir obtenu leur documentation partenaire.

### 3.5 Transverse
- **Suivi de vol** (API type AviationStack / FlightAware / AeroDataBox) : ajustement automatique de l'heure de prise en charge (« Heure actualisée »).
- Notifications : push (FCM/APNs), SMS, e-mail, WhatsApp (Twilio / Meta Cloud API).
- Notation chauffeur et score de fiabilité. Le code applique une suspension automatique à certains seuils de récidive. Le rôle de la revue humaine, les conditions de recours et le barème restent à valider.
- Contrat cadre de sous-traitance + CGU signés électroniquement à l'inscription.

## 4. Cycle de vie d'une course

`created → quoted → confirmed → dispatching → assigned → en_route → arrived → in_progress → completed`
Branches : `cancelled_by_client`, `cancelled_by_partner`, `driver_cancelled` (→ redispatch), `no_show`, `disputed`, `refunded`.

Dispatch : à la confirmation, la course est publiée dans la bourse (filtrée par zone, catégorie de véhicule, disponibilité) avec un délai d'acceptation (ex. 1 min si imminente, plus long si planifiée) ; en cas d'expiration → élargissement du rayon / alerte opérateur ; le dispatcheur peut appeler un chauffeur éligible et attribuer la course après son accord verbal sur la course et la rémunération, en enregistrant sa déclaration dans le back-office. La notification chauffeur ne requiert aucune confirmation. Les protections d’exclusivité, de planning et de véhicule s’appliquent. Voir les [règles métier](REGLES_METIER.md).

## 5. Architecture technique (budget < 500 €/mois)

**Existant.** Monorepo TypeScript avec pnpm, NestJS, Prisma, PostgreSQL, Next.js et Expo. Voir [Architecture](ARCHITECTURE.md). Le schéma et les options ci-dessous conservent le cadrage technique historique et les choix à valider.

```
apps/
  api/            NestJS (REST, WebSocket, jobs) 
  backoffice/     Next.js (admin & dispatch)
  web-booking/    Next.js (réservation client)
  driver-app/     Expo / React Native
packages/
  shared/         types, schémas Zod, SDK client généré (OpenAPI)
  pricing/        moteur de tarification (pur, testable)
infra/            Docker, IaC, CI
docs/
```

| Besoin | Choix MVP | Évolution |
|---|---|---|
| Base de données | PostgreSQL + PostGIS (Neon / Supabase / Scaleway) | réplicas, partitionnement |
| ORM | Prisma ou Drizzle | — |
| Cache/queues/jobs | Redis + BullMQ | — |
| Temps réel | WebSocket (Socket.IO) / Supabase Realtime | — |
| Auth | Clerk / Supabase Auth / Auth.js ; OAuth2 pour l'API | — |
| Carte/routage | Google Maps Platform (précis, coût à surveiller) ou OSRM/Mapbox | auto-hébergé |
| Paiement | Stripe (paiement carte, Connect pour reversements) + SEPA | — |
| Stockage documents | S3 compatible (chiffré, URLs signées) | — |
| Hébergement | Railway / Fly.io / Scaleway + Vercel | Kubernetes |
| Observabilité | Sentry + logs structurés + Uptime | Datadog/Grafana |
| Mobile | Expo EAS (build/OTA) | — |

Principes : API-first, machine à états explicite pour les courses, événements de domaine + outbox pour fiabiliser webhooks/notifications, toutes les écritures sensibles auditées, **RGPD dès le départ** (minimisation, rétention, DPA, chiffrement des documents chauffeurs).

## 6. Modèle de données (existant et entités envisagées)

`Partner`, `ApiKey`, `WebhookEndpoint`, `Customer`, `Booking`, `Ride`, `RideEvent`, `Quote`, `PricingRule` (zone, forfait, majoration, partenaire), `VehicleCategory`, `Company`, `Driver`, `Vehicle`, `Document` (type, expiration, statut), `DriverVehicleAssignment`, `DispatchOffer` (course, chauffeur, expire_at, statut), `Payment`, `Payout`, `Invoice`, `CreditNote`, `Rating`, `Dispute`, `Notification`, `AuditLog`, `FlightWatch`.

## 7. Tarification

Prix = max(minimum course, forfait si applicable, base + km × tarif + minutes × tarif) × coefficient catégorie × (1 + majorations) × coefficient partenaire, + options (bagages, siège enfant, attente). Le prix est **figé à la réservation** (le chauffeur voit son net, la plateforme sa commission). Moteur pur dans `packages/pricing` avec tests exhaustifs.

## 8. Roadmap par phases

Cadrage historique et durées indicatives. La [feuille de route](ROADMAP.md) fait référence pour les jalons de la phase 2.

| Phase | Durée indicative | Contenu | Critère de sortie |
|---|---|---|---|
| 0 — Fondations | 2 sem. | Monorepo, CI, DB, auth, modèle de données, specs OpenAPI | Squelette déployé |
| 1 — Démo « Booking-ready » | 4-6 sem. | API B2B sandbox (devis/résa/annulation/webhooks), moteur de prix, back-office minimal, app chauffeur (bourse + exécution) avec données de test, simulateur de partenaire | Démo bout-en-bout filmable |
| 2 — Pilote Paris | 6-8 sem. | Onboarding documents + e-signature, Stripe, suivi de vol, SMS/WhatsApp, facturation/reversements, support, monitoring | 10-20 chauffeurs, premières vraies courses |
| 3 — Industrialisation | continu | Multi-langue, auto-dispatch, scoring, comptabilité, Tap to Pay, France entière, adaptateurs Booking/Trip.com | SLA tenu, contrat signé |

## 9. Risques et points à valider ⚠️

1. **Statut juridique** : en France, vendre des courses VTC et/ou opérer une centrale de réservation implique en général une **inscription au registre des exploitants VTC (Atout France)** et des responsabilités (assurance RC, conditions de prise en charge préalable). « Simple intermédiaire technique » est fragile face à un acteur comme Booking, qui exige **un contractant unique responsable** de la prestation. **À valider avec un avocat/expert transport avant de signer quoi que ce soit.**
2. **Assurance** : RC plateforme + vérification de l'assurance de chaque chauffeur/véhicule.
3. **Qualité de service** : fiabilité 24/7, taux d'acceptation, plan B en cas d'absence de chauffeur (c'est le critère n°1 des grands comptes).
4. **Coûts cartographie / SMS / suivi de vol** à surveiller avec le budget < 500 €/mois.
5. **Requalification** du lien chauffeur/plateforme (subordination) : contrat et pratiques à cadrer.
6. **TVA / facturation** : mandat de facturation, TVA transport (10 %), commission, avoirs.
7. **Dépendance solo** : prioriser ruthlessly ; l'API + le simulateur de démo valent plus que des écrans nombreux.

## 10. Questions encore ouvertes

- Nom de marque, identité visuelle, domaine ?
- Déjà des contacts chauffeurs/sociétés prêts à tester ? Combien ?
- Commission cible (%), délai de paiement chauffeurs ?
- Faut-il une flotte propre pour garantir la disponibilité ?
- Langues obligatoires au lancement ?
- Faut-il un compte chauffeur « société » avec sous-comptes dès la phase 2 ?
- Hébergement des données : UE obligatoire pour les partenaires ?
