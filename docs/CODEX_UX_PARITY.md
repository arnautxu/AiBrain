# Paridad funcional y UX con Codex

## Estado actual

AiBrain conserva una superficie propia y usa Codex App Server como motor real.
La UI recibe contratos AiBrain tipados; nunca se conecta a App Server, CDP o
almacenamiento. La persistencia de producto no vive en Supabase: proyectos,
threads, mensajes, preferencias, approvals, documentos, memoria y auditoría son
file-backed y privados por empleado.

## Superficies con backend real

| Superficie | Contrato activo |
| --- | --- |
| Proyectos y threads | crear, listar, leer, continuar, buscar, renombrar, fijar, archivar y restaurar |
| Turns | NDJSON, plan, actividad, tools, diffs, usage, steering, stop, replay y recovery |
| Approvals | pendientes durables, resolución explícita, expiración, replay y aislamiento por item |
| Composer | modos, modelo, esfuerzo, web, skills e imágenes revalidados server-side |
| Review | diff y estado del resultado persistidos por turn |
| Documentos | upload streaming, Office/PDF/texto/imagen, preview privado y publicación confirmada |
| Memoria | extracción automática privada al terminar, creación manual, corrección/borrado y snapshot relevante trazable por turn |
| Browser | perfil por empleado, target/descargas por thread, viewer autenticado y takeover humano |
| Runtime | worker/CODEX_HOME por empleado y transporte WebSocket privado recuperable |

No se muestran controles que dependan de fixtures de producción. Los fixtures
de las dos empresas sintéticas y las cuentas demo solo existen para desarrollo
y pruebas.

## Principios de interacción

- Jerarquía proyecto → thread y conversación como foco principal.
- Actividad, approvals y Review son contextuales y no sustituyen la respuesta.
- IDs de runtime, paths y secrets no cruzan la frontera del servidor.
- Las operaciones sensibles piden confirmación explícita y presentan una
  explicación no técnica; los detalles administrativos quedan secundarios.
- Refresh/reconnect conserva IDs y recompone el estado durable antes de emitir
  nuevos comandos.
- Desktop usa rail/inspector; mobile usa drawer y Review a pantalla completa sin
  crear un contrato de datos alternativo.

## Deliberadamente fuera de V1

- App nativa, voz y vídeo.
- Automatizaciones programadas o recurrentes.
- Billing/cuotas comerciales.
- Postgres de producto, Redis, Kubernetes, Mem0, Cognee, pgvector u OpenFGA.
- Terminal/Git/PR general como superficie para trabajadores no técnicos.

El contrato exacto para la rama UI está en `UI_BACKEND_CONTRACT.md`; el estado
de validación está en `AIBRAIN_BACKEND_PROGRESS.md`.
