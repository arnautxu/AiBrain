# Contrato UI ↔ backend de AiBrain

Estado verificado: rama `codex/aibrain-backend-definitivo`, implementación observada el 27-08-2026. Este documento describe las rutas, validadores y tipos que existen en el repositorio. No convierte stores internos en APIs públicas ni promete endpoints futuros.

Contrato ejecutable V1: `contracts/aibrain/v1/ui-backend.schema.json` contiene los JSON Schemas y ejemplos compilables; `contracts/aibrain/v1/http-routes.json` inventaría cada método y ruta pública. `npm run test:contract` exige paridad exacta con los handlers de Next, valida los ejemplos y fixtures TypeScript y las pruebas E2E validan respuestas reales de sesión, workbench y runtime contra esos schemas. Este Markdown es la guía humana complementaria.

## 1. Convenciones de transporte y seguridad

- Todas las rutas de producto se ejecutan en Node.js y usan la cookie de sesión; la UI no envía tokens de Supabase ni credenciales de Codex.
- Las mutaciones exigen mismo origen. El backend compara `Origin` con `InstallationConfig.publicUrl`; si no hay `Origin`, usa `Sec-Fetch-Site: same-origin`. La excepción sin esas cabeceras solo existe fuera de producción.
- La respuesta de error HTTP estable es, como mínimo, `{ "error": string }`. Algunas rutas retiradas añaden `code`.
- Los `GET` que contienen estado privado usan `Cache-Control: no-store` o `private, no-store`.
- Los identificadores de proyecto, thread, mensaje, upload, operación y turn creados por la UI son UUID. `clientRequestId` es UUID en controles de turn y un identificador opaco seguro en publicación.
- El App Server no se expone al navegador. `/api/chat` traduce su transporte WebSocket privado per-user a NDJSON HTTP autenticado.
- No enviar campos adicionales a contratos marcados como estrictos: controles de turn y publicación los rechazan.

Ejemplo de error:

```json
{
  "error": "No autenticat."
}
```

## 2. Resumen de superficies públicas

| Método | Ruta | Contrato actual |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Login demo o intercambio Supabase → sesión local opaca |
| `GET` | `/api/auth/session` | Sesión actual |
| `POST` | `/api/auth/logout` | Revoca sesión local y cookies |
| `POST` | `/api/auth/password/change-initial` | Cambio inicial mediante challenge en cookie |
| `POST` | `/api/auth/password/reset/request` | Solicitud de recuperación, respuesta no enumerable |
| `POST` | `/api/auth/password/recovery` | Completa recuperación y crea sesión local |
| `GET`, `POST` | `/api/memory` | Lista o crea memoria explícita privada del empleado |
| `POST` | `/api/memory/{memoryId}/revoke` | Revoca memoria explícita con trazabilidad |
| `GET` | `/api/workbench` | Snapshot completo de proyectos y threads |
| `GET`, `POST` | `/api/projects` | Lista/búsqueda y creación |
| `GET`, `PATCH` | `/api/projects/{projectId}` | Lectura, renombrado, pin y archivo/restauración |
| `GET`, `POST` | `/api/projects/{projectId}/threads` | Lista y creación de threads del proyecto |
| `GET` | `/api/threads` | Lista/búsqueda global de threads |
| `GET`, `PATCH` | `/api/threads/{threadId}` | Lectura, renombrado, pin y archivo/restauración |
| `GET`, `PATCH` | `/api/task-center` | Historial derivado de turns, lectura y preferencias de avisos |
| `POST` | `/api/chat` | Turn persistente y stream NDJSON |
| `POST` | `/api/runtime/turns/control` | Steering o stop idempotente |
| `POST` | `/api/runtime/approvals` | Resolución durable de aprobación |
| `GET` | `/api/runtime/status?projectId={uuid}` | Estado, modelos, skills y capacidades del worker |
| `GET`, `PATCH` | `/api/settings` | Cuenta, apps reales, permisos, privacidad, red y preferencias persistentes |
| `POST` | `/api/threads/{threadId}/messages/{messageId}/result` | Estado de revisión/reversión del resultado |
| `GET` | `/api/projects/{projectId}/artifacts/{artifactId}` | Artefacto de imagen generado |
| `GET` | `/api/projects/{projectId}/files?path={path}` | Vista autenticada del archivo actual del workspace |
| `POST` | `/api/threads/{threadId}/documents` | Upload seguro, staging y preview |
| `GET` | `/api/threads/{threadId}/documents/{uploadId}/preview/{fileName}` | Fichero privado de preview |
| `POST` | `/api/threads/{threadId}/publications` | Congela un candidato para confirmación |
| `POST` | `/api/threads/{threadId}/publications/{operationId}` | Confirma o rechaza publicación |
| `GET`, `POST` | `/api/runtime/browser` | Estado y lifecycle del browser privado del usuario |
| `POST` | `/api/runtime/browser/token` | Token corto y ligado a sesión para el viewer |
| `GET` | `/api/runtime/browser/viewer/frame` | Frame PNG privado |
| `POST` | `/api/runtime/browser/viewer/input` | Navegación y input durante takeover humano |
| `GET` | `/api/health/live` | Liveness del proceso, sin autenticación |
| `GET` | `/api/health/ready` | Readiness de roots, capacidad y aislamiento del host |

No existe hoy una ruta HTTP pública de branding. Browser/Computer Use sí tiene un contrato de viewer privado y acotado; las capacidades y límites exactos están en la sección 14.

## 3. Auth y sesión

### 3.1 Tipo de sesión

```ts
type AuthSession = {
  provider: "demo" | "local";
  user: {
    id: string;       // UUID
    name: string;
    email: string;
  };
  tenant: {
    id: string;       // installationId en sesión local
    name: string;
  };
  expiresAt: string;  // ISO-8601; vencimiento idle visible
};
```

En producción con Supabase Auth, un login correcto emite una sesión file-backed y el `provider` que la UI lee es `local`. Los access/refresh tokens del proveedor no se guardan en el navegador ni se usan para persistencia de producto.

### 3.2 Login

`POST /api/auth/login`

Modo Supabase configurado:

```json
{
  "email": "employee@example.com",
  "password": "temporary-or-current-password"
}
```

Resultado normal `200`:

```json
{ "authenticated": true }
```

Si el usuario tiene el marcador de cambio inicial, el backend guarda el challenge en una cookie HttpOnly y responde:

```json
{
  "passwordChangeRequired": true,
  "expiresAt": "2026-08-27T12:10:00.000Z"
}
```

Modo demo, disponible solo bajo las condiciones de desarrollo/preview del backend:

```json
{ "userId": "demo-user-id" }
```

Su respuesta es `{ "session": AuthSession }`. La UI no debe asumir esta forma en producción.

Errores relevantes: `400` input inválido, `401` credenciales incorrectas,
`403` origen o usuario demo no autorizado, `429` límite temporal con
`Retry-After`, y `503` proveedor o rate limiter no disponible. Login se limita
por cliente y email (30/cliente y 10/email cada 15 minutos).

### 3.3 Cambio inicial y recuperación

`POST /api/auth/password/change-initial`

```json
{
  "password": "Permanent-pass-456",
  "confirmation": "Permanent-pass-456"
}
```

La contraseña debe tener 12–128 caracteres, al menos una letra y un número. Éxito: `{ "authenticated": true }`. Un challenge ausente/caducado responde `401`.

`POST /api/auth/password/reset/request`

```json
{ "email": "employee@example.com" }
```

Respuesta siempre no enumerable: `202 { "accepted": true }`, tanto si la
cuenta existe como si no, si el proveedor está inaccesible o si se alcanzó el
límite (10/cliente y 3/email por hora). No incluye `Retry-After` ni revela qué
componente rechazó la operación.

`POST /api/auth/password/recovery`

Debe incluir exactamente una prueba, `code` o `tokenHash`, además de las contraseñas:

```json
{
  "tokenHash": "provider-recovery-proof",
  "password": "Recovered-pass-789",
  "confirmation": "Recovered-pass-789"
}
```

Éxito: `{ "authenticated": true }`; `400` contrato/password inválido, `401`
prueba inválida/caducada, `429` límite por cliente+prueba con `Retry-After`, y
`503` proveedor o limiter inaccesible. Cambio inicial y recovery se limitan
antes de consumir el challenge/code/token.

