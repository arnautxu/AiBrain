# AiBrain backend definitivo — progreso reproducible

Última actualización: 2026-08-27 (Europe/Madrid)

## Estado de la rama

- Rama: `codex/aibrain-backend-definitivo`
- Commit base: `21bb8b4a2bd9b74cba6a1b771d46b0033893ea01`
- Remoto: `origin` (`arnautxu/AiBrain`)
- Último checkpoint backend publicado: `bded0b6` en
  `origin/codex/aibrain-backend-definitivo`.
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
| 2. Supabase Auth-only + sesión local | Completado localmente | `1c0386b`, `323243b`, `283caf8`: login/cambio inicial/recuperación, cookie opaca, expiración, revocación, CSRF/Origin y E2E HTTP de continuidad offline tras corte total y restart; eliminados adapters, migraciones y dependencia SSR de producto. Solo queda validación externa Supabase QA |
| 3. Stores file-backed resilientes | Completado localmente | `38eeaaf`, `9efb45a`, `facda49`, `cf76855`, `ac0b62e`, `368aec0`, `4487ef2`, `016f708`: schemas estrictos, atomic write/fsync, journals, índices y locks con recovery verificado entre procesos reales; owner local vivo no se roba aunque el timestamp parezca stale |
| 4. Provisionamiento idempotente + 20 usuarios | Completado localmente | `75316e1`, `545948a`, `323243b`, `d74a800`: alta real de 20 empleados, baja/reactivación/recuperación idempotentes, revocación de sesiones, parada selectiva de worker/browser, receipts y auditoría sin datos sensibles |
| 5. Worker registry + WebSocket + contratos | Completado localmente | `fc29316`, `75316e1`, `26fa801`, `a67ecf5`: worker caliente por usuario, gateway loopback autenticado, registry, router scoped, replay/ACK/dedupe/backoff y contratos Codex 0.149.1; falta únicamente login Codex externo real |
| 6. Proyectos y threads completos | Completado localmente | `9efb45a`, `6439f0d`, `a67ecf5`: crear/listar/leer/continuar/renombrar/buscar/fijar/archivar/restaurar, paginación estable y runtime thread ligado a instalación+usuario |
| 7. Streaming, steering, stop, approvals, replay | Completado localmente | `cf76855`, `26fa801`, `a67ecf5`, `46569e6`, `4487ef2`, `2b8de16`, `392d837`, `d40862a`, `2d7b063`, `78972d3`: aceptación conjunta 2 usuarios × 2 threads sobre gateways WebSocket loopback reales, con approval pendiente, stop aislado, crash, replay, dedupe, restart y continuidad del otro worker |
| 8. Uploads, Office/PDF, previews y publicación | Completado localmente; ejecución dentro de Docker QA pendiente | `d51f171`, `afcec39`, `e090832`, `416d368`, `907feab`, `ca630f3`, `be93949`, `9d0500c`, `bfbe610`, `3091b0f`, `dd8da5b`, `d16b3a1`, `14f63af`, `eff6edc`, `42c7539`: staging server-only, backup documental, conversores aislados, capacidad multiproceso, previews V2 atestados/cancelables, publicación `expired`, retención terminal de candidato, gates separados de data/publish y recovery de temporales tras `SIGKILL` |
| 9. Browser/Computer Use aislado | Completado localmente | `4bed095`, `77935a5`, `29dd7c5`, `a69f049`, `7e6ff36`, `ae319e9`, `b23c1d5`, `4aff307`, `0f196a1`, `35920e3`, `79aaeb9`, `4021124`, `e546a23`, `ecbb10b`, `6827f51`, `cc2f7a4`: runtime/perfil por empleado, sandbox filesystem por usuario, viewer autenticado ligado a thread, targets propios con cierre de popups/workers no autorizados, takeover/recovery, navegación privada recuperable, descargas proyectadas y acotadas, historial idempotente con backpressure, tool namespace cerrado con approval durable, CDP por pipe y egress autenticado/DNS-pinned a través del sidecar físico; dos pruebas Chrome for Testing reales verdes |
| 10. Contratos reales para UI | Completado localmente | `0728b17`, `9dffcc4`, `f90e4fa`, `915f875`, `27984f2`, `40c94b8`, `7655fb0`: Auth/contrato role-free, superficies rechazadas retiradas, schemas Codex 0.149.1 regenerados byte a byte y contrato HTTP V1 ejecutable con inventario exacto de 39 operaciones, JSON Schemas, ejemplos, tipos y respuestas Next E2E |
| 11. Compose y operación | Reabierto por auditoría estricta; evidencia Docker QA pendiente | `73f3329`, `c67ec92`, `4bbf53a`, `caec559`, `cf6f39d`, `28674bc`, `93947b6`, `c645483`, `76b5cbf`, `853089b`, `3cf7e1e`, `b566152`, `95958c8`, `721ca68`, `4021124`, `bfbe610`, `5cae93c`, `f35edc3`, `b77dc7f`: backup compuesto, réplica Restic, alertas y recovery transaccional de release cerrados localmente; falta evidencia Docker/host QA real |
| 12. Hardening y suite completa | Reabierto por auditoría estricta | `b8dff0a`, `1ced607`, `47ea3c0`, `9f5092b`, `0cde0da`, `b58bc9f`, `4ef6d96`, `8d4edde`, `e58ef6c`, `4b2ed61`, `e539ffd`, `67a8394`, `4021124`, `e546a23`, `ecbb10b`, `6827f51`, `cc2f7a4`, `c95f820`, `bded0b6`, `42c7539`: CI protegida y reproducible, denegación física de tools, artefactos no cacheables y capacidad independiente de publicación cerrados; aún quedan gaps operativos locales del checkpoint 11 |

