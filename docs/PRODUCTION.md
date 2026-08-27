# Operación de AiBrain en servidor dedicado

AiBrain se despliega como una instalación white-label independiente por empresa. La misma imagen sirve para otra compañía cambiando únicamente `InstallationConfig`, secretos, branding, rutas host, nombres de red/volúmenes, puerto e imagen de release. No existen servicios, usuarios o rutas funcionales precreados para una empresa concreta.

El stack de QA está en `infra/hetzner/compose.yaml` y su procedimiento reproducible en [HETZNER_MIGRATION.md](HETZNER_MIGRATION.md). No debe exponerse a tráfico real hasta completar allí todos los gates externos.

## Fronteras de seguridad

- Next.js, el publicador documental y los App Servers ejecutan como UID/GID no-root configurable; el root filesystem del contenedor es read-only y todas las capabilities están eliminadas.
- `sourceReadRoot` es un bind mount `ro` para Next.js y los workers.
- `publishWriteRoot` solo es writable por el proceso servidor/publicador. Cada App Server se ejecuta con `bubblewrap`: el root se vuelve read-only y `dataRoot` queda oculto. Solo se reexponen el contexto corporativo/documental de lectura, los tres Markdown privados del empleado y sus raíces runtime/workspace/staging/artifacts/audit. Perfiles Chromium, sesiones, backups y carpetas de otros empleados no son legibles; `publish-rw` se reemplaza por un mount vacío read-only.
- El arranque falla si el host no puede crear ese namespace o si `source-ro` es writable. No hay fallback de worker sin aislamiento.
- No se monta `docker.sock`, no se usan redes/volúmenes externos y todos sus nombres son obligatoriamente únicos por instalación.
- Chromium usa un canal CDP heredado por proceso (`--remote-debugging-pipe`),
  y un launcher `bubblewrap` separado por empleado. El namespace oculta todo
  `dataRoot`, reexpone únicamente su `browserRoot`, aísla PID/IPC/UTS y enmascara
  tanto `source-ro` como `publish-rw`. El seccomp no permite `ptrace` ni
  `process_vm_*` sin `CAP_SYS_PTRACE`, capability que Compose elimina.
  sin socket TCP, discovery URL ni `DevToolsActivePort`; perfiles, targets y
  descargas se aíslan por empleado y thread. No se publican puertos CDP o
  viewers internos.
- LibreOffice, Poppler y QPDF se ejecutan siempre mediante launchers `bubblewrap`
  sin red ni capabilities y con PID/IPC/UTS privados. El namespace oculta
  configuración, estado de producto, `source-ro` y `publish-rw`, y reexpone
  únicamente el directorio desechable de esa conversión como `/work`. El
  launcher rechaza rutas absolutas externas y traversal. LibreOffice además
  exige headless/safe mode, perfil privado, `--norestore` y seguridad de macros
  `Very High`; los uploads OOXML con macros ya se rechazan antes de convertir.
  El entrypoint prueba esta frontera con los cinco launchers y falla cerrado.
  La cancelación HTTP se propaga al proceso nativo con terminación forzada;
  `--die-with-parent` elimina su árbol, el `finally` borra el work privado y
  libera el slot compartido.
- Los logs Docker tienen rotación y buffer no bloqueante. No se debe ejecutar `docker compose config` sin `--quiet` en registros compartidos porque puede materializar variables del `env_file`.

## Persistencia

```text
/var/lib/aibrain/data/                 estado file-backed, sesiones y empleados
/var/lib/aibrain/data/users/<uuid>/    CODEX_HOME, workspace, staging, artefactos, browser y auditoría privados
/var/lib/aibrain/data/backups/         volumen de snapshots separado
/var/lib/aibrain-restores/             volumen de restauraciones QA, nunca root activo
/srv/aibrain/source-ro/                repositorio documental oficial, solo lectura
/srv/aibrain/publish-rw/               destino oficial, escritura solo server-side confirmada
```

Los límites de CPU, memoria, PIDs, descriptores, tmpfs y arranques de navegador
protegen frente a saturación. `AIBRAIN_DOCUMENT_MAX_CONVERSIONS` limita los
conversores nativos simultáneos en toda la instalación mediante slots
filesystem compartidos entre procesos y empleados; si están ocupados se
devuelve `429 Retry-After` antes de arrancar otro binario. Los slots tienen
heartbeat y se recuperan tras la caída de su proceso propietario. Estos límites
no son cuotas comerciales de empleados, proyectos, chats, turns o tokens; se
amplían cambiando recursos/configuración, no código.

