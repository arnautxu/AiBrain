# Réplica cifrada off-host

AiBrain replica únicamente snapshots locales que ya han pasado la verificación completa del manifest V2. El adapter usa Restic: el repositorio remoto recibe bloques cifrados y no puede leer el estado de producto ni los documentos publicados sin el password separado. El proceso no recibe `dataRoot`, `publishWriteRoot`, sesiones ni secretos de la aplicación; monta el volumen de snapshots read-only y escribe receipts en una raíz independiente.

El adapter no inicializa, elimina, olvida ni poda snapshots remotos. Es idempotente por `installationId + backupId + sourceFingerprint`: primero busca el tag exacto, reutiliza un upload que hubiera terminado antes de un crash local, lee el snapshot remoto por tags, ejecuta `restic check` y solo entonces guarda un receipt. El receipt contiene hashes e IDs, nunca la URL del repositorio, password o credenciales backend.

## Preparación por instalación

Estas acciones son externas y requieren seleccionar el proveedor/destino autorizado. No reutilices cuentas, buckets, rutas, redes ni credenciales de BGreenly.

1. Crea `/etc/aibrain/<installation>/replica.env` a partir de `infra/hetzner/replica.env.example`, propiedad de `root`, modo `0600`. V1 admite `s3:https://`, `rest:https://`, `b2:`, `azure:` o `gs:`; el preflight rechaza repositorios locales.
2. Crea un password Restic aleatorio, independiente de Supabase/Codex y del proveedor, en `/etc/aibrain/<installation>/restic-password`, propiedad del UID/GID AiBrain y modo `0400`. Guárdalo también en el gestor de secretos externo; perderlo hace la réplica irrecuperable.
3. Crea `/srv/aibrain-<installation>/replication`, propiedad del UID/GID AiBrain y modo `0700`. No lo sitúes dentro de `source-ro` ni `publish-rw`.
4. Añade las tres rutas a `compose.env` y ejecuta `npm run infra:preflight -- --env-file ... --installation ...`. El preflight valida fichero regular, permisos privados, roots no solapados, ownership AiBrain y backend off-host.
5. Inicializa el repositorio exactamente una vez, solo tras aprobación del destino:

```bash
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml \
  --profile backup run --rm \
  --entrypoint /bin/sh backup-replicator \
  -c 'exec /usr/bin/restic -r "$AIBRAIN_RESTIC_REPOSITORY" --password-file "$AIBRAIN_RESTIC_PASSWORD_FILE" init'
```

`backup-replicator` es one-shot, no publica puertos y solo se une a la red egress. El volumen de backups está read-only; el password también. La raíz de receipts y el volumen separado de restores son sus únicas escrituras locales.

## Replicar un snapshot verificado

Primero crea y verifica el backup local según [BACKUP_RESTORE.md](BACKUP_RESTORE.md). Después:

```bash
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml \
  --profile backup run --rm backup-replicator \
  --snapshot /var/lib/aibrain/data/backups/snapshots/<backup-id>
```

Archiva del JSON de salida: `backupId`, `sourceFingerprint`, `repositoryFingerprint`, `remoteSnapshotId`, `replicatedAt` y `verifiedAt`. El receipt durable queda en `/srv/aibrain-<installation>/replication/receipts/<backup-id>.json`. Repetir el mismo comando devuelve el mismo receipt sin duplicar el snapshot.

## Restore drill desde la réplica

Restaurar desde off-host es una prueba separada del restore local. Usa siempre un destino nuevo bajo el volumen de restores y el `remoteSnapshotId` exacto del receipt:

```bash
docker compose \
  --env-file /etc/aibrain/<installation>/compose.env \
  -f infra/hetzner/compose.yaml \
  --profile backup run --rm \
  --entrypoint /bin/sh backup-replicator \
  -c 'exec /usr/bin/restic -r "$AIBRAIN_RESTIC_REPOSITORY" --password-file "$AIBRAIN_RESTIC_PASSWORD_FILE" restore "$1" --target "$2"' -- \
  <remote-snapshot-id> /var/lib/aibrain-restores/offhost-<backup-id>
```

Localiza dentro del target el directorio restaurado cuyo basename sea `<backup-id>`. Copia ese snapshot a un volumen de backups QA aislado, ejecuta `aibrain-backup verify` y después el restore dual `--data-destination` + `--publish-destination`. Arranca solo la instalación QA contra ambas raíces restauradas y valida health, workbench, documentos y hashes. No conviertas el drill en cutover, no borres el snapshot remoto/local ni el root previo y no uses el destino restaurado en producción sin aprobación separada.

## Evidencia local sin credenciales

```bash
npx vitest run src/operations/backup-replica.test.ts tests/integration/backup-cli.integration.test.ts
```

Los tests usan un proceso Restic sintético: prueban ejecución sin shell, timeout, entorno allowlisted, password privado, upload/readback/check, recovery tras interrupción, receipt sin secretos e idempotencia CLI. No afirman conectividad con un proveedor real.
