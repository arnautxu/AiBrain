# Runbook QA aislado en Hetzner

Este procedimiento crea una instalación QA sin tocar servicios, redes, volúmenes, puertos, rutas o procesos de terceros presentes en el host. No autoriza DNS, cutover, datos reales, NAS real ni producción.

En los ejemplos, sustituye `<installation>` por un slug nuevo y `<git-sha>` por el commit exacto. No reutilices nombres o rutas de otra instalación.

## 1. Preparar release y configuración

Instala Docker Engine, Compose V2 y Buildx desde los paquetes del host antes de
recibir ningún archivo de release. Verifica `docker version`, `docker compose
version` y `docker buildx version`; el preflight falla antes de crear una
release si falta alguno. En Ubuntu 26.04 el complemento se instala con el
paquete `docker-buildx` y no requiere reiniciar Docker ni contenedores activos.

```bash
install -d -m 0750 /opt/aibrain-<installation>/releases/<git-sha>
install -d -m 0750 /etc/aibrain/<installation>
install -d -m 0550 -o 10001 -g 10001 /srv/aibrain-<installation>/source-ro
install -d -m 0750 -o 10001 -g 10001 /srv/aibrain-<installation>/publish-rw
install -d -m 0700 -o 10001 -g 10001 /srv/aibrain-<installation>/replication
```

Coloca el checkout exacto en `/opt/aibrain-<installation>/releases/<git-sha>` sin modificar otro checkout. Copia y edita:

```bash
cp infra/hetzner/compose.env.example /etc/aibrain/<installation>/compose.env
cp infra/hetzner/aibrain.env.example /etc/aibrain/<installation>/runtime.env
cp infra/hetzner/egress.env.example /etc/aibrain/<installation>/egress.env
cp infra/hetzner/alerts.env.example /etc/aibrain/<installation>/alerts.env
cp infra/hetzner/replica.env.example /etc/aibrain/<installation>/replica.env
cp infra/hetzner/backup-controller.env.example /etc/aibrain/<installation>/backup-controller.env
cp infra/hetzner/installation.qa.example.json /etc/aibrain/<installation>/installation.json
install -m 0600 infra/hetzner/compose.yaml \
  /etc/aibrain/<installation>/release.json.active.compose.yaml
install -m 0400 -o 10001 -g 10001 /dev/null /etc/aibrain/<installation>/restic-password
chmod 0640 /etc/aibrain/<installation>/compose.env /etc/aibrain/<installation>/installation.json
chmod 0600 /etc/aibrain/<installation>/runtime.env /etc/aibrain/<installation>/egress.env \
  /etc/aibrain/<installation>/alerts.env /etc/aibrain/<installation>/replica.env \
  /etc/aibrain/<installation>/backup-controller.env
chown root:10001 /etc/aibrain/<installation>/installation.json
```

Antes de arrancar, crea en los dos roots exclusivos (`/etc/aibrain/<installation>`
y `/srv/aibrain-<installation>`) un `.aibrain-owner.json` regular, no symlink,
con permisos de root y este contenido, cambiando únicamente el identificador:

```json
{"schemaVersion":1,"product":"aibrain","installationId":"company-qa"}
```

Deja ambos markers propiedad del operador, con un solo enlace y sin escritura
de grupo/mundo. No uses hardlinks para ningún env, config, password o marker.

En `compose.env`, usa la convención exacta `aibrain-<installation>` para el
proyecto, red y los tres volúmenes, un puerto loopback libre, rutas host
exclusivas y los dos digests inmutables de app/gateway. Usa paths absolutos para
todos los ficheros y roots. En `installation.json`, cambia identidad, branding y
`publicUrl`, pero conserva exactamente los seis paths internos del ejemplo: son
el contrato de mounts del contenedor.

Instala `infra/hetzner/nginx/default-deny.conf` una sola vez en el host. Renderiza
después un fichero exclusivo por instalación con el renderer estricto, que crea
un fichero nuevo y se niega a sobrescribir o seguir symlinks:

```sh
node scripts/render-nginx-config.mjs \
  --installation company-qa \
  --host brain.example.com \
  --port 3100 \
  --output /tmp/aibrain-company-qa.conf
```

Mueve el candidato a la ruta de Nginx mediante una operación atómica controlada
por el administrador y ejecuta `nginx -t` antes de recargar. El token de
instalación separa upstream y rate-limit zone, por lo que dos empresas pueden
convivir sin colisiones. El template desactiva buffering para chat y uploads,
fija el Host público, sobrescribe los headers de IP del cliente y no publica
CDP, workers ni viewers internos.