El upload completo también usa slots compartidos
(`AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS`). Antes de leer el multipart se mide el
volumen y se reserva de forma conservadora el peor caso de todos los uploads
simultáneos (`AIBRAIN_DOCUMENT_WORST_CASE_ACTIVE_BYTES`, 512 MiB por defecto),
además del mayor margen entre `AIBRAIN_MINIMUM_FREE_BYTES` y
`AIBRAIN_MINIMUM_FREE_RATIO`. Si no cabe ese burst sin degradar el host, la API
devuelve `429 Retry-After` y no persiste el body. Es backpressure operativo de
la instalación, no una cuota de usuario.

El volumen oficial `publishWriteRoot` se mide de forma independiente. Cada
confirmación adquiere un gate global entre procesos y reserva el tamaño del
candidato sobre el mayor suelo entre bytes y ratio libre. Si falta margen,
responde `429 Retry-After`; si no puede medirse, responde `503`. En ambos casos
la operación permanece pendiente y no se crea versión ni se toca el destino.
Readiness y alertas evalúan también este volumen separado.

Los restos de una caída se inspeccionan y recuperan con
`aibrain-document-maintenance`; el modo predeterminado es dry-run y `--apply`
solo elimina `.incoming`/`.work-*` sin lock vivo y fuera de la gracia. La
política y los comandos exactos están en `docs/DOCUMENT_MAINTENANCE.md`. Los
uploads, previews y registros de publicación duraderos no se purgan de forma
implícita; solo los bytes congelados del candidato de una publicación ya
terminada son elegibles tras 30 días, conservando operación, receipts, versión
recuperable y auditoría.

## Gates P0 que requieren evidencia QA

El canal CDP ya no cruza el namespace de red: existe únicamente entre Next.js
y el proceso Chrome exacto mediante descriptores heredados. El worker aislado
no recibe esos descriptores; aunque descubriera el puerto loopback efímero, no
recibe su secreto aleatorio ni puede autenticarse. El egress físico está
cerrado localmente: `app` solo pertenece a una red Docker interna y el sidecar
propio, autenticado por canal, es el único servicio dual-homed. Browser entrega
una IP global ya fijada; worker/server resuelven una vez y conectan a esa IP,
rechazando respuestas mixtas, red privada, loopback, link-local y metadata. La
imagen QA todavía debe demostrar esta frontera con el Compose y kernel reales;
consulta `docs/EGRESS_GATEWAY.md`.

La imagen base Node está fijada por versión y digest, y Chromium, LibreOffice,
Poppler y QPDF se resuelven contra el snapshot Debian inmutable
`20260820T000000Z`. `AIBRAIN_CHROME_EXPECTED_VERSION` bloquea un arranque que
no coincida. Cada build QA debe registrar versiones, digest y SBOM; para una
verificación independiente bit a bit también deben conservarse checksums de
los paquetes o una imagen interna inmutable ya escaneada.

## Variables obligatorias

Los valores de Compose, no secretos, parten de `infra/hetzner/compose.env.example`. Los secretos de runtime, salida, alertas y réplica parten respectivamente de `aibrain.env.example`, `egress.env.example`, `alerts.env.example` y `replica.env.example`; viven fuera del checkout con modo `0600`. El password Restic es un fichero separado, read-only y propiedad del UID AiBrain. La separación física y operación están en `docs/EGRESS_GATEWAY.md` y `docs/BACKUP_REPLICATION.md`.

Secretos independientes, cada uno con al menos 32 bytes:

- `AIBRAIN_SESSION_SECRET`
- `AIBRAIN_AUTH_CHALLENGE_SECRET`
- `AIBRAIN_PUBLICATION_SECRET`
- `AIBRAIN_BROWSER_GATEWAY_SECRET`
- `AIBRAIN_MAINTENANCE_SECRET`

La frontera de red usa otros tres tokens fuertes, distintos entre sí y de los
anteriores: `AIBRAIN_EGRESS_BROWSER_TOKEN`, `AIBRAIN_EGRESS_WORKER_TOKEN` y
`AIBRAIN_EGRESS_SERVER_TOKEN`. Se guardan en `egress.env`, nunca en
`runtime.env` ni en la configuración versionada.

