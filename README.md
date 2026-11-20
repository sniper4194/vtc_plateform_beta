# VTC Platform

Plateforme B2B2C de transferts VTC à prix fixe (API partenaires type Booking.com / Trip.com, app chauffeur, back-office).

- Cahier des charges & architecture : [docs/CAHIER_DES_CHARGES.md](docs/CAHIER_DES_CHARGES.md)
- Spec API partenaires : [docs/openapi.yaml](docs/openapi.yaml)

## Démarrage

```bash
pnpm install
cp .env.example .env
pnpm db:up                       # PostgreSQL/PostGIS + Redis
pnpm -F @vtc/api db:deploy       # migrations
pnpm -F @vtc/api seed            # règles de prix et forfaits
pnpm build && pnpm test          # les tests d'intégration utilisent la base `vtc_test`
pnpm -F @vtc/api dev             # API sur http://localhost:3000
```

### Démo bout-en-bout (simulateur de partenaire)

Avec l'API qui tourne (`ADMIN_TOKEN` défini) :

```bash
ADMIN_TOKEN=... API_URL=http://localhost:3000 pnpm -F @vtc/api simulate
```

Le simulateur crée un partenaire et deux chauffeurs, réserve un CDG → Paris à 55 €, fait accepter la course
(acceptation concurrente, un seul gagnant), la déroule jusqu'à la fin et vérifie les 6 webhooks signés.

## Structure

| Chemin | Contenu |
|---|---|
| `apps/api` | API NestJS + schéma Prisma (`prisma/schema.prisma`) |
| `apps/backoffice` | « Tour de contrôle » Next.js (port 3001) : missions en colonnes, suivi de vol, alertes, performance, chauffeurs, sociétés, partenaires, webhooks. **Espace société** sur `/societe` (clé d'accès) : performance, chauffeurs, véhicules, missions, relevé de paiements + CSV |
| `apps/driver-app` | App chauffeur Expo : Cap / Radar / Agenda, **mode mission** (carte Google Maps, vol, attente, pancarte), prise par appui maintenu (`pnpm -F @vtc/driver-app start`) |
| `apps/web-booking` | Site de réservation client — à initialiser (phase 2) |
| `packages/pricing` | Moteur de tarification pur, testé |
| `packages/shared` | Schémas Zod, machine à états des courses |
| `infra` | docker-compose |

## État de la phase 1

| Élément | État |
|---|---|
| API partenaires (clé API, devis 15 min, réservation idempotente, annulation, webhooks signés) | ✅ testé (PostgreSQL réel) |
| Dispatch (bourse, acceptation exclusive, relances, redistribution, alertes, attribution manuelle) | ✅ testé |
| Onboarding chauffeur (documents requis, validation) | ✅ testé — upload réel S3 : phase 2 |
| Back-office | ✅ vérifié dans un navigateur — authentification par token partagé (comptes nominatifs : phase 2) |
| App chauffeur | ✅ typée, bundle Android compilé, logique testée — **non essayée sur un téléphone/émulateur** |
| Routage, suivi de vol, push/SMS, paiements, e-signature | ⏳ phase 2 (stubs : `RoutingService`, `NotificationsService`) |

Connexion chauffeur en dev : téléphone d'un chauffeur créé via `/admin/drivers`, code `DRIVER_DEV_OTP` (000000 par défaut).

**Identité visuelle** : aplats bleu/jaune/rouge, serif massif, pastilles, grain d'impression (voir `apps/driver-app/src/theme.ts`). « ÉTOILE » est un nom de travail : il se change dans une seule constante (`BRAND`) et dans le back-office.

## Google Maps (app chauffeur)

La carte native utilise Google Maps. La clé n'est jamais commitée : `GOOGLE_MAPS_API_KEY=... npx expo run:android` (ou variable d'environnement du build EAS).
Sans clé, la carte native reste vide ; sur le web, un schéma sans carte est affiché. Le tracé est une ligne droite (pas d'itinéraire routier).

## Suivi de vol

Le retard est mesuré par rapport à l'heure d'arrivée prévue (`pickupAt`). `POST /admin/rides/:id/flight` (opérateur) et le fournisseur branchable
(`FlightsService.provider`, interface `FlightProvider`) passent par le même chemin : webhook `flight.delayed`, notification chauffeur, heure effective,
et décompte du no-show à partir de l'heure effective. **Aucun fournisseur de données de vol n'est branché pour l'instant.**

## Comptes du back-office

Le back-office utilise des comptes nominatifs (mot de passe haché scrypt, verrouillage 15 min après 5 échecs, sessions de 8 h révoquées au changement de mot de passe ou à la désactivation, journal d'audit, rôles Administrateur / Régulateur).
Premier administrateur :

```bash
ADMIN_PASSWORD='une phrase de passe longue' pnpm -F @vtc/api admin:create vous@exemple.fr "Votre Nom"
```

`ADMIN_TOKEN` (en-tête `x-admin-token`) reste un **token de service** pour les scripts et le simulateur ; sans cette variable, il est refusé. Derrière un proxy, définir `TRUST_PROXY=1`.

## Connexion des chauffeurs (code SMS)

`POST /driver/otp {phone}` envoie un code à 6 chiffres (5 min, 5 essais, 1 renvoi / 30 s, 3 demandes / 10 min, réponse identique pour un numéro inconnu) ; `POST /driver/login {phone, code}` le vérifie. Seule l'empreinte HMAC est stockée.
Fournisseur : `SMS_PROVIDER=twilio` (adaptateur écrit d'après la documentation, **non essayé contre un vrai compte**) ; en production sans fournisseur, l'envoi répond 501.
Pour le simulateur et les démos locales, lancer l'API avec `DRIVER_DEV_OTP=000000` (interdit en production).
