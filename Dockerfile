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
# Dummy values so the build never touches a real database or secrets;
# runtime values come from docker-compose.
ENV DATABASE_URL="postgres://build:build@localhost:5432/build" \
    DATABASE_DRIVER="pg" \
    BETTER_AUTH_SECRET="build-time-placeholder" \
    ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"
RUN npm run build

# ── run ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migrations run at container start (docker-entrypoint.sh)
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/drizzle.config.docker.ts ./drizzle.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh

USER app
EXPOSE 3000
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
