# Architecture and trust boundaries

Estado de esta evidencia: base `d381ccf836516f91464f20225403996e7e8158d1`; rama de trabajo `codex/aibrain-auth-security`. “Validated locally” significa tests sintéticos del repositorio, no aceptación en Arnall ni verificación live.

## Identidad, tenancy y autorización

| Límite | Estado | Código y evidencia |
| --- | --- | --- |
| Login real y sesión local opaca | implemented; validated locally | [servicio](../src/auth/auth-service.ts), [store](../src/auth/local-session-store.ts), [integración](../tests/integration/local-auth-service.integration.test.ts), [negativos del store](../tests/unit/local-auth-stores.test.ts) |
| Cookie y mutaciones same-origin | implemented; validated locally | [cookie](../src/auth/session-cookie.ts), [same-origin](../src/auth/request-security.ts), [test CSRF](../tests/unit/auth-request-security.test.ts), [rate limits](../tests/unit/auth-rate-limit-routes.test.ts) |
| Tenant e instalación derivados del servidor | implemented; validated locally | [sesión](../src/auth/session.ts), [instalación](../src/config/installation.ts), [workbench](../src/workbench/store.ts), [integración](../tests/integration/workbench-lifecycle-routes.integration.test.ts) |
| User/project/thread IDOR | implemented; validated locally | [store](../src/workbench/filesystem-store.ts), rutas de [projects](../src/app/api/projects) y [threads](../src/app/api/threads), negativos cross-user en [workbench](../tests/integration/workbench-lifecycle-routes.integration.test.ts), [documentos](../tests/integration/document-routes.integration.test.ts) y [publicación](../tests/integration/publication-routes.integration.test.ts) |
| Roles y grupos durables | implemented; validated locally | [store](../src/admin/workspace-admin-store.ts), [servicio](../src/admin/server-service.ts), [ruta](../src/app/api/admin/route.ts), [test del store](../src/admin/workspace-admin-store.test.ts), [test de ruta](../src/app/api/admin/route.test.ts) |
| Usage de empresa por rol durable | implemented; validated locally | [ruta](../src/app/api/usage/company/route.ts), [tests](../src/app/api/usage/usage-routes.test.ts); `AIBRAIN_USAGE_ADMIN_USER_IDS` no autoriza |
| Rol ligado al snapshot de permisos del turno | implemented; validated locally | [resolución](../src/runtime/permission-turn.ts), [test](../src/runtime/permission-turn.test.ts) |
| Dos identidades reales David/Arnau en Arnall | not started / external | requiere IdP QA/producción, perfiles locales, roles explícitos y aceptación cross-user live |

El bootstrap de propietarios es un acto de host separado de las sesiones de empleado. `AIBRAIN_ADMIN_USER_IDS` solo puede crear el primer estado cuando contiene un UUID ya provisionado. Una vez existe `dataRoot/workspace-admin/state.json`, cambiar esa variable no altera asignaciones; los nuevos miembros empiezan como `workspace-member` y toda promoción pasa por una mutación autenticada y auditada.

## Runtime, approvals y secretos

| Límite | Estado | Código y evidencia |
| --- | --- | --- |
| Worker, `HOME`, `CODEX_HOME`, workspace y navegador por usuario | implemented; validated locally | [provisioner](../src/runtime/workers/provisioner.ts), [registry](../src/runtime/workers/registry.ts), [aceptación multiusuario](../tests/integration/multi-user-worker-acceptance.integration.test.ts) |
| Entorno del worker allowlist-only | implemented; validated locally | [allowlist](../src/runtime/worker-environment.ts), [tests](../tests/unit/worker-environment.test.ts); secretos del proceso web no se copian al hijo |
| Approval ligada a installation/user/thread/turn/item | implemented; validated locally | [store](../src/runtime/approval-store.ts), [ruta](../src/app/api/runtime/approvals/route.ts), [tests](../src/runtime/approval-store.test.ts) |
| Auditoría de cambios de rol/grupo y lifecycle | implemented; validated locally | `dataRoot/workspace-admin/audit.jsonl`, [lifecycle](../src/users/lifecycle.ts) y [tests](../src/users/lifecycle.test.ts) |
| Auditoría única del fingerprint compuesto PERMISSIONS + grupos | not started | el deny efectivo se aplica server-side, pero el journal de resolución Markdown se escribe antes del overlay de grupos; debe cerrarse antes de aceptación final |
| Revocación inmediata al deshabilitar | implemented; validated locally | [lifecycle](../src/users/lifecycle.ts): revoca sesiones y detiene worker/browser; falta readback live |

## Threat model focal

- Robo o fijación de sesión: el identificador es aleatorio, solo su hash se persiste; cookies `Secure`, `HttpOnly`, `SameSite=Lax`, `__Host-`, timeout idle y absoluto. Riesgo residual: el robo de cookie sigue siendo válido hasta revocación/expiración; TLS y seguridad del endpoint son obligatorios.
- CSRF: toda mutación de empleado exige origen igual a `InstallationConfig.publicUrl`; la cookie no sustituye este control.
- IDOR cross-user/cross-project: las rutas no aceptan `userId` del navegador y resuelven almacenamiento desde la sesión y el thread server-side. Los UUID ajenos devuelven denegación/not-found sin abrir su root.
- Escalada por variable de entorno: `AIBRAIN_USAGE_ADMIN_USER_IDS` ya no concede acceso. El bootstrap de owner no se reevalúa después de crear el estado durable.
- Escalada por cambio concurrente de rol: cada request administrativo y cada turno relee la política durable. Un turno ya iniciado conserva su snapshot inmutable; revocar acceso exige además `disable`, que revoca sesiones y detiene runtime.
- Prompt injection: mensajes, documentos, web y outputs son datos no fiables; no pueden cambiar las reglas resueltas server-side. Esto es defensa conductual adicional, no reemplazo del sandbox físico.
- Symlink/path traversal: stores de sesión, usuario, permisos, approvals y workers validan IDs, raíces canónicas, tipos de fichero, ownership/modes y rechazan symlinks/hardlinks donde aplica.
- Exposición de secretos: el worker recibe una allowlist de variables y roots privados. Credenciales de conectores deben vivir fuera del repo y montarse solo en el adapter autorizado; la aceptación live debe inspeccionar `/proc/<pid>/environ` de procesos no autorizados sin imprimir valores.

## Gates de aceptación pendientes

1. Crear David y Arnau en el IdP real, provisionar ambos UUID sin datos de demo y asignar owner/admin/member de forma explícita.
2. Ejecutar login, renovación, logout, disable/recovery y revocación en dos navegadores independientes.
3. Probar matriz cross-user en rutas, proyectos, threads, documentos, browser, approvals, settings, usage y runtime real.
4. Cerrar la auditoría del fingerprint compuesto de grupos y permisos antes del primer turno live aceptado.
5. Verificar en el host que procesos de David, Arnau, conversión, browser y conectores solo reciben los secretos autorizados.
6. Registrar SHA desplegado, timestamps, receipts y resultados en el runbook de release; hasta entonces todo lo anterior es local, no live.
