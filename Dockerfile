ARG NODE_IMAGE=node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7

FROM ${NODE_IMAGE} AS egress-gateway

ARG AIBRAIN_EGRESS_UID=10002
ARG AIBRAIN_EGRESS_GID=10002

RUN groupadd --system --gid "${AIBRAIN_EGRESS_GID}" aibrain-egress \
  && useradd --system --uid "${AIBRAIN_EGRESS_UID}" --gid aibrain-egress \
    --home-dir /nonexistent --no-create-home aibrain-egress \
  && install -d -m 0755 -o root -g root /usr/local/share/aibrain

COPY --chown=root:root infra/hetzner/egress/gateway.mts /usr/local/share/aibrain/egress-gateway.mts
COPY --chown=root:root infra/hetzner/ingress/gateway.mts /usr/local/share/aibrain/ingress-gateway.mts
RUN chmod 0444 /usr/local/share/aibrain/egress-gateway.mts /usr/local/share/aibrain/ingress-gateway.mts

ARG AIBRAIN_REVISION=development
LABEL org.opencontainers.image.title="AiBrain Egress Gateway" \
      org.opencontainers.image.vendor="GraphikAI" \
      org.opencontainers.image.revision="${AIBRAIN_REVISION}"

USER aibrain-egress:aibrain-egress
EXPOSE 8080
ENTRYPOINT ["node", "/usr/local/share/aibrain/egress-gateway.mts"]

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run build:automation-worker && npm run build:container-app-server-acceptance

FROM ${NODE_IMAGE} AS runtime

ARG AIBRAIN_UID=10001
ARG AIBRAIN_GID=10001
ARG DEBIAN_SNAPSHOT=20260820T000000Z

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    CHAT_RUNTIME=codex \
    CODEX_BIN=/usr/local/bin/aibrain-codex-worker \
    CODEX_HOME_ROOT=/var/lib/aibrain/data/users \
    CODEX_WORKSPACE_ROOT=/var/lib/aibrain/data/users \
    CODEX_APPROVAL_POLICY=never \
    AIBRAIN_BROWSER_INTERACTIVE_APPROVALS=disabled \
    CODEX_SANDBOX=workspace-write \
    AIBRAIN_INSTALLATION_CONFIG=/etc/aibrain/installation.json \
    AIBRAIN_CHROME_BIN=/usr/local/bin/aibrain-chrome \
    AIBRAIN_SOFFICE_BIN=/usr/local/bin/aibrain-soffice \
    AIBRAIN_PDFINFO_BIN=/usr/local/bin/aibrain-pdfinfo \
    AIBRAIN_PDFTOPPM_BIN=/usr/local/bin/aibrain-pdftoppm \
    AIBRAIN_PDFTOTEXT_BIN=/usr/local/bin/aibrain-pdftotext \
    AIBRAIN_QPDF_BIN=/usr/local/bin/aibrain-qpdf \
    AIBRAIN_CODEX_EXPECTED_VERSION=0.149.1 \
    AIBRAIN_INTERNAL_AGENT_CONTEXT_ROOT=/usr/local/share/aibrain/internal-agent-context \
    HOME=/var/lib/aibrain/data/app-home \
    XDG_CACHE_HOME=/var/lib/aibrain/data/server/xdg/cache \
    XDG_CONFIG_HOME=/var/lib/aibrain/data/server/xdg/config \
    XDG_DATA_HOME=/var/lib/aibrain/data/server/xdg/data \
    XDG_STATE_HOME=/var/lib/aibrain/data/server/xdg/state

# The pinned slim base does not contain a system trust store. Bootstrap only
# ca-certificates from the base image's signed Debian sources before switching
# every runtime/tool package to the immutable snapshot below.
RUN apt-get update \
  && export DEBIAN_FRONTEND=noninteractive \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN printf '%s\n' \
    "deb https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/ bookworm main" \
    "deb https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/ bookworm-updates main" \
    "deb https://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}/ bookworm-security main" \
    > /etc/apt/sources.list \
  && rm -f /etc/apt/sources.list.d/debian.sources \
  && printf '%s\n' 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99snapshot \
  && apt-get update \
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
    python3 \
    python3-venv \
    qpdf \
    restic \
    tini \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global --omit=dev "@openai/codex@0.149.1" "tsx@4.20.6" \
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

# Bubblewrap needs a pre-existing mountpoint because the container root is
# deliberately read-only before document conversion begins.
RUN install -d -m 0555 -o root -g root /work

