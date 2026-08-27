# Automatizaciones programadas

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

En producción debe ejecutarse como servicio independiente con el mismo usuario, imagen, `AIBRAIN_INSTALLATION_CONFIG`, volumen de datos y credenciales Codex que la aplicación. Configure reinicio automático y parada con `SIGTERM`; nunca ejecute dos workers como sustituto de alta disponibilidad. El lock con lease evita que dos procesos reclamen la misma ocurrencia, pero ambos necesitan acceso al mismo volumen.

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
- Los mensajes del turno usan ids deterministas. Tras una recuperación, el store y el workbench rechazan duplicados ya terminales.

Los fallos se guardan y se muestran en la tarea. En horarios recurrentes se calcula la siguiente ocurrencia; una tarea de una sola vez termina aunque su ejecución falle, para evitar reintentos infinitos no solicitados.
