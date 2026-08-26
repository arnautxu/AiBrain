# Approvals durables y aisladas

Las approvals de App Server ya no usan un `Map` global. Cada instalación y trabajador tienen un store filesystem privado, versionado y recuperable:

```text
<usersRoot>/<user-uuid>/approvals/
  records/<sha256-del-routing>.json
  events.jsonl
  locks/
```

Los nombres físicos nunca contienen IDs recibidos del runtime. El hash se calcula sobre la tupla completa:

```text
installationId + userId + threadId + turnId + itemId + approvalId
```

El registro JSON es la fuente de verdad del estado actual; el journal append-only conserva `requested`, `resolved`, `cancelled` y `expired`. Ambos usan schemas estrictos. Los cambios de estado usan lock por approval, escritura temporal, `fsync`, rename atómico y journal durable. El journal no guarda command, cwd, explicación, documentos ni secrets.

## Flujo

1. App Server emite `requestApproval` con `threadId`, `turnId` e `itemId`.
2. Si App Server incluye su `approvalId`, se conserva. Si no, el backend deriva uno estable del método y routing para que un replay tras restart encuentre el mismo registro.
3. El runtime rechaza el server request si thread/turn no coinciden con el turn activo.
4. Antes de esperar, `FileApprovalStore.createPending` persiste el estado.
5. El evento de streaming entrega al navegador solo los campos de routing necesarios y la presentación de la approval.
6. `POST /api/runtime/approvals` vuelve a obtener instalación y usuario de la sesión autenticada; el body no puede elegirlos.
7. La decisión solo se aplica si `threadId + turnId + itemId + approvalId` encuentran exactamente un registro pendiente bajo ese usuario.
8. El waiter consulta el registro durable. No existe resolver global ni handler compartido por ID.

Body de decisión:

```json
{
  "approvalId": "approval-...",
  "threadId": "019...",
  "turnId": "019...",
  "itemId": "item_...",
  "decision": "accept"
}
```

Decisiones válidas: `accept`, `acceptForSession`, `decline`. Repetir exactamente la misma decisión es idempotente. Una decisión distinta sobre una approval ya resuelta devuelve conflicto. Una tupla de otro thread/turn/item o un estado cancelado/caducado se trata como no pendiente.

## Restart, expiración y concurrencia

- Un nuevo proceso puede abrir el mismo store, leer la decisión y responder a un server request reemitido sin pedir de nuevo ni duplicar el journal.
- Una espera abortada queda `cancelled`; una approval sin decisión queda `expired` tras cinco minutos.
- Cada waiter y record tienen su propio lock. Una approval pendiente no retiene un mutex global ni impide resolver approvals de otros turns o usuarios.
- Los directorios de usuario deben existir con modo privado. Symlinks, hardlinks, permisos inseguros, records corruptos o storage inaccesible fallan cerrado.

## Límite temporal del adapter legacy

El store permite esperas concurrentes e independientes, pero la ruta `codex-app-server.ts` todavía usa el adapter legacy `stdio`, con un handler activo y cola por pool. Esa cola puede serializar turns que compartan el mismo proceso mientras una approval está pendiente. El aislamiento/concurrencia completo de ejecución requiere que la ruta de chat use `WorkerRuntimeRegistry` y el gateway `AppServerTransport`, que enrutan eventos y server requests por usuario/thread/turn/item. El store durable queda preparado para ese adapter y no debe sustituirse por estado en memoria durante la migración.

## Pruebas

```bash
npx vitest run src/runtime/approval-store.test.ts
npx eslint src/runtime/approval-store.ts src/runtime/approval-store.test.ts
npm run typecheck
```

Las pruebas cubren restart/replay, idempotencia, conflicto de decisión, aislamiento cruzado por usuario/thread/turn/item, dos esperas simultáneas, expiración, abort y sustitución por symlink.