### Reapertura de auditoría de cierre (2026-08-27)

El commit `dbb7137` documentó un handoff, no una condición de acabado. La auditoría adversarial posterior demostró trabajo local seguro restante: CLI de alta roto, lifecycle de empleados ausente, superficies funcionales rechazadas aún publicadas, locks/aceptaciones multiproceso insuficientes, staging de adjuntos visible entre turns del mismo empleado, lock documental no global entre usuarios, backup sin documental ni réplica cifrada, alertas sin delivery, contratos UI manuales y gaps de release/Compose. Lifecycle quedó corregido en `d74a800`, las superficies rechazadas en `27984f2`, ambas fronteras documentales P0 en `9d0500c`, la exclusión/recovery multiproceso de locks en `016f708`, la aceptación conjunta multiusuario en `78972d3`, la continuidad HTTP sin Supabase en `283caf8`, el guard/regeneración de contratos fijados en `40c94b8`, el contrato HTTP ejecutable en `7655fb0`, el backup documental compuesto en `bfbe610`, la réplica cifrada off-host en `5cae93c`, el delivery durable de alertas en `f35edc3`, el release recovery en `b77dc7f`, el sandbox de conversión en `3091b0f`, su gate multiproceso en `dd8da5b`, la integridad/expiración documental en `d16b3a1` y la admisión/recovery de almacenamiento en `14f63af`. El pipeline documental ya no conserva gaps locales conocidos; su frontera ejecutable dentro de Docker permanece como gate QA externo.

## Decisiones menores registradas

