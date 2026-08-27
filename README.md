# AiBrain

AiBrain is a white-label Company Brain built on Codex App Server. One codebase
serves independent company installations; identity, branding, paths, secrets,
networks, volumes and release tags come from configuration rather than tenant
forks or customer hardcodes.

## Implemented architecture

- Supabase is used only to authenticate login, initial-password change and
  recovery. AiBrain exchanges that identity for an opaque, revocable local
  session cookie; all product data remains local.
- Projects, threads, turns, approvals, documents, publication records, memory,
  audit and runtime state use validated, versioned filesystem stores with
  atomic writes, locks, journals and recovery.
- Every employee receives an independent `CODEX_HOME`, workspace, staging,
  artifacts, browser profile, downloads, credentials and audit roots.
- A persistent per-employee worker talks to the server through an authenticated
  loopback WebSocket transport with replay, ACK, dedupe, idempotency,
  heartbeat, backoff and restart recovery. The browser never connects to App
  Server.
- `PERMISSIONS.md` is resolved read-only on the server for each turn and its
  version/fingerprint is written to durable audit before execution.
- Office, PDF, text and image uploads stream to private staging, are validated
  before isolated preview conversion, and can reach the official document root
  only through the server-side freeze/review/confirm publisher.
- Each employee has one persistent Chromium runtime. Threads receive separate
  page targets and download roots. CDP uses inherited process pipes only—no TCP
  listener or discovery file—and the viewer requires short, session- and
  thread-bound tokens plus explicit takeover for human input.
- The production container is non-root/read-only, does not mount `docker.sock`,
  masks other employees and `publish-rw` from worker sandboxes, and uses unique
  networks, volumes, ports and host paths per installation.

## Local development

Requirements: Node 24 and npm. The committed development installation is
synthetic and writes only below `/tmp/aibrain-example-lab`.

```bash
npm ci
export AIBRAIN_INSTALLATION_CONFIG="$PWD/config/installations/development.example.json"
export AIBRAIN_SESSION_SECRET="$(openssl rand -hex 32)"
npm run dev
```

Demo login is development-only. Production requires `AIBRAIN_AUTH_MODE=supabase`,
the Supabase URL/publishable key, independent session/challenge/publication/
browser secrets, an absolute `AIBRAIN_INSTALLATION_CONFIG`, and an exact
`AIBRAIN_CHROME_EXPECTED_VERSION`. No Supabase service-role key or product
database is used.

Provision employees using the same UUID issued by Supabase Auth:

```bash
npm run users:provision -- --input /absolute/path/to/users.json
```

The command is idempotent and accepts any number of employees; capacity is
controlled operationally rather than through commercial quotas.

## Verification

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:contract
npm run test:e2e
npm run build
npm run infra:validate
```

The real document and Chromium matrices are opt-in because they require the
host toolchain:

```bash
npm run test:documents:real
AIBRAIN_CHROME_EXECUTABLE=/absolute/path/to/pinned/chrome \
AIBRAIN_CHROME_EXPECTED_VERSION=152.0.7977.64 \
npm run test:browser:real
```

## Contracts and operations

- [UI/backend contract](docs/UI_BACKEND_CONTRACT.md)
- [Backend progress and reproducible evidence](docs/AIBRAIN_BACKEND_PROGRESS.md)
- [Installation configuration](docs/INSTALLATION_CONFIGURATION.md)
- [Permissions provider](docs/PERMISSIONS_PROVIDER.md)
- [Browser/Computer Use runtime](docs/BROWSER_COMPUTER_USE_RUNTIME.md)
- [Document publisher](docs/DOCUMENT_PUBLISHER.md)
- [Backup and restore](docs/BACKUP_RESTORE.md)
- [Dedicated-server operation](docs/PRODUCTION.md)
- [Isolated Hetzner QA runbook](docs/HETZNER_MIGRATION.md)

The repository does not authorize DNS changes, production cutover, real client
data, real NAS writes, destructive Supabase actions, subscription purchases or
shared personal Codex accounts.
