# syntax=docker/dockerfile:1
# Construire depuis la racine du dépôt :  docker build -f apps/api/Dockerfile -t vtc-api .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable \
 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- compilation (TypeScript + client Prisma)
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/pricing/package.json packages/pricing/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @vtc/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @vtc/pricing --filter @vtc/shared build \
 && pnpm --filter @vtc/api exec prisma generate \
 && pnpm --filter @vtc/api build

# --- image d'exécution : dépendances de production seulement
FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/pricing/package.json packages/pricing/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @vtc/api...
COPY --from=build /app/packages/pricing/dist packages/pricing/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/prisma apps/api/prisma
RUN pnpm --filter @vtc/api exec prisma generate
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Les migrations s'appliquent au démarrage (Prisma prend un verrou : plusieurs instances ne se gênent pas).
# On appelle le binaire directement : pas de pnpm (ni de téléchargement) à l'exécution.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
