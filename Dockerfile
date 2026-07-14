# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Dummy values scoped to this command only, so the build never touches a real
# database or secrets and nothing persists in image metadata; runtime values
# come from docker-compose.
RUN DATABASE_URL="postgres://build:build@localhost:5432/build" \
    DATABASE_DRIVER="pg" \
    BETTER_AUTH_SECRET="build-time-placeholder" \
    ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000" \
    NEXT_TELEMETRY_DISABLED=1 \
    npm run build

# ── run ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app

# Standalone output already contains server.js + the traced node_modules
# (including drizzle-orm and pg, which scripts/migrate.mjs uses at start).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
# drizzle-orm is bundled into the server chunks by Next, so the standalone
# node_modules lacks it; migrate.mjs needs the real package (zero deps).
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY scripts/migrate.mjs ./scripts/migrate.mjs
COPY docker-entrypoint.sh ./docker-entrypoint.sh

USER app
EXPOSE 3000
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
