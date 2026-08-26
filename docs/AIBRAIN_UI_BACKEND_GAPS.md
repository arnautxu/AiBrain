# Contrato UI ↔ backend y gaps

Última verificación backend: `origin/codex/aibrain-backend-definitivo@7a20c51f6d5870a9f02ba3df8311b6955dd3b386`, 2026-08-27.

## Contratos consumibles hoy

- `InstallationConfig` schema v1 y `PublicInstallationBranding`.
- Codex App Server `0.149.1` generado bajo `contracts/codex/0.149.1`.
- Envelope de transporte `APP_SERVER_TRANSPORT_PROTOCOL_VERSION = 1`.
- `AppServerEvent { eventId, sequence, occurredAt, message }`.
- Cursor durable `{ eventId, sequence }`.
- Frames `ready`, `accepted`, `event`, `pong`, `rejected`, `overloaded` y cliente `resume`, `request`, `event-ack`, `ping`.
- Estado de transporte `idle | connecting | connected | reconnecting | closing | closed`.

## Mapping a contrato de aplicación

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

## Reglas del reducer cliente

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
| Auth-only + sesión local opaca | Pendiente checkpoint 2 | Login UI se puede completar; smoke definitivo espera endpoint |
| Stores de producto migrados a filesystem | En curso checkpoint 3 | No se valida persistencia definitiva de proyectos/threads |
| Provisionamiento y registry por empleado | Pendiente checkpoints 4–5 | No hay smoke multiusuario definitivo |
| Proyectos/threads definitivos | Pendiente checkpoint 6 | Adapter conserva frontera y fixtures de test |
| Streaming/steer/stop/approval/replay integrados end-to-end | Pendiente checkpoint 7 | Transporte está probado, integración de producto no |
| Office/PDF/previews/publicador | Pendiente checkpoint 8 | Estados UI honestos, smoke real bloqueado |
| Browser/Computer Use aislado | Pendiente checkpoint 9 | Viewer UI sin declarar sesión disponible |
| Contrato final para rama UI | Pendiente checkpoint 10 | Este documento es propuesta de integración, no API final |

## Integración segura

- No mergear automáticamente las ramas.
- Antes del merge final, volver a fijar el SHA backend y comparar `InstallationConfig`, transporte y contrato UI.
- Preferir el backend como fuente de verdad para schemas generados, seguridad, Auth, stores y gateway.
- Preferir esta rama para tokens, componentes, adapters de presentación, reducers y tests visuales.
- Resolver cambios compartidos archivo a archivo; nunca elegir una rama completa sobre la otra.
- Orden recomendado provisional: backend definitivo → adapter UI compatible → componentes UI → E2E/visual compartidos.
