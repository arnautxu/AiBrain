# AiBrain backend definitivo — progreso reproducible

Última actualización: 2026-08-27 (Europe/Madrid)

## Estado de la rama

- Rama: `codex/aibrain-backend-definitivo`
- Commit base: `21bb8b4a2bd9b74cba6a1b771d46b0033893ea01`
- Remoto: `origin` (`arnautxu/AiBrain`)
- Rama UI paralela reservada: `codex/aibrain-ui-parity` (no se integra ni se reescribe desde esta rama)
- Worktree inicial: limpio; no había cambios ajenos que preservar.

## Baseline comprobado

- `npm ci`: verde, 111 paquetes instalados, 0 vulnerabilidades reportadas.
- `npm run typecheck`: verde.
- `npm run build`: verde, Next.js 16.3.2 y 24 rutas generadas.
- Docker/Compose: pendiente de validación local porque el binario `docker` no está instalado en este Mac.
- Lint, unit, integración, E2E y contract tests: no existían en el commit base.

## Inventario técnico inicial de gaps

1. Branding, tenants demo, rutas y `CODEX_HOME` están acoplados a definiciones hardcodeadas.
2. Supabase conserva sesiones SSR y persiste memberships, proyectos, threads, mensajes, permisos y manifests; debe quedar limitado a Auth.
3. El store filesystem actual es monolítico y demo: no tiene `schemaVersion`, `fsync`, locks multi-proceso, journals ni recuperación.
4. App Server usa `stdio`, handlers mutables y una cola por tenant/workspace; hereda todo el entorno, tiene timeout de cinco minutos y no soporta replay/reconnect.
5. Las approvals se guardan solo en memoria y se ligan únicamente al tenant.
6. Los artifacts no tienen registro durable y la descarga puede seguir symlinks.
7. No existen uploads Office/PDF, snapshots, previews ni publicador confirmado e idempotente.
8. El navegador es único por tenant y no dispone de gateway/viewer autenticado por usuario/thread.
9. Compose monta todo `/var/lib/aibrain` en la web; faltan workers separados, healthchecks, backup/restore/release/rollback y alertas.
10. No existe el contrato backend definitivo para la rama UI ni una suite de aceptación.

## Checkpoints

| # | Estado | Evidencia / commit |
|---|---|---|
| 0. Baseline, rama y protección | Completado | `e2b571e` |
| 1. InstallationConfig + segunda instalación | Completado | `a2255ef`; 8/8 tests, lint, typecheck, dos builds y smoke HTTP QA verdes |
| 2. Supabase Auth-only + sesión local | Completado localmente | `1c0386b`, `323243b`: login/cambio inicial/recuperación, cookie opaca, expiración, revocación, CSRF/Origin y continuidad offline; eliminados adapters, migraciones y dependencia SSR de producto. Solo queda validación externa Supabase QA |
| 3. Stores file-backed resilientes | Completado localmente | `38eeaaf`, `9efb45a`, `facda49`, `cf76855`, `ac0b62e`, `368aec0`, `4487ef2`: schemas estrictos, atomic write/fsync, locks multi-proceso y cola local, journals batched, índices, workbench, approvals y proyección incremental de turns aislados, backup/restore real |
| 4. Provisionamiento idempotente + 20 usuarios | Completado | `75316e1`, `545948a`, `323243b`: `user.json`, perfiles, políticas y raíces completas; comando idempotente y prueba con veinte empleados sintéticos |
| 5. Worker registry + WebSocket + contratos | Completado localmente | `fc29316`, `75316e1`, `26fa801`, `a67ecf5`: worker caliente por usuario, gateway loopback autenticado, registry, router scoped, replay/ACK/dedupe/backoff y contratos Codex 0.149.1; falta únicamente login Codex externo real |
| 6. Proyectos y threads completos | Completado localmente | `9efb45a`, `6439f0d`, `a67ecf5`: crear/listar/leer/continuar/renombrar/buscar/fijar/archivar/restaurar, paginación estable y runtime thread ligado a instalación+usuario |
| 7. Streaming, steering, stop, approvals, replay | Completado localmente | `cf76855`, `26fa801`, `a67ecf5`, `46569e6`, `4487ef2`, `2b8de16`, `392d837`, `d40862a`: persistencia antes de ACK, approvals no bloqueantes, routing aislado, retry/replay/reconnect, crash real del worker y recovery sin segundo `turn/start`, steering y stop idempotentes |
| 8. Uploads, Office/PDF, previews y publicación | Completado localmente | `d51f171`, `afcec39`, `e090832`, `416d368`, `907feab`, `ca630f3`: multipart streaming a fichero privado, inspección OOXML por payload/CRC/ratio real, staging no-overwrite recuperable, previews reales y publicación confirmada exactamente una vez |
| 9. Browser/Computer Use aislado | Completado localmente | `4bed095`, `77935a5`, `29dd7c5`, `a69f049`, `7e6ff36`, `ae319e9`, `b23c1d5`, `4aff307`: runtime/perfil por empleado, viewer autenticado ligado a thread, targets y descargas por thread, takeover/recovery, tool namespace cerrado con approval durable, CDP por pipe y egress por proxy DNS-pinned; dos pruebas Chrome real verdes |
| 10. Contratos reales para UI | Completado localmente | `0728b17`, `9dffcc4`, `f90e4fa`, `915f875`: contrato UI versionado para auth, branding, workbench, streaming, approvals, memoria, documentos, publicación, browser tools, takeover, recovery, readiness y errores |
| 11. Compose y operación | Completado localmente | `73f3329`, `c67ec92`, `4bbf53a`, `caec559`, `cf6f39d`, `28674bc`, `93947b6`: Compose aislado, mounts/bwrap fail-closed, readiness, logs estructurados, Nginx streaming/rate limits, backup sin credenciales, releases/rollback y soak; build/restore/reboot/rollback dentro de Docker quedan como validación externa QA |
| 12. Hardening y suite completa | Completado localmente | `b8dff0a`, `1ced607`, `47ea3c0`, `9f5092b`, `0cde0da`, `b58bc9f`, `4ef6d96`: raíces sin solape, rate limit Auth file-backed/fail-closed, contratos contra Codex fijado, E2E HTTP con restart real, LibreOffice concurrente aislado, suite completa, auditoría 0 vulnerabilidades y soak verde; matrices Docker/QA externas pendientes |

