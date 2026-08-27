# Publicador documental server-side

## Alcance

`FileDocumentPublisher` es la única capacidad de esta base de código que conoce
`publishWriteRoot`. Convierte un fichero ya preparado en el staging privado de
un usuario en una publicación confirmada, versionada, atómica y auditable.

El publicador no es un editor ni un renderizador. La generación de Office/PDF y
sus previews ocurre antes. Las routes server-side resuelven `PERMISSIONS.md`,
autentican la sesión y autorizan el target antes de llamar al servicio.

Archivos de implementación:

- `src/documents/publication-contract.ts`: contratos file-backed con
  `schemaVersion: 1` y validación estricta.
- `src/documents/document-publisher.ts`: capability server-side, lifecycle,
  locks, publicación, recuperación y auditoría.
- `src/documents/document-publisher.test.ts`: aceptación local sintética.

## Frontera de seguridad

El constructor se vincula a una instalación y un usuario concretos. Recibe tres
raíces absolutas y no solapadas:

- `stagingRoot`: copia privada del usuario, legible por el publicador.
- `stateRoot`: snapshots, operaciones, receipts, versiones y journal.
- `publishWriteRoot`: repositorio documental oficial, escribible solo por el
  proceso server-side.

`publishWriteRoot` es un campo privado de JavaScript y se omite de todos los
resultados y eventos. El constructor exige además `workerVisibleRoots` y falla
si cualquiera contiene o está contenido por `publishWriteRoot`. Esta
comprobación evita una composición insegura, pero no sustituye el aislamiento
del sistema operativo: Compose/systemd debe montar `publishWriteRoot` solo en
la web/publicador y nunca en workers, browser, viewer ni App Server.

El worker recibe `source-ro`, el workspace del proyecto y únicamente
`staging/tmp` como temporal privado. Los uploads staged permanecen visibles
solo para el servidor: antes de iniciar el turn, este verifica usuario, thread,
hash y preview, extrae texto acotado y entrega contenido preparado en el
payload App Server. No se envía ningún path staged a Codex. El worker tampoco
recibe una ruta, variable de entorno, descriptor, socket delegado ni volumen
con acceso a `publish-rw`.

## Lifecycle durable

1. `freezeCandidate` valida UUIDs, rutas normalizadas, preview `ready`,
   pertenencia thread/turn y hash SHA-256.
2. Copia los bytes desde staging a un snapshot inmutable bajo `stateRoot`.
3. Captura `exists + size + sha256 + mtimeMs` del original oficial.
4. Persiste `awaiting_confirmation`, un receipt idempotente y un evento
   `frozen`.
5. Devuelve el registro público y un token HMAC con expiración. Solo el hash del
   token queda en disco.
6. `decline` consume el token/request y pasa a `declined`; no crea versión ni
   toca el target.
7. `confirm` pasa primero a `publishing`, vuelve a comprobar el original, crea
   una versión recuperable si existía y escribe mediante
   temp + fsync + rename + fsync del directorio.
8. Verifica los bytes publicados, añade el evento `published` y por último
   persiste `published`.

Estados válidos:

```text
awaiting_confirmation -> declined
awaiting_confirmation -> publishing -> published
awaiting_confirmation -> publishing -> conflict
```

`publishing` es deliberadamente durable. Si el proceso cae después del rename
pero antes de marcar éxito, la misma confirmación detecta el hash ya publicado,
verifica la versión anterior, añade como máximo un evento y finaliza con
`recoveredAfterInterruption: true`.

## Contrato mínimo

### Congelar candidato

```ts
const frozen = await publisher.freezeCandidate({
  operationId,
  clientRequestId,
  threadId,
  turnId,
  candidateRelativePath: "threads/<thread>/uploads/<upload>/report.docx",
  targetRelativePath: "projects/acme/report.docx",
  preview: {
    schemaVersion: 1,
    previewId,
    threadId,
    turnId,
    candidateSha256,
    status: "ready",
    artifacts: ["preview.pdf", "page-1.png"],
    createdAt,
  },
});
```

El preview es una atestación server-side de que existe una representación lista
para revisión. Una lista de artefactos vacía, un hash diferente o un thread/turn
distinto falla cerrado.

### Confirmar o rechazar

```ts
await publisher.confirm({
  operationId,
  clientRequestId: confirmRequestId,
  threadId,
  turnId,
  confirmationToken: frozen.confirmationToken,
});

await publisher.decline({
  operationId,
  clientRequestId: declineRequestId,
  threadId,
  turnId,
  confirmationToken: frozen.confirmationToken,
});
```

