# Releases, recovery y rollback

El gestor `scripts/manage-release.mjs` trata `app`, `egress-gateway` y
`alert-dispatcher` como una única release. Los dos valores de imagen deben ser
digests `@sha256`, ambas imágenes deben
llevar la misma label OCI `org.opencontainers.image.revision` y los contenedores
que terminan healthy deben declarar exactamente esos digests y esa revisión.
Un healthcheck verde con una imagen antigua no se acepta.

## Publicación GHCR y promoción Arnall

`Backend CI` conserva todos los gates. Solo un `workflow_run` exitoso de un
push a `main` publica `ghcr.io/arnautxu/aibrain:<SHA>` y
`ghcr.io/arnautxu/aibrain-egress:<SHA>`. El workflow guarda los dos digests en
un artefacto de siete días y `Deploy Arnall` descarga ese manifiesto, rechaza
una revisión que ya no sea la punta de `main`, y transmite el `GITHUB_TOKEN`
temporal por stdin al gateway restringido.

El gateway usa una configuración Docker temporal para el login, hace pull de
ambos digests exactos, elimina esa configuración antes de promover y ejecuta el
release manager. Nunca recibe un archivo fuente, no construye ni publica en
Hetzner y no persiste credenciales GHCR. Tras health/readiness y los readbacks,
solo elimina referencias de imágenes AiBrain previas que no tengan ningún
contenedor asociado. La imagen anterior queda recuperable desde GHCR por su
digest guardado en el estado de release.

## Precondiciones

1. Completar maintenance/drain, backup compuesto, verificación, réplica, tests,
   SBOM y scan de la release.
2. Ejecutar `npm run infra:preflight -- --env-file <compose.env>
   --installation <installation>`. En Hetzner Linux, `/usr/bin/flock` es
   obligatorio; serializa también dos operadores que intenten recuperar un
   lock huérfano a la vez.
3. Mantener el directorio `/etc/aibrain/<installation>` privado y propiedad del
   operador. `compose.env`, `release.json` y el journal son ficheros regulares,
   sin symlinks/hardlinks y con modo `0600` cuando contienen estado durable.
4. Preparar `compose.target.env`, el Compose, su
   `browser/seccomp_profile.json` hermano y `installation.json` candidatos como
   ficheros regulares, exclusivos, owner-controlled y no escribibles por
   grupo/mundo. Ninguno se edita durante la operación. El config candidato no
   es el config activo que la release actual tiene montado.
5. No ejecutar dos comandos por fuera del gestor ni editar `compose.env`,
   `release.json` o `release.json.transaction.json` mientras haya una operación.

## Promoción

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
  --state-file /etc/aibrain/<installation>/release.json \
  --health-timeout-ms 120000 \
  --docker-command-timeout-ms 30000
```

`compose.target.env` es una copia candidata completa y no secreta: debe declarar
exactamente instalación, proyecto, digests y revisión solicitados. Las rutas,
UID/GID, puerto, redes, volúmenes y ficheros privados no pueden cambiar durante
una release ordinaria; CPU, RAM, PIDs, tmpfs, logs y otros límites sí pueden
versionarse allí. El gestor rechaza claves de secretos y cualquier referencia a
BGreenly.

`--current-compose-file` es obligatorio únicamente en la primera promoción que
crea el estado V3. Después, `current` ya contiene la copia atestada. Antes de
mutar servicios, el gestor verifica estado, env, Compose activo, seccomp activo,
InstallationConfig, imágenes locales y runtime actual. El estado privado
conserva bytes+SHA-256 de los cinco inputs no secretos: env, Compose fuente,
Compose efectivo, seccomp e InstallationConfig; el journal duplica los records
exactos de commit/rollback. Las fases son `prepared`, `inputs-updated`, `target-healthy`,
`state-committed` y las fases de
recovery. Cada escritura usa fichero único, `fsync`, rename y `fsync` del
directorio. Los comandos Docker tienen timeout individual y la operación normal
comparte un deadline monotónico; el recovery obtiene un presupuesto separado.
El Compose candidato se parsea como YAML antes de seleccionarlo: solo admite
`app`, `egress-gateway`, `alert-dispatcher` y el replicador opcional, con las
dos redes y tres volúmenes propios de la instalación. Rechaza redes o mounts no
revisados, recursos externos, puertos adicionales, modos privilegiados,
`docker.sock` y cualquier referencia a BGreenly.

## Rollback

```bash
node scripts/manage-release.mjs rollback \
  --installation-id <installation> \
  --env-file /etc/aibrain/<installation>/compose.env \
  --state-file /etc/aibrain/<installation>/release.json \
  --health-timeout-ms 120000 \
  --docker-command-timeout-ms 30000