- `installationId` será un slug configurable y nunca un literal de cliente en tipos.
- El modo local de desarrollo utilizará una instalación fixture explícita; producción fallará cerrada si no existe configuración.
- Los fixtures de empresa vivirán bajo `config/installations/` y quedarán marcados como desarrollo/QA; los datos reales no entrarán en Git.
- Los límites de archivos y backpressure serán controles de seguridad/capacidad, no cuotas comerciales.
- `InstallationConfig` v1 separa identidad, branding, origen público y seis raíces filesystem; producción exige una ruta absoluta montada read-only y falla cerrada si falta.
- Los fixtures `example-lab-dev` y `northwind-qa` son sintéticos y prueban que la misma base arranca con empresa, dominio, marca, assets y rutas distintos.
- Los eventos del transporte se aceptan únicamente tras persistencia JSONL y se reanudan con cursor durable; no existe journal in-memory implícito en la composición WebSocket.
- Los payloads RPC se validan en runtime con los JSON Schemas generados por Codex 0.149.1, además del tipado estático.
- El contrato UI V1 tiene dos artefactos versionados: un inventario de método+ruta que debe coincidir exactamente con los exports reales de Next y un bundle JSON Schema compilado. Sus ejemplos, fixtures TypeScript y respuestas HTTP reales de sesión/workbench/runtime se validan en CI local; añadir o retirar una ruta rompe `test:contract` hasta actualizar el contrato deliberadamente.
- Las credenciales efímeras usadas durante el cambio inicial se cifran en disco con AES-256-GCM; la cookie de sesión contiene 256 bits aleatorios y el store conserva solo su SHA-256.
- `PERMISSIONS.md` v1 se resuelve antes de persistir cada turn, se inyecta en el App Server privado y registra fingerprint/versiones en un journal durable por usuario.
- El worker se ejecuta bajo `bubblewrap`: oculta todo `dataRoot`, reexpone únicamente sus raíces declaradas y sustituye `publishWriteRoot` por un mount vacío read-only. El preflight del contenedor falla si esa frontera no existe.
- El UUID de Supabase Auth es exactamente el UUID filesystem del empleado; no existe membership, rol, proyecto o sesión de producto remota.
- El guard Auth-only rechaza imports SDK fuera del identity adapter, `.from/.rpc`, servicios `rest/graphql/storage/realtime`, clientes de producto y dependencias PostgREST/GraphQL directas.
- Después del intercambio inicial con Supabase, sesión, workbench y logout no construyen un cliente remoto. El E2E corta el servidor de identidad, crea proyecto/thread, reinicia Next y conserva la cookie local; un nuevo login durante el corte devuelve `503`, no un falso `401`.
- El publicador conserva el original como versión verificable, congela candidato+preview y exige una confirmación HMAC idempotente; el worker nunca recibe la raíz `publish-rw`.
- Backup V2 captura `product-data` y `published-documents` bajo fingerprints por componente y global. Comparte una barrera física con el publicador para no cruzar una confirmación; restore preflight comprueba roots/espacio, prepara ambos árboles y revierte la primera promoción si falla la segunda.
- La réplica off-host es un proceso Restic one-shot separado: recibe snapshots read-only, password read-only y estado de receipts independiente; reusa tags exactos tras crash, verifica readback+repository, no ejecuta shell y solo reenvía variables de proveedor allowlisted. No inicializa, poda ni borra el remoto.
- Las alertas operativas separan evaluación, outbox y sink. El estado file-backed genera transiciones `raised/updated/resolved`, deduplica por código+severidad+umbral, conserva generations y receipts, aplica backoff y falla por backpressure antes de una reconciliación parcial. El colector no monta `docker.sock`: readiness, disco y backup se leen dentro del contenedor y los contadores de supervisor son argumentos host obligatorios.
- Una release une app+gateway y usa journal durable por fases. Antes de mutar, verifica estado, env, imágenes y contenedores actuales; después valida health, digest y revisión realmente ejecutados. `flock`/`lockf` serializa operadores, el lock local vincula PID+inicio+boot, los Docker subprocesses están acotados y recovery recibe un deadline independiente.
- El chat y el status reales ya no usan el pool `stdio` por tenant/workspace: ambos arrancan o reutilizan el worker privado del UUID autenticado y hablan exclusivamente por el transporte WebSocket loopback.
- Los tokens de continuidad de thread son V2 y están firmados contra instalación, usuario y runtime thread; un empleado no puede reanudar el token de otro.
- Los proyectos viven bajo `users/<uuid>/workspace/projects/<projectId>`; la ruta legacy configurable no se entrega al worker ni al sandbox del turn.
- Los locks filesystem mantienen la exclusión entre procesos y añaden una cola FIFO abortable dentro del proceso para evitar thundering herd sin ampliar timeouts.
- La recuperación stale de locks falla cerrada ante un PID local vivo, valida hash del recurso e inode/mtime/ctime antes de cuarentena y vuelve a verificar el inode/mtime después del rename. La aceptación usa dos procesos Node reales y cubre serialización, heartbeat y recovery tras `SIGKILL`.
- Cada delta, snapshot, actividad, approval y terminal de un turn se proyecta atómicamente antes de confirmar su secuencia de transporte; el workbench recompone mensajes aún activos tras refresh o restart.
- Las peticiones de App Server usan IDs estables por operación y mensaje UI. Un retry inspecciona el historial del thread mediante `clientUserMessageId` y no emite un segundo `turn/start` cuando Codex ya conoce el turn.
- Una approval pendiente mantiene su contexto completo pero no bloquea eventos de otros threads; los ACK de transporte siguen avanzando únicamente en orden contiguo.
- La aceptación integrada arranca dos procesos App Server sintéticos detrás de dos gateways WebSocket autenticados y cuatro turns simultáneos. Una approval de usuario 1 queda pendiente mientras usuario 1/thread 2 y ambos threads de usuario 2 avanzan; el stop de usuario 2/thread 1 no detiene el otro thread; el crash/replay del worker 1 no duplica su delta ni afecta al worker 2.
- Steering y stop reciben únicamente IDs locales de UI: el servidor obtiene los IDs App Server desde la proyección vinculada al usuario, exige `expectedTurnId`, persiste la aceptación antes del ACK y cancela los waiters locales después de una interrupción confirmada.
- Los uploads aceptan un único `File + uploadId`, no aceptan raíces ni paths del navegador, revalidan propiedad del thread y generan previews bajo estado privado. El publicador deriva candidato/preview/target desde estado server-side y exige `documents.publish=allow` para freeze/confirm; decline sigue disponible para cerrar una operación pendiente.
- Los uploads staged no se montan en el worker ni se añaden a `runtimeWorkspaceRoots`: el servidor prepara texto UTF-8 o texto/primera página desde el PDF atestado y entrega data URLs acotadas. Codex solo conserva `staging/tmp` para temporales privados y nunca recibe un path de upload.
- El lock de publicación por target vive en una raíz física común de la instalación. Dos empleados con stores privados que confirman sobre el mismo original quedan serializados; uno publica y el otro recibe conflicto.
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
- En producción, LibreOffice, QPDF y los tres binarios Poppler solo se invocan
  por launchers `bubblewrap`: sin red/capabilities, con filesystem oculto salvo
  el work efímero. El entrypoint prueba los cinco launchers y no existe fallback
  Linux directo; la ejecución de esa frontera y la matriz real dentro de Docker
  siguen siendo evidencia QA externa.
- La capacidad de conversión es una frontera operacional por instalación, no
  una cuota de producto. Los slots se coordinan con locks filesystem y heartbeat
  entre usuarios/procesos, fallan rápido con `429 Retry-After` y recuperan un
  owner muerto; se amplía con `AIBRAIN_DOCUMENT_MAX_CONVERSIONS` al ampliar host.
- Preview V2 conserva tamaño y SHA-256 de cada artefacto y verifica esos bytes
  antes de reutilizar `ready`; un fichero regular alterado/ausente se reconstruye
  desde staging atestado y un symlink falla cerrado. Los límites se comprueban
  antes del `readFile`, y abort HTTP termina el conversor, limpia work y slot.