Genera cinco secretos de runtime distintos y tres tokens de salida distintos.
No pegues el resultado en terminales grabadas, tickets o commits:

```bash
umask 077
openssl rand -base64 48
```

Completa `runtime.env` con Supabase Auth y los cinco secretos; completa
`egress.env` con los tres tokens; configura `alerts.env` con un webhook HTTPS y
token dedicados; y configura `replica.env` más `restic-password` para el backend
cifrado off-host autorizado. No añadas `SUPABASE_SECRET_KEY`. Consulta los
nombres exactos y la separación obligatoria en `docs/EGRESS_GATEWAY.md` y
`docs/BACKUP_REPLICATION.md`. No continúes con valores `replace-*`.

## 2. Validación estática y build inmutable

Ejecuta primero el preflight de host. Es de solo lectura salvo por reservar y
liberar brevemente el puerto loopback para comprobar exclusividad; no crea, une,
reinicia ni elimina recursos. Si encuentra una red o volumen ya existente, solo
lo acepta cuando sus labels pertenecen a la misma instalación:

```sh
npm run infra:preflight -- \
  --env-file /etc/aibrain/company-qa/compose.env \
  --installation company-qa
```

No continúes si falla. En particular, el preflight rechaza symlinks, roots
solapados, nombres fuera de convención, ownership ajeno y cualquier ruta que
apunte a BGreenly.

Desde el release:

```bash
npm run infra:validate
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml \
  config --quiet
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml \
  -f infra/hetzner/compose.build.yaml \
  build --pull egress-gateway app
docker scout cves --only-severity critical --exit-code \
  aibrain-<installation>:<git-sha>
```

No uses `docker compose config` sin `--quiet`: su salida puede incluir variables del runtime. No publiques la imagen desde este runbook. El gate de vulnerabilidades debe quedar verde; si Docker Scout no está disponible, ejecuta un scanner equivalente actualizado y conserva el informe. No aceptes una vulnerabilidad crítica sin documentar paquete, explotabilidad, mitigación, versión corregida y responsable/fecha de actualización.

Obtén la versión exacta de Chromium desde el tag construido:

```bash
docker run --rm --entrypoint /usr/bin/chromium \
  aibrain-<installation>:<git-sha> --version
```

Escribe solo los cuatro componentes numéricos en `AIBRAIN_CHROME_EXPECTED_VERSION` de `runtime.env`, vuelve a ejecutar `config --quiet` y conserva como evidencia el tag, digest local, commit, versión Codex `0.149.1` y versión Chromium.

El snapshot Debian fija el índice de paquetes aceptado al construir y el
entrypoint fija la versión de Chromium aceptada al arrancar. Registra también
`dpkg-query -W chromium chromium-sandbox libreoffice-core poppler-utils qpdf`
dentro de la imagen, sus checksums y la SBOM. Conserva además los dos digests de
imagen promovidos para que la reconstrucción no sea el mecanismo de rollback.

## 3. Primer arranque QA

Comprueba que el puerto no está ocupado y que los nombres no existen antes de crear nada:

```bash
ss -ltn | grep ':<qa-port> ' || true
docker network inspect aibrain-<installation>-private >/dev/null 2>&1 && exit 1 || true
docker network inspect aibrain-<installation>-egress >/dev/null 2>&1 && exit 1 || true
docker volume inspect aibrain-<installation>-data >/dev/null 2>&1 && exit 1 || true
docker volume inspect aibrain-<installation>-backups >/dev/null 2>&1 && exit 1 || true
docker volume inspect aibrain-<installation>-restores >/dev/null 2>&1 && exit 1 || true
```

Si cualquiera de esos recursos pertenece a otro stack, detente: no lo conectes, renombres o elimines. Arranca solo AiBrain:

```bash
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml \
  up -d --no-deps egress-gateway app alert-dispatcher
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml \
  ps
```

El entrypoint prueba, antes de Next.js, UID no-root, secretos, config, toolchain,
versiones Codex/Chromium, mounts y los namespaces de workers y browser. Para el
browser crea dos empleados sintéticos efímeros: el proceso debe ver su propio
marker, no el del hermano ni el de `publish-rw`; después elimina únicamente
estos roots sintéticos. Cualquier fallo bloquea el servicio.

Comprueba las fronteras del servidor sin mostrar secretos:

```bash
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml \
  exec -T app sh -c \
  'test "$(id -u)" -ne 0 && test ! -w /srv/aibrain/source-ro && test -w /srv/aibrain/publish-rw && test ! -S /var/run/docker.sock'
```