```

Rollback no acepta un Compose/config suministrado por el operador: usa solo
`previous` del estado durable. Restaura el env e InstallationConfig exactos,
materializa el seccomp atestado en `release.json.active.seccomp.json` y el
Compose efectivo en `release.json.active.compose.yaml`, fuerza la recreación y
valida health, digest y revisión de los tres servicios. El Compose efectivo
apunta al seccomp gestionado con ruta absoluta y ya no depende de que la carpeta
de una release antigua siga presente. Un symlink, hardlink, permiso inseguro o
hash distinto falla antes de invocar Docker.

## Recuperación tras SIGKILL o reboot

No borres `.lock`, `.transaction.json`, releases, imágenes ni backups. Repite
el mismo comando previsto. El gestor identifica PID+inicio de proceso+boot,
recupera un lock muerto bajo el advisory lock del SO y reconcilia el journal:

- antes de seleccionar el target: limpia el intento sin mutación;
- target seleccionado pero health no confirmado: restaura y vuelve a validar
  las dos imágenes anteriores;
- target confirmado healthy pero estado no escrito: revalida y termina el
  commit;
- estado escrito pero journal no borrado: revalida runtime y termina cleanup;
- target comprometido que ya no arranca: vuelve al par anterior, persiste el
  rollback y conserva el target fallido como `previous` recuperable.

Si `compose.env`, Compose activo, seccomp activo o InstallationConfig cambian
fuera del gestor, el hash deja de coincidir y la recuperación falla cerrada:
nunca sobrescribe un valor que no coincida exactamente con `current` o `target`
del journal.

## Migración controlada de estado V2 a V3

El binario V3 nunca interpreta ni sobrescribe un `release.json` V2: devuelve
`RELEASE_STATE_MIGRATION_REQUIRED` antes de invocar Docker. En maintenance y
solo tras crear y verificar un backup compuesto:

```bash
cd /etc/aibrain/<installation>
test ! -e release.json.transaction.json
test ! -e release.json.lock
v2_hash=$(sha256sum release.json | awk '{print $1}')
install --mode=0600 release.json "release.v2.${v2_hash}.json"
cmp --silent release.json "release.v2.${v2_hash}.json"
mv release.json release.v2-bootstrap-source.json
```

Prepara `compose.target.env` y ejecuta una promoción V3 incluyendo
`--current-compose-file` con el Compose exacto que gobierna el runtime actual.
El gestor captura también su seccomp hermano y el InstallationConfig activo,
verifica el runtime y solo entonces crea el primer estado V3. Si falla, conserva
el V2 archivado, no lo vuelvas a colocar delante del gestor V3 y corrige la causa
antes de repetir el bootstrap. Restaurar V2 como estado activo solo corresponde
a un rollback deliberado del propio binario de release; nunca borres ninguno de
los dos archivos fuente.

## Códigos operables

- `RELEASE_RECOVERED`: la operación nueva falló y el par anterior vuelve a
  estar healthy.
- `RELEASE_INTERRUPTED_RECOVERED`: se resolvió una transacción interrumpida;
  revisar evidencia y reintentar deliberadamente el comando original.
- `RELEASE_COMMITTED_CLEANUP_FAILED` o
  `RELEASE_COMMITTED_LOCK_CLEANUP_FAILED`: env/runtime/estado ya son
  autoritativos; no promover a ciegas. Reejecutar para completar la
  reconciliación y verificar los tres.
- `RELEASE_ENV_DRIFT_DURING_RECOVERY` o `RELEASE_TRANSACTION_DRIFT`: hubo un
  cambio externo. Conservar los ficheros, comparar sus hashes y resolver el
  origen antes de reintentar.
- `RELEASE_AND_RECOVERY_FAILED`: ni target ni par anterior llegaron a estado
  verificado. Mantener maintenance, no borrar el journal y seguir el restore QA
  de `docs/BACKUP_RESTORE.md`.

## Evidencia QA obligatoria

```bash
npx vitest run tests/unit/release-manager.test.ts
```

Después, en el Hetzner QA aislado: promover A→B con env/Compose/seccomp/config distintos,
comprobar digests/revisión de los tres contenedores, matar el proceso una vez
durante `compose up`, repetir el comando para recovery, ejecutar B→A, reiniciar
el host y repetir la reconciliación. Registrar tiempos, hashes, IDs de
contenedor y estado final. No
realizar el ensayo contra BGreenly ni contra producción.