- El TTL de publicación se reconcilia bajo lock a `expired` exactamente en su
  instante de vencimiento. El evento se repara tras restart, confirm no escribe
  y decline posterior es un acuse idempotente que conserva el estado terminal.
- El upload completo reserva un slot filesystem de instalación antes de leer el
  multipart. La admisión mide el volumen y conserva el mayor margen entre bytes
  y ratio libres más 512 MiB por cada upload simultáneo posible; saturación o
  disco bajo devuelven `429 Retry-After` sin persistir el body. No es una cuota
  comercial y se amplía por configuración/recursos.
- `.incoming` y `.work-*` mantienen locks con heartbeat. El mantenimiento es
  dry-run por defecto, exige `--apply`, espera seis horas, valida raíz, inode,
  tipo, permisos y hardlinks, y elimina mediante cuarentena atómica. Uploads,
  previews y registros de publicación duraderos se retienen; no se borran
  silenciosamente para recuperar capacidad.
- Chrome de escritorio autoactualizable no es una evidencia aceptable del runtime: la prueba real se ejecuta con Chrome for Testing exacto. En este host, Google Chrome 151 abrió el proceso pero no habilitó el pipe CDP; Chrome for Testing 152.0.7977.64 pasó la misma matriz en 1,29 s.
- El runtime descubre todos los targets CDP y cierra cualquier popup, service worker o página no creada por la operación de thread activa; los cierres se deduplican para evitar carreras durante ráfagas de eventos.
- En producción `app` solo pertenece a una red Docker `internal`; el sidecar
  `egress-gateway` es el único componente dual-homed. Browser, worker y server
  usan tokens distintos y políticas distintas; ninguna conexión autorizada
  vuelve a resolver DNS antes de abrir el socket.
- Aplicación y gateway son una única release: dos digests inmutables con la
  misma revisión, promoción atómica, health de ambos y recuperación conjunta.
- Los journals de eventos y requests se compactan bajo lock: conservan todo
  estado incierto/no entregado y únicamente una cola acotada de terminales ya
  confirmados.
- La navegación browser recuperable se guarda por instalación+usuario+thread
  en un store privado y acotado. Al reiniciar, cada URL vuelve a pasar por la
  política de red vigente antes de abrirse.
- Las descargas solo se promueven tras cierre atómico del fichero en cuarentena;
  su estado queda proyectado por sesión y una interrupción del runtime las
  marca fallidas sin atribuirlas a otro thread.
- El proxy loopback del browser exige una credencial Basic aleatoria por
  runtime. Chrome la recibe únicamente por `Fetch.authRequired` en el target
  privado; no aparece en argumentos, entorno, URL ni filesystem del worker.
- El historial de browser tools conserva la idempotencia y falla con
  backpressure antes de superar sus límites por usuario; una llamada existente
  puede reproducirse aunque ya no se admitan llamadas nuevas.
- Alta y lifecycle son operaciones distintas: el alta conserva identidad local
  inmutable; baja/reactivación/recuperación usan un `requestId` durable, revocan
  sesiones cuando corresponde y nunca introducen roles o paneles admin.
- Auth no contiene roles de producto. `PERMISSIONS.md` decide acciones
  server-side; onboarding, invitaciones, control plane y automatizaciones
  programadas no forman parte del build V1. Review sigue visible y el panel
  técnico Runtime queda oculto a empleados.

## Riesgos y acciones externas pendientes

- Falta Docker local: schemas, scripts y fronteras Compose están validados estáticamente; el build real de imágenes debe ejecutarse donde Docker esté disponible.
- No se tocarán DNS, Supabase hosted, NAS real, BGreenly, suscripciones Codex ni producción sin aprobación separada.
- La primera autenticación Codex real y la comprobación de Data Controls requieren login humano y suscripción dedicada.
- Nginx, bubblewrap, Chromium sandbox, Docker build/Compose, SBOM/scan y restore/reboot/rollback del contenedor no pueden validarse realmente en este Mac sin Docker/Nginx y deben repetirse en el QA aislado.
- Los hosts exactos que necesita Codex 0.149.1 y el origen Supabase deben
  observarse con las credenciales QA antes de cerrar sus allowlists de cada
  instalación; el gateway falla cerrado y no admite wildcards.
- Restic no está instalado en este Mac y no se usaron credenciales/proveedor
  reales. Adapter, proceso sintético y Compose estático están verdes; `init`,
  upload y restore drill off-host permanecen como gate externo exacto.
- El webhook HTTPS de alertas está implementado y probado sin persistir URL,
  token o body remoto. Su destino/token y allowlist exacta siguen siendo una
  acción externa por instalación; el sink local durable queda operativo sin
  fingir una entrega externa.
- El launcher `aibrain-document-maintenance` está incluido y validado
  estáticamente, pero su dry-run/apply debe ejecutarse también dentro de la
  imagen QA real junto con el preflight de los conversores.

## Siguiente acción concreta

Corregir los P0 operativos verificados: hacer que rollback restaure Compose y
configuración exactos, integrar un sink externo de alertas en una topología con
egress explícito y alertar por gateway/réplica ausentes. Después cerrar preflight
y orquestación transaccional de backup/restore antes de repetir la matriz total.