El único puerto publicado debe ser `<bind-address>:<qa-port>->3000`. CDP no usa
red: cada Chrome recibe un canal privado heredado por descriptores 3/4 y
`--remote-debugging-pipe`. No debe existir listener CDP, URL de discovery ni
`DevToolsActivePort` dentro del contenedor. Verifícalo además de comprobar
`docker compose ps`; no montes `docker.sock` para administrar browsers.

## 4. Diagnóstico seguro

```bash
docker inspect --format '{{.State.Health.Status}} {{.RestartCount}}' \
  "$(docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml ps -q app)"
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml \
  logs --tail 200 app alert-dispatcher
docker stats --no-stream \
  "$(docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml ps -q app)"
```

No ejecutes `env`, `docker inspect` completo ni Compose config sin `--quiet` en una sesión compartida. `alert-dispatcher` persiste outbox y dedupe, comprueba app, gateway, data, publicación, snapshot y receipt off-host y entrega solo payloads saneados al webhook HTTPS. Un URL/token real y la comprobación de recepción siguen siendo gates externos de cada instalación.

## 5. Backup y restore QA reales

El endpoint de operador no se publica por Nginx: solo responde en el puerto app ligado a loopback. Configura `AIBRAIN_MAINTENANCE_SECRET` independiente y usa el origen público exacto. Instala el controlador y su recovery de boot desde el mismo commit revisado:

```bash
install -d -m 0755 /usr/local/lib/aibrain
install -m 0555 scripts/orchestrate-backup.mjs /usr/local/lib/aibrain/orchestrate-backup.mjs
install -m 0644 infra/hetzner/systemd/aibrain-backup-recovery@.service \
  /etc/systemd/system/aibrain-backup-recovery@.service
systemctl daemon-reload
systemctl enable aibrain-backup-recovery@<installation>.service
```

Completa `backup-controller.env` con las rutas exactas, puerto loopback y origen de esa instalación. El controlador toma el secreto directamente del `runtime.env` privado; nunca lo recibe por argumento ni lo imprime. Ejecuta:

```bash
node /usr/local/lib/aibrain/orchestrate-backup.mjs backup \
  --installation-id <installation> \
  --env-file /etc/aibrain/<installation>/compose.env \
  --compose-file /etc/aibrain/<installation>/release.json.active.compose.yaml \
  --runtime-env /etc/aibrain/<installation>/runtime.env \
  --state-file /etc/aibrain/<installation>/backup-operation.json \
  --maintenance-url http://127.0.0.1:<qa-port>/api/operations/maintenance \
  --origin https://<public-host>
```

El controlador persiste `prepared → drained → app-stopped → snapshot-created →
snapshot-verified → app-restarted → admission-resumed`, verifica identidad del
snapshot y solo entonces emite un receipt `verified`. Cualquier error ejecuta
recovery antes de salir y deja receipt `aborted` si no existe snapshot
verificado. Tras `SIGKILL` o reboot, la unidad systemd revalida el journal,
verifica un snapshot creado, arranca app, espera health y reabre admisión. Nunca
borres el journal para desbloquear: ejecuta el comando `recover` exacto si la
unidad falla y conserva su error.

Restaura siempre al volumen separado, nunca sobre el root activo:

```bash
docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml run --rm --no-deps app \
  aibrain-backup restore \
  --snapshot /var/lib/aibrain/data/backups/snapshots/<backup-id> \
  --data-destination /var/lib/aibrain-restores/<backup-id>-data \
  --publish-destination /var/lib/aibrain-restores/<backup-id>-publish
```

Para probar el restore, crea un volumen de datos nuevo y un host path documental QA nuevo. Copia cada componente únicamente a su destino aislado. Ambos deben pertenecer a la instalación de restore:

```bash
docker volume create aibrain-<installation>-restore-<backup-id>-data
docker run --rm --entrypoint /bin/sh \
  --mount source=aibrain-<installation>-restores,target=/restores,readonly \
  --mount source=aibrain-<installation>-restore-<backup-id>-data,target=/var/lib/aibrain/data \
  aibrain-<installation>:<git-sha> \
  -c 'cp -a /restores/<backup-id>-data/. /var/lib/aibrain/data/'

install -d -m 0700 -o 10001 -g 10001 /srv/aibrain-<installation>-restore-<backup-id>/publish-rw
docker run --rm --entrypoint /bin/sh \
  --mount source=aibrain-<installation>-restores,target=/restores,readonly \
  --mount type=bind,source=/srv/aibrain-<installation>-restore-<backup-id>/publish-rw,target=/publish-rw \
  aibrain-<installation>:<git-sha> \
  -c 'cp -a /restores/<backup-id>-publish/. /publish-rw/'
```

