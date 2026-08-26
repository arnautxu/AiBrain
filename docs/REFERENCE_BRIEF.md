# Reference brief · workbench multi-tenant amb projectes durables

## Resultat

- Workbench propi sobre Codex amb una UX de fils, activitat, approvals i diffs.
- Dues experiències configurades per manifest, sense forks de la UI.
- Sessió demo signada, rols, control plane i límits de tenant verificats al servidor.
- Workspace, credencials Codex, threads, approvals i estat de navegador amb namespace de tenant.
- Projectes, workspaces, fils i missatges persistents; el token de represa de Codex queda exclusivament al servidor.

## Invariants

- Codex és el runtime; la UI no fabrica estats de connexió ni d’execució.
- El navegador no rep secrets, rutes administratives ni IDs crus de thread.
- El tenant prové de la sessió i no del cos de la petició.
- Cada Route Handler protegeix les seves dades i accions directament.
- `chat` és una finestra obligatòria; `inspector` i `runtime` són mòduls activables.
- L’auth demo no es presenta com a producció i no funciona amb `NODE_ENV=production`.
- Cap sincronització al NAS forma part d’aquest milestone.

## Prova d’acceptació

1. Sense cookie, `/` redirigeix a `/login` i les APIs retornen `401`.
2. Studio i Operations mostren marca, accent, densitat, finestres i workspace propis.
3. Els projectes i fils persistents d’un tenant no apareixen a l’altre.
4. L’owner pot desar el seu manifest; el member rep `403`.
5. Les mutacions d’un origen creuat reben `403`.
6. Un fil només es pot reprendre dins del tenant i projecte signats, sense exposar el token opac al navegador.
7. Typecheck, build i audit completen; desktop i mobile es revisen en navegador real.

## Decisions pendents

- Bootstrap del primer owner i SMTP de producció per al model Supabase invite-only ja escollit.
- Host persistent, provisioning de `CODEX_HOME` i estratègia de quotes.
- Empaquetat desktop, si continua sent necessari després de validar la versió web.

## Tall UX/UI · command center

### Evidència

- Direcció de l’usuari: la qualitat d’interacció de Codex és un requisit literal; la marca i les capes han de continuar sent pròpies.
- Referència visual observada: rail de projectes i fils, top bar mínima, conversa centrada, composer persistent i superfícies contextuals que no desplacen el focus principal.
- Referència funcional oficial: projectes amb múltiples fils, agents en paral·lel, review de canvis dins del fil, aprovacions, worktrees i configuració per projecte.
- Implementació AiBrain existent: projectes, fils, activitat, aprovacions, diffs, finestres i runtime ja aporten dades reals; no cal fabricar controls sense backend.

### Tall verificable

1. Sidebar col·lapsable amb projectes i fils agrupats.
2. Cerca global i command palette amb `⌘K`, navegació per teclat i accions reals.
3. Top bar amb breadcrumb de projecte/fil i estat de runtime.
4. Review pane amb fitxers, comptadors i diff real del torn, separat de l’activitat.
5. Composer amb context visible, dreceres i accés directe a ordres i runtime.
6. Paritat responsive: rail en drawer i review a pantalla completa en mòbil, sense overflow.

### No-objectius d’aquest tall

- No mostrar selectors de model, adjunts, terminal o worktrees fins que les seves accions tinguin contracte i backend reals.
- No copiar assets privats, marca ni codi intern de Codex.
- No canviar el model de dades, l’auth, RLS ni la frontera server-side del runtime.