## Últimas validaciones

- Resiliencia documental `eff6edc`: 20/20 focalizadas, typecheck, lint e infra
  estática verdes; retención terminal de 30 días conserva operación, receipts,
  versiones y auditoría y corrige el lease de multipart ante boundary inválido.
- CI `bded0b6`: workflow sin secretos y acciones fijadas por SHA; contratos,
  typecheck, lint, suite, E2E, build, auditorías, matriz Office/PDF y builds
  Docker limpios. Validación local agregada: 100 ficheros pasados + 1 omitido,
  463 pruebas pasadas + 3 omitidas, E2E 4/4, build y 0 vulnerabilidades.
- Hardening `42c7539`: 43/43 pruebas focalizadas verdes antes del commit;
  `tools.execute=deny` cubre tres requests App Server sin pendiente ni grants,
  artefactos privados se reautorizan con `no-store` y capacidad data/publish se
  mide por separado antes de cambiar una publicación a `publishing`.

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
- Lifecycle de empleados: CLI real reparado; proceso hijo provisiona 20 usuarios
  dos veces (20 creados y después 20 sin cambios), rechaza input symlink, y 12
  pruebas focalizadas cubren baja, reactivación, recuperación, revocación,
  parada selectiva, Origin/bearer, replay y conflicto. Suite agregada posterior:
  82 ficheros pasados + 1 opt-in omitido, 376 pruebas pasadas + 3 opt-in omitidas.
- Superficies rechazadas: contract test 2/2, 14 integraciones focalizadas, E2E
  HTTP 3/3 y build Next 16.3.2 verdes. El build lista 38 rutas dinámicas y
  ninguna corresponde a onboarding, control plane, invitaciones o automations.
  Suite agregada posterior: 83 ficheros pasados + 1 opt-in omitido, 378 pruebas
  pasadas + 3 opt-in omitidas.
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
- Sandbox documental `3091b0f`: los cinco launchers pasan validación estática y
  9/9 pruebas focalizadas; suite completa 92 ficheros pasados + 1 opt-in omitido,
  430 pruebas pasadas + 3 opt-in omitidas; build Next 16.3.2 verde. El preflight
  ejecutable de los cinco launchers se correrá obligatoriamente al arrancar la
  imagen Docker QA; Docker no está disponible en este Mac.
- Gate documental `dd8da5b`: 13/13 pruebas focalizadas; dos procesos/usuarios
  ocupan los slots compartidos, el tercero recibe `429 Retry-After` y un
  `SIGKILL` libera por recovery solo el slot abandonado. El escenario de locks
  se repitió tres veces (12/12); suite completa 94 ficheros pasados + 1 opt-in
  omitido, 435 pruebas pasadas + 3 omitidas y build Next 16.3.2 verde.
- Lifecycle documental `d16b3a1`: previews V2 verifican/reconstruyen hash+tamaño,
  rechazan symlink, limitan sparse output antes de cargarlo y abortan el proceso
  nativo; publicación expira durablemente y sin tocar target. Selección conjunta
  41/41 verde; suite completa 94 ficheros pasados + 1 opt-in omitido, 441 pruebas
  pasadas + 3 omitidas y build Next 16.3.2 verde.
- Almacenamiento documental `14f63af`: 32/32 focalizadas verdes; dos procesos
  comparten slots de upload, overflow falla antes del multipart y un owner
  muerto se recupera. Un `SIGKILL` real durante multipart y otro durante preview
  dejan temporales que el recolector elimina tras heartbeat/gracia, sin unsafe ni
  locked. El escenario de caída se repitió tres veces (3/3).
- Gate global posterior a `14f63af`: 99 ficheros pasados + 1 opt-in omitido,
  457 pruebas pasadas + 3 opt-in omitidas; typecheck, lint, build Next 16.3.2,
  infra estática y matriz real LibreOffice/Poppler 2/2 verdes. Docker Compose no
  se ejecutó porque el CLI no está instalado en este Mac.
- Hardening de targets: suite completa de unidad 58 ficheros verdes + 1 opt-in omitido, 294 pruebas verdes + 2 opt-in omitidas; typecheck y lint verdes.
- Chrome for Testing 152.0.7977.64: 2/2 pruebas reales verdes en 1,29 s tras añadir discovery, ownership y cierre deduplicado de popup/service worker/página ajena. SHA-256 del ZIP mac-arm64 validado localmente: `ad6ea84171a067f0f1ce32d4063b726ea63b6c71ad6dfc480ddcd5af89acfdfb`.
- Soak final de 120,487 s: 4 workers, 808 requests, 36 restarts, p95
  612,61 ms, pendientes 0 y pendiente de heap/handles/sockets/listeners/procesos
  igual a 0; 266 registros y 97,23 KiB de journal por worker, sin crecimiento
  sostenido tras la ventana de calentamiento.
- Backup/restore adversarial: 8/8 pruebas, incluidos hardlink, symlink,
  mutación durante snapshot, candidato `.pending` interrumpido, corrupción y
  conservación forense de restore parcial.
