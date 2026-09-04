# Automatizaciones

AiBrain puede ejecutar un prompt una vez, cada día o ciertos días de la semana. Cada tarea pertenece a un único usuario y a un proyecto, incluido el proyecto técnico `Sin proyecto`, conserva su próxima y última ejecución y crea una conversación normal para que el resultado quede visible en el workbench y el Centro de tareas.

## Garantía operativa honesta

Una tarea se procesa en `automation-worker`, un servicio durable e independiente de la aplicación web. Sigue trabajando aunque el navegador o el dispositivo del usuario estén cerrados; un heartbeat fresco forma parte de readiness y el despliegue de Arnall exige que el contenedor esté saludable. El worker tampoco envía correos, mensajes ni publicaciones por sí solo: ejecuta un turno normal y conserva el resultado en una conversación.

El mismo proceso drena los trabajos pendientes de memoria privada automática. Cada turno terminal persiste primero un trabajo mínimo por usuario y después solicita su procesamiento; si la aplicación cae en esa ventana, el siguiente barrido del worker lo recupera de disco. La cola no conserva el prompt completo, el procesamiento es idempotente y nunca promociona recuerdos al ámbito de empresa.

Un turno background no puede esperar una aprobación interactiva de una sesión que no existe. Web, skills, archivos y conectores de lectura autorizados siguen disponibles. Si una herramienta pide una aprobación sensible sin una autorización durable previa vinculada, el servidor la rechaza inmediatamente y el resultado explica el bloqueo; nunca queda esperando ni la aprueba por contexto.

Cada ejecución solicita búsqueda web en vivo. Inmediatamente antes de iniciar el turno, el servidor vuelve a comprobar la política de web, las skills efectivas y los conectores disponibles para el propietario. Una revocación no queda congelada en la tarea: el recurso deja de incluirse y, si se revoca la web, la ejecución falla cerrada y queda registrada.

## Creación y control

La superficie principal permite crear, editar, pausar, reanudar, eliminar y ejecutar ahora una tarea, además de consultar su historial y abrir la conversación de resultado. `Ejecutar ahora` usa un id de solicitud durable: repetir la misma petición no crea otra ocurrencia, y una segunda petición distinta se rechaza mientras haya una ejecución manual pendiente o en curso. Una ejecución manual puede arrancar con la recurrencia en pausa y no la reactiva al terminar.

El chat también puede preparar una automatización mediante herramientas dinámicas internas y reconoce instrucciones naturales como «envíame hello dentro de 2 minutos», «mañana a las 9» o «cada lunes». Cuando el usuario no especifica proyecto, zona horaria o audiencia, usa el proyecto actual, `Europe/Madrid` y el usuario actual; conserva menciones `@`, archivos y referencias a skills dentro del prompt. Antes de persistirla muestra acción, horario, zona horaria, proyecto o `Sin proyecto` y audiencia. La propuesta se guarda por usuario, tenant, conversación y turno, pero no crea ninguna tarea. La creación exige una confirmación explícita en un mensaje posterior; un «sí» natural puede confirmar la última propuesta pendiente de esa conversación sin repetir su id. Propuesta y tarea usan ids durables para que un reintento tras reinicio no duplique la automatización.

Las herramientas dinámicas quedan fijadas cuando se crea la conversación privada del runtime. Los tokens de conversación incluyen una revisión del toolset: si una petición de programación llega desde una conversación anterior a esta capacidad, el servidor abre de forma acotada un hilo privado nuevo para ese turno y conserva la conversación visible y su propuesta durable. Las conversaciones actuales y los mensajes normales continúan reanudándose sin reinicio.

`Automatizaciones` es una vista del área principal y nunca un overlay sobre el sidebar. No contiene una X, `Centro de tareas` ni banners que infieran falsamente que el servicio está desconectado. `Nueva` queda centrado bajo el estado vacío y el proyecto técnico `Conversaciones` siempre se proyecta como `Sin proyecto`.

La zona por defecto es `Europe/Madrid`, pero se guarda por tarea. En el salto de primavera, una hora inexistente se mueve al primer minuto válido posterior del mismo día. En la repetición de otoño se usa la primera aparición de la hora.

El formulario de una ejecución única edita fecha y hora en controles separados y convierte exactamente ese minuto desde la zona elegida. El `PATCH` devuelve la tarea persistida; la UI nunca sustituye el valor introducido por la hora por defecto del formulario.

## Operación

Una sola pasada, útil para diagnóstico:

```bash
npm run automations:once
```

Worker continuo, con sondeo cada 30 segundos:

```bash
npm run automations:worker
```

Otro intervalo:

```bash
npm run automations:worker -- --interval-ms 60000
```

Aceptación local controlada de dos minutos con el cliente ausente, worker en un proceso separado y readback exactly-once:

```bash
npm run acceptance:automations-offline
```

