# VTC Platform

Plateforme B2B2C de transferts VTC à prix fixe (API partenaires type Booking.com / Trip.com, app chauffeur, back-office).

- Cahier des charges & architecture : [docs/CAHIER_DES_CHARGES.md](docs/CAHIER_DES_CHARGES.md)
- Spec API partenaires : [docs/openapi.yaml](docs/openapi.yaml)

## Démarrage

```bash
pnpm install
cp .env.example .env
pnpm db:up                       # PostgreSQL/PostGIS + Redis
pnpm -F @vtc/api exec prisma migrate deploy
pnpm build && pnpm test
pnpm -F @vtc/api dev             # API sur http://localhost:3000 (GET /health, POST /v1/quotes)
```

## Structure

| Chemin | Contenu |
|---|---|
| `apps/api` | API NestJS + schéma Prisma (`prisma/schema.prisma`) |
| `apps/backoffice`, `apps/web-booking`, `apps/driver-app` | À initialiser (phase 1) |
| `packages/pricing` | Moteur de tarification pur, testé |
| `packages/shared` | Schémas Zod, machine à états des courses |
| `infra` | docker-compose |