## Decisiones menores registradas

- `installationId` será un slug configurable y nunca un literal de cliente en tipos.
- El modo local de desarrollo utilizará una instalación fixture explícita; producción fallará cerrada si no existe configuración.
- Los fixtures de empresa vivirán bajo `config/installations/` y quedarán marcados como desarrollo/QA; los datos reales no entrarán en Git.
- Los límites de archivos y backpressure serán controles de seguridad/capacidad, no cuotas comerciales.
- `InstallationConfig` v1 separa identidad, branding, origen público y seis raíces filesystem; producción exige una ruta absoluta montada read-only y falla cerrada si falta.
- Los fixtures `example-lab-dev` y `northwind-qa` son sintéticos y prueban que la misma base arranca con empresa, dominio, marca, assets y rutas distintos.
- Los eventos del transporte se aceptan únicamente tras persistencia JSONL y se reanudan con cursor durable; no existe journal in-memory implícito en la composición WebSocket.
- Los payloads RPC se validan en runtime con los JSON Schemas generados por Codex 0.149.1, además del tipado estático.
- Las credenciales efímeras usadas durante el cambio inicial se cifran en disco con AES-256-GCM; la cookie de sesión contiene 256 bits aleatorios y el store conserva solo su SHA-256.
- `PERMISSIONS.md` v1 se resuelve antes de persistir cada turn, se inyecta en el App Server privado y registra fingerprint/versiones en un journal durable por usuario.
- El worker se ejecuta bajo `bubblewrap`: oculta todo `dataRoot`, reexpone únicamente sus raíces declaradas y sustituye `publishWriteRoot` por un mount vacío read-only. El preflight del contenedor falla si esa frontera no existe.
- El UUID de Supabase Auth es exactamente el UUID filesystem del empleado; no existe membership, rol, proyecto o sesión de producto remota.
- El publicador conserva el original como versión verificable, congela candidato+preview y exige una confirmación HMAC idempotente; el worker nunca recibe la raíz `publish-rw`.
- El chat y el status reales ya no usan el pool `stdio` por tenant/workspace: ambos arrancan o reutilizan el worker privado del UUID autenticado y hablan exclusivamente por el transporte WebSocket loopback.
- Los tokens de continuidad de thread son V2 y están firmados contra instalación, usuario y runtime thread; un empleado no puede reanudar el token de otro.
- Los proyectos viven bajo `users/<uuid>/workspace/projects/<projectId>`; la ruta legacy configurable no se entrega al worker ni al sandbox del turn.
- Los locks filesystem mantienen la exclusión entre procesos y añaden una cola FIFO abortable dentro del proceso para evitar thundering herd sin ampliar timeouts.
- Cada delta, snapshot, actividad, approval y terminal de un turn se proyecta atómicamente antes de confirmar su secuencia de transporte; el workbench recompone mensajes aún activos tras refresh o restart.
- Las peticiones de App Server usan IDs estables por operación y mensaje UI. Un retry inspecciona el historial del thread mediante `clientUserMessageId` y no emite un segundo `turn/start` cuando Codex ya conoce el turn.
- Una approval pendiente mantiene su contexto completo pero no bloquea eventos de otros threads; los ACK de transporte siguen avanzando únicamente en orden contiguo.
- Steering y stop reciben únicamente IDs locales de UI: el servidor obtiene los IDs App Server desde la proyección vinculada al usuario, exige `expectedTurnId`, persiste la aceptación antes del ACK y cancela los waiters locales después de una interrupción confirmada.
- Los uploads aceptan un único `File + uploadId`, no aceptan raíces ni paths del navegador, revalidan propiedad del thread y generan previews bajo estado privado. El publicador deriva candidato/preview/target desde estado server-side y exige `documents.publish=allow` para freeze/confirm; decline sigue disponible para cerrar una operación pendiente.
- La matriz pesada de LibreOffice/Poppler se ejecuta con `npm run test:documents:real`; la suite general serializa los ficheros de test para conservar sin ampliar los umbrales de 5 s de locks/gateway en hosts QA pequeños. La concurrencia funcional se mantiene dentro de los suites focalizados.
- La memoria V1 solo acepta escrituras y revocaciones explícitas, conserva provenance, journal e índice privados por usuario e inyecta un snapshot acotado como datos no confiables; cada turn audita IDs y fingerprint sin copiar contenido.
- Los reintentos HTTP de memoria conservan idempotencia aunque cambie el timestamp server-side de recepción; contenido, tipo y provenance semántica siguen protegidos contra conflicto.
- Auth limita login, solicitud/consumo de recovery y cambio inicial con buckets HMAC file-backed por cliente+sujeto. Los identificadores crudos no se persisten, la corrupción falla cerrada y la solicitud de reset mantiene siempre un `202` indistinguible.
- Chrome no abre CDP en loopback: usa `--remote-debugging-pipe` sobre fds heredados 3/4, con framing NUL, UTF-8 estricto, allowlist y routing por `sessionId`. Cada thread tiene target y descarga propios dentro del perfil exclusivo del empleado.
- El upload HTTP nunca materializa `FormData`/`File` completo: aplica límites al stream, valida OOXML local+central, expansión/CRC reales y publica en staging con hardlink exclusivo, `fsync` y recovery de orphan inequívoco.
- Los browser tools expuestos a Codex forman un namespace cerrado (`open`, `read`, `screenshot`, `scroll`, `click`, `type`, `tabs`, `downloads`); las mutaciones requieren approval durable y los reintentos se deduplican por `toolCallId` y binding usuario/thread/turn/item.
- El takeover humano suspende todos los browser tools del agente hasta recovery explícito. El visor humano autenticado sigue siendo un canal distinto y nunca expone CDP.
- Chrome solo sale por un proxy loopback privado que resuelve una vez, valida IP pública y conecta al destino fijado; QUIC y WebRTC UDP no proxificado están deshabilitados para evitar bypass. El modo de red privada solo existe en test/no producción.
- Los threads ya existentes no pueden recibir definiciones `dynamicTools` con Codex 0.149.1; el contrato obliga a crear un thread runtime nuevo al habilitar la capacidad, sin simular tools en producción.
- El E2E HTTP ejecuta una copia efímera de la aplicación para que `next dev` no modifique `next-env.d.ts` ni `tsconfig.json` del checkout compartido.
- Cada proceso LibreOffice de test y de producto usa un perfil privado distinto; se evita la colisión observada al ejecutar conversiones en paralelo.

