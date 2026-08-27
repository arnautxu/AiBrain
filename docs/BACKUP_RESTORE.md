# Backup, restore y rollback del estado local y documental

El manifest V2 contiene dos componentes verificados por separado y por un fingerprint global: `product-data` para el estado file-backed y `published-documents` para el `publishWriteRoot` oficial. Del primer componente excluye `backupsRoot`, cualquier directorio `locks` y toda identidad o credencial efímera: `sessions/`, `auth-challenges/`, `auth-rate-limits/`, `secrets/`, ficheros `.env*`, cualquier `auth.json` y `users/<userId>/browser/profile/`. Por tanto, las cookies Chromium, sesiones web y autenticación Codex no se copian ni se restauran. El estado durable del browser y las descargas fuera del perfil sí pueden formar parte del snapshot. El árbol publicado no aplica exclusiones de contenido: debe recuperarse completo.

Cada fichero de ambos componentes se abre sin seguir symlinks, se exige regular y con un solo hardlink, se copia con `fsync`, se vuelve a comprobar que no cambió durante la lectura y se registra con SHA-256. El backup comparte un lock físico de barrera con el publicador server-side, por lo que una confirmación documental termina antes del snapshot o espera hasta después; nunca cruza la copia del árbol publicado. El manifest se escribe al final y el snapshot queda read-only.

Un backup consistente requiere drenar mutaciones y turns antes de crearlo. El servicio detecta un fichero que cambia durante su copia y falla; el runbook de producción debe poner la app en mantenimiento antes del command.

La imagen de servidor incluye el CLI mínimo de backup y un volumen separado para restores QA. En contenedor, usa siempre el procedimiento de parada, snapshot, restore a volumen nuevo y validación aislada de [HETZNER_MIGRATION.md](HETZNER_MIGRATION.md); no restaures sobre `/var/lib/aibrain/data` activo.

## Crear y verificar

```bash
export AIBRAIN_INSTALLATION_CONFIG=/etc/aibrain/installation.json
npm run backup:create
npm run backup:verify -- --snapshot /var/lib/aibrain/data/backups/snapshots/<backup-id>
```

Una verificación correcta actualiza de forma atómica el receipt no sensible
`/var/lib/aibrain/data/backups/verification/latest.json`. Contiene ID,
fingerprint y timestamps, nunca contenido, credenciales ni paths de usuario; el
evaluator de alertas usa tanto la edad de creación como la de verificación.

Conservar `backupId`, `sourceFingerprint`, número de ficheros y resultado del verify en el registro de release. El volumen de backups debe usar cifrado en reposo y una copia fuera del servidor con acceso separado; este command no sube ni elimina copias.

La réplica cifrada, su proceso one-shot y el restore drill externo se describen en [BACKUP_REPLICATION.md](BACKUP_REPLICATION.md). Solo debe ejecutarse después del verify local.

## Restaurar sin sobrescribir

La restauración nunca escribe encima de `dataRoot` ni `publishWriteRoot` activos. Exige dos destinos inexistentes, no solapados, con padres reales y escribibles y espacio libre comprobado. Ambos componentes se preparan primero bajo nombres `.pending`; solo después se promocionan. Si la segunda promoción falla, la primera se revierte y ambos árboles parciales se conservan con sufijo `.failed.<uuid>`.

```bash
npm run backup:restore -- \
  --snapshot /var/lib/aibrain/data/backups/snapshots/<backup-id> \
  --data-destination /var/lib/aibrain-restores/<backup-id>-data \
  --publish-destination /var/lib/aibrain-restores/<backup-id>-publish
```

Después del command:

1. comprobar que el `sourceFingerprint` coincide con el backup verificado;
2. arrancar una instancia QA aislada apuntando `InstallationConfig.paths.dataRoot` y `publishWriteRoot` a los dos destinos restaurados;
3. ejecutar health, login sintético, lectura de proyectos/threads, journals y artefactos;
4. detener la instancia QA;
5. para rollback, cambiar de forma atómica la ruta de release/configuración al root restaurado y reiniciar solo AiBrain;
6. volver a ejecutar health y smoke tests.

No modificar la ruta de BGreenly, no reutilizar sus redes/volúmenes y no borrar el root anterior ni el snapshot. Si una restauración falla, el estado parcial se conserva con sufijo `.failed.<uuid>` para diagnóstico; no se presenta como restauración válida.

## Evidencia local automatizada

```bash
npx vitest run src/operations/backup.test.ts
```

La prueba crea estado y documentos publicados QA reales en un filesystem temporal, congela y verifica el snapshot, modifica el estado vivo, restaura a dos roots nuevos y comprueba que reaparecen las versiones anteriores. También demuestra que sesiones, challenges, rate limits, secretos, `auth.json`, `.env*` y el perfil/cookies Chromium no llegan al snapshot ni al restore, rechaza corrupción, symlinks y hardlinks en ambos componentes, y prueba que el backup espera a una publicación en curso.