- Gateway de salida físico: 6/6 integración; release manager dual 5/5;
  conectores browser/worker y redacción 32/32 focalizadas. Suite posterior:
  322 unitarias pasadas + 2 opt-in omitidas y 31 integraciones pasadas + 1
  matriz real omitida; typecheck, lint e invariantes estáticas verdes.
- Auditoría npm completa y solo producción: 0 vulnerabilidades en 594
  dependencias. Docker Compose no se ejecutó porque el CLI no existe en este
  host; esta ausencia se informa como `NOT RUN`, nunca como verde.
- Lifecycle browser final: navegación privada por thread recuperada tras
  restart, LRU de 512 threads y rechazo de hardlinks; 9/9 pruebas focalizadas.
- Descargas browser finales: eventos CDP reales, promoción atómica, continuidad
  tras rotación de sesión, fallo al perder runtime y retención terminal acotada;
  23/23 pruebas focalizadas.
- Proxy browser autenticado: desafío local cancelado para cualquier caller no
  autorizado y credencial entregada solo al proxy exacto por CDP; Chrome for
  Testing 152.0.7977.64 pasó 2/2 pruebas reales.
- Store de browser tools: capacity lock global por usuario, recuperación de
  temporales interrumpidos y backpressure sin perder replays; matriz browser
  focalizada 50/50.
- Matriz local final de 2026-08-27: typecheck y lint verdes; unit 330 pasadas +
  2 opt-in omitidas; integración 31 pasadas + 1 matriz real omitida; contract
  5/5; E2E 3/3; documentos reales 2/2; Chrome real 2/2; build Next 16.3.2 verde.
- Cobertura agregada: 79 ficheros verdes + 1 opt-in omitido, 366 pruebas
  pasadas + 3 omitidas; 74,22 % statements, 67,39 % branches, 80,66 %
  functions y 78,23 % lines.
- Auditorías npm final de producción y completa: 0 vulnerabilidades. Validator
  infra estático verde; `docker compose config` permanece correctamente como
  `NOT RUN` por ausencia del CLI Docker.
- Soak exacto del estado final: 120,893 s, 4 workers, 648 requests/eventos,
  28 replays y 28 restarts, p95 865,49 ms; 0 pendientes, 0 fugas de handles,
  recursos, sockets, listeners o procesos, pendientes de memoria 0 y 306
  registros/107,53 KiB/3 journals por worker.
- Contrato Auth-only endurecido: `persistence: "supabase"` ya no es aceptado
  por el tipo, validador ni contrato UI; la suite contract queda en 6/6.
- Ejecución agregada posterior a ese cambio: 79 ficheros pasados + 1 opt-in
  omitido, 367 pruebas pasadas + 3 opt-in omitidas; build de producción verde
  con las 44 rutas API/UI previstas.
- Push verificado: `a0e7045..c95f820` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.
- Cierre P0 documental `9d0500c`: typecheck, lint e infra validator verdes;
  suite completa 83 ficheros pasados + 1 opt-in omitido, 381 pruebas pasadas +
  3 omitidas; E2E 3/3; matriz real LibreOffice/Poppler 2/2, incluido DOCX a
  inputs de turn sin path; build Next 16.3.2 verde con 38 rutas dinámicas.
- Push verificado: `a229f86..9d0500c` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.
- Checkpoint stores `016f708`: typecheck y lint verdes; 10/10 pruebas
  focalizadas, incluida exclusión entre procesos reales y recovery tras
  `SIGKILL`; suite completa 84 ficheros pasados + 1 opt-in omitido, 385 pruebas
  pasadas + 3 omitidas; build Next 16.3.2 verde.
- Push verificado: `04801ee..016f708` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.
- Aceptación multiusuario `78972d3`: escenario integrado 1/1 verde en 3,24 s;
  typecheck y lint verdes; regresión conjunta crash/recovery 2/2; suite completa
  85 ficheros pasados + 1 opt-in omitido, 386 pruebas pasadas + 3 omitidas.
- Push verificado: `31eb34a..78972d3` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.
- Auth outage `283caf8`: clasificación de red 2/2; E2E HTTP Supabase-offline
  1/1 verde en 8,35 s; suite completa 86 ficheros pasados + 1 opt-in omitido,
  388 pruebas pasadas + 3 omitidas; E2E global 4/4 y build verde.
- Push verificado: `bc03471..283caf8` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.
- Contratos fijados `40c94b8`: contract tests 8/8, guard Auth-only ampliado y
  `npm run contracts:verify` regeneró tipos+JSON Schema con Codex 0.149.1 en
  temporal y confirmó igualdad byte a byte.
- Push verificado: `ed2ba70..40c94b8` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.
- Contrato UI ejecutable `7655fb0`: typecheck y lint verdes; `test:contract`
  13/13 con paridad exacta de 39 operaciones, schemas y ejemplos compilados;
  E2E 4/4 validando respuestas Next reales, incluido provider Auth caído y
  restart; suite completa 87 ficheros pasados + 1 opt-in omitido, 393 pruebas
  pasadas + 3 omitidas; Codex 0.149.1 regenerado byte a byte y build de
  producción verde con 38 rutas dinámicas.
