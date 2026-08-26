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
| 3. Stores file-backed resilientes | En curso | `38eeaaf`, `9efb45a`, `facda49`, `cf76855`, `ac0b62e`: schemas estrictos, atomic write/fsync, locks multi-proceso y cola local, journals, índices, workbench y approvals aislados, backup/restore real; falta la proyección durable de cada evento de streaming |
| 4. Provisionamiento idempotente + 20 usuarios | Completado | `75316e1`, `545948a`, `323243b`: `user.json`, perfiles, políticas y raíces completas; comando idempotente y prueba con veinte empleados sintéticos |
| 5. Worker registry + WebSocket + contratos | Completado localmente | `fc29316`, `75316e1`, `26fa801`, `a67ecf5`: worker caliente por usuario, gateway loopback autenticado, registry, router scoped, replay/ACK/dedupe/backoff y contratos Codex 0.149.1; falta únicamente login Codex externo real |
| 6. Proyectos y threads completos | Completado localmente | `9efb45a`, `6439f0d`, `a67ecf5`: crear/listar/leer/continuar/renombrar/buscar/fijar/archivar/restaurar, paginación estable y runtime thread ligado a instalación+usuario |
| 7. Streaming, steering, stop, approvals, replay | En curso | `cf76855`, `26fa801`, `a67ecf5`: streaming, stop scoped, approvals durables, clientUserMessageId, replay y routing sin handlers globales; faltan steering explícito, proyección durable incremental y recovery E2E tras crash |
| 8. Uploads, Office/PDF, previews y publicación | En curso | `d51f171`, `afcec39`, `e090832`, `416d368`: validación segura, staging privado, preview real y publicador atómico/versionado/idempotente; faltan routes autorizadas y matriz completa de formatos |
| 9. Browser/Computer Use aislado | En curso | `4bed095`: roots, perfil, descargas, estado durable, fencing, heartbeat, takeover, recovery, tokens HMAC y backpressure por usuario; faltan adapter Chrome/CDP/noVNC y routes autenticadas |
| 10. Contratos reales para UI | Pendiente | — |
| 11. Compose y operación | Pendiente | — |
| 12. Hardening y suite completa | Pendiente | — |

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
- `PERMISSIONS.md` v1 se resuelve antes de persistir cada turn, se inyecta en App Server y registra fingerprint/versiones en un journal durable por usuario; la ruta de ejecución todavía debe migrar del adapter `stdio` legacy al registry por empleado.
- El launch context del worker no contiene `publishWriteRoot`; la factory concreta deberá imponer esos mounts a nivel proceso/contenedor.
- El UUID de Supabase Auth es exactamente el UUID filesystem del empleado; no existe membership, rol, proyecto o sesión de producto remota.
- El publicador conserva el original como versión verificable, congela candidato+preview y exige una confirmación HMAC idempotente; el worker nunca recibe la raíz `publish-rw`.
- El chat y el status reales ya no usan el pool `stdio` por tenant/workspace: ambos arrancan o reutilizan el worker privado del UUID autenticado y hablan exclusivamente por el transporte WebSocket loopback.
- Los tokens de continuidad de thread son V2 y están firmados contra instalación, usuario y runtime thread; un empleado no puede reanudar el token de otro.
- Los proyectos viven bajo `users/<uuid>/workspace/projects/<projectId>`; la ruta legacy configurable no se entrega al worker ni al sandbox del turn.
- Los locks filesystem mantienen la exclusión entre procesos y añaden una cola FIFO abortable dentro del proceso para evitar thundering herd sin ampliar timeouts.

## Riesgos y acciones externas pendientes

- Falta Docker local: se prepararán y validarán schemas/scripts estáticamente; el build real de imágenes se ejecutará donde Docker esté disponible.
- No se tocarán DNS, Supabase hosted, NAS real, BGreenly, suscripciones Codex ni producción sin aprobación separada.
- La primera autenticación Codex real y la comprobación de Data Controls requieren login humano y suscripción dedicada.

## Siguiente acción concreta

Persistir cada evento de turn antes de su ACK y añadir recuperación/reanudación E2E después de refresh, pérdida de red y restart, incluyendo steering y retry idempotente de `clientUserMessageId`.

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
- `npm run test:contract`: 2/2 verdes contra la versión fijada.
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
- Browser foundation: 6 pruebas focalizadas para aislamiento de perfiles/cookies/downloads, takeover, heartbeat, recovery y tokens autenticados.
- Gateway/router: 20 pruebas de transporte, gateway y routing, incluido replay durable, ACK posterior al handler, requests inciertos, dedupe y concurrencia por thread.
- Camino real worker: tests de token user-bound, inicialización única y turn con `clientUserMessageId`; el pool legacy queda sin referencias desde `/api/chat` y `/api/runtime/status`.
- Suite global más reciente: 184/184 tests en 38 ficheros; lint, typecheck y build Next.js verdes tras `ac0b62e` y `a67ecf5`.
