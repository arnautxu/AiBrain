# Runbook QA aislado en Hetzner

Este procedimiento crea una instalación QA sin tocar servicios, redes, volúmenes, puertos, rutas o procesos de terceros presentes en el host. No autoriza DNS, cutover, datos reales, NAS real ni producción.

En los ejemplos, sustituye `<installation>` por un slug nuevo y `<git-sha>` por el commit exacto. No reutilices nombres o rutas de otra instalación.

## 1. Preparar release y configuración

```bash
install -d -m 0750 /opt/aibrain-<installation>/releases/<git-sha>
install -d -m 0750 /etc/aibrain/<installation>
install -d -m 0550 -o 10001 -g 10001 /srv/aibrain-<installation>/source-ro
install -d -m 0750 -o 10001 -g 10001 /srv/aibrain-<installation>/publish-rw
```

Coloca el checkout exacto en `/opt/aibrain-<installation>/releases/<git-sha>` sin modificar otro checkout. Copia y edita:

```bash
cp infra/hetzner/compose.env.example /etc/aibrain/<installation>/compose.env
cp infra/hetzner/aibrain.env.example /etc/aibrain/<installation>/runtime.env
cp infra/hetzner/installation.qa.example.json /etc/aibrain/<installation>/installation.json
chmod 0640 /etc/aibrain/<installation>/compose.env /etc/aibrain/<installation>/installation.json
chmod 0600 /etc/aibrain/<installation>/runtime.env
chown root:10001 /etc/aibrain/<installation>/installation.json
```

Antes de arrancar, crea en los dos roots exclusivos (`/etc/aibrain/<installation>`
y `/srv/aibrain-<installation>`) un `.aibrain-owner.json` regular, no symlink,
con permisos de root y este contenido, cambiando únicamente el identificador:

```json
{"schemaVersion":1,"product":"aibrain","installationId":"company-qa"}
```

En `compose.env`, usa la convención exacta `aibrain-<installation>` para el
proyecto, red y los tres volúmenes, un puerto loopback libre, rutas host
exclusivas y el tag `aibrain-<installation>:<git-sha>`. Usa paths absolutos para
los dos ficheros montados. En `installation.json`, cambia identidad, branding y
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

Genera cuatro secretos distintos. No pegues el resultado en terminales grabadas, tickets o commits:

```bash
umask 077
openssl rand -base64 48
```

Completa `runtime.env` con Supabase Auth y los secretos. No añadas `SUPABASE_SECRET_KEY`.

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
  build --pull app
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

Este check fija la versión aceptada al arrancar, no el artifact de build: APT puede resolver otra versión en una reconstrucción futura. Registra también `dpkg-query -W chromium chromium-sandbox libreoffice-core poppler-utils qpdf` dentro de la imagen y su SBOM. El build solo será reproducible cuando estas dependencias procedan de snapshot/artifacts con checksums fijos o de una imagen interna inmutable ya escaneada.

## 3. Primer arranque QA

Comprueba que el puerto no está ocupado y que los nombres no existen antes de crear nada:

```bash
ss -ltn | grep ':<qa-port> ' || true
docker network inspect aibrain-<installation>-private >/dev/null 2>&1 && exit 1 || true
docker volume inspect aibrain-<installation>-data >/dev/null 2>&1 && exit 1 || true
docker volume inspect aibrain-<installation>-backups >/dev/null 2>&1 && exit 1 || true
docker volume inspect aibrain-<installation>-restores >/dev/null 2>&1 && exit 1 || true
```

Si cualquiera de esos recursos pertenece a otro stack, detente: no lo conectes, renombres o elimines. Arranca solo AiBrain:

```bash
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml \
  up -d --no-deps app
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
  logs --tail 200 app
docker stats --no-stream \
  "$(docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml ps -q app)"
```

No ejecutes `env`, `docker inspect` completo ni Compose config sin `--quiet` en una sesión compartida. Alerta ante `unhealthy`, tres reinicios en 15 minutos, disco/volumen mayor al 80 %, ausencia de backup verificado o errores de sandbox/publicación. El envío de esas alertas al canal del cliente requiere integración externa y no forma parte del repositorio.

