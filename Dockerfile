# CPL Project Feasibility Calculator — container image for Azure App Service.
#
# Two build targets:
#   runtime (default) — the web app. Small, non-root, no dev tooling.
#   tools             — the full repo with dev dependencies, used for one-off
#                       jobs: database migration and seeding (see
#                       docs/deployment-guide.md). Never run this as the web app.
#
#   docker build -t feasibility:1.0 .                 # web app
#   docker build --target tools -t feasibility-tools:1.0 .

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM build AS tools
ENV NODE_ENV=production
# migrate:   node scripts/migrate.mjs
# seed:      npm run seed:apply && npm run seed:people
CMD ["node", "scripts/migrate.mjs"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 app && adduser --system --uid 1001 --ingroup app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
