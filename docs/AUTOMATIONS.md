# Automatizaciones

AiBrain puede ejecutar un prompt una vez, cada día o ciertos días de la semana. Cada tarea pertenece a un único usuario y proyecto, conserva su próxima y última ejecución y crea una conversación normal para que el resultado quede visible en el workbench.

## Garantía operativa honesta

No es un servicio cloud. Una tarea solo se procesa mientras `scripts/run-automations.ts` esté vivo en el servidor de la instalación. La UI muestra la última señal del worker y deja las tareas pendientes cuando está desconectado. El worker tampoco envía correos, mensajes ni publicaciones por sí solo; ejecuta un turno normal y respeta las mismas políticas y aprobaciones que una conversación interactiva.

La zona por defecto es `Europe/Madrid`, pero se guarda por tarea. En el salto de primavera, una hora inexistente se mueve al primer minuto válido posterior del mismo día. En la repetición de otoño se usa la primera aparición de la hora.

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
- Locks: `<usersRoot>/<userId>/automations/locks/`.
- Señal del worker: `<dataRoot>/automations/worker-status.json`.
- El identificador de ejecución deriva de tarea + instante programado.
- La concesión expira si el proceso muere y se renueva mientras el turno sigue activo.
- La conversación y los mensajes del turno usan ids deterministas. Tras una recuperación, el store y el workbench reutilizan el mismo resultado visible y rechazan duplicados ya terminales.
- Pausar o eliminar una tarea con una ejecución en curso no borra su fence de
  inmediato: el worker recibe la cancelación desde el estado durable, aborta
  cooperativamente el turno y registra el resultado. La tarea deja de ser
  visible al instante, no se reintenta ni vuelve a programarse, y el historial
  conservado mantiene el error y el vínculo a la conversación si ya existía.

Los fallos se guardan y se muestran en la tarea. En horarios recurrentes se calcula la siguiente ocurrencia; una tarea de una sola vez termina aunque su ejecución falle, para evitar reintentos infinitos no solicitados.