Crea un segundo `compose.env` con proyecto, red, puerto, data volume, backup volume, restore volume y publish host nuevos. Usa una copia del `installation.json` original: conserva `installationId` y los paths internos para que los manifests restaurados sigan vinculados a su instalación; cambia únicamente `publicUrl` al origen QA aislado si es necesario. Apunta `AIBRAIN_DATA_VOLUME_NAME` al volumen recién creado y `AIBRAIN_PUBLISH_HOST_PATH` al host path documental restaurado. Lanza ese segundo Compose y valida health, login sintético, proyectos, threads, journals, artefactos y documentos publicados; luego detenlo. No ejecutes primaria y restore contra los mismos recursos externos, y no elimines snapshot, restore, volumen validado o root anterior como parte de la prueba.

Reinicia la instancia primaria y valida recovery:

```bash
docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml up -d --no-deps egress-gateway app alert-dispatcher
```

La copia cifrada fuera del servidor, sus credenciales y la prueba del proveedor externo son gates externos.

## 6. Release y rollback

Antes de un release, completa maintenance/drain, backup/verify, SBOM, scan y tests. Construye con `compose.build.yaml` y `AIBRAIN_REVISION=<git-sha>`, publica la imagen en el registry aprobado y resuelve su digest `sha256`. El Compose runtime no contiene `build:` y nunca acepta un tag mutable.

Promueve mediante el gestor transaccional. Este verifica que ambos digests
existen localmente, que sus labels OCI coinciden con el commit, valida Compose,
acepta un `compose.target.env` completo para versionar también límites de
CPU/RAM sin cambiar rutas o recursos de aislamiento, y selecciona sus valores
mediante journal durable. Espera los tres
healthchecks, verifica la identidad de las imágenes realmente ejecutadas y
registra `current`/`previous` junto con bytes y hashes exactos de env, Compose
fuente/efectivo, seccomp e InstallationConfig. Si cualquiera falla, restaura los inputs y ambos
digests anteriores y exige que los tres servicios vuelvan a estar healthy. El
journal recupera SIGKILL o
reboot sin adivinar el estado; procedimiento y códigos: `docs/RELEASES.md`.

```bash
node scripts/manage-release.mjs promote \
  --image registry.example/aibrain@sha256:<64-hex> \
  --egress-image registry.example/aibrain-egress@sha256:<64-hex> \
  --revision <git-sha> \
  --installation-id <installation> \
  --env-file /etc/aibrain/<installation>/compose.env \
  --target-env-file /etc/aibrain/<installation>/compose.target.env \
  --compose-file /opt/aibrain-<installation>/releases/<git-sha>/infra/hetzner/compose.yaml \
  --current-compose-file /opt/aibrain-<installation>/releases/<previous-sha>/infra/hetzner/compose.yaml \
  --installation-config /opt/aibrain-<installation>/releases/<git-sha>/config/installation.json \
  --state-file /etc/aibrain/<installation>/release.json
```

Rollback usa únicamente el digest previo firmado en el estado durable y vuelve a verificar su label/health:

```bash
node scripts/manage-release.mjs rollback \
  --installation-id <installation> \
  --env-file /etc/aibrain/<installation>/compose.env \
  --state-file /etc/aibrain/<installation>/release.json
```

No borres imágenes, releases, volúmenes ni backups. Si el release migró datos incompatibles, detén `app`, valida el snapshot y arranca una instalación QA aislada sobre el restore antes de cambiar cualquier ruta activa.

## 7. Gates externos pendientes

- Docker build y Compose deben ejecutarse en el host QA; Docker no está disponible en el Mac de desarrollo actual.
- El kernel/daemon del host debe pasar el preflight real de `bubblewrap`, seccomp y sandbox de Chromium.
- El canal CDP heredado y el sidecar de egress ya tienen gates locales. Deben
  repetirse en la imagen QA con dos empleados para obtener evidencia del
  aislamiento Docker, pinning DNS y bloqueo privado/metadata en el host real.
- La base, el snapshot Debian y los paquetes Node están fijados. Falta ejecutar build limpio, SBOM y scan sobre la imagen resultante en el host QA antes de considerarla promovible.
- Faltan credenciales reales de Supabase Auth y login de una suscripción Codex dedicada.
- La réplica cifrada fuera del servidor y el webhook de alertas deben configurarse con credenciales reales y probarse contra sus proveedores.
- DNS, TLS público, NAS/documental real y cutover requieren autorización separada.
