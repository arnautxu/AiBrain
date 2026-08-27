# Alertas operativas

AiBrain separa evaluación, outbox y entrega. El evaluator solo produce códigos y métricas acotadas; nunca acepta texto libre, paths, usuarios, documentos, cookies o credenciales. El delivery file-backed genera transiciones `raised`, `updated` y `resolved`, deduplica por código+severidad+umbral, conserva generación, aplica retry/backoff y escribe un receipt antes de retirar el job del outbox.

## Colector local

El comando se ejecuta dentro del contenedor `app`, donde puede consultar readiness por loopback y medir el filesystem real sin `docker.sock`:

```bash
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml exec -T app \
  aibrain-alerts \
  --restart-count-15m <n> \
  --preflight-failure-count-15m <n>
```

Los dos contadores son obligatorios. El controlador host debe calcularlos para la ventana exacta de 15 minutos desde su supervisor/event log; AiBrain no asume cero y no monta el socket Docker. El colector añade:

- `GET http://127.0.0.1:3000/api/health/ready`, sin redirects;
- uso real del filesystem de `dataRoot`;
- receipt local de backup verificado y su edad de creación/verificación.

El sink operativo por defecto es durable y local bajo `dataRoot/operations/alerts/local-sink`; estado, outbox y receipts viven en `dataRoot/operations/alerts/delivery`. Repetir el mismo estado no genera otra entrega. Cambios de valor que no cruzan severidad/umbral tampoco generan ruido; el valor observado se conserva en la transición material.

## Canal externo

`WebhookAlertSink` es el adapter HTTPS: exige URL sin credenciales, `Idempotency-Key`, timeout, códigos de error sanitizados y receipt hasheado. No persiste URL, bearer token, response body ni detalle privado. El destino real, token y allowlist exacta del egress gateway son configuración externa pendiente por instalación; no se ha enviado ninguna alerta durante la implementación local.

Hasta completar esa configuración, un agente host puede exportar los eventos ya sanitizados del sink local. No debe enviar otros ficheros de `dataRoot`. La activación del webhook debe probar retry, 4xx, 429, 5xx, timeout, dedupe y resolución antes de producción.

## Evidencia local

```bash
npx vitest run \
  src/operations/alerts.test.ts \
  src/operations/alert-collector.test.ts \
  src/operations/alert-delivery.test.ts \
  tests/integration/alerts-cli.integration.test.ts
```

La integración arranca un endpoint loopback sintético y ejecuta el CLI en procesos separados. Comprueba entrega durable, replay sin duplicados y rechazo de ejecución sin contadores host.