## Riesgos y acciones externas pendientes

- Falta Docker local: schemas, scripts y fronteras Compose están validados estáticamente; el build real de imágenes debe ejecutarse donde Docker esté disponible.
- No se tocarán DNS, Supabase hosted, NAS real, BGreenly, suscripciones Codex ni producción sin aprobación separada.
- La primera autenticación Codex real y la comprobación de Data Controls requieren login humano y suscripción dedicada.
- Nginx, bubblewrap, Chromium sandbox, Docker build/Compose, SBOM/scan y restore/reboot/rollback del contenedor no pueden validarse realmente en este Mac sin Docker/Nginx y deben repetirse en el QA aislado.

## Siguiente acción concreta

Ejecutar el runbook QA Docker en la red y volúmenes exclusivos de AiBrain del Hetzner, sin conectar ni reiniciar BGreenly; después completar login Codex dedicado y Supabase Auth QA con intervención humana.

## Últimas validaciones

- `npx vitest run tests/unit/installation-config.test.ts`: 8/8 verdes.
- `npm run lint`: verde, sin warnings.
- `npm run typecheck`: verde.
- `AIBRAIN_INSTALLATION_CONFIG=.../qa.example.json npm run build`: verde.
- `env -u AIBRAIN_INSTALLATION_CONFIG npm run build`: verde; la imagen puede compilarse sin secretos/configuración runtime.
- Smoke HTTP de `/login` con el fixture QA: devolvió `Northwind Brain`, `Northwind Advisory QA`, su dominio y favicon específicos.
- `npx vitest run src/storage src/runtime/transport`: 49/49 verdes durante integración; suite completa posterior: 65/65 verdes en 12 ficheros.
- Almacenamiento: se corrigió una carrera real con mtimes submilisegundo y se añadió regresión; 36/36 pruebas específicas verdes antes de ampliar la suite.
- Transporte: 13/13 pruebas de WebSocket/journal file-backed verdes, incluyendo auth, contrato, backpressure, reconnect, heartbeat, replay, ACK, dedupe, gaps e idempotencia.
- `npm run test:contract`: 2 ficheros y 5/5 pruebas verdes contra la versión fijada.
- `npm run lint`, `npm run typecheck` y `npm run build`: verdes tras los commits `38eeaaf` y `fc29316`.
- Documentos: 13 pruebas, incluida conversión real DOCX→PDF/PNG con LibreOffice y Poppler; QPDF no está instalado todavía en este Mac.
- Permisos: 27/27 tests específicos verdes; fingerprint estable y auditoría obligatoria sin contenido sensible.
- Workers: 7/7 tests verdes en cinco ejecuciones consecutivas; veinte usuarios, aislamiento, backpressure, restart y rechazo de symlinks.
- Auth: 10/10 tests focalizados verdes; tokens de challenge ausentes del fichero en claro y sesión local operativa con proveedor offline.
- Provisionamiento: 20 empleados sintéticos con perfiles, policies y roots completos; repetición idempotente verde.
- Backup/restore: tres pruebas reales de snapshot inmutable, verificación por hash, restore separado y rechazo de corrupción/symlink/hardlink.
- Workbench filesystem: seis pruebas de aislamiento, restart, concurrencia y lifecycle de proyecto/thread.
- Permisos por turn: 31 pruebas focalizadas con auditoría durable, binding de identidad y fallo cerrado.
- Supabase Auth-only: contract test impide SDK fuera del identity provider, llamadas Data API, adapters de producto, migraciones y servicios opcionales; 5/5 contract tests verdes.
- Publicación: 10/10 pruebas focalizadas y 21/21 documentales para freeze, preview, decline, exactly-once, conflicto, versión, recovery, symlinks y frontera de mounts.
- Lifecycle workbench: 14 pruebas focalizadas para lectura, búsqueda, paginación, rename, pin, archive/restore y aislamiento cross-user.
- Approvals: 8 pruebas focalizadas para persistencia, expiración, conflicto, cancelación, restart e identidad completa por item.
- Browser: 27+ pruebas focalizadas y 2 reales opt-in para tokens/thread ownership, targets y descargas por thread, aislamiento de perfiles/cookies entre dos usuarios, takeover/recovery, framing/EOF del pipe, backpressure y egress fijado; Chrome for Testing 152.0.7977.64 pasó sin listener TCP ni `DevToolsActivePort`.
- Gateway/router: 20 pruebas de transporte, gateway y routing, incluido replay durable, ACK posterior al handler, requests inciertos, dedupe y concurrencia por thread.
- Camino real worker: tests de token user-bound, inicialización única y turn con `clientUserMessageId`; el pool legacy queda sin referencias desde `/api/chat` y `/api/runtime/status`.
- Persistencia/recovery: tests de proyección exact-once, múltiples mutaciones sobre una misma secuencia, overlay tras restart y recuperación de un turn completado sin repetir `turn/start`.
- Concurrencia del router: una approval pendiente no bloquea otro thread y los ACK permanecen globalmente ordenados; un response RPC no se confirma antes de su hook de persistencia.
- Control de turn: ruta real con sesión/Origin, contrato estricto, rechazo de runtime IDs elegidos por cliente, aislamiento cross-user, steering con precondición de turn, stop durable y replay idempotente.
- Documentos HTTP: tests de sesión, ownership cross-user, multipart, MIME falso, preview privado, permiso publish, decline sin escritura, confirmación exactly-once y versión recuperable.
- Matriz documental real: `npm run test:documents:real`, 2/2 pruebas; conversiones y previews reales DOCX, XLSX, PPTX y PDF con LibreOffice/Poppler, más texto e imagen. QPDF sigue pendiente de instalación local, pero es obligatorio por configuración en producción.
- Upload streaming/OOXML/staging: 26/26 pruebas focalizadas, incluido multipart abortado/sin `Content-Length`, ZIP local inconsistente, bomb con metadata falsa, CRC y retry tras crash sin overwrite.
- Memoria explícita: 12/12 pruebas HTTP+service para auth, aislamiento, create/replay/list/revoke, provenance y conflicto idempotente.
- Auth rate limiting: 14/14 pruebas focalizadas para límites exactos, concurrencia multiproceso, HMAC sin identificadores crudos, corrupción/symlink fail-closed y reset indistinguible.
- Browser real: Chrome for Testing 152.0.7977.64, 2/2 pruebas; aislamiento de perfiles/cookies/tabs/downloads, pipe privado sin listener TCP y navegación HTTPS real únicamente por egress proxy DNS-pinned.
- E2E HTTP real: 3/3 pruebas sobre Next dev aislado; branding, rechazo cross-origin, login/cookie, proyecto/thread, archive/pin, restart real, recuperación filesystem y logout/revocación.
- Soak de 60,206 s: 4 workers, 612 requests, 612 eventos streaming, 28 replays, 28 restarts, 10,17 req/s, media 333,70 ms, p95 369,46 ms y máximo 817,40 ms; 0 fugas de handles, sockets, listeners o procesos; 1.398,98 bytes de journal/evento y 3 journals/worker.
- Suite global final: typecheck y lint verdes; unit 274 pasados + 2 opt-in omitidos en 53 ficheros; integración 19 pasados + 1 matriz pesada omitida en 10 ficheros; contract 5/5; documentos reales 2/2; E2E 3/3; build Next 16.3.2 verde con 44 rutas listadas.
- `npm test` agregado final: 64 ficheros pasados + 1 opt-in omitido; 298 pruebas pasadas + 3 opt-in omitidas, sin fallos.
- La integración y la matriz documental real se ejecutaron simultáneamente tras aislar los perfiles LibreOffice: ambas verdes. No se ampliaron timeouts para ocultar la carrera.
- `npm audit --omit=dev --audit-level=critical` y `npm audit --audit-level=critical`: 0 vulnerabilidades.
- `npm run infra:validate`: fronteras Docker/Compose, CDP pipe privado, imágenes fijadas y snapshot Debian verdes; `docker compose config` no ejecutado porque no existe Docker CLI en este host.