Supabase solo requiere su URL y publishable key para Auth. No se inyecta service-role/secret key ni se usa Postgres de producto. `AIBRAIN_CHROME_EXPECTED_VERSION` debe coincidir exactamente con Chromium en la imagen inmutable.

## Health, logs y alertas

El healthcheck interno consulta Next.js por loopback cada 15 segundos, con
período inicial de 45 segundos. Readiness exige stores/mounts seguros, 20 % y
1 GiB libres, ausencia de `docker.sock`, Codex 0.149.1, Chromium exacto y la
toolchain LibreOffice/Poppler/QPDF. No crea workers ni browsers. Un estado
`unhealthy`, reinicios repetidos, presión de disco mayor al 80 %, volumen de
backups sin réplica reciente o errores `preflight failed` deben alertar al
operador. El runbook muestra los comandos de diagnóstico sin imprimir secretos.

Cada `backup:verify` correcto escribe atómicamente
`backups/verification/latest.json` con installation, backup ID, fingerprint,
fecha de creación y fecha de verificación. El evaluator local
`evaluateOperationalAlerts` produce códigos tipados para readiness degradado,
disco de datos/publicación >=80/90 %, gateway degradado, tres reinicios en 15
minutos, fallos de preflight, backup o réplica ausentes y evidencias con más de
26 horas. Verificar hoy un snapshot antiguo no reinicia su edad. `aibrain-alerts`
recoge readiness privada, ambos volúmenes, snapshot y receipt off-host dentro del
contenedor, y exige que el controlador aporte explícitamente los contadores de
reinicios y preflight de 15 minutos. El outbox file-backed deduplica
raised/updated/resolved, aplica backoff y entrega primero a un sink local
durable; no requiere `docker.sock`. `alert-dispatcher` arranca sin depender de
la salud de app, conserva su propio health y entrega mediante el adapter webhook
HTTPS. Solo su destino/token reales y la confirmación externa siguen pendientes
por instalación. Procedimiento: `docs/ALERTING.md`.

Los logs esperados son códigos y métricas acotadas. No añadir bodies, cookies, tokens, credenciales, contenido documental o variables de entorno a logs. La retención local por defecto es cinco ficheros de 10 MB; la exportación remota y el canal de alertas son configuración externa por instalación.

## Gates de producción

Antes de DNS/cutover deben estar validados en un servidor dedicado de la empresa:

1. build desde cero, `npm run infra:validate`, `docker compose config --quiet`, SBOM y scan crítico;
2. health estable y smoke de login/trabajo con Supabase temporalmente inaccesible después de login;
3. Codex dedicado autenticado en el `CODEX_HOME` del primer empleado, nunca una cuenta personal compartida;
4. matriz de dos empleados para workers, threads, approvals, archivos y browser sin acceso cruzado;
5. `source-ro` no writable y `publish-rw` invisible/no writable desde el App Server;
6. Office/PDF/texto/imagen y confirmación documental exactamente una vez;
7. backup, restore a volumen separado, reboot recovery, release y rollback medidos;
8. réplica de backup cifrada fuera del servidor y alertas conectadas;
9. soak operativo corto verde en cada release y perfil QA largo verde antes del primer cutover, siguiendo `docs/OPERATIONS_SOAK.md`.
10. revisión de capacidad/egress y hardening del host;
11. canal CDP heredado sin sockets, egress browser fijado por DNS y build
    inmutable verificado de la toolchain;
12. autorización separada para DNS y producción.

La imagen base se fija por digest, Codex/Node packages por versión y APT contra
el snapshot inmutable `20260820T000000Z` de Debian. Cambiar ese snapshot es una
actualización de release revisable: requiere build limpio, SBOM, scan y matriz
Office/PDF/Chromium antes de promover la nueva imagen.

El Compose de runtime exige `AIBRAIN_IMAGE` y `AIBRAIN_EGRESS_IMAGE` resueltas
a `@sha256`; el build vive
en `infra/hetzner/compose.build.yaml` y exige la revisión Git exacta, registrada
como label OCI. `scripts/manage-release.mjs` verifica digest+revisión, conserva
estado atómico V3 `current`/`previous` con bytes+hashes exactos de Compose,
compose env e InstallationConfig, espera readiness y recupera automáticamente
los tres inputs y las dos imágenes anteriores si una promoción no llega a
healthy. Un journal por fase, timeout de subprocess, deadline compartido, lock advisory del SO e
inspección del digest/revisión realmente ejecutados cubren caída y reboot;
runbook: `docs/RELEASES.md`.
