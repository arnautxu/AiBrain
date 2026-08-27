# Releases, recovery y rollback

El gestor `scripts/manage-release.mjs` trata `app` y `egress-gateway` como una
única release. Los dos valores deben ser digests `@sha256`, ambas imágenes deben
llevar la misma label OCI `org.opencontainers.image.revision` y los contenedores
que terminan healthy deben declarar exactamente esos digests y esa revisión.
Un healthcheck verde con una imagen antigua no se acepta.

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
4. No ejecutar dos comandos por fuera del gestor ni editar `compose.env`,
   `release.json` o `release.json.transaction.json` mientras haya una operación.

## Promoción

```bash
node scripts/manage-release.mjs promote \
  --image registry.example/aibrain@sha256:<64-hex> \
  --egress-image registry.example/aibrain-egress@sha256:<64-hex> \
  --revision <git-sha> \
  --installation-id <installation> \
  --env-file /etc/aibrain/<installation>/compose.env \
  --compose-file /opt/aibrain-<installation>/releases/<git-sha>/infra/hetzner/compose.yaml \
  --state-file /etc/aibrain/<installation>/release.json \
  --health-timeout-ms 120000 \
  --docker-command-timeout-ms 30000
```

Antes de mutar nada, el gestor verifica estado, env, imágenes locales y runtime
actual. Después persiste un journal con hashes de los env anterior/objetivo y
los estados exactos de commit/rollback. Las fases son `prepared`,
`environment-updated`, `target-healthy`, `state-committed` y las fases de
recovery. Cada escritura usa fichero único, `fsync`, rename y `fsync` del
directorio. Los comandos Docker tienen timeout individual y la operación normal
comparte un deadline monotónico; el recovery obtiene un presupuesto separado.

## Rollback

```bash
node scripts/manage-release.mjs rollback \
  --installation-id <installation> \
  --env-file /etc/aibrain/<installation>/compose.env \
  --compose-file /opt/aibrain-<installation>/current/infra/hetzner/compose.yaml \
  --state-file /etc/aibrain/<installation>/release.json \
  --health-timeout-ms 120000 \
  --docker-command-timeout-ms 30000
```

Rollback solo usa `previous` del estado durable. Vuelve a inspeccionar app y
gateway antes de cambiar el env y, después de arrancar, valida health, digest y
revisión de los dos servicios.

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

Si cualquier clave de `compose.env` cambió fuera del gestor, el hash deja de
coincidir y la recuperación falla cerrada: nunca sobrescribe ese cambio.

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

Después, en el Hetzner QA aislado: promover A→B, comprobar digests/revisión de
los dos contenedores, matar el proceso una vez durante `compose up`, repetir el
comando para recovery, ejecutar B→A, reiniciar el host y repetir la
reconciliación. Registrar tiempos, hashes, IDs de contenedor y estado final. No
realizar el ensayo contra BGreenly ni contra producción.
