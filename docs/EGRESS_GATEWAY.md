# Runbook del gateway de egress

## Límite de red

En producción `app` pertenece únicamente a `aibrain-internal`, una red Docker
con `internal: true`. No tiene una ruta directa a Internet. `egress-gateway` es
el único servicio conectado a esa red y a `aibrain-egress`; no publica puertos
en el host, no monta volúmenes y no recibe `docker.sock`. La imagen se construye
desde el target propio `egress-gateway` del `Dockerfile`, sobre el mismo digest
Node fijado, y se ejecuta sin root, capabilities ni filesystem escribible.

Cada instalación debe usar nombres distintos para ambas redes. Ninguna puede
ser externa ni coincidir con BGreenly. El preflight verifica nombres, labels de
propiedad, ficheros y digests antes de levantar servicios.

## Política y autenticación

El gateway escucha solo dentro de Compose en `http://egress-gateway:8080`. Los
tres tokens son independientes y seleccionan la política; un header de canal no
tiene autoridad:

| Canal | Autenticación | Destinos |
| --- | --- | --- |
| browser | `Proxy-Authorization: Bearer <browser-token>` más `X-AiBrain-Pinned-IP` | La IP global que `BrowserNetworkPolicy` ya resolvió y fijó; solo 80/443 |
| worker | Bearer o Basic con usuario fijo `aibrain` y password `<worker-token>` | Hosts DNS exactos en `AIBRAIN_EGRESS_WORKER_HOSTS`; CONNECT/443 |
| server | Bearer o Basic con usuario fijo `aibrain` y password `<server-token>` | Host exacto de `AIBRAIN_EGRESS_SUPABASE_ORIGIN`; CONNECT/443 |

Worker y server resuelven el nombre una sola vez por conexión, rechazan toda la
respuesta si contiene una IP no global y conectan directamente a una de las IP
aprobadas. Así no existe una segunda resolución entre autorización y socket.
Browser no resuelve de nuevo en el sidecar. En todos los canales se rechazan
loopback, RFC1918, link-local, CGNAT, rangos de documentación, multicast,
metadata cloud, credenciales en el destino y puertos fuera de política.

Los CONNECT conservan el hostname en el cliente: TLS, SNI y validación del
certificado siguen ocurriendo en Chrome/Codex/Node, no en el gateway.

## Preparación por instalación

Crear `/etc/aibrain/<installation>/egress.env` desde
`infra/hetzner/egress.env.example`, modo `0600`. Generar cada token por separado:

```sh
openssl rand -hex 48
```

No reutilizar tokens entre canales o instalaciones. `AIBRAIN_EGRESS_WORKER_HOSTS`
es una lista CSV de nombres exactos, sin wildcard, esquema, puerto ni path. Se
deben añadir únicamente hosts observados como imprescindibles con el Codex
fijado; un endpoint nuevo debe pasar QA antes de ampliar producción.
`AIBRAIN_EGRESS_SUPABASE_ORIGIN` debe coincidir exactamente con
`NEXT_PUBLIC_SUPABASE_URL` y no concede acceso a ningún otro servicio Supabase.

El proceso server construye internamente la URL Basic con `URL`, que aplica
percent-encoding al token, activa `NODE_USE_ENV_PROXY=1` y nunca imprime esa URL.
El worker recibe solo una URL construida igual con su token. Su entorno se crea
desde una allowlist; no hereda los secretos de sesión, publicación, Supabase,
browser ni server. No guardar URLs autenticadas en Compose, argumentos, logs,
journals o ficheros del usuario.

Integración de conectores:

- Browser: el proxy loopback por usuario exige Basic con un secreto aleatorio
  por runtime que Chrome recibe solo mediante `Fetch.authRequired` sobre el pipe
  CDP heredado. Después elimina ese header y envía al sidecar el Bearer de
  browser y `X-AiBrain-Pinned-IP`. Un worker no recibe el secreto y no puede
  usar el proxy para ampliar su allowlist.
- Worker: construir server-side
  `http://aibrain:<percent-encoded-worker-token>@egress-gateway:8080` para
  `HTTP_PROXY`, `HTTPS_PROXY` y `ALL_PROXY`; `NO_PROXY=127.0.0.1,localhost,::1`.
- Server: el entrypoint configura esas variables con el token server; solo el
  origen Supabase configurado puede atravesar el canal.

## Arranque y diagnóstico

Validar antes del primer arranque y después de cada cambio:

```sh
npm run infra:validate
node scripts/validate-host-preflight.mjs \
  --env-file /etc/aibrain/<installation>/compose.env \
  --installation <installation>
docker compose --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml config --quiet
```

El healthcheck consulta `GET /__aibrain_egress_health` por loopback dentro del
sidecar. El endpoint devuelve únicamente estado y contadores, y responde 404 a
clientes de la red. No expone política, destinos ni secretos. Para inspección:

```sh
docker compose --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml ps app egress-gateway
```

Un 403 significa política/destino/pin rechazado; 407 autenticación inválida;
429 saturación; 504 timeout de conexión. No registrar la URL ni tokens al
investigar. Si un host imprescindible cambia, demostrar el destino exacto en QA,
actualizar solo la allowlist de esa instalación y reiniciar el sidecar; nunca
conectar temporalmente `app` a la red egress.

## Release y rollback

App y gateway forman una unidad de release. Ambos digests deben llevar el mismo
label OCI de revisión. `manage-release.mjs promote` exige `--image`,
`--egress-image` y un env candidato completo, verifica digest y revisión de
ambos, selecciona los inputs bajo journal durable, arranca los tres servicios
(`app`, gateway y alertas) y exige sus healthchecks. Ante fallo restaura ambos
digests y los inputs versionados; rollback usa el registro V3 atestado. No
promover manualmente uno de los servicios.

Las pruebas sintéticas locales cubren autenticación cruzada, DNS mixto/privado,
metadata, puertos, exactitud de Supabase, pin browser, stripping de credenciales,
reuso idempotente y promoción/recuperación de los dos digests sin red externa.

Riesgo operativo restante: los hosts legítimos de OpenAI/Supabase y sus rangos
globales pueden cambiar. El diseño falla cerrado; la validación real de la
suscripción y del proyecto Supabase sigue siendo una tarea QA con credenciales,
no un motivo para ampliar a wildcards o devolver salida directa a `app`.
