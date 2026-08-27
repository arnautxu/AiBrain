# Reference brief · Company Brain white-label

Este documento conserva el criterio de producto vigente. La evidencia técnica y
los comandos reproducibles están en `AIBRAIN_BACKEND_PROGRESS.md`; los
contratos consumibles por UI, en `UI_BACKEND_CONTRACT.md`.

## Resultado

- Workbench propio sobre Codex con proyectos, threads, streaming, actividad,
  approvals, review, documentos, memoria explícita y Browser/Computer Use.
- Una instalación/servidor por empresa en producción, sin forks de código ni
  literals de cliente. Una instalación QA adicional se obtiene cambiando solo
  configuración, secretos, branding, rutas y recursos aislados.
- Supabase Auth-only. Todo el estado de producto es filesystem local,
  versionado, validado, atómico, recuperable y privado por empleado.
- Un worker caliente, `CODEX_HOME`, workspace, staging, artifacts, browser,
  perfil, descargas, permisos y auditoría independientes por empleado.

## Invariantes

- Codex es el runtime real; producción no fabrica respuestas ni estados.
- Instalación y usuario provienen de la sesión local; nunca del body.
- El navegador no recibe credenciales Codex, rutas administrativas, tokens de
  continuidad ni conexión a App Server/CDP.
- `PERMISSIONS.md` se resuelve server-side antes de cada turn y se audita por
  fingerprint.
- Los workers leen `source-ro`, no ven otros usuarios y no pueden escribir en
  `publish-rw`. Solo el publicador server-side confirmado puede hacerlo.
- Los límites de capacidad son backpressure operativo, no cuotas comerciales.
- App nativa, voz, vídeo y automatizaciones programadas están fuera de V1.

## Aceptación

1. Sin sesión, UI y APIs privadas responden con login/`401`; mutaciones
   cross-origin reciben `403`.
2. Dos configuraciones muestran identidad, dominio, assets, color y paths
   distintos sin modificar código.
3. Veinte empleados se provisionan idempotentemente y no comparten datos,
   workers, eventos, approvals, ficheros, browsers ni credenciales.
4. Refresh, pérdida de red y restart recuperan threads/turns sin duplicarlos.
5. Upload, preview, rechazo y publicación confirmada sobreviven restart y
   conservan hash, versión, conflicto, idempotencia y auditoría.
6. Un browser por empleado conserva su perfil; cada thread obtiene target y
   descargas propios; CDP no abre sockets.
7. Typecheck, lint, unit, integración, E2E, contratos, build e infraestructura
   pasan localmente; Docker/Compose y servicios reales se repiten en QA.

## Límites externos

La implementación local no equivale a haber realizado login Codex/Supabase,
DNS/TLS, NAS real, backup offsite, alertas, deploy, cutover o rollback en el
servidor. Esas acciones necesitan sus credenciales y autorizaciones separadas.