Una repetición exacta devuelve el mismo estado. Reutilizar un
`clientRequestId` con otra operación/acción, cambiar thread/turn o intentar una
segunda decisión distinta es un conflicto. El token no permite publicar otro
candidato ni otro destino porque su HMAC incluye instalación, usuario, thread,
turn, operación y expiración.

## Persistencia y auditoría

Layout interno v1:

```text
stateRoot/
  operations/<userId>/<operationId>.json
  requests/<userId>/{freeze|decision}-<requestHash>.json
  candidates/<userId>/<threadId>/<operationId>/candidate.<ext>
  versions/<userId>/<operationId>/original.<ext>
  audit/<installationId>/publication.jsonl
```

Los JSON pasan por schemas estrictos y escrituras atómicas. El journal es
append-only, secuenciado, fsync y deduplica por `auditKey`. Los eventos incluyen
identidad de instalación/usuario/thread/turn, hashes de target/candidato/
original/resultado, request hash y recovery flag. No guardan contenido, token,
secret, raíz de publicación ni target en claro.

`readRecoveryVersion` devuelve la versión anterior solo tras volver a validar
su tamaño y SHA-256. La restauración al repositorio oficial debe ser otra
operación explícita y autorizada; este módulo no restaura automáticamente.

## Conflictos, locks y filesystem

- Existe un lock por operación, uno por receipt y uno por target lógico. El
  lock de target vive en
  `<dataRoot>/locks/document-publication-targets`, compartido físicamente por
  todos los publicadores de la instalación; nunca bajo el estado privado de un
  usuario.
- Dos operaciones que parten del mismo original pueden congelarse, pero solo
  una puede publicar. La segunda observa el cambio y termina en `conflict`.
- El original se comprueba al confirmar, antes de crear/escribir y de nuevo
  cuando el temporal ya está sincronizado, justo antes del rename.
- Rutas absolutas, `..`, segmentos vacíos, backslashes, caracteres de control,
  symlinks y targets no regulares se rechazan.
- Los directorios oficiales deben existir. El publicador no crea libremente una
  jerarquía dentro del repositorio documental.
- Candidato, snapshot y versión se abren dentro de sus raíces con protección
  `O_NOFOLLOW` cuando el sistema la ofrece.

## Integración server-side

Las routes implementadas siguen este orden:

1. validar sesión local, Origin/CSRF y scope de instalación/usuario;
2. resolver permisos server-side y comprobar autorización sobre el target;
3. comprobar que el preview pertenece al turn y candidato reales;
4. construir/obtener el publicador vinculado al usuario;
5. devolver solo `PublicationOperation` y, únicamente al congelar, el token;
6. registrar el fingerprint de permisos del turn junto a la auditoría superior.

No aceptan una raíz del navegador, del worker ni del request. Las raíces y
el secret provienen exclusivamente de `InstallationConfig`/secret store del
servidor. El secret debe permanecer estable durante la vida de confirmaciones
pendientes; su rotación necesita drenar o invalidar explícitamente esas
operaciones.

## Validación reproducible

```bash
npx vitest run src/documents/document-publisher.test.ts
npx eslint src/documents/publication-contract.ts src/documents/document-publisher.ts src/documents/document-publisher.test.ts --max-warnings=0
npm run typecheck
```

La prueba focalizada cubre preview obligatorio, snapshot inmutable, rechazo sin
publicar, confirmación exactamente una vez, idempotencia, versión recuperable,
conflicto del original, crash/restart, aislamiento usuario/thread, publicación
concurrente entre dos usuarios sobre un mismo target físico, traversal,
symlinks y frontera worker/publish.

Las pruebas usan únicamente directorios temporales locales y datos sintéticos.
No simulan ni afirman haber validado un NAS. Quedan como validaciones de
infraestructura la matriz real de mounts/UIDs, el filesystem del servidor QA,
backup/restore de `stateRoot + publishWriteRoot` y un ensayo de corte de proceso
en contenedor.

Routes disponibles:

- `POST /api/threads/:threadId/documents`
- `GET /api/threads/:threadId/documents/:uploadId/preview/:fileName`
- `POST /api/threads/:threadId/publications`
- `POST /api/threads/:threadId/publications/:operationId`

La congelación y la confirmación requieren la regla efectiva
`documents.publish | publish | allow`; una regla publish denegada cierra el
flujo. El rechazo de una operación ya congelada permanece disponible para que
un cambio posterior de permisos no obligue a dejarla pendiente.