## 5. Backup y restore QA reales

Primero drena turns y mutaciones desde la aplicación. Después detén `app` para congelar el filesystem:

```bash
docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml stop app
docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml run --rm --no-deps app aibrain-backup create
```

Anota `backupId`, `sourceFingerprint` y `fileCount`. Verifica el snapshot indicado por el comando:

```bash
docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml run --rm --no-deps app \
  aibrain-backup verify --snapshot /var/lib/aibrain/data/backups/snapshots/<backup-id>
```

Restaura siempre al volumen separado, nunca sobre el root activo:

```bash
docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml run --rm --no-deps app \
  aibrain-backup restore \
  --snapshot /var/lib/aibrain/data/backups/snapshots/<backup-id> \
  --destination /var/lib/aibrain-restores/<backup-id>
```

Para probar el restore, crea un volumen de datos nuevo y copia dentro únicamente el root restaurado. El volumen de destino debe ser nuevo y pertenecer a la instalación de restore:

```bash
docker volume create aibrain-<installation>-restore-<backup-id>-data
docker run --rm --entrypoint /bin/sh \
  --mount source=aibrain-<installation>-restores,target=/restores,readonly \
  --mount source=aibrain-<installation>-restore-<backup-id>-data,target=/var/lib/aibrain/data \
  aibrain-<installation>:<git-sha> \
  -c 'cp -a /restores/<backup-id>/. /var/lib/aibrain/data/'
```

Crea un segundo `compose.env` con proyecto, red, puerto, data volume, backup volume, restore volume y publish host nuevos. Usa una copia del `installation.json` original: conserva `installationId` y los paths internos para que los manifests restaurados sigan vinculados a su instalación; cambia únicamente `publicUrl` al origen QA aislado si es necesario. Apunta `AIBRAIN_DATA_VOLUME_NAME` al volumen recién creado. Lanza ese segundo Compose y valida health, login sintético, proyectos, threads, journals y artefactos; luego detenlo. No ejecutes primaria y restore contra los mismos recursos externos, y no elimines snapshot, restore, volumen validado o root anterior como parte de la prueba.

Reinicia la instancia primaria y valida recovery:

```bash
docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml up -d --no-deps app
```

La copia cifrada fuera del servidor, sus credenciales y la prueba del proveedor externo son gates externos.

## 6. Release y rollback

Antes de un release, completa backup/verify y conserva el tag anterior. Construye el nuevo commit con un tag nuevo, ejecuta `node scripts/validate-infra.mjs`, `config --quiet`, smoke y tests. Cambia solo `AIBRAIN_IMAGE` en `compose.env` y recrea `app`:

```bash
docker compose --env-file /etc/aibrain/<installation>/compose.env -f infra/hetzner/compose.yaml up -d --no-deps app
```

Para rollback de código, repón el tag anterior en `AIBRAIN_IMAGE` y repite el mismo comando. No borres imágenes, releases, volúmenes ni backups. Si el release migró datos incompatibles, detén `app`, valida el snapshot y arranca una instalación QA aislada sobre el restore antes de cambiar cualquier ruta activa.

## 7. Gates externos pendientes

- Docker build y Compose deben ejecutarse en el host QA; Docker no está disponible en el Mac de desarrollo actual.
- El kernel/daemon del host debe pasar el preflight real de `bubblewrap`, seccomp y sandbox de Chromium.
- El canal CDP heredado y sin socket debe repetirse en la imagen QA con dos
  empleados. Sigue pendiente validar en el host la política de egress del
  browser, incluido pinning DNS y bloqueo de destinos privados/metadata.
- La base, el snapshot Debian y los paquetes Node están fijados. Falta ejecutar build limpio, SBOM y scan sobre la imagen resultante en el host QA antes de considerarla promovible.
- Faltan credenciales reales de Supabase Auth y login de una suscripción Codex dedicada.
- La réplica cifrada fuera del servidor y el canal de alertas deben configurarse y probarse.
- DNS, TLS público, NAS/documental real y cutover requieren autorización separada.