La salida válida contiene `clientSessionPresent:false`, `browserRequired:false`, `chatProposalConfirmed:true`, `terminalExecutions:1`, `replayExecutions:0`, `persistedResult:"TEST-AUTO-P0-OK"` y el mismo `runKey` en el recibo y el historial. La prueba recorre propuesta y confirmación durable, espera el reloj real, ejecuta en un proceso hijo sin cliente, relee una conversación real del workbench y arranca un segundo worker para demostrar que no hay replay. El contenido se produce de forma controlada en el límite del executor: esta prueba no certifica por sí sola el modelo, web, skills, conectores, una pestaña cerrada ni el runtime Codex autenticado desplegado.

En producción, `infra/hetzner/compose.yaml` arranca `automation-worker` como servicio independiente, supervisado con `restart: unless-stopped` y un healthcheck que requiere un heartbeat fresco del proceso vivo. Comparte la misma imagen, usuario, configuración, volumen de datos y credenciales Codex que la aplicación. No arranque un segundo worker manualmente como sustituto de alta disponibilidad: el lock con lease evita reclamaciones duplicadas, pero ambos procesos compartirían el mismo volumen.

Tras un despliegue autorizado, la comprobación de aceptación es:

```bash
docker compose -f /opt/aibrain/active.compose.yaml ps app automation-worker
docker compose -f /opt/aibrain/active.compose.yaml exec app node -e 'fetch("http://127.0.0.1:3000/api/health/ready").then(async r => { const b = await r.json(); if (!r.ok || !b.components?.some(c => c.name === "automations-worker" && c.status === "ready")) process.exit(1) })'
```

Ambos servicios deben aparecer `healthy`; si el worker se reinicia, la aplicación expone readiness degradado hasta que vuelva a escribir una señal fresca.

Ejemplo conceptual para systemd (ajuste rutas y usuario):

```ini
[Service]
Type=simple
User=aibrain
WorkingDirectory=/opt/aibrain
EnvironmentFile=/etc/aibrain/runtime.env
ExecStart=/usr/bin/npm run automations:worker
Restart=on-failure
RestartSec=5
```

## Persistencia e idempotencia

- Tareas: `<usersRoot>/<userId>/automations/tasks.json`.
- Historial append-only: `<usersRoot>/<userId>/automations/runs.jsonl`.
- Propuestas pendientes del chat: `<usersRoot>/<userId>/automations/chat-proposals.json`.
- Locks: `<usersRoot>/<userId>/automations/locks/`.
- Señal del worker: `<dataRoot>/automations/worker-status.json`.
- Extracción automática pendiente: `<usersRoot>/<userId>/memory/automatic-jobs/`.
- El identificador de una ejecución programada deriva de tarea + instante; el de una ejecución manual deriva de tarea + id de solicitud del cliente.
- La concesión expira si el proceso muere y se renueva mientras el turno sigue activo.
- La conversación y los mensajes del turno usan ids deterministas. Tras una recuperación, el store y el workbench reutilizan el mismo resultado visible y rechazan duplicados ya terminales.
- Una ejecución solo se asienta como correcta después de releer la conversación y confirmar que conserva el prompt y una respuesta terminal no vacía.
- El journal conserva los snapshots internos `running`, pero el historial de producto proyecta un único estado actual por `runKey + attempt`; preparar el thread y terminar el mismo intento nunca crea filas duplicadas.
- El selector muestra un único perfil canónico por email local. La autorización de resultados permanece ligada al UUID exacto persistido: un perfil recreado con el mismo email no hereda acceso. Grupos y personas se resuelven contra miembros habilitados en cada lectura.
- Un worker que pierde su fence deja de escribir en el historial; solo el sucesor que posee la nueva lease puede registrar el resultado terminal.
- Pausar o eliminar una tarea con una ejecución en curso no borra su fence de
  inmediato: el worker recibe la cancelación desde el estado durable, aborta
  cooperativamente el turno y registra el resultado. La tarea deja de ser
  visible al instante, no se reintenta ni vuelve a programarse, y el historial
  conservado mantiene el error y el vínculo a la conversación si ya existía.

Los fallos se guardan y se muestran en la tarea. En horarios recurrentes se calcula la siguiente ocurrencia; una tarea de una sola vez termina aunque su ejecución falle, para evitar reintentos infinitos no solicitados.

## Propiedad y destinatarios

Every automation has exactly one immutable owner in `task.userId`. The store is
physically rooted under that same user's private directory and rejects any task
whose persisted owner does not match the directory owner. Existing legacy
snapshots are migrated on their next locked read by adding an explicit audience
whose sole initial recipient is the owner; the owner field itself was already
mandatory, so no ownership inference or cross-user move is required.

Recipients are an independent, non-empty set of direct users and groups.
Current membership is resolved on every authorized result read. The owner is not
implicitly a recipient. Only that owner or a workspace administrator can edit,
pause, run or delete; other recipients can only view results.
