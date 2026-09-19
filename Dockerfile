# syntax=docker/dockerfile:1

# Node 22 LTS is pinned deliberately: package.json allows >=20, so an
# unpinned build silently drifted across major versions between local, CI, and
# production runs. See .nvmrc for the matching local version.
ARG NODE_VERSION=22-alpine

# ---- build stage -----------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY wb_v3config.public.json ./
COPY tests ./tests
COPY fixtures ./fixtures
RUN pnpm typecheck && pnpm test

# ---- production stage -----------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
RUN corepack enable \
  && addgroup -S wkb \
  && adduser -S wkb -G wkb \
  && mkdir -p /app/data \
  && chown -R wkb:wkb /app/data
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /app/src ./src
COPY --from=build /app/wb_v3config.public.json ./wb_v3config.public.json
COPY tsconfig.json ./
COPY --chown=wkb:wkb docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER wkb
# No token in the image: credentials come from env / mounted secret.
ENV NODE_ENV=production HOST=0.0.0.0
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
EXPOSE 7891
# Probes /ready, not /health: a process that is alive but has no usable
# credential pool cannot serve requests, and reporting it healthy hid exactly
# that failure mode.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7891)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
