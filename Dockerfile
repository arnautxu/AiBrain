ARG NODE_IMAGE=node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runtime

ARG AIBRAIN_UID=10001
ARG AIBRAIN_GID=10001
ARG CODEX_VERSION=0.149.1

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    CHAT_RUNTIME=codex \
    CODEX_BIN=/usr/local/bin/aibrain-codex-worker \
    CODEX_HOME_ROOT=/var/lib/aibrain/data/users \
    CODEX_WORKSPACE_ROOT=/var/lib/aibrain/data/users \
    CODEX_APPROVAL_POLICY=on-request \
    CODEX_SANDBOX=workspace-write \
    AIBRAIN_INSTALLATION_CONFIG=/etc/aibrain/installation.json \
    AIBRAIN_CHROME_BIN=/usr/bin/chromium \
    AIBRAIN_SOFFICE_BIN=/usr/local/bin/aibrain-soffice \
    AIBRAIN_PDFINFO_BIN=/usr/bin/pdfinfo \
    AIBRAIN_PDFTOPPM_BIN=/usr/bin/pdftoppm \
    AIBRAIN_QPDF_BIN=/usr/bin/qpdf \
    HOME=/var/lib/aibrain/data/app-home \
    XDG_CACHE_HOME=/var/lib/aibrain/data/server/xdg/cache \
    XDG_CONFIG_HOME=/var/lib/aibrain/data/server/xdg/config \
    XDG_DATA_HOME=/var/lib/aibrain/data/server/xdg/data \
    XDG_STATE_HOME=/var/lib/aibrain/data/server/xdg/state

RUN apt-get update \
  && export DEBIAN_FRONTEND=noninteractive \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    bubblewrap \
    ca-certificates \
    chromium \
    chromium-sandbox \
    fonts-dejavu-core \
    fonts-liberation \
    libreoffice-calc \
    libreoffice-core \
    libreoffice-impress \
    libreoffice-writer \
    poppler-utils \
    qpdf \
    tini \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global --omit=dev "@openai/codex@${CODEX_VERSION}" "tsx@4.20.6" \
  && mv /usr/local/bin/codex /usr/local/bin/codex-real \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && groupadd --system --gid "${AIBRAIN_GID}" aibrain \
  && useradd --system --uid "${AIBRAIN_UID}" --gid aibrain --home-dir /var/lib/aibrain/data/app-home aibrain \
  && install -d -m 0700 -o aibrain -g aibrain \
    /var/lib/aibrain/data \
    /var/lib/aibrain/data/app-home \
    /var/lib/aibrain/data/backups \
    /var/lib/aibrain/data/server/xdg/cache \
    /var/lib/aibrain/data/server/xdg/config \
    /var/lib/aibrain/data/server/xdg/data \
    /var/lib/aibrain/data/server/xdg/state \
    /var/lib/aibrain-restores \
    /srv/aibrain/publish-rw \
  && install -d -m 0555 -o root -g root /srv/aibrain/source-ro \
  && install -d -m 0755 -o root -g root /etc/aibrain /usr/local/share/aibrain

WORKDIR /app
COPY --from=builder --chown=aibrain:aibrain /app/.next/standalone ./
COPY --from=builder --chown=aibrain:aibrain /app/.next/static ./.next/static
COPY --from=builder --chown=aibrain:aibrain /app/public ./public
COPY --from=builder --chown=root:root /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=root:root /app/scripts/backup.ts ./scripts/backup.ts
COPY --from=builder --chown=root:root /app/src/config/installation.ts /app/src/config/installation-schema.ts ./src/config/
COPY --from=builder --chown=root:root /app/src/operations/backup.ts /app/src/operations/index.ts ./src/operations/
COPY --from=builder --chown=root:root /app/src/security/safe-file.ts ./src/security/safe-file.ts
COPY --from=builder --chown=root:root \
  /app/src/storage/atomic-file.ts \
  /app/src/storage/errors.ts \
  /app/src/storage/index.ts \
  /app/src/storage/journal.ts \
  /app/src/storage/regenerable-index.ts \
  /app/src/storage/resource-lock.ts \
  /app/src/storage/schema.ts \
  ./src/storage/
COPY --chown=root:root infra/hetzner/app/entrypoint.sh /usr/local/bin/aibrain-entrypoint
COPY --chown=root:root infra/hetzner/app/worker-sandbox.sh /usr/local/bin/aibrain-codex-worker
COPY --chown=root:root infra/hetzner/app/soffice-safe.sh /usr/local/bin/aibrain-soffice
COPY --chown=root:root infra/hetzner/app/backup.sh /usr/local/bin/aibrain-backup
COPY --chown=root:root infra/hetzner/app/healthcheck.mjs /usr/local/share/aibrain/healthcheck.mjs
RUN chmod 0755 \
  /usr/local/bin/aibrain-entrypoint \
  /usr/local/bin/aibrain-codex-worker \
  /usr/local/bin/aibrain-soffice \
  /usr/local/bin/aibrain-backup \
  && chmod 0444 /usr/local/share/aibrain/healthcheck.mjs \
  && chmod -R a-w /app /usr/local/bin/codex-real /usr/local/lib/node_modules/@openai/codex

USER aibrain:aibrain
EXPOSE 3000
VOLUME ["/var/lib/aibrain/data", "/var/lib/aibrain-restores"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aibrain-entrypoint"]
CMD ["node", "server.js"]
