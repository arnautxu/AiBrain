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
| 2. Supabase Auth-only + sesión local | En curso | `1c0386b`: login/cambio inicial/recuperación, cookie opaca, expiración, revocación, CSRF/Origin y continuidad offline; falta retirar los stores legacy de producto Supabase y validar Supabase QA real |
| 3. Stores file-backed resilientes | En curso | `38eeaaf`: schemas estrictos, atomic write/fsync, locks, journals e índices; falta migrar stores de producto |
| 4. Provisionamiento idempotente + 20 usuarios | En curso | `75316e1`: veinte roots/manifest de worker provisionados de forma idempotente y aislada; falta unir `user.json`, políticas y comando operativo |
| 5. Worker registry + WebSocket + contratos | En curso | `fc29316`, `75316e1`: transporte WS privado durable, registry por usuario y contratos Codex 0.149.1; falta factory/gateway real |
| 6. Proyectos y threads completos | Pendiente | — |
| 7. Streaming, steering, stop, approvals, replay | Pendiente | — |
| 8. Uploads, Office/PDF, previews y publicación | En curso | `d51f171`, `afcec39`, `e090832`: validación segura, staging privado y preview real DOCX→PDF/PNG; falta API/publicador y matriz completa |
| 9. Browser/Computer Use aislado | Pendiente | — |
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
- `PERMISSIONS.md` v1 se lee server-side con precedencia determinista, protección de symlink/hardlink y fingerprint canónico; falta conectarlo a la creación de cada turn y a un journal de auditoría durable.
- El launch context del worker no contiene `publishWriteRoot`; la factory concreta deberá imponer esos mounts a nivel proceso/contenedor.

## Riesgos y acciones externas pendientes

- Falta Docker local: se prepararán y validarán schemas/scripts estáticamente; el build real de imágenes se ejecutará donde Docker esté disponible.
- No se tocarán DNS, Supabase hosted, NAS real, BGreenly, suscripciones Codex ni producción sin aprobación separada.
- La primera autenticación Codex real y la comprobación de Data Controls requieren login humano y suscripción dedicada.

## Siguiente acción concreta

Migrar proyectos, metadatos de threads y operaciones de turn desde los stores demo/Supabase al filesystem privado por usuario, usando los primitives durables ya validados.

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
- Suite global posterior: 122/122 tests en 22 ficheros; lint, typecheck y build Next.js verdes.