WORKDIR /app
COPY --from=builder --chown=aibrain:aibrain /app/.next/standalone ./
COPY --from=builder --chown=aibrain:aibrain /app/.next/static ./.next/static
COPY --from=builder --chown=aibrain:aibrain /app/public ./public
COPY --from=builder --chown=root:root /app/config/internal-agent-context /usr/local/share/aibrain/internal-agent-context
COPY --from=builder --chown=root:root /app/dist/automation-worker.mjs ./automation-worker.mjs
COPY --from=builder --chown=root:root /app/dist/container-app-server-acceptance.mjs /usr/local/share/aibrain/container-app-server-acceptance.mjs
# The scheduler is an explicit server-conditioned ESM bundle. Unlike the app,
# it does not depend on Next's standalone file tracer, tsx, source mounts, or a
# hand-copied `server-only` marker/dependency graph at runtime.
COPY --from=builder --chown=root:root /app/scripts/backup.ts ./scripts/backup.ts
COPY --from=builder --chown=root:root /app/scripts/replicate-backup.ts ./scripts/replicate-backup.ts
COPY --from=builder --chown=root:root /app/scripts/run-operational-alerts.ts ./scripts/run-operational-alerts.ts
COPY --from=builder --chown=root:root /app/scripts/maintain-document-temporaries.ts ./scripts/maintain-document-temporaries.ts
COPY --from=builder --chown=root:root /app/src/config/installation.ts /app/src/config/installation-schema.ts ./src/config/
COPY --from=builder --chown=root:root /app/src/documents/publication-locks.ts ./src/documents/publication-locks.ts
COPY --from=builder --chown=root:root /app/src/documents/maintenance.ts ./src/documents/maintenance.ts
COPY --from=builder --chown=root:root /app/src/operations/backup.ts /app/src/operations/backup-replica.ts ./src/operations/
COPY --from=builder --chown=root:root /app/src/operations/alerts.ts /app/src/operations/alert-collector.ts /app/src/operations/alert-delivery.ts ./src/operations/
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
COPY --chown=root:root infra/hetzner/app/browser-sandbox.sh /usr/local/bin/aibrain-chrome
COPY --chown=root:root infra/hetzner/app/soffice-safe.sh /usr/local/bin/aibrain-soffice
COPY --chown=root:root infra/hetzner/app/soffice-safe.sh /usr/local/bin/aibrain-pdfinfo
COPY --chown=root:root infra/hetzner/app/soffice-safe.sh /usr/local/bin/aibrain-pdftoppm
COPY --chown=root:root infra/hetzner/app/soffice-safe.sh /usr/local/bin/aibrain-pdftotext
COPY --chown=root:root infra/hetzner/app/soffice-safe.sh /usr/local/bin/aibrain-qpdf
COPY --chown=root:root infra/hetzner/app/backup.sh /usr/local/bin/aibrain-backup
COPY --chown=root:root infra/hetzner/app/backup-replicate.sh /usr/local/bin/aibrain-backup-replicate
COPY --chown=root:root infra/hetzner/app/alerts.sh /usr/local/bin/aibrain-alerts
COPY --chown=root:root infra/hetzner/app/alert-controller.sh /usr/local/bin/aibrain-alert-controller
COPY --chown=root:root infra/hetzner/app/document-maintenance.sh /usr/local/bin/aibrain-document-maintenance
COPY --chown=root:root infra/hetzner/app/healthcheck.mjs /usr/local/share/aibrain/healthcheck.mjs
COPY --chown=root:root infra/hetzner/app/automation-worker-healthcheck.mjs /usr/local/share/aibrain/automation-worker-healthcheck.mjs
COPY --chown=root:root infra/hetzner/app/configure-egress.mjs /usr/local/share/aibrain/configure-egress.mjs
RUN chmod 0755 \
  /usr/local/bin/aibrain-entrypoint \
  /usr/local/bin/aibrain-codex-worker \
  /usr/local/bin/aibrain-chrome \
  /usr/local/bin/aibrain-soffice \
  /usr/local/bin/aibrain-pdfinfo \
  /usr/local/bin/aibrain-pdftoppm \
  /usr/local/bin/aibrain-pdftotext \
  /usr/local/bin/aibrain-qpdf \
  /usr/local/bin/aibrain-backup \
  /usr/local/bin/aibrain-backup-replicate \
  /usr/local/bin/aibrain-alerts \
  /usr/local/bin/aibrain-alert-controller \
  /usr/local/bin/aibrain-document-maintenance \
  && chmod 0444 /usr/local/share/aibrain/healthcheck.mjs /usr/local/share/aibrain/automation-worker-healthcheck.mjs \
  && chmod 0555 /usr/local/share/aibrain/configure-egress.mjs /usr/local/share/aibrain/container-app-server-acceptance.mjs \
  && chmod -R a-w /app /usr/local/share/aibrain/internal-agent-context /usr/local/bin/codex-real /usr/local/lib/node_modules/@openai/codex

ARG AIBRAIN_REVISION=development
LABEL org.opencontainers.image.title="AiBrain Company Brain" \
      org.opencontainers.image.vendor="GraphikAI" \
      org.opencontainers.image.revision="${AIBRAIN_REVISION}"

USER aibrain:aibrain
EXPOSE 3000
VOLUME ["/var/lib/aibrain/data", "/var/lib/aibrain-restores"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aibrain-entrypoint"]
CMD ["node", "server.js"]