- Push verificado: `ae03868..7655fb0` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.
- Backup compuesto `bfbe610`: manifest V2 con estado privado y documental,
  fingerprints por componente, barrera contra publicación concurrente,
  rechazo symlink/hardlink en ambos árboles, preflight de espacio y restore
  transaccional a dos raíces. Focalizadas 23/23; suite completa 87 ficheros
  pasados + 1 opt-in omitido, 395 pruebas pasadas + 3 omitidas; typecheck,
  lint, validator infra y build de producción verdes.
- Push verificado: `7655fb0..bfbe610` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.
- Réplica cifrada `5cae93c`: adapter Restic idempotente, entorno allowlisted,
  password privado, ejecución sin shell/timeout, tags+readback+check y receipt
  sin URL/secretos; servicio Compose one-shot con snapshots read-only y red
  egress-only. Focalizadas 20/20; suite completa 88 ficheros pasados + 1
  opt-in omitido, 401 pruebas pasadas + 3 omitidas; typecheck, lint, YAML,
  validator infra y build verdes. Restic/proveedor real: no ejecutado.
- Push verificado: `74dfd83..5cae93c` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.
- Alertas durables `f35edc3`: collector loopback+filesystem, outbox y estado
  versionados, transiciones `raised/updated/resolved`, dedupe, backoff,
  backpressure, receipts, recuperación de crash, sink local y adapter webhook
  HTTPS idempotente. Focalizadas 13/13; suite completa 91 ficheros pasados + 1
  opt-in omitido, 411 pruebas pasadas + 3 omitidas; typecheck, lint, shell,
  validator infra y build Next 16.3.2 verdes.
- Push verificado: `5cae93c..f35edc3` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.
- Release recovery `b77dc7f`: journal exacto por fases, hashes env/estado,
  timeout de subprocess, deadline monotónico, verificación de digest+revisión
  de los contenedores, fallback transaccional, PID+start/boot, advisory lock del
  SO y rechazo de drift sin overwrite. Release+preflight 19/19; suite completa
  91 ficheros pasados + 1 opt-in omitido, 423 pruebas pasadas + 3 omitidas;
  typecheck, lint, validator infra y build Next 16.3.2 verdes.
- Push verificado: `886747b..b77dc7f` publicado exclusivamente en
  `origin/codex/aibrain-backend-definitivo`, sin merge ni force-push.

## Matriz requisito → implementación → prueba

| Requisito | Implementación | Prueba/evidencia |
|---|---|---|
| Dos instalaciones white-label | `InstallationConfig` v1, manifest y assets configurables | Tests de dos fixtures, dos builds y smoke HTTP con branding distinto |
| Sin hardcodes de Arnay/dominio/paths | Config obligatoria en producción y ejemplos sintéticos | Contract tests y búsqueda estática de fronteras/configuración |
| Veinte empleados sin cambiar código | Provisionador idempotente y raíces privadas por UUID | CLI real en proceso hijo: 20 creados y replay 20 unchanged |
| Alta/baja/reactivación/recovery | Endpoint host-local + CLI offline, receipts y journal por `requestId` | 12 focalizadas + proceso hijo; sesiones revocadas y worker/browser selectivos |
| Sin roles/control/onboarding/automations | Auth role-free, UI sin panel Runtime y rutas rechazadas eliminadas | Contract test 2/2, build de 38 rutas y E2E 3/3 |
| Sesión/worker/workspace/staging/browser independientes | `WorkerRuntimeRegistry` y layout por usuario | Tests de workers, browser, cookies, archivos y symlinks cross-user |
| WebSocket privado resiliente | Gateway loopback autenticado, journal, ACK/replay/dedupe/backoff | 20 pruebas gateway/router, crash/restart y soak con 28 replays |
| Concurrencia sin mezcla | Routing por instalación+usuario+thread+turn+item | Aceptación real 2 users × 2 threads: approval, stop, crash/replay/restart y cero mezcla |
| Supabase solo Auth | Identity provider único; estado de producto filesystem y contrato sin modo de persistencia Supabase | Guard contract 6/6 + E2E HTTP con provider apagado, restart, workbench y logout |
| Persistencia tras refresh/restart | Stores versionados, atomic/fsync, locks, journal e índices | E2E HTTP reiniciado, 10/10 locks focalizadas y tres escenarios en procesos hijos reales |
| `PERMISSIONS.md` server-side | Provider Markdown read-only y fingerprint por turn | 31 tests focalizados y auditoría durable |
| Office/PDF/texto/imagen | Staging validado, conversores confinados, gate multiproceso y previews V2 atestados | Matriz real 2/2, sandbox 9/9, gate/rutas 13/13, hash/tamaño/rebuild/abort/sparse output; preflight Docker QA pendiente |
| Codex sin staging ni `publish-rw` | Sandbox bwrap con upload server-only, solo `staging/tmp` y mount vacío RO para `publish-rw` | Validator infra, turn DOCX real sin path y pruebas de frontera/symlink |
| Publicación confirmada | Freeze+hash+preview+HMAC+conflicto+versión+atomic write+lock global por target | Focalizadas, carrera concurrente entre dos usuarios y 28/28 de la selección documental/runtime |
| Browser/Computer Use aislado | CDP pipe autenticado, perfil/targets/navegación/descargas/viewer por usuario/thread | Chrome real 2/2 y matriz browser focalizada 50/50 |
| Browser egress sin rebinding | Proxy loopback con resolución/IP fijadas y sidecar físico autenticado | Unit/integration, gateway 6/6 e HTTPS real a `example.com`; Compose QA pendiente |
| Contratos UI reales | `contracts/aibrain/v1`: inventario exacto de rutas y bundle JSON Schema; guía humana en `UI_BACKEND_CONTRACT.md`; contratos App Server generados | 13/13 contract tests, 39 operaciones en paridad con handlers, ejemplos+fixtures tipados y respuestas Next E2E; regeneración/compare byte a byte de Codex 0.149.1 |
| Auth defensivo | Cookie opaca, Origin/CSRF, expiración, revocación y rate limit | 24 pruebas Auth/rate limit y E2E de logout |
| Backup/restore/recovery | Manifest V2 compuesto para estado+documental, hashes por componente/global, barrera de publicación, promoción dual y Restic off-host one-shot | 10 pruebas backup + CLI/proceso Restic sintético, incluidas corrupción, enlaces, publicación concurrente, restore, crash/replay y secretos; contenedor QA y proveedor externo pendientes |
| Operación/release/rollback | Compose, Nginx, health, logs, alertas con outbox/sink durable, drain y release dual atómica con journal | Alertas 13/13, release/preflight 19/19 y validator estático verde; ejecución Docker/reboot QA pendiente |
| Hardening/dependencias | Paths seguros, límites, fail-closed y versiones fijadas | Lint/typecheck/build, auditorías 0 vulnerabilidades |
| Soak y latencia | Harness de workers/WS/replay/restart, compactación y gates de recursos | Ejecución final 120,893 s verde, p95 865,49 ms, 0 fugas y journals acotados |