### 3.4 Lectura y cierre

`GET /api/auth/session` → `200 { "session": AuthSession }` o `401 { "error": "No autenticat." }`.

`POST /api/auth/logout` → `200 { "ok": true }`. El backend elimina el registro local de sesión, el challenge si existe y las cookies.

Cookies de producción:

- `__Host-aibrain-session` y `__Host-aibrain-auth-challenge`;
- `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, prioridad alta;
- sesión: 7 días de inactividad, renovación de actividad cada 24 horas y máximo absoluto de 30 días.

Una sesión local ya emitida sigue funcionando si Supabase queda temporalmente inaccesible. Nuevos logins, cambios de contraseña y recuperaciones sí pueden devolver `503`.

## 4. Instalación y branding

### 4.1 Configuración server-side

El servidor carga un único `InstallationConfig` versionado:

```ts
type InstallationConfig = {
  schemaVersion: 1;
  installationId: string;
  companyName: string;
  companySlug: string;
  publicUrl: string;
  branding: {
    productName: string;
    logoPath: string;
    faviconPath: string;
    accentColor: string; // #RRGGBB
  };
  paths: {
    dataRoot: string;
    companyContextRoot: string;
    usersRoot: string;
    sourceReadRoot: string;
    publishWriteRoot: string;
    backupsRoot: string;
  };
};
```

Las rutas filesystem nunca se entregan a la UI. `installationId`, company y branding se proyectan como:

```ts
type PublicInstallationBranding = {
  installationId: string;
  companyName: string;
  companySlug: string;
  publicUrl: string;
  productName: string;
  logoPath: string;
  faviconPath: string;
  accentColor: string;
};
```

### 4.2 Límite público actual

**No hay endpoint JSON de branding.** Next.js carga esta proyección server-side y la pasa como props a login y recovery. El workbench recibe un `BrainManifest` renderizado en servidor cuyo `identity.productName` y color de accent se sobrescriben con el branding exacto de instalación. Metadata, favicon y título también se generan server-side.

La rama UI debe conservar ese límite o acordar una ruta nueva antes de intentar `fetch('/api/installation')`; esa ruta no existe.

No existe todavía un control plane remoto de onboarding o invitaciones. La identidad local provisionada y `PERMISSIONS.md` siguen siendo las únicas fuentes server-side de autorización efectiva. Los miembros guardados en un proyecto son metadatos locales explícitos: no crean cuentas, no envían correo y no amplían permisos del runtime. El workbench recibe también `logoPath`, por lo que login y aplicación muestran la marca de la instalación sin una rama por empresa.

## 5. Proyectos y threads

### 5.1 Tipos

```ts
type WorkbenchWorkspace = {
  id: string; // UUID
  label: string;
  hostType: "managed";
  status: "ready" | "pending" | "unavailable";
  isPrimary: boolean;
};

type ProjectSource = {
  id: string;
  kind: "file" | "link" | "note";
  name: string;
  url: string | null;
  mimeType: string | null;
  size: number | null;
  excerpt: string | null; // texto persistido, máximo 32.000
  status: "ready" | "pending-index";
  createdAt: string;
};

type ProjectMember = {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "editor" | "viewer";
  status: "active" | "invited-local";
  addedAt: string;
};

type WorkbenchProject = {
  id: string;
  name: string;       // 1–80 caracteres no vacíos
  slug: string;
  status: "active" | "archived";
  pinned: boolean;
  instructions: string; // máximo 16.000; se inyecta como instrucción persistente
  sources: ProjectSource[]; // máximo 100
  memory: { enabled: boolean; notes: string; updatedAt: string | null };
  sharing: {
    visibility: "private" | "shared";
    members: ProjectMember[]; // acceso declarado local, no invitación remota
  };
  workspace: WorkbenchWorkspace;
  createdAt: string;
  updatedAt: string;
};

