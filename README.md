# AiBrain

Workbench propi, replicable i personalitzable sobre Codex App Server. Codex continua sent el motor agentic; AiBrain controla la UX, l’auth, els tenants, els manifests, les finestres i les polítiques.

## Què funciona

- Client real de Codex App Server per `stdio`, amb inici i represa de threads, streaming i interrupció.
- Plans, activitat, ordres, eines, canvis, diffs i aprovacions interactives amb un contracte NDJSON tipat.
- Sessió demo signada en cookie `HttpOnly`, allowlist local, rols `owner` i `member` i protecció server-side de totes les APIs.
- Adaptador Supabase SSR per producció, login passwordless invite-only, refresh de sessió i resolució de tenant/rol a cada petició.
- Projectes i fils durables amb crear, canviar, cercar, reanomenar, fixar, arxivar i reprendre per projecte.
- Command center amb jerarquia projecte → fil, sidebar col·lapsable, cerca global amb `⌘K` i dreceres de creació.
- Review per torn amb navegació per fitxer, comptadors, diff línia a línia, còpia i activitat separada.
- Migracions Postgres amb RLS, memberships, invitacions, manifests append-only, workspaces, threads, missatges i auditoria per triggers.
- Dos tenants reals de demostració, cadascun amb manifest, identitat, preferències, finestres i workspace propis.
- Tokens opacs de thread vinculats al tenant i al fil persistent; el navegador no rep ni l’ID cru de Codex ni el token de represa.
- Control plane owner-only amb overlays de manifest validats i escriptura atòmica.
- Registre extensible de finestres: workbench, inspector i runtime.
- Selecció i preferències de navegador separades per tenant; projectes, fils i missatges viuen al servidor, excepte a la preview UX explícitament efímera.

## Executar el prototip local

```bash
npm ci
AIBRAIN_SESSION_SECRET="$(openssl rand -hex 32)" npm run dev
```

Obre `http://localhost:3000/login` i tria una de les dues identitats de demostració:

- `AiBrain Studio`: owner amb accés a `/control`.
- `AiBrain Operations`: member sense permisos de control plane.

L’entrada demo no demana contrasenya i està desactivada amb `NODE_ENV=production`, excepte en un deployment Vercel Preview que declari alhora `AIBRAIN_AUTH_MODE=demo` i `AIBRAIN_ENABLE_PREVIEW_DEMO=1`. El codi comprova `VERCEL_ENV=preview`, de manera que la mateixa bandera no pot obrir producció. Serveix per validar sessió, autorització, tenancy i UX; no és auth de producció.

## Activar l’adaptador Supabase

El projecte hosted `aibrain-workbench` està creat, vinculat i té les tres migracions aplicades. La configuració, el bootstrap del primer owner i els gates live són a [docs/SUPABASE.md](docs/SUPABASE.md).

Quan les credencials existeixen, `AIBRAIN_AUTH_MODE=supabase` substitueix completament la sessió demo i el filesystem de manifests. Si falta configuració, l’aplicació queda tancada.

## Activar Codex local

```bash
CHAT_RUNTIME=codex \
CODEX_WORKSPACE_ROOT=/ruta/absoluta/workspaces \
CODEX_HOME_ROOT=/ruta/privada/codex-homes \
AIBRAIN_SESSION_SECRET="$(openssl rand -hex 32)" \
npm run dev
```

Per a cada tenant es deriva automàticament:

```text
CODEX_WORKSPACE_ROOT/<tenant>/workspace
CODEX_HOME_ROOT/<tenant>
```

Si `CODEX_HOME_ROOT` no està configurat, el prototip pot utilitzar la sessió local heretada del procés, però la UI el marca com a no aïllat i el runtime ho rebutja en producció.

## Superfícies i contractes

- `POST /api/auth/login|logout`: demo local o passwordless Supabase segons l’adaptador actiu.
- `GET /auth/confirm`: intercanvi server-side de code o token hash per sessió SSR.
- `GET /api/auth/session`: DTO mínim de sessió.
- `GET /api/workbench`: snapshot públic de projectes, workspaces, fils i missatges del tenant actiu.
- `POST|PATCH /api/projects|threads`: CRUD validat i protegit per sessió, origen i RLS.
- `POST /api/chat`: NDJSON amb `plan`, `activity`, `approval`, `diff`, `delta`, `done` i `error`; la represa de Codex queda server-side.
- `POST /api/runtime/approvals`: resol una aprovació només si pertany al tenant actiu.
- `GET /api/runtime/status`: estat no sensible i específic del tenant.
- `GET|PUT /api/control-plane/manifest`: lectura i edició owner-only del manifest del tenant actiu.
- `POST /api/control-plane/invitations`: alta owner-only de membres amb assignació i audit atòmics.

Consulta [AIBRAIN_CODEX_ARCHITECTURE.md](AIBRAIN_CODEX_ARCHITECTURE.md), [docs/SUPABASE.md](docs/SUPABASE.md), [docs/PRODUCTION.md](docs/PRODUCTION.md) i [.env.example](.env.example).
