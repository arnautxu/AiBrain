FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV CHAT_RUNTIME=codex
ENV CODEX_BIN=/usr/local/bin/codex
ENV CODEX_HOME_ROOT=/var/lib/aibrain/codex
ENV CODEX_WORKSPACE_ROOT=/var/lib/aibrain/workspaces
ENV CONTROL_PLANE_DATA_DIR=/var/lib/aibrain/control-plane
ENV CODEX_APPROVAL_POLICY=on-request
ENV CODEX_SANDBOX=workspace-write

RUN npm install --global @openai/codex@0.149.1 \
  && groupadd --system --gid 1001 aibrain \
  && useradd --system --uid 1001 --gid aibrain aibrain \
  && mkdir -p /var/lib/aibrain/codex/studio /var/lib/aibrain/codex/operations /var/lib/aibrain/control-plane /var/lib/aibrain/workspaces/studio/workspace /var/lib/aibrain/workspaces/operations/workspace \
  && chown -R aibrain:aibrain /var/lib/aibrain /app

COPY --from=builder --chown=aibrain:aibrain /app/.next/standalone ./
COPY --from=builder --chown=aibrain:aibrain /app/.next/static ./.next/static
COPY --from=builder --chown=aibrain:aibrain /app/public ./public
COPY --from=builder --chown=aibrain:aibrain /app/runtime/tenants ./runtime/tenants

USER aibrain
EXPOSE 3000
VOLUME ["/var/lib/aibrain"]

CMD ["node", "server.js"]