type WorkbenchThread = {
  id: string;
  projectId: string;
  title: string;      // 1–120 caracteres no vacíos
  status: "active" | "archived";
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

type WorkbenchThreadSummary = Omit<WorkbenchThread, "messages"> & {
  messageCount: number;
  lastMessageAt: string | null;
};
```

### 5.2 Listas, búsqueda y paginación

Rutas:

- `GET /api/projects`
- `GET /api/threads`
- `GET /api/projects/{projectId}/threads`

Query compartida:

```text
status=active|archived|all  // default active
limit=1..50                // default 20
q=<texto>                  // trim, 1..100
cursor=<base64url opaco>   // 1..256
```

No se permiten parámetros desconocidos, repetidos ni formatos como `limit=01`.

Respuesta de proyectos:

```json
{
  "projects": [
    {
      "id": "0198b9f0-6631-7000-8000-000000000301",
      "name": "Private Operations",
      "slug": "private-operations",
      "status": "active",
      "pinned": false,
      "workspace": {
        "id": "0198b9f0-6631-7000-8000-000000000311",
        "label": "Private Operations",
        "hostType": "managed",
        "status": "ready",
        "isPrimary": true
      },
      "createdAt": "2026-08-27T10:00:00.000Z",
      "updatedAt": "2026-08-27T10:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

Threads listados usan `WorkbenchThreadSummary` y la clave `threads`.

### 5.3 Crear, leer, renombrar, fijar, archivar y restaurar

`POST /api/projects`

```json
{ "name": "Private Operations" }
```

→ `201 { "project": WorkbenchProject }`.

`GET /api/projects/{projectId}` → `{ "project": WorkbenchProject }`.

`PATCH /api/projects/{projectId}` acepta uno o varios de `name`, `pinned`, `status`, `instructions`, `sources`, `memory` y `sharing`:

```json
{
  "name": "Renamed Operations",
  "pinned": true,
  "status": "active",
  "instructions": "Responde en español y cita las fuentes del proyecto.",
  "memory": { "enabled": true, "notes": "El cliente prefiere entregas los viernes.", "updatedAt": "2026-08-28T09:00:00.000Z" },
  "sharing": { "visibility": "private", "members": [] }
}
```

→ `{ "project": WorkbenchProject }`. Restaurar equivale a `PATCH { "status": "active" }`.

`POST /api/projects/{projectId}/threads`

```json
{ "title": "Confidential planning" }
```

→ `201 { "thread": WorkbenchThread }`.

`GET /api/threads/{threadId}` → `{ "thread": WorkbenchThread }` con todos los mensajes.

`PATCH /api/threads/{threadId}` acepta `title`, `pinned` y/o `status`, con las mismas reglas que project. No existe borrado HTTP; archivo/restauración es el lifecycle soportado.

Los recursos se resuelven por el usuario de sesión. Un ID válido de otro usuario se presenta como `404`, no como recurso global.

### 5.4 Snapshot inicial

`GET /api/workbench`:

```ts
type WorkbenchSnapshot = {
  persistence: "filesystem" | "filesystem-demo" | "browser-preview";
  projects: WorkbenchProject[];
  threads: WorkbenchThread[];
};
```

Respuesta: `{ "workbench": WorkbenchSnapshot }`. Para una sesión local real la persistencia es `filesystem`. Supabase no es un valor válido de persistencia: participa únicamente durante los flujos de identidad anteriores a la emisión de la sesión local.

### 5.5 Centro de tareas

`GET /api/task-center` reconstruye el historial desde los mensajes durables del usuario y devuelve estados `running`, `needs_attention`, `completed` o `failed`, junto con `readTaskIds`, preferencias de avisos y `continuity: "worker_required"`. La última señal impide que la UI prometa ejecución cloud si el servidor o el worker no están activos.

`PATCH /api/task-center` marca ids como leídos o guarda las preferencias `inApp` y `desktop`. El backend persiste ese estado dentro de la raíz del usuario autenticado; no acepta tenant ni user en el body. Los avisos Web requieren además permiso explícito en el navegador y nunca se solicitan al cargar la página. Véase [`TASK_CENTER.md`](TASK_CENTER.md).

## 6. Mensajes, turns y streaming

### 6.1 Modelo persistido

```ts
type TurnSource = {
  id: string;
  kind: "web" | "file" | "app";
  title: string;
  url: string | null;         // solo HTTP(S) entregado por el runtime
  domain: string | null;
  snippet: string | null;
  publishedAt: string | null; // ISO-8601 cuando existe en metadatos
};

type ToolResult = {
  id: string;
  kind: "command" | "file" | "web" | "app" | "browser";
  title: string;
  status: "running" | "complete" | "failed" | "stopped";
  summary: string | null;
  output: string | null;      // salida real acotada; nunca texto inferido del asistente
  sourceIds: string[];
  createdAt: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "complete" | "streaming" | "error" | "stopped";
  activity: ActivityItem[];
  plan: PlanStep[];
  approvals: ApprovalItem[];
  diff: string;
  attachments: ChatAttachment[];
  artifacts: GeneratedArtifact[];
  sources?: TurnSource[];     // opcional solo para leer mensajes V1 previos
  toolResults?: ToolResult[]; // opcional solo para leer mensajes V1 previos
};
```

Las fuentes se proyectan únicamente desde URLs o archivos presentes en los metadatos del runtime, la búsqueda web, una app/MCP o los adjuntos del turno. Un resultado sin URL no se transforma en cita. Los tool results conservan salida y estado por separado de `activity`, de modo que siguen siendo revisables tras refresh.

### 6.2 Iniciar o reanudar un turn

`POST /api/chat`

```ts
type ChatRequest = {
  projectId: string;          // UUID
  threadId: string;           // UUID activo y del project
  userMessageId: string;      // UUID generado por cliente
  assistantMessageId: string; // UUID generado por cliente
  message: string;            // no vacío tras trim
  displayMessage?: string;    // máximo 500; solo representación persistida
  preferences: {
    tone: "direct" | "balanced" | "detailed";
    language: "ca" | "es" | "en";
    showActivity: boolean;
  };
  options: {
    mode: "agent" | "plan" | "ask";
    model: string | null;      // máximo 100
    effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | null;
    webSearch: boolean;
    imageGeneration: boolean;
    skill: string | null;      // máximo 100
    attachments: ChatInputAttachment[];
    documentUploadIds?: string[]; // máximo 10 UUID ya staged en este thread
  };
};
```

Ejemplo:

```json
{
  "projectId": "0198b9f0-6631-7000-8000-000000000301",
  "threadId": "0198b9f0-6631-7000-8000-000000000302",
  "userMessageId": "0198b9f0-6631-7000-8000-000000000303",
  "assistantMessageId": "0198b9f0-6631-7000-8000-000000000304",
  "message": "Revisa el contrato y resume los riesgos.",
  "preferences": { "tone": "direct", "language": "es", "showActivity": true },
  "options": {
    "mode": "agent",
    "model": null,
    "effort": "medium",
    "webSearch": false,
    "imageGeneration": false,
    "skill": null,
    "attachments": [],
    "documentUploadIds": ["0198b9f0-6631-7000-8000-000000000511"]
  }
}
```

La respuesta correcta es `application/x-ndjson; charset=utf-8`: un JSON por línea, no SSE.

```text
{"type":"activity","item":{"id":"codex-connected","kind":"system","label":"Codex connectat","detail":"Sessió dedicada verificada","status":"complete"}}
{"type":"delta","value":"He revisado "}
{"type":"delta","value":"el contrato."}
{"type":"done"}
```

### 6.3 Eventos y reducción en UI

```ts
type ChatStreamEvent =
  | { type: "snapshot"; message: ChatMessage }
  | { type: "content"; value: string }
  | { type: "delta"; value: string }
  | { type: "activity"; item: ActivityItem }
  | { type: "plan"; explanation: string | null; steps: PlanStep[] }
  | { type: "approval"; item: ApprovalItem }
  | { type: "diff"; value: string }
  | { type: "artifact"; item: GeneratedArtifact }
  | { type: "source"; item: TurnSource }
  | { type: "toolResult"; item: ToolResult }
  | { type: "done" }
  | { type: "stopped" }
  | { type: "error"; message: string };
```

Reglas del reducer actual:

- `snapshot` reemplaza el mensaje completo;
- `content` reemplaza `content`; `delta` concatena;
- `activity` y `approval` hacen upsert por `item.id`;
- `plan` reemplaza `message.plan` con `steps`; `explanation` no se persiste en `ChatMessage`;
- `diff` reemplaza el diff completo;
- `artifact` añade el elemento;
- `source` y `toolResult` hacen upsert por `item.id`; cada `toolResult.sourceIds` solo referencia fuentes observadas en el mismo turn;
- `done`, `stopped`, `error` cambian el estado terminal.

### 6.4 Idempotencia, refresh y recuperación

La identidad idempotente del turn es el par persistido `userMessageId + assistantMessageId` dentro del thread.

- Reenviar la misma petición con el mismo contenido/adjuntos devuelve el resultado existente.
- Si ya terminó, la respuesta contiene un único evento `snapshot` y la cabecera `X-AiBrain-Idempotent-Replay: true`.
- Si sigue activo en el worker, la respuesta empieza con `snapshot` y sigue las proyecciones durables hasta estado terminal, también con esa cabecera.
- Reutilizar IDs con contenido distinto responde `409`.
- Solo puede existir un assistant `streaming` por thread; otros threads y usuarios siguen siendo independientes.

La UI debe conservar los cuatro UUID del request hasta obtener un estado terminal. Un corte de red se recupera repitiendo el mismo body, no generando nuevos IDs.

### 6.5 Steering y stop

`POST /api/runtime/turns/control`

Stop:

```json
{
  "action": "stop",
  "threadId": "0198b9f0-6631-7000-8000-000000000302",
  "assistantMessageId": "0198b9f0-6631-7000-8000-000000000304",
  "clientRequestId": "0198b9f0-6631-7000-8000-000000000305"
}
```

Steer:

```json
{
  "action": "steer",
  "threadId": "0198b9f0-6631-7000-8000-000000000302",
  "assistantMessageId": "0198b9f0-6631-7000-8000-000000000304",
  "clientRequestId": "0198b9f0-6631-7000-8000-000000000306",
  "userMessageId": "0198b9f0-6631-7000-8000-000000000307",
  "message": "Incluye también los riesgos operativos."
}
```

`message` de steer admite hasta 32.000 caracteres. La UI nunca envía IDs de App Server; el backend los resuelve desde la proyección privada.

Respuesta:

```json
{ "ok": true, "action": "steer", "idempotent": false }
```

Repetir el mismo `clientRequestId` después de que su actividad durable exista cambia `idempotent` a `true` y no reenvía el control. `409` indica turn terminal/no controlable/continuidad cambiada; `502` indica una respuesta incoherente del App Server.

## 7. Plan, actividad, tools y estado del runtime

### 7.1 Plan y actividad

```ts
type PlanStep = {
  step: string;
  status: "pending" | "in_progress" | "completed";
};

type ActivityItem = {
  id: string;
  kind: "system" | "reasoning" | "plan" | "command" | "file" | "tool" | "web" | "agent";
  label: string;
  detail?: string;
  output?: string;
  status: "pending" | "running" | "waiting" | "complete" | "failed" | "stopped";
};
```

La actividad de comandos puede actualizar `output` incrementalmente, pero cada evento contiene el snapshot acumulado del item. El tipo `tool` es actividad observable, no un endpoint de invocación arbitraria. El worker registra además un namespace cerrado `browser` en cada thread nuevo; solo Codex App Server puede invocarlo y la UI lo observa mediante actividad/approvals del mismo stream.

### 7.2 Estado, modelos, skills y capacidades

`GET /api/runtime/status?projectId={uuid}`. `projectId` es opcional; si se proporciona debe resolver a un proyecto del usuario.

```ts
type RuntimeStatus = {
  tenantId: string;
  projectId: string | null;
  projectName: string;
  mode: "demo" | "codex";
  codex: "checking" | "connected" | "unavailable" | "disabled";
  isolated: boolean;
  ready: boolean;
  authMode: "chatgpt" | "apiKey" | "amazonBedrock" | null;
  planType: string | null;
  processWarm: boolean;
  rateLimit: {
    usedPercent: number;
    windowDurationMins: number | null;
    resetsAt: number | null;
  } | null;
  usage: {
    lifetimeTokens: number | null;
    currentStreakDays: number | null;
    longestRunningTurnSec: number | null;
  } | null;
  workspaceName: string;
  model: string | null;
  approvalPolicy: "never" | "on-request";
  sandbox: "read-only" | "workspace-write";
  models: Array<{
    id: string;
    label: string;
    description: string;
    isDefault: boolean;
    inputModalities: Array<"text" | "image" | "audio">;
    supportedReasoningEfforts: Array<"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra">;
    defaultReasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | null;
    supportsPersonality: boolean;
  }>;
  skills: Array<{ id: string; label: string; description: string }>;
  capabilities: {
    webSearch: boolean;
    imageInput: boolean;
    imageGeneration: boolean;
  };
};
```

Ejemplo degradado válido con HTTP `200`:

```json
{
  "tenantId": "example-lab-dev",
  "projectId": null,
  "projectName": "Example Lab",
  "mode": "codex",
  "codex": "unavailable",
  "isolated": true,
  "ready": false,
  "authMode": null,
  "planType": null,
  "processWarm": false,
  "rateLimit": null,
  "usage": null,
  "workspaceName": "Example Lab / default",
  "model": null,
  "approvalPolicy": "on-request",
  "sandbox": "workspace-write",
  "models": [],
  "skills": [],
  "capabilities": { "webSearch": false, "imageInput": false, "imageGeneration": false }
}
```

La UI debe habilitar selección/invocación según `models`, `skills` y `capabilities` de esta respuesta, no según el manifest visual.

### 7.3 Superficies no publicadas

AiBrain no envía invitaciones ni publica un control plane remoto. El panel de proyecto persiste miembros locales; cuando el correo coincide con una persona provisionada y habilitada de la misma instalación, el backend activa la visibilidad compartida según `viewer` o `editor`. Un correo sin identidad local sigue como `invited-local`, no obtiene acceso y la UI debe explicar que no se ha enviado nada. La autorización efectiva siempre se resuelve en servidor.

Las automatizaciones programadas son locales y explícitas: `/api/automations` administra tareas privadas del empleado y el runner documentado en `docs/AUTOMATIONS.md` ejecuta sus prompts únicamente mientras ese proceso está vivo. La API y la UI muestran la señal real del worker; no prometen ejecución cloud, no envían mensajes externos por sí solas y conservan las aprobaciones normales del runtime.

### Centro de administración del workspace

`GET /api/admin` exige una sesión local del mismo tenant y un rol persistido con `canManageWorkspace=true`. Devuelve personas, estado observado de workers, uso interno, roles, grupos, políticas y los últimos eventos de auditoría. Nunca inicia un worker para calcular su estado.

`PATCH /api/admin` exige además mismo origen. Admite comandos estrictos para cambiar rol/estado de una persona, crear/actualizar/eliminar grupos y provisionar un perfil local. Las políticas de rol y grupo cubren apps (`web-search`, `image-generation`, `skills`, `managed-browser`) y capacidades (`consult`, `respond`, `execute`, `publish`); un bloqueo de cualquier grupo prevalece. Los cambios se persisten por instalación y se registran con actor, destino, acción y fecha.

`provision-local-member` reutiliza `UserProvisioner`: crea perfil, worker y workspace locales para un UUID que ya debe existir en el proveedor de identidad. La respuesta declara `emailSent:false` e `identityCreated:false`. AiBrain no finge una invitación, un alta de IdP ni un correo enviado.

## 8. Approvals

```ts
type ApprovalItem = {
  id: string;
  threadId: string;
  turnId: string;
  itemId: string;
  kind: "command" | "file" | "browser";
  title: string;
  detail: string;
  command?: string;
  cwd?: string;
  permissionFingerprint?: string; // SHA-256 hex
  status: "pending" | "accepted" | "accepted_session" | "declined";
};
```

Los items llegan en el stream como `{ "type": "approval", "item": ApprovalItem }`. Resolver con `POST /api/runtime/approvals`:

```json
{
  "approvalId": "approval-runtime-id",
  "threadId": "runtime-thread-id",
  "turnId": "runtime-turn-id",
  "itemId": "runtime-item-id",
  "decision": "accept"
}
```

`decision` admite `accept`, `acceptForSession` o `decline`. Los cuatro IDs son opacos y deben copiarse literalmente del evento; no deben reconstruirse.

Éxito y replay de la misma decisión:

```json
{ "ok": true, "status": "resolved" }
```

Una aprobación ya no pendiente devuelve `404`; una decisión distinta concurrente puede devolver `409`; indisponibilidad del store, `503`. La espera de una aprobación pertenece solo a su turn y no bloquea otros turns. El backend persiste el record pendiente antes de emitirlo, por lo que una resolución inmediata de UI no puede adelantarse al store.

Las solicitudes genéricas de comando, cambio de fichero o ampliación de
permisos solo pueden crear un pendiente cuando el snapshot inmutable del turn
contiene `tools.execute | execute | allow`. Ausencia o `deny` se rechaza
server-side antes del store; la UI puede observar el item ya `declined`, pero no
puede convertir esa denegación de `PERMISSIONS.md` en una concesión humana.

Todas las interacciones (`open`, `scroll`, `click`, `type`) se ligan a evidencia
server-side del destino y al fingerprint de `PERMISSIONS.md`, pero solo las que
pueden enviar, publicar, comprar/pagar, borrar, cambiar cuenta o datos, o exponer
credenciales/pago generan una approval `kind: "browser"`. `read`, `screenshot`,
`tabs` y `downloads` son solo lectura, pero siguen necesitando permiso
server-side. El resultado se
deduplica por call: un replay completado devuelve el mismo resultado y una
acción que quedó `executing` tras crash no se repite automáticamente.

## 9. Review y diffs

El diff se entrega como texto completo en `{ "type": "diff", "value": string }` y se persiste en `ChatMessage.diff`. No existe actualmente una API de hunks tipados, aplicación parcial ni patch directo desde UI.

La UI puede registrar el estado de revisión con:

`POST /api/threads/{threadId}/messages/{messageId}/result`

```json
{ "action": "approved" }
```

Acciones: `approved`, `pending`, `undo_waiting`, `undo_complete`. Respuesta: `{ "message": ChatMessage }`. El backend hace upsert de una actividad `result-review` o `result-undo`; este endpoint registra estado de UI y **no ejecuta por sí mismo una reversión filesystem**.

## 10. Adjuntos y artefactos generados

### 10.1 Imágenes inline en chat

```ts
type ChatAttachment = {
  id: string;       // UUID
  name: string;     // 1..120
  mimeType: string; // whitelist de imagen o documento soportado
  size: number;     // imagen inline <=2 MB; staged <=50 MiB
};

type ChatInputAttachment = ChatAttachment & {
  dataUrl: string;  // data:<mimeType>;base64,...
};
```

Máximo 3 imágenes y 5.000.000 bytes reales en total. El backend decodifica
base64, compara tamaño y firma PNG/JPEG/WebP/GIF con el MIME; no confía solo en
la metadata declarada. El `dataUrl` solo viaja en el request; el mensaje
persistido conserva metadata, no base64.

### 10.2 Imágenes generadas

```ts
type GeneratedArtifact = {
  id: string;          // UUID derivado de forma estable del evento
  type: "image";
  name: string;
  url: string;         // /api/projects/{projectId}/artifacts/{artifactId}
  prompt: string | null;
};
```

`GET /api/projects/{projectId}/artifacts/{artifactId}` responde bytes `image/png`, inline, con `Cache-Control: private, no-store`. La URL se reautoriza en cada request; no debe reutilizarse desde caché tras logout o cambio de empleado. IDs inválidos o artefactos ajenos/inexistentes responden `400` o `404` sin revelar paths.

`GET /api/projects/{projectId}/files?path={path}` reautoriza el proyecto y confina la lectura a su workspace. Devuelve metadata y contenido acotado para texto/código; para imágenes y PDF devuelve una `previewUrl` del mismo endpoint con `raw=1`. Las respuestas no se cachean y una ruta absoluta emitida por Codex solo se acepta si resuelve dentro del workspace autorizado.

Los documentos Office/PDF/texto/imagen no usan este contrato inline; usan la API de documentos siguiente.

## 11. Office, PDF, texto, imágenes y previews

### 11.1 Upload

`POST /api/threads/{threadId}/documents`, `multipart/form-data`, exactamente dos partes:

- `uploadId`: UUID generado por cliente y reutilizado solo para reintentar el mismo fichero;
- `file`: fichero binario.

Límite de fichero 50 MiB; request multipart máximo 52 MiB. Formatos aceptados:

| Kind | Extensión/MIME coherente | Preview |
| --- | --- | --- |
| `docx` | `.docx` OOXML | `document.pdf`, `page-1.png` |
| `xlsx` | `.xlsx` OOXML | `document.pdf`, `page-1.png` |
| `pptx` | `.pptx` OOXML | `document.pdf`, `page-1.png` |
| `pdf` | `.pdf`, firma `%PDF-` | `document.pdf`, `page-1.png` |
| `text` | `.txt`, `.md`, `.csv`, `.json`; UTF-8 | `preview.txt` |
| `image` | PNG, JPEG, GIF, WebP | `preview.<ext>` |

Texto: 10 MiB máximo; imagen: 20 MiB. OOXML rechaza macros/ActiveX/custom UI/macrosheets, traversal, cifrado, Zip64, codecs no seguros, más de 5.000 entradas, más de 250 MiB descomprimidos o ratio mayor de 100. PDF cifrado, sin número de páginas válido o con más de 500 páginas se rechaza durante preview.

Respuesta `201`:

```json
{
  "document": {
    "schemaVersion": 1,
    "uploadId": "0198b9f0-6631-7000-8000-000000000511",
    "threadId": "0198b9f0-6631-7000-8000-000000000302",
    "fileName": "notes.md",
    "relativePath": "threads/0198b9f0-6631-7000-8000-000000000302/uploads/0198b9f0-6631-7000-8000-000000000511/notes.md",
    "kind": "text",
    "mediaType": "text/plain",
    "size": 17,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "status": "staged",
    "createdAt": "2026-08-27T10:00:00.000Z"
  },
  "preview": {
    "schemaVersion": 2,
    "uploadId": "0198b9f0-6631-7000-8000-000000000511",
    "threadId": "0198b9f0-6631-7000-8000-000000000302",
    "sourceSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "status": "ready",
    "kind": "text",
    "files": [
      {
        "name": "preview.txt",
        "url": "/api/threads/0198b9f0-6631-7000-8000-000000000302/documents/0198b9f0-6631-7000-8000-000000000511/preview/preview.txt"
      }
    ],
    "artifacts": [
      {
        "fileName": "preview.txt",
        "size": 17,
        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ],
    "pages": null,
    "createdAt": "2026-08-27T10:00:01.000Z"
  }
}
```

`relativePath` es metadata opaca; la UI no debe enviarla de vuelta como
authority. `409` para `uploadId` reutilizado con otro contenido; `413` por
tamaño; `400` validación de seguridad; `429` con `Retry-After` cuando todos los
slots compartidos de upload/conversión están ocupados o cuando el volumen no
puede absorber el peor burst sin invadir su margen libre; `503` si no puede
medirse el volumen o el toolchain/store no está disponible. La saturación de
almacenamiento se rechaza antes de leer o persistir el multipart; la de
conversión, antes de arrancar LibreOffice/Poppler. La UI puede reintentar el
mismo `uploadId` después del intervalo indicado.

`preview.schemaVersion: 2` atesta cada artefacto mediante `fileName`, tamaño y
SHA-256. El backend vuelve a verificar los bytes antes de reutilizar un preview
`ready`; si falta o cambia un fichero regular lo reconstruye desde el upload
staged validado. Un symlink o metadata corrupta falla cerrado. La UI puede usar
`artifacts` como evidencia informativa, pero las URLs server-side siguen siendo
la única autoridad de lectura.

Para adjuntar el documento a un turn, la UI envía únicamente su `uploadId` en
`options.documentUploadIds` del `POST /api/chat`, después de recibir el `201`.
No reenvía `relativePath`, paths absolutos, MIME, hash ni nombre. El backend:

- exige `documents.read | consult | allow` en el fingerprint de ese turn;
- vuelve a verificar user, thread, fichero regular, tamaño y SHA-256;
- mantiene el path absoluto y todo staging bajo autoridad exclusiva del
  servidor; el worker solo ve su `staging/tmp` privado;
- para texto valida UTF-8; para Office/PDF usa exclusivamente el PDF atestado
  por preview, extrae texto acotado con Poppler y, si existe, incorpora la
  primera página renderizada; para imagen incorpora bytes validados como data
  URL;
- entrega esos inputs preparados como datos no confiables dentro del request
  App Server. Nunca usa `mention`, `localImage`, `localAudio` ni otra referencia
  a un path staged.

Máximo 10 documentos y 200 MiB verificados por turn como protección de
saturación. El contenido preparado se limita además a 2 MiB de texto por
documento, 4 MiB de texto y 20 MiB de imágenes codificadas por turn. Los
metadatos seguros se guardan en `ChatMessage.attachments`; los paths no se
devuelven a la UI ni al worker. Un ID de otro thread/empleado, un contenido
alterado, un preview no atestado o un permiso denegado falla antes de iniciar el
turn de Codex.

El backend consume el multipart por streaming y escribe un temporal privado;
no materializa el request ni el fichero completo en RAM. Para OOXML compara
headers central/local, rangos, CRC, tamaño y ratio reales mientras descomprime.
El staging publica sin overwrite y un retry solo recupera el orphan exacto si
hash y tamaño coinciden.

### 11.2 Leer preview

Usar exactamente cada `preview.files[].url`. La respuesta es el fichero, con MIME derivado del nombre, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` y CSP sandbox. La ruta verifica sesión, usuario, thread, upload y whitelist de fichero; otro usuario obtiene `404`.

## 12. Publicación documental

La publicación es un protocolo de dos pasos. La UI nunca elige roots server-side ni publica el path staged directamente.

### 12.1 Congelar candidato

`POST /api/threads/{threadId}/publications`

Body estricto:

```json
{
  "operationId": "0198b9f0-6631-7000-8000-000000000615",
  "clientRequestId": "freeze-publish-001",
  "turnId": "0198b9f0-6631-7000-8000-000000000612",
  "uploadId": "0198b9f0-6631-7000-8000-000000000613",
  "targetRelativePath": "knowledge/approved.txt"
}
```

Precondiciones verificadas server-side:

- sesión local e instalación coincidente;
- thread del usuario y assistant turn perteneciente al thread;
- regla efectiva exacta `documents.publish | publish | allow` y ausencia de `publish | deny` en `PERMISSIONS.md`;
- candidato staged y preview `ready` con el mismo SHA-256;
- path destino relativo normalizado, sin traversal ni symlinks.

Respuesta `201`:

```ts
{
  operation: PublicationOperation;
  confirmationToken: string;
  permissionFingerprint: string; // SHA-256 hex
}
```

La operación visible es:

```ts
type PublicationOperation = {
  schemaVersion: 1;
  operationId: string;
  installationId: string;
  userId: string;
  threadId: string;
  turnId: string;
  targetRelativePath: string;
  status: "awaiting_confirmation" | "publishing" | "published" | "declined" | "expired" | "conflict";
  candidate: { fileName: string; size: number; sha256: string };
  preview: {
    schemaVersion: 1;
    previewId: string;
    threadId: string;
    turnId: string;
    candidateSha256: string;
    status: "ready";
    artifacts: string[];
    createdAt: string;
  };
  original: {
    exists: boolean;
    size: number | null;
    sha256: string | null;
    mtimeMs: number | null;
  };
  confirmationExpiresAt: string;
  version: { size: number; sha256: string; createdAt: string } | null;
  result: {
    size: number;
    sha256: string;
    publishedAt: string;
    recoveredAfterInterruption: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};
```

El token de confirmación solo se entrega en este receipt y se liga a instalación, usuario, thread, turn, operación y expiración. La UI debe mantenerlo en memoria hasta decidir; no debe registrarlo.

Al llegar a `confirmationExpiresAt`, el backend reconcilia la operación bajo su
lock a `status: "expired"`. Es un estado terminal, durable y auditable; su
`updatedAt` coincide exactamente con `confirmationExpiresAt`, aunque el primer
acceso posterior ocurra más tarde. La UI debe retirar las acciones de
confirmación y mostrar que hace falta congelar un candidato nuevo.

### 12.2 Confirmar o rechazar

`POST /api/threads/{threadId}/publications/{operationId}`

Body estricto:

```json
{
  "action": "confirm",
  "clientRequestId": "confirm-publish-001",
  "turnId": "0198b9f0-6631-7000-8000-000000000612",
  "confirmationToken": "v1.178...signature"
}
```

`action` es `confirm` o `decline`. Respuesta:

```json
{
  "operation": {
    "status": "published",
    "version": {
      "size": 17,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "createdAt": "2026-08-27T10:01:00.000Z"
    },
    "result": {
      "size": 18,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "publishedAt": "2026-08-27T10:01:01.000Z",
      "recoveredAfterInterruption": false
    }
  },
  "permissionFingerprint": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
}
```

El ejemplo omite los campos de identidad/preview ya definidos en `PublicationOperation`; la respuesta real incluye la operación completa. En `decline`, `permissionFingerprint` es `null` y el fichero oficial no se modifica.

Si el TTL ya venció, `confirm` devuelve `403` y nunca inicia la escritura. Un
`decline` posterior funciona como acuse de cierre idempotente: devuelve la
operación terminal `expired`, con `permissionFingerprint: null`, sin cambiar el
target ni convertirla en `declined`. Repetir ese cierre no duplica el evento de
auditoría.

Confirmar vuelve a resolver `PERMISSIONS.md`. La escritura compara el original congelado, versiona el original si existe, escribe atómicamente y verifica el hash posterior. El lock del target es único por instalación y destino, incluso cuando dos empleados confirman operaciones desde estados privados distintos. `status: "conflict"` es un resultado válido si el original cambió. Repetir exactamente el mismo `clientRequestId` y decisión devuelve el resultado ya registrado; cambiar contenido o decisión devuelve `409`.

Errores: `403` token expirado/inválido o permiso retirado; `404` operación; `409` decisión previa o `clientRequestId` reutilizado con otra intención; `400` binding/path inseguro; `429` con `Retry-After`, `code: "PUBLICATION_STORAGE_BACKPRESSURE"` y `retryable: true` si el volumen oficial no conserva margen; `503` con `code: "PUBLICATION_STORAGE_CAPACITY_UNAVAILABLE"` y `retryable: true` si su capacidad no puede medirse. Ambos fallan antes de cambiar la operación a `publishing`, crear una versión o tocar el destino. Un cambio del original detectado durante la confirmación normalmente es `200` con `operation.status: "conflict"`. La expiración ya reconciliada se representa como `status: "expired"`, no como `conflict` ni como un pendiente recuperable.

No hay hoy endpoints públicos para listar operaciones ni descargar/restaurar la versión anterior. Esas funciones existen en el publisher server-side, no en el contrato UI.

## 13. Memoria explícita

La memoria V1 no aprende automáticamente. Solo una acción explícita del
empleado crea o revoca un registro. El backend deriva instalación, actor y
sujeto de la sesión local; la UI nunca envía `userId`, paths ni timestamps de
captura.

`GET /api/memory?status=active|revoked|all&kind=recollection|decision&limit=1..100`
devuelve `200` y `Cache-Control: private, no-store`:

```ts
type ExplicitMemory = {
  schemaVersion: 1;
  memoryId: string;
  installationId: string;
  subjectUserId: string;
  kind: "recollection" | "decision";
  content: string;
  provenance: {
    sourceType: "manual" | "thread" | "project" | "document" | "decision";
    sourceId: string;
    sourceExcerpt: string;
    capturedAt: string;
  };
  explicit: true;
  createdBy: string;
  createdAt: string;
  status: "active" | "revoked";
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  idempotencyKey: string;
};
```

`POST /api/memory` acepta un body estricto:

```json
{
  "explicit": true,
  "kind": "decision",
  "content": "Publicar únicamente tras confirmación explícita.",
  "sourceExcerpt": "El empleado pidió recordar esta regla.",
  "clientRequestId": "0198b9f0-6631-7000-8000-000000000711"
}
```

Devuelve `201 { "memory": ExplicitMemory, "created": true }`. Repetir el mismo
UUID y contenido devuelve `200` con `created: false`; reutilizarlo para otra
memoria devuelve `409`.

`POST /api/memory/{memoryId}/revoke`:

```json
{
  "explicit": true,
  "reason": "La decisión fue sustituida.",
  "clientRequestId": "0198b9f0-6631-7000-8000-000000000712"
}
```

La revocación es durable e idempotente. Errores: `400` contrato/consulta,
`401` sesión, `404` memoria ajena o inexistente, `409` clave idempotente en
conflicto y `503` store corrupto/no disponible. Cada turn registra el
fingerprint e IDs de la memoria inyectada, nunca su contenido en auditoría.

## 14. Browser y Computer Use

El contrato público actual es un viewer browser propio: Chrome headless aislado por usuario, CDP privado por pipes heredados, frames PNG y comandos de navegación/teclado/ratón. No es una conexión del navegador cliente a CDP y no es noVNC.

Todas las rutas requieren una sesión `local`. Tenant, user y sesión opaca se derivan server-side; ningún body acepta `userId`, `installationId`, perfil o path.

### 14.1 Estado y lifecycle

`GET /api/runtime/browser`

```ts
type BrowserStatus = {
  healthy: boolean;
  state: {
    schemaVersion: 1;
    installationId: string;
    userId: string;
    browserSessionId: string | null;
    lifecycle: "stopped" | "starting" | "ready" | "human-control" | "recovering" | "degraded";
    controller: "none" | "agent" | "human";
    generation: number;
    heartbeatAt: string | null;
    heartbeatExpiresAt: string | null;
    recoveryAttempt: number;
    lastRecoveryReason: "process_restart" | "human_release" | "heartbeat_timeout" | "runtime_failure" | null;
    profileGeneration: number;
    profileCleanShutdown: boolean;
    profileLastOpenedAt: string | null;
    downloads: Array<{
      id: string;
      fileName: string;
      status: "active" | "complete" | "failed";
      sizeBytes: number | null;
      createdAt: string;
      updatedAt: string;
    }>;
    createdAt: string;
    updatedAt: string;
  };
  runtime: { healthy: boolean; detail?: string } | null;
  runningInProcess: boolean;
};
```

Ejemplo detenido:

```json
{
  "healthy": false,
  "state": {
    "schemaVersion": 1,
    "installationId": "example-lab-dev",
    "userId": "0198b9f0-6631-7000-8000-000000000601",
    "browserSessionId": null,
    "lifecycle": "stopped",
    "controller": "none",
    "generation": 0,
    "heartbeatAt": null,
    "heartbeatExpiresAt": null,
    "recoveryAttempt": 0,
    "lastRecoveryReason": null,
    "profileGeneration": 0,
    "profileCleanShutdown": true,
    "profileLastOpenedAt": null,
    "downloads": [],
    "createdAt": "2026-08-27T10:00:00.000Z",
    "updatedAt": "2026-08-27T10:00:00.000Z"
  },
  "runtime": null,
  "runningInProcess": false
}
```

`POST /api/runtime/browser` acepta un body estricto:

```ts
type BrowserControlRequest = {
  action: "start" | "stop" | "takeover" | "release" | "heartbeat";
};
```

La respuesta es el mismo `BrowserStatus` actualizado. Flujo de UI:

1. `start` → esperar `lifecycle: "ready"`, `controller: "agent"` y `healthy: true`.
2. `takeover` → `lifecycle: "human-control"`, `controller: "human"`.
3. Mientras el humano controla, enviar `heartbeat` antes de `heartbeatExpiresAt`.
4. `release` cerca la sesión anterior, ejecuta recovery y devuelve el control al agente en una nueva generación/sesión.
5. `stop` cierra el runtime y deja lifecycle `stopped`.

Durante `human-control`, todas las herramientas del agente quedan pausadas,
incluidas lectura, screenshots, tabs y downloads. El viewer humano conserva su
ruta autenticada de frames e input hasta `release` o expiración del heartbeat.

`GET` también recupera un takeover con heartbeat caducado antes de calcular health. Tras un restart del proceso, un `start` sobre estado persistido no detenido inicia recuperación y cerca la sesión anterior.

La UI no debe guardar ni reenviar una URL para reconstruir el browser. El
backend mantiene una proyección privada y acotada de la última URL segura por
thread; al recrear su target la revalida con la política de red vigente y la
restaura. Si esa persistencia falla, `runtime.healthy` pasa a `false` con detalle
de navegación degradada en vez de simular una recuperación correcta.

`state.downloads` es la proyección durable de eventos reales de Chrome, no un
fixture: registra basename, estado y tamaño terminal sin exponer paths. Un
restart, timeout, fallo del runtime o stop convierte registros activos en
`failed`; una rotación normal de takeover conserva la descarga. La retención
evicta únicamente metadata terminal antigua y aplica backpressure si todas las
entradas retenidas siguen activas; los archivos descargados no se borran.

### 14.2 Token privado del viewer

`POST /api/runtime/browser/token`

Body estricto:

```json
{
  "threadId": "0198b9f0-6631-7000-8000-000000000302",
  "capabilities": ["view", "control"],
  "ttlMs": 30000
}
```

Capacidades válidas: `view`, `control`, `heartbeat`, `takeover`, sin duplicados. `ttlMs` es opcional, entre 1.000 y 300.000; el default es 60.000. El runtime debe estar en `ready` o `human-control`.

Respuesta:

```json
{
  "token": "base64url-payload.base64url-signature",
  "browserSessionId": "0198b9f0-6631-7000-8000-000000000699"
}
```

El token HMAC está ligado a instalación, user, thread, browser session y hash
de la sesión local opaca. El backend comprueba que el thread pertenece a la
sesión antes de emitirlo. Un logout, cambio de sesión local, cambio de thread,
nueva browser session o expiración lo invalida. En el contrato HTTP actual
`view` protege frames y `control` protege input; `heartbeat` y `takeover` están
reservadas en el token, pero lifecycle sigue usando la cookie y
`/api/runtime/browser`.

### 14.3 Frames

`GET /api/runtime/browser/viewer/frame?threadId={uuid}`

Cabecera requerida:

```http
Authorization: Bearer <token-con-view>
```

Respuesta `200`: bytes PNG, no JSON, con:

```text
Content-Type: image/png
Cache-Control: private, no-store
X-AiBrain-Captured-At: 2026-08-27T10:02:03.000Z
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
```

La captura está permitida en `ready` y `human-control`. La UI puede hacer polling acotado; no existe stream de vídeo o WebSocket de frames.

### 14.4 Navegación y Computer Use humano

`POST /api/runtime/browser/viewer/input`, con `Authorization: Bearer <token-con-control>`. Solo se acepta durante takeover humano activo.

Navegación:

```json
{
  "threadId": "0198b9f0-6631-7000-8000-000000000302",
  "action": "navigate",
  "url": "https://example.com/path"
}
```

Se admiten `http:`, `https:` sin credenciales y `about:blank`; se rechazan `file:`, `data:`, URLs con user/password y valores de más de 2.048 caracteres.

Ratón:

```ts
{
  threadId: string;
  action: "input";
  command: {
    kind: "mouse";
    event: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
    x: number; // 0..100000
    y: number; // 0..100000
    button?: "none" | "left" | "middle" | "right";
    clickCount?: number; // 0..3
    deltaX?: number;     // -100000..100000
    deltaY?: number;     // -100000..100000
  };
}
```

Teclado:

```ts
{
  action: "input";
  command: {
    kind: "key";
    event: "keyDown" | "keyUp" | "char";
    key: string;       // 1..128
    code?: string;     // máximo 128
    text?: string;     // máximo 4096
    modifiers?: number; // bitmask 0..15
  };
}
```

Éxito: `{ "ok": true }`. Cada objeto es estricto; campos adicionales se rechazan.

### 14.5 Errores y límites actuales

Los errores browser añaden metadatos:

```json
{
  "error": "No s’ha pogut obrir una sessió privada del visor.",
  "code": "BROWSER_RUNTIME_NOT_RUNNING",
  "retryable": true
}
```

- `401`: sesión ausente o token expirado;
- `403`: sesión no local, signature/capacidad inválida o instalación incorrecta;
- `409`: runtime no iniciado, viewer aún no disponible o token ligado a una
  generación anterior; en este último caso la UI relee estado, solicita un
  token nuevo y reintenta una sola vez;
- `429`: saturación de arranques, con `Retry-After: 1`;
- `503`: Chrome/CDP/store no disponible, normalmente `retryable: true`;
- `400`: body, URL o input inválido, sin ejecutar el comando.

Cada thread obtiene un target CDP propio y su token no puede controlar otro.
Las descargas completadas se enrutan desde una cuarentena GUID al directorio
privado del thread; `state.downloads` sigue siendo metadata de solo lectura
para la UI hasta que exista una API de descarga explícita. No existen endpoints
que expongan CDP, discovery, noVNC ni métodos arbitrarios; Chrome usa un pipe
heredado sin listener TCP. El runtime normal fuerza un proxy efímero en
`127.0.0.1`, resuelve cada hostname con la política privada y conecta solo a la
IP pública aprobada; QUIC y UDP WebRTC no proxyado quedan deshabilitados. El
interceptor Fetch conserva una segunda validación con la misma policy.
El proxy solo permite TCP 80/443 por defecto; un puerto público arbitrario se
rechaza antes de abrir el socket y nunca es una opción enviada por la UI.

### 14.6 Settings > Usage

`GET /api/usage/me` requiere la cookie local opaca y siempre devuelve únicamente
las métricas internas del empleado autenticado. `GET /api/usage/company`
requiere además que la asignación durable del usuario sea `workspace-owner` o
`workspace-admin`; `workspace-member` falla de forma cerrada con `403`. La ruta
resuelve el rol server-side desde `dataRoot/workspace-admin/state.json` y no
acepta UUIDs o roles enviados por el navegador.

Ambos endpoints responden `Cache-Control: private, no-store`. El objeto
`internal` usa este contrato:

```ts
type UsageAggregate = {
  turns: number;
  completedTurns: number;
  errorTurns: number;
  stoppedTurns: number;
  activeDays: number;
  averageDurationMs: number | null;
  p95DurationMs: number | null;
  averageFirstTextMs: number | null;
  p95FirstTextMs: number | null;
  turnsWithTokenData: number;
  tokens: {
    totalTokens: number;
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  };
};
```

Respuesta personal:

```json
{
  "schemaVersion": 1,
  "scope": "personal",
  "generatedAt": "2026-08-27T10:00:00.000Z",
  "userId": "00000000-0000-4000-8000-000000000001",
  "internal": {
    "turns": 8,
    "completedTurns": 7,
    "errorTurns": 1,
    "stoppedTurns": 0,
    "activeDays": 2,
    "averageDurationMs": 6220,
    "p95DurationMs": 8900,
    "averageFirstTextMs": 1250,
    "p95FirstTextMs": 2100,
    "turnsWithTokenData": 7,
    "tokens": {
      "totalTokens": 4800,
      "inputTokens": 3500,
      "cachedInputTokens": 1200,
      "cacheWriteInputTokens": 0,
      "outputTokens": 1300,
      "reasoningOutputTokens": 300
    }
  },
  "sharedSubscription": {
    "schemaVersion": 1,
    "installationId": "arnall",
    "observedAt": "2026-08-27T10:00:00.000Z",
    "scope": "shared_chatgpt_account",
    "planType": "team",
    "rateLimitsAvailable": true,
    "accountTokenUsageAvailable": true,
    "rateLimits": [
      {
        "limitId": "codex",
        "limitName": "Codex",
        "planType": "team",
        "primary": {
          "usedPercent": 32,
          "windowDurationMins": 300,
          "resetsAt": 1777000000
        },
        "secondary": null,
        "credits": null,
        "individualLimit": null,
        "spendControlReached": false,
        "rateLimitReachedType": null
      }
    ],
    "accountTokenUsage": {
      "lifetimeTokens": "125000",
      "peakDailyTokens": "22000",
      "longestRunningTurnSec": "98",
      "currentStreakDays": "4",
      "longestStreakDays": "9",
      "dailyUsageBuckets": [
        { "startDate": "2026-08-27", "tokens": "12000" }
      ]
    }
  },
  "notices": [
    "Les mètriques internes per empleat provenen només dels torns d’aquesta instal·lació.",
    "El percentatge i l’ús del proveïdor pertanyen al compte ChatGPT compartit; no s’atribueixen a cap empleat."
  ]
}
```

La respuesta de empresa cambia `scope` a `company`, añade `installationId` y
`members: Array<{ userId, displayName, email, usage }>` y mantiene un único
`sharedSubscription`. La UI puede mostrar `rateLimits[].primary.usedPercent`
como porcentaje del plan solo cuando `rateLimitsAvailable=true`; en caso
contrario debe mostrar «No disponible», nunca derivarlo de tokens internos.

Los tokens por empleado se registran únicamente desde
`thread/tokenUsage/updated` ligado al mismo thread y turn. Los totales de
`account/usage/read` son globales de la suscripción compartida y no se reparten
ni estiman por empleado.

## 15. Estados degradados y errores recuperables

Durante un drain operativo, un chat nuevo devuelve `503` con
`code: "MAINTENANCE_ACTIVE"`, `retryAfterMs` y header `Retry-After`. La UI debe
conservar el borrador y reintentar solo por acción del usuario o backoff; no
debe interpretar la respuesta como un turn aceptado. Turns ya admitidos siguen
hasta terminar. `/api/operations/maintenance` es control host-local y no forma
parte del cliente UI.

### 15.1 Mapa de respuesta UI

| Señal | Interpretación | Acción UI segura |
| --- | --- | --- |
| `401` | Sesión ausente/caducada/revocada | Ir a login; no repetir mutaciones automáticamente |
| `403` origen | Request fuera del origen configurado | Error terminal de configuración |
| `403` scope/permiso | Recurso, instalación o `PERMISSIONS.md` no autoriza | No reintentar; refrescar permisos/estado si el usuario lo pide |
| `404` | Recurso no visible para este usuario o inexistente | Retirar de UI y recargar lista |
| `409` | Conflicto/idempotency mismatch/turn terminal/original cambiado | Recargar entidad; conservar evidencia; usar IDs nuevos solo para una intención nueva |
| `410` + `FEATURE_OUT_OF_SCOPE` | Superficie retirada de V1 | Ocultar permanentemente en V1 |
| `413` | Upload/request demasiado grande | Pedir otro fichero; no reintentar igual |
| `429` | Backpressure de arranque browser, upload, disco o conversión documental | Respetar `Retry-After`; no lanzar starts/uploads/conversiones paralelos |
| `502` | Contrato de runtime incoherente | Mostrar degradado y permitir refresh/retry explícito |
| `503` | Provider, filesystem, permisos, toolchain o runtime no disponible | Backoff acotado; no asumir que una mutación no ocurrió |
| stream `{ "type": "error" }` | Turn terminó con error o persistencia final falló | Conservar IDs y recuperar repitiendo el mismo request |
| `RuntimeStatus.ready=false` | Worker no listo aunque HTTP responda `200` | Deshabilitar envío y mostrar estado de conexión |
| publicación `status="conflict"` | Original cambió desde freeze | Exigir nueva revisión/freeze; no confirmar de nuevo con IDs distintos a ciegas |

### 15.2 Liveness y readiness

`GET /api/health/live` no prueba filesystem, Codex, Supabase ni document toolchain. Solo confirma que el proceso HTTP está vivo:

```json
{
  "schemaVersion": 1,
  "status": "live",
  "processStartedAt": "2026-08-27T09:00:00.000Z",
  "checkedAt": "2026-08-27T10:00:00.000Z"
}
```

Para readiness de usuario/proyecto, usar `/api/runtime/status`.

`GET /api/health/ready` comprueba que las raíces de datos, backups, documentos
y usuarios son directorios accesibles con aislamiento seguro, que queda al
menos 20 % y 1 GiB de disco libre y que no aparece `docker.sock` en el
contenedor. Además agrega tres probes requeridos: Codex 0.149.1 más launcher y
`bwrap`, Chromium con versión exacta más launcher, y LibreOffice/Poppler/QPDF.
Devuelve `200` con `status: "ready"` solo si todos pasan; cualquier componente
`degraded | unavailable` devuelve `503`, con códigos no sensibles. Los probes
solo inspeccionan ejecutables/versiones: no crean workers, perfiles o browsers
ni tocan sesiones de empleados.

## 16. Reglas de integración para la rama UI

1. Obtener la sesión con `/api/auth/session`; no leer cookies ni tokens directamente.
2. Consumir branding mediante los props server-side existentes hasta que haya un endpoint acordado.
3. Generar UUID únicos antes de iniciar un turn y conservarlos durante stream, refresh y retry.
4. Parsear `/api/chat` por líneas NDJSON; no usar `EventSource`.
5. Reducir eventos con las reglas de la sección 6.3 y tratar `snapshot` como autoridad durable.
6. Enviar approvals usando exactamente los IDs del evento; enviar stop/steer usando solo IDs locales.
7. Consultar `/api/runtime/status` para modelos, skills y capacidades. Un manifest visual no habilita tools.
8. Usar las URLs de preview/artifact entregadas por backend, nunca construir paths filesystem.
9. Mantener `confirmationToken` de publicación fuera de logs/URLs y usar el mismo `clientRequestId` al reintentar la misma decisión.
10. Implementar browser solo con `/api/runtime/browser*`: takeover antes de input, heartbeat mientras controla el humano y tokens cortos fuera de logs/URLs.

## 17. Fuentes de implementación

- Auth: [`src/auth/types.ts`](../src/auth/types.ts), [`src/auth/session.ts`](../src/auth/session.ts), [`src/auth/auth-service.ts`](../src/auth/auth-service.ts), [`src/app/api/auth`](../src/app/api/auth).
- Memoria explícita: [`src/memory`](../src/memory), [`src/app/api/memory`](../src/app/api/memory), [`tests/integration/memory-routes.integration.test.ts`](../tests/integration/memory-routes.integration.test.ts).
- Instalación: [`src/config/installation-schema.ts`](../src/config/installation-schema.ts), [`src/config/installation-branding.ts`](../src/config/installation-branding.ts).
- Workbench: [`src/workbench/types.ts`](../src/workbench/types.ts), [`src/app/api/projects`](../src/app/api/projects), [`src/app/api/threads`](../src/app/api/threads).
- Chat/runtime: [`src/lib/chat-contract.ts`](../src/lib/chat-contract.ts), [`src/lib/runtime-status.ts`](../src/lib/runtime-status.ts), [`src/app/api/chat/route.ts`](../src/app/api/chat/route.ts), [`src/app/api/runtime`](../src/app/api/runtime).
- Usage: [`src/usage`](../src/usage), [`src/app/api/usage`](../src/app/api/usage).
- Documentos/publicación: [`src/documents`](../src/documents), [`src/app/api/threads/[threadId]/documents`](../src/app/api/threads/%5BthreadId%5D/documents), [`src/app/api/threads/[threadId]/publications`](../src/app/api/threads/%5BthreadId%5D/publications).
- Browser/Computer Use: [`src/runtime/browser`](../src/runtime/browser), [`src/app/api/runtime/browser`](../src/app/api/runtime/browser), [`tests/integration/browser-routes.integration.test.ts`](../tests/integration/browser-routes.integration.test.ts).
- Pruebas de rutas: [`tests/integration`](../tests/integration).

## 18. Settings, apps and capability policy

`GET /api/settings` returns a private, no-store `schemaVersion: 1` snapshot for
the authenticated employee. The snapshot separates account/company identity,
the real capability catalogue, in-app notification preferences, effective
permission rules, privacy/isolation facts and browser/network policy.

Apps use `connected | available | blocked | not_configured`. A connected label
requires live runtime evidence. No route creates OAuth, secret or provider
records. Missing external adapters are configuration work, not a clickable
fake connection.

`PATCH /api/settings` accepts one strict mutation:

- `{ target: "user-app", appId, enabled }`
- `{ target: "installation-app", appId, enabled }` (admin only)
- `{ target: "notifications", values }`

Controllable app IDs are `web-search`, `image-generation`, `skills` and
`managed-browser`. Both policy files are private (`0600`), atomically replaced
under a cross-process resource lock, and scoped to the current installation or
employee. `/api/chat` enforces web/image/skill gates and the browser service
enforces the managed-browser gate for human and agent operations. A stop action
remains available so disabling a running browser cannot strand the process.