## Comandos reproducibles

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:contract
npm run contracts:verify
npm run test:e2e
npm run test:documents:real
AIBRAIN_REAL_CHROME_TEST=1 AIBRAIN_CHROME_EXECUTABLE=/ruta/chrome-headless-shell AIBRAIN_CHROME_EXPECTED_VERSION=152.0.7977.64 npm run test:browser:real
npm run test:soak
npm run test:coverage
npm run build
npm run backup:create
npm run backup:verify -- --snapshot /ruta/absoluta
npm run backup:replicate -- --snapshot /ruta/absoluta
npm run alerts:run -- --restart-count-15m 0 --preflight-failure-count-15m 0
npm audit --omit=dev --audit-level=critical
npm audit --audit-level=critical
npm run infra:validate
```

## Handoff externo exacto

1. En el Hetzner QA, comprobar nombres de red, puertos y volúmenes exclusivos de AiBrain antes de ejecutar nada; abortar si aparece una referencia a BGreenly.
2. Con Docker disponible: validar `docker compose config`, construir desde cero las imágenes `app` y `egress-gateway`, levantar únicamente el proyecto Compose de AiBrain y esperar ambos healthchecks verdes.
3. Ejecutar `npm run test:soak:qa`, la matriz documental con QPDF obligatorio, dos instalaciones y 20 usuarios dentro del contenedor.
4. Crear backup compuesto QA, verificarlo, restaurarlo en dos raíces QA vacías (estado+documental), reiniciar host/servicios AiBrain y confirmar replay/recovery sin duplicados.
5. Con destino y credenciales off-host aprobados, inicializar Restic una vez, replicar el snapshot verificado y ejecutar el restore drill exacto de `BACKUP_REPLICATION.md`.
6. Ensayar release anterior/nueva y rollback sin borrar releases ni backups; generar SBOM y escaneo de imagen, resolviendo cualquier hallazgo crítico.
7. Con una suscripción Codex dedicada al primer empleado, completar login humano, verificar Data Controls y ejecutar un turn real con tool browser y approval.
8. Configurar un proyecto Supabase QA solo-Auth, probar login/cambio inicial/recovery y después bloquear su acceso temporalmente para confirmar continuidad del workbench.
9. DNS, NAS real, cutover, datos Arnay, compras, producción y merge a `main` siguen requiriendo aprobación separada.

## Integración con `codex/aibrain-ui-parity`

- Fuente de verdad de la UI: `docs/UI_BACKEND_CONTRACT.md` y schemas versionados del repo; no inferir payloads desde componentes antiguos ni reintroducir roles, onboarding, control plane, automations o panel Runtime.
- Consumir `InstallationConfig`/manifest para marca exacta, incluida `accentColor`; no mantener nombres, dominios ni rutas de empresa en componentes.
- Mantener cursores/IDs de instalación+usuario+thread+turn+item, deduplicar eventos y representar estados `pending`, `degraded`, `reconnecting`, `conflict` y recuperables según contrato.
- Abrir un runtime thread nuevo cuando se habiliten browser dynamic tools; approvals y takeover se resuelven por las rutas documentadas y nunca desde estado global de cliente.
- La rama backend no ha hecho merge/rebase/reset ni reescritura masiva de `codex/aibrain-ui-parity`; la integración debe hacerse mediante commit/PR normal después de sus propias pruebas visuales.
