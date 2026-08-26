# AiBrain backend definitivo — progreso reproducible

Última actualización: 2026-08-26 (Europe/Madrid)

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
| 0. Baseline, rama y protección | Completado | Baseline anterior; commit pendiente |
| 1. InstallationConfig + segunda instalación | En curso | Siguiente cambio concreto |
| 2. Supabase Auth-only + sesión local | Pendiente | — |
| 3. Stores file-backed resilientes | Pendiente | — |
| 4. Provisionamiento idempotente + 20 usuarios | Pendiente | — |
| 5. Worker registry + WebSocket + contratos | Pendiente | — |
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

## Riesgos y acciones externas pendientes

- Falta Docker local: se prepararán y validarán schemas/scripts estáticamente; el build real de imágenes se ejecutará donde Docker esté disponible.
- No se tocarán DNS, Supabase hosted, NAS real, BGreenly, suscripciones Codex ni producción sin aprobación separada.
- La primera autenticación Codex real y la comprobación de Data Controls requieren login humano y suscripción dedicada.

## Siguiente acción concreta

Implementar y probar `InstallationConfig` versionado, loader estricto, branding server-side, rutas derivadas y una segunda instalación QA sin hardcodes funcionales.
