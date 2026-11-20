# syntax=docker/dockerfile:1
# Construire depuis la racine du dépôt :
#   docker build -f apps/backoffice/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.exemple.fr -t vtc-backoffice .
# NEXT_PUBLIC_API_URL est intégrée au code client à la compilation : une image par environnement.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backoffice/package.json apps/backoffice/
RUN pnpm install --frozen-lockfile --filter @vtc/backoffice...
COPY apps/backoffice apps/backoffice
RUN pnpm --filter @vtc/backoffice build

FROM node:22-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/backoffice/.next/standalone ./
COPY --from=build /app/apps/backoffice/.next/static apps/backoffice/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/backoffice/server.js"]
