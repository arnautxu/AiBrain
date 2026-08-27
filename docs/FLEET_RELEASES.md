# AiBrain fleet releases

AiBrain is one product codebase and many isolated installations. Arnall is the
first installation, not a fork. A customer-specific server contains only
configuration, secrets, Supabase Auth settings, company context and durable
data; it does not contain customer-specific application code.

## Unit of release

Every accepted source revision produces two immutable image digests: the app
image and the ingress/egress gateway image. A fleet release records:

- source commit and contract version;
- exact image digests;
- required file-store schema versions;
- minimum `InstallationConfig` version;
- health, migration and rollback commands.

Never deploy a mutable tag, run `git pull` on a customer server or copy one
customer's volumes, browser profiles, Supabase project or secrets to another.

## Per-customer boundary

Each customer gets:

- a dedicated Hetzner server and Compose project;
- a unique `installationId`, domain, TLS certificate and branding config;
- a dedicated Supabase project used only for Auth;
- separate filesystem volumes for users, workers, workspaces, staging,
  browsers, documents, journals, approvals, memory, usage and audit;
- root-owned runtime secret files and connector credentials;
- its own backup repository, alert routing and release state.

The same image digest must boot two installations with different configs and
branding. No customer name, domain, path or Supabase identifier may be compiled
into the image.

## Promotion policy

1. Build once from a tested main commit and address images by digest.
2. Promote to an internal synthetic installation.
3. Promote to Arnall as the first canary.
4. Verify login, real Codex turn, streaming, usage, browser, documents,
   persistence, alerts and backup/restore.
5. Promote in bounded waves to the remaining customers.
6. Stop the wave automatically on any failed readiness or acceptance check.
7. Roll only the failed installation back to its previously recorded digests
   and config. Never roll customer data back implicitly.

The fleet controller may hold server addresses and release status, but never
customer application secrets. Deployment identities should accept only a
restricted `deploy <immutable-sha>` command, as the Arnall gateway already
does. A change reaches every customer by promoting the same tested release
through these waves—not by allowing every server to follow `main` blindly.

## Compatibility rule

File-store migrations are forward-only, versioned, atomic and restartable.
Every release declares whether the previous app version can read the migrated
state. If it cannot, the release requires a verified backup and a separate data
restore procedure before promotion. UI/backend contracts remain versioned so
the same backend release cannot silently break a customer-specific frontend.

## New installation acceptance

Use `npm run installation:new` to generate configuration, then provision users
from an operator-owned input file. Before DNS or real data, validate:

- config and filesystem boundaries;
- twenty synthetic users and isolated workers;
- a dedicated Supabase Auth project;
- Codex authentication chosen for that installation;
- browser, Office/PDF, publishing and backup/restore;
- immutable release promotion and rollback.
