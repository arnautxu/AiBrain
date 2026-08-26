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
| 2. Supabase Auth-only + sesión local | Pendiente | — |
| 3. Stores file-backed resilientes | En curso | `38eeaaf`: schemas estrictos, atomic write/fsync, locks, journals e índices; falta migrar stores de producto |
| 4. Provisionamiento idempotente + 20 usuarios | Pendiente | — |
| 5. Worker registry + WebSocket + contratos | En curso | `fc29316`: transporte WS privado durable y validado contra Codex 0.149.1; registry/gateway en integración |
| 6. Proyectos y threads completos | Pendiente | — |
| 7. Streaming, steering, stop, approvals, replay | Pendiente | — |
| 8. Uploads, Office/PDF, previews y publicación | Pendiente | — |
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

## Riesgos y acciones externas pendientes

- Falta Docker local: se prepararán y validarán schemas/scripts estáticamente; el build real de imágenes se ejecutará donde Docker esté disponible.
- No se tocarán DNS, Supabase hosted, NAS real, BGreenly, suscripciones Codex ni producción sin aprobación separada.
- La primera autenticación Codex real y la comprobación de Data Controls requieren login humano y suscripción dedicada.

## Siguiente acción concreta

Integrar Auth local opaca, `PermissionProvider` y el provisionamiento/registry aislado por empleado; después migrar los stores de producto a los primitives durables.

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
