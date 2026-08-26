# Backup, restore y rollback del estado local

El snapshot incluye el estado file-backed de la instalación y excluye `backupsRoot` y cualquier directorio `locks`. Cada fichero se abre sin seguir symlinks, se exige regular y con un solo hardlink, se copia con `fsync`, se vuelve a comprobar que no cambió durante la lectura y se registra con SHA-256. El manifest se escribe al final y el snapshot queda read-only.

Un backup consistente requiere drenar mutaciones y turns antes de crearlo. El servicio detecta un fichero que cambia durante su copia y falla; el runbook de producción debe poner la app en mantenimiento antes del command.

## Crear y verificar

```bash
export AIBRAIN_INSTALLATION_CONFIG=/etc/aibrain/installation.json
npm run backup:create
npm run backup:verify -- --snapshot /var/lib/aibrain/backups/snapshots/<backup-id>
```

Conservar `backupId`, `sourceFingerprint`, número de ficheros y resultado del verify en el registro de release. El volumen de backups debe usar cifrado en reposo y una copia fuera del servidor con acceso separado; este command no sube ni elimina copias.

## Restaurar sin sobrescribir

La restauración nunca escribe encima del `dataRoot` activo y exige un destino inexistente:

```bash
npm run backup:restore -- \
  --snapshot /var/lib/aibrain/backups/snapshots/<backup-id> \
  --destination /var/lib/aibrain-restores/<backup-id>
```

Después del command:

1. comprobar que el `sourceFingerprint` coincide con el backup verificado;
2. arrancar una instancia QA aislada apuntando `InstallationConfig.paths.dataRoot` al destino restaurado;
3. ejecutar health, login sintético, lectura de proyectos/threads, journals y artefactos;
4. detener la instancia QA;
5. para rollback, cambiar de forma atómica la ruta de release/configuración al root restaurado y reiniciar solo AiBrain;
6. volver a ejecutar health y smoke tests.

No modificar la ruta de BGreenly, no reutilizar sus redes/volúmenes y no borrar el root anterior ni el snapshot. Si una restauración falla, el estado parcial se conserva con sufijo `.failed.<uuid>` para diagnóstico; no se presenta como restauración válida.

## Evidencia local automatizada

```bash
npx vitest run src/operations/backup.test.ts
```

La prueba crea estado QA real en un filesystem temporal, congela y verifica el snapshot, modifica el estado vivo, restaura a un root nuevo y comprueba que reaparece la versión anterior. También demuestra rechazo de corrupción, symlinks y destinos existentes.
