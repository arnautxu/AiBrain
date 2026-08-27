# Soak operativo y detección de fugas

`npm run --silent test:soak` ejecuta un ensayo local reproducible sobre el runtime real de workers y el transporte WebSocket privado. Cada worker tiene sus propios roots, proceso App Server sintético, listener loopback, sockets, journals de gateway/cliente y cursor de entrega. No usa Supabase, una cuenta Codex, datos de empresa, Docker ni servicios externos.

El workload valida de forma concurrente:

- request y evento streaming asociados al mismo `clientRequestId`;
- persistencia file-backed y ACK durable;
- evento pendiente recuperado tras stop/start;
- reenvío idempotente del mismo request después del restart;
- ausencia de eventos antiguos o cruzados en ciclos posteriores;
- cierre de procesos, listeners, sockets, handles y listeners de handles;
- crecimiento absoluto y pendiente temporal de RSS, heap y memoria externa;
- retorno al baseline de recursos activos y de cada tipo de recurso;
- compacción atómica y límites absolutos de bytes/records de journals por worker;
- latencia mínima, media, p50, p95 y máxima con una muestra acotada.

## Gate local por defecto

```bash
npm run --silent test:soak -- \
  --duration-ms 120000 \
  --concurrency 4 \
  --restart-every 20 \
  --sample-ms 1000
```

El JSON final se escribe en stdout y los logs operativos JSONL, ya redactados, en stderr. El comando termina con código distinto de cero si supera cualquier límite. Sin `--work-root`, crea un directorio temporal único y lo elimina al acabar. Para conservar los journals de una ejecución QA, usa únicamente un padre absoluto dedicado y vacío de datos reales:

```bash
npm run --silent test:soak -- --work-root /var/tmp/aibrain-soak-qa --duration-ms 3600000 --concurrency 20
```

El harness crea siempre un subdirectorio `run-<uuid>` y nunca elimina un `--work-root` suministrado por el operador.

## Perfil QA largo

```bash
npm run --silent test:soak:qa > /var/tmp/aibrain-soak-report.json
```

El perfil QA dura ocho horas, usa veinte workers, toma muestras cada treinta segundos y fuerza restart/replay cada cien ciclos. Ejecutarlo dentro de la instalación QA aislada, nunca dentro del Compose o de los volúmenes de BGreenly. Registrar commit, host, CPU/RAM, timestamps, exit code y SHA-256 del informe. No declarar el gate completo usando solo el ensayo corto local.

## Criterios por defecto

- cero procesos, listeners, sockets, handles o listeners retenidos respecto al baseline;
- crecimiento steady-state máximo de 128 MiB RSS, 64 MiB heap y 32 MiB externa;
- pendiente máxima de 32 MiB/min RSS, 16 MiB/min heap y 8 MiB/min externa cuando existen al menos noventa segundos de muestras estables; los ensayos más cortos siguen aplicando los límites absolutos, pero no confunden el calentamiento de V8 con una fuga temporal;
- cero crecimiento residual de recursos activos o de cualquier tipo de recurso después del cierre;
- máximo de tres journals JSONL por worker;
- máximo de 16 KiB de journal por evento streaming medido.
- máximo de 8 MiB y 1.024 records de journal por worker.

Los límites son guardrails operativos, no cuotas comerciales. El informe conserva baseline, inicio estable, pico agregado, estado antes del cierre y estado después del cierre para distinguir capacidad activa de una fuga. Producción conserva por defecto un tail durable de 256 eventos entregados y 4.096 requests completadas, más todos los pendientes/resultados inciertos. El harness usa ventanas de 64 para forzar y verificar compacción incluso en el ensayo corto. La compacción mantiene secuencia/cursor fuera del fichero regenerable y usa sustitución atómica bajo lock. Así, bytes y records alcanzan un plateau en vez de crecer indefinidamente, sin perder replay pendiente ni resultados inciertos.

## Prueba automatizada

```bash
npx vitest run src/operations/soak.test.ts
```

La regresión ejecuta dos workers, dos ciclos y restart/replay en cada ciclo. El segundo ciclo falla si recibe un evento del primero. También exige que el cierre vuelva a cero de crecimiento para sockets, listeners, child processes y listeners registrados.