## Matriz requisito → implementación → prueba

| Requisito | Implementación | Prueba/evidencia |
|---|---|---|
| Dos instalaciones white-label | `InstallationConfig` v1, manifest y assets configurables | Tests de dos fixtures, dos builds y smoke HTTP con branding distinto |
| Sin hardcodes de Arnay/dominio/paths | Config obligatoria en producción y ejemplos sintéticos | Contract tests y búsqueda estática de fronteras/configuración |
| Veinte empleados sin cambiar código | Provisionador idempotente y raíces privadas por UUID | Test de 20 usuarios y segunda ejecución sin cambios |
| Sesión/worker/workspace/staging/browser independientes | `WorkerRuntimeRegistry` y layout por usuario | Tests de workers, browser, cookies, archivos y symlinks cross-user |
| WebSocket privado resiliente | Gateway loopback autenticado, journal, ACK/replay/dedupe/backoff | 20 pruebas gateway/router, crash/restart y soak con 28 replays |
| Concurrencia sin mezcla | Routing por instalación+usuario+thread+turn+item | Tests concurrentes, approval pendiente y stop aislado |
| Supabase solo Auth | Identity provider único; estado de producto filesystem | Contract test 5/5 y continuidad workbench con provider offline |
| Persistencia tras refresh/restart | Stores versionados, atomic/fsync, locks, journal e índices | E2E HTTP con proceso Next reiniciado y tests de recovery |
| `PERMISSIONS.md` server-side | Provider Markdown read-only y fingerprint por turn | 31 tests focalizados y auditoría durable |
| Office/PDF/texto/imagen | Staging validado, LibreOffice/Poppler/QPDF configurable | Matriz real 2/2 y suites de OOXML/bomb/MIME/macros |
| Codex sin `publish-rw` | Sandbox bwrap con mount vacío RO para worker | Validator infra y pruebas de frontera/symlink |
| Publicación confirmada | Freeze+hash+preview+HMAC+conflicto+versión+atomic write | 10/10 focalizadas y 21/21 documentales |
| Browser/Computer Use aislado | CDP pipe, perfil/targets/downloads/viewer por usuario/thread | Chrome real 2/2 y 27+ pruebas focalizadas |
| Browser egress sin rebinding | Proxy loopback con resolución y conexión IP fijadas | Unit/integration e HTTPS real a `example.com` |
| Contratos UI reales | Schemas HTTP/eventos/tools/errores en `UI_BACKEND_CONTRACT.md` | Contract tests y validación Codex 0.149.1 |
| Auth defensivo | Cookie opaca, Origin/CSRF, expiración, revocación y rate limit | 24 pruebas Auth/rate limit y E2E de logout |
| Backup/restore/recovery | Snapshots con manifest/hash y restore separado | 3 pruebas reales locales; contenedor QA pendiente |
| Operación/release/rollback | Compose, Nginx, health, logs, alertas y scripts versionados | Validator estático verde; ejecución Docker QA pendiente |
| Hardening/dependencias | Paths seguros, límites, fail-closed y versiones fijadas | Lint/typecheck/build, auditorías 0 vulnerabilidades |
| Soak y latencia | Harness de workers/WS/replay/restart y métricas de recursos | 60,206 s verde, p95 369,46 ms, 0 fugas |

