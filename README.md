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
| `apps/backoffice`, `apps/web-booking`, `apps/driver-app` | À initialiser (phase 1) |
| `packages/pricing` | Moteur de tarification pur, testé |
| `packages/shared` | Schémas Zod, machine à états des courses |
| `infra` | docker-compose |
