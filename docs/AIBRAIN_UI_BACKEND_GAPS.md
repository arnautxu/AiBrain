# Contrato UI ↔ backend y gaps

Última verificación backend: `origin/codex/aibrain-backend-definitivo@b8b0f3c64119e0e723ddf286077da97cf1555c59`, 2026-08-27.

## Contratos consumibles hoy

- `InstallationConfig` schema v1 y `PublicInstallationBranding`.
- Codex App Server `0.149.1` generado bajo `contracts/codex/0.149.1`.
- Envelope de transporte `APP_SERVER_TRANSPORT_PROTOCOL_VERSION = 1`.
- `AppServerEvent { eventId, sequence, occurredAt, message }`.
- Cursor durable `{ eventId, sequence }`.
- Frames `ready`, `accepted`, `event`, `pong`, `rejected`, `overloaded` y cliente `resume`, `request`, `event-ack`, `ping`.
- Estado de transporte `idle | connecting | connected | reconnecting | closing | closed`.

Estos contratos existen y tienen pruebas en la rama backend, pero todavía no están conectados al flujo de producto: los checkpoints backend 5, 7 y 10 siguen en curso o pendientes.

## Contrato conectado hoy en la rama UI

- `POST /api/chat` recibe IDs opacos de proyecto, conversación y mensajes, opciones de turno e imágenes inline validadas.
- La respuesta es NDJSON con el discriminante `ChatStreamEvent`: `activity`, `plan`, `approval`, `diff`, `delta`, `artifact`, `done` y `error`.
- `src/ui/app-server-ui-adapter.ts` conserva el orden de lectura, soporta fragmentación arbitraria de chunks y falla cerrado ante JSON malformado, eventos desconocidos o líneas mayores de 1 MB.
- `AbortController` cancela la petición existente y la UI conserva el resultado parcial con estado terminal `stopped`.
- En Preview sintética, proyectos, conversaciones y mensajes se recuperan desde almacenamiento local; un mensaje que quedó `streaming` durante una recarga se recupera honestamente como `stopped`.
- El evento `artifact` admite tres view models fail-closed: imagen, documento y navegador. Los documentos conservan `kind`, MIME, tamaño, estado de conversión, total de páginas, preview, lifecycle de publicación y errores; los cambios de estado con el mismo ID reemplazan el artefacto anterior sin duplicarlo.
- El límite documental del view model es 50 MB, alineado con `StagedDocument` v1 del backend. Las URLs visibles solo se aceptan bajo rutas opacas `/api/projects/…`; viewer, captura y descarga de navegador quedan limitados a `/api/browser/sessions/…`.
- La presentación cubre DOCX/XLSX/PPTX/PDF, imagen generada, conversión, preview/error, página 1 de N, descarga, estados `awaiting_confirmation | publishing | published | declined | conflict`, error de publicación y lifecycle de browser/Computer Use (`starting | ready | active | reconnecting | disconnected | closed | error`) con control del agente, empleado o aprobación pendiente.
- El iframe de Computer Use no recibe `allow-same-origin`, no envía referrer y solo se monta si llega un artefacto válido en estado listo/activo. El logout desmonta el viewer. No hay fallback productivo ni sesión sintética fuera de tests.
- El contrato actual no expone `eventId`, `sequence`, cursor, ACK, `turnId` ni `itemId`; por tanto la UI no simula dedupe, replay o reconnect durable.
- Los adjuntos de entrada actuales siguen siendo únicamente PNG/JPEG/WebP/GIF inline, máximo 3, 2 MB por imagen y 5 MB agregados. No se amplía el selector a Office/PDF porque todavía no existe una route autorizada conectada a esta rama.

## Mapping objetivo al contrato backend definitivo

Los componentes no importarán tipos RPC generados. Un adapter server-side transforma los eventos en un envelope UI versionado:

```ts
type UiEventEnvelope = {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  occurredAt: string;
  projectId: string;
  threadId: string;
  turnId: string | null;
  payload: UiEvent;
};
```

`UiEvent` discrimina como mínimo `connection`, `thread`, `turn`, `message-delta`, `plan`, `activity`, `tool`, `diff`, `approval`, `artifact`, `browser`, `usage`, `error` y `complete`. IDs y rutas Codex permanecen server-side salvo IDs opacos que el backend declare públicos.

## Reglas del reducer cliente definitivo

1. Rechazar versiones desconocidas.
2. Deduplicar por `eventId`.
3. Aplicar solo `sequence === lastSequence + 1`.
4. Ante gap, detener la aplicación de eventos y solicitar replay desde el cursor confirmado.
5. Persistir el cursor solo después de aplicar el evento de forma idempotente.
6. Un ACK no implica completion del turno.
7. `rejected.retryable` y `overloaded.retryAfterMs` gobiernan backoff; no se reenvían peticiones aceptadas.
8. Completion/error/cancelled son terminales por turn, no globales para la app.
9. El stream pertenece a `threadId/turnId`; cambiar de vista no lo cancela.
10. Reconnect no crea una conversación nueva si resume falla.

## Gaps reales, no simulables

| Gap backend | Estado | Consecuencia UI |
| --- | --- | --- |
| Auth-only + sesión local opaca | Completado localmente; QA externa pendiente | Login UI se puede completar; smoke definitivo espera endpoint |
| Stores de producto migrados a filesystem | En curso checkpoint 3 | Preview verifica recuperación local, no persistencia definitiva |
| Provisionamiento y registry por empleado | Provisionamiento completo; factory/gateway en curso checkpoint 5 | No hay smoke multiusuario definitivo |
| Proyectos/threads definitivos | En curso checkpoint 6 | Adapter conserva frontera y fixtures de test |
| Streaming/steer/stop/approval/replay integrados end-to-end | Pendiente checkpoint 7 | Transporte está probado, integración de producto no |
| Office/PDF/previews/publicador | Servicios backend checkpoint 8 en curso; `StagedDocument`, `DocumentPreview` y publicador v1 existen, pero faltan routes autorizadas y el preview real solo materializa página 1 | UI/adapter/fixtures cubren tipos y lifecycle; upload, paginación interactiva y confirmación real siguen bloqueados |
| Browser/Computer Use aislado | Pendiente backend checkpoint 9; no existe gateway/viewer autenticado por usuario/thread | UI/adapter/fixtures cubren estados, captura, takeover representado, devolución, descarga, reconexión y cierre; ninguna acción declara una sesión real disponible |
| Contrato final para rama UI | Pendiente checkpoint 10 | Este documento es propuesta de integración, no API final |

## Integración segura

- No mergear automáticamente las ramas.
- Antes del merge final, volver a fijar el SHA backend y comparar `InstallationConfig`, transporte y contrato UI.
- Preferir el backend como fuente de verdad para schemas generados, seguridad, Auth, stores y gateway.
- Preferir esta rama para tokens, componentes, adapters de presentación, reducers y tests visuales.
- Resolver cambios compartidos archivo a archivo; nunca elegir una rama completa sobre la otra.
- Orden recomendado provisional: backend definitivo → adapter UI compatible → componentes UI → E2E/visual compartidos.