## Comandos reproducibles

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:contract
npm run test:e2e
npm run test:documents:real
AIBRAIN_REAL_CHROME_TEST=1 AIBRAIN_CHROME_EXECUTABLE=/ruta/chrome-headless-shell AIBRAIN_CHROME_EXPECTED_VERSION=152.0.7977.64 npm run test:browser:real
npm run test:soak
npm run build
npm audit --omit=dev --audit-level=critical
npm audit --audit-level=critical
npm run infra:validate
```

## Handoff externo exacto

1. En el Hetzner QA, comprobar nombres de red, puertos y volúmenes exclusivos de AiBrain antes de ejecutar nada; abortar si aparece una referencia a BGreenly.
2. Con Docker disponible: validar `docker compose config`, construir desde cero, levantar únicamente el proyecto Compose de AiBrain y esperar readiness verde.
3. Ejecutar `npm run test:soak:qa`, la matriz documental con QPDF obligatorio, dos instalaciones y 20 usuarios dentro del contenedor.
4. Crear backup QA, verificarlo, restaurarlo en una raíz QA vacía, reiniciar host/servicios AiBrain y confirmar replay/recovery sin duplicados.
5. Ensayar release anterior/nueva y rollback sin borrar releases ni backups; generar SBOM y escaneo de imagen, resolviendo cualquier hallazgo crítico.
6. Con una suscripción Codex dedicada al primer empleado, completar login humano, verificar Data Controls y ejecutar un turn real con tool browser y approval.
7. Configurar un proyecto Supabase QA solo-Auth, probar login/cambio inicial/recovery y después bloquear su acceso temporalmente para confirmar continuidad del workbench.
8. DNS, NAS real, cutover, datos Arnay, compras, producción y merge a `main` siguen requiriendo aprobación separada.

## Integración con `codex/aibrain-ui-parity`

- Fuente de verdad de la UI: `docs/UI_BACKEND_CONTRACT.md` y schemas versionados del repo; no inferir payloads desde componentes antiguos.
- Consumir `InstallationConfig`/manifest para marca exacta, incluida `accentColor`; no mantener nombres, dominios ni rutas de empresa en componentes.
- Mantener cursores/IDs de instalación+usuario+thread+turn+item, deduplicar eventos y representar estados `pending`, `degraded`, `reconnecting`, `conflict` y recuperables según contrato.
- Abrir un runtime thread nuevo cuando se habiliten browser dynamic tools; approvals y takeover se resuelven por las rutas documentadas y nunca desde estado global de cliente.
- La rama backend no ha hecho merge/rebase/reset ni reescritura masiva de `codex/aibrain-ui-parity`; la integración debe hacerse mediante commit/PR normal después de sus propias pruebas visuales.
