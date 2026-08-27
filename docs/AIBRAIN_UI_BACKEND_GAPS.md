# Contrato UI ↔ backend y gaps

Última verificación backend: `origin/codex/aibrain-backend-definitivo@6bc7bc2f8a9d4e5706c8796fd57b2621929ca5eb`, 2026-08-27.

La fuente de verdad de integración es `docs/UI_BACKEND_CONTRACT.md` de ese commit. La rama UI continúa basada en `a54838787fe7ca516510fb73d7e3bc4f77f2e183`: no se ha hecho merge ni se afirma que estos endpoints estén conectados en esta rama.

## Contratos públicos disponibles en la rama backend

- Auth y sesión: `/api/auth/session`; la UI no lee cookies ni tokens directamente.
- Workbench durable: proyectos, threads y mensajes bajo `/api/projects` y `/api/threads`.
- Turnos: `POST /api/chat` devuelve `application/x-ndjson`, con `snapshot`, `content`, `delta`, `activity`, `plan`, `approval`, `diff`, `artifact`, `done`, `stopped` y `error`.
- Recuperación: el par `userMessageId + assistantMessageId` es idempotente. Tras un corte, se repite exactamente el mismo body; un replay terminado devuelve `snapshot` y `X-AiBrain-Idempotent-Replay: true`.
- Control: `POST /api/runtime/turns/control` implementa `stop` y `steer` con `clientRequestId` idempotente.
- Approvals: `POST /api/runtime/approvals`, copiando literalmente `approvalId`, `threadId`, `turnId` e `itemId` recibidos.
- Runtime: `GET /api/runtime/status`; modelos, skills y capacidades visibles proceden de esta respuesta, no del manifest visual.
- Documentos: upload multipart bajo `/api/threads/{threadId}/documents`, previews privadas mediante las URLs opacas devueltas y límite general de 50 MiB.
- Publicación: freeze y confirmación en dos pasos bajo `/api/threads/{threadId}/publications`; el token de confirmación permanece solo en memoria.
- Browser: lifecycle, token, frame PNG e input humano bajo `/api/runtime/browser*`. Es polling HTTP, no CDP público, no noVNC y no WebSocket de vídeo.

## Lo conectado hoy en la rama UI

- El flujo legacy de `/api/chat` ya parsea NDJSON de forma fail-closed y presenta actividad, plan, approvals, diff, deltas y artefactos.
- `AbortController` detiene la petición local y conserva el resultado parcial como `stopped`.
- La UI cubre presentación white-label de mensajes, Review, documentos, publicación y Computer Use con fixtures sintéticos exclusivos de test.
- `src/ui/durable-chat-event-adapter.ts` prueba ordering, dedupe, gaps y replay sobre un envelope UI interno. Ese envelope no es el contrato HTTP público actual y no debe conectarse como si existiera un endpoint WebSocket.
- El smoke real del checkpoint 8 probó `/api/chat` → Codex App Server por `stdio`: primer turno, resume del mismo thread y cancelación, con `ready: true` e `isolated: true` en el host Hetzner existente.
- Preview sintética usa almacenamiento local para proyectos, threads y mensajes. No equivale al store durable del backend definitivo.

## Mapping de integración exacto

1. Sustituir el store Preview de la UI por los clientes de proyectos/threads del backend.
2. Adaptar el reader existente al `ChatRequest` definitivo y conservar los cuatro UUID hasta estado terminal.
3. Reducir `snapshot` como autoridad; `content` reemplaza, `delta` concatena, `activity`/`approval` hacen upsert por ID y `plan` reemplaza pasos.
4. Recuperar un stream cortado repitiendo el mismo `POST /api/chat`; no crear IDs nuevos ni exigir ACK/cursor en el navegador.
5. Conectar stop/steer a `/api/runtime/turns/control` y approvals a `/api/runtime/approvals` usando IDs opacos.
6. Poblar modelos, skills y capabilities desde `/api/runtime/status`.
7. Separar imágenes inline de documentos: Office/PDF/texto usan upload multipart y las URLs de preview devueltas.
8. Implementar publicación con freeze + confirmación, sin registrar ni persistir el `confirmationToken`.
9. Implementar Computer Use solo con `/api/runtime/browser*`: takeover antes de input, heartbeat durante control humano y tokens cortos fuera de logs/URLs.

El backend es autoridad para seguridad, schemas, rutas, stores y runtime. La rama UI es autoridad para tokens visuales, componentes, reducers de presentación y suites visuales. Los archivos compartidos se reconcilian uno a uno; no se elige una rama completa ni se hace merge automático.

## Gaps reales restantes

| Gap | Estado verificado | Consecuencia |
| --- | --- | --- |
| Integración entre ramas | Backend `6bc7bc2` expone el contrato; UI `43465f8` aún usa el flujo legacy/fixtures | La definición global de end-to-end no está cumplida hasta reconciliar ambas ramas |
| Auth de esta Preview UI | Login real carga correctamente, pero no había sesión AiBrain/test credential autorizada | No se recorrió el workbench autenticado en el deployment exacto |
| Codex login y límites reales | Pendiente QA externa en la rama backend | No se declara aceptación operativa multiusuario completa |
| Browser tool final | Viewer y takeover existen; falta cerrar la invocación App Server con approval/auditoría y defensa DNS-pinned contra rebinding | La UI no debe inventar tabs, URL/title, downloads ni tool calls no publicados |
| Documentación/memory contractual | Contrato UI principal existe; la rama backend aún registra incorporación explícita de memory como pendiente | Revalidar el SHA y contrato antes de integrar |
| Operación real | Docker/Compose, restore, reboot, rollback y soak siguen pendientes en backend | Preview y smoke efímero no son aceptación de Production |

## Superficies que la UI debe ocultar o degradar

- No hay endpoints públicos para listar/abrir/cerrar tabs ni leer URL/título actuales.
- `state.downloads` es solo lectura; no hay API pública de descarga.
- No hay API de hunks tipados, patch parcial ni undo filesystem desde Review.
- No hay API pública para listar/restaurar versiones anteriores de una publicación.
- `RuntimeStatus.ready=false` bloquea el envío aunque HTTP responda `200`.
- `503` nunca autoriza a asumir que una mutación no ocurrió; el reintento conserva IDs.

## Archivos con conflicto probable

- `src/components/brain-app.tsx`
- `src/components/chat-workspace.tsx`
- `src/components/details-panel.tsx`
- `src/components/turn-activity.tsx`
- `src/lib/chat-contract.ts`
- `src/app/api/chat/route.ts`
- `src/runtime/*`

La integración segura parte de la rama backend, incorpora manualmente la presentación y tests UI, y termina con typecheck, lint, unit, adapter, component, E2E, a11y, visual, builds Example/Northwind, smoke real y QA autenticada de Preview.
