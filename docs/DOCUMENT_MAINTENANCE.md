# Mantenimiento de temporales documentales

Este mantenimiento elimina exclusivamente restos temporales creados por el
parser de uploads (`staging/.incoming/<uuid>.upload`) y por el generador de
previews (`state/document-previews/<thread>/<upload>/.work-XXXXXX`). No elimina
uploads ya staged, previews terminadas, candidatos de publicación, versiones,
recibos ni auditoría.

## Política de retención

- Temporales incompletos: elegibles tras seis horas, siempre que no exista un
  lock vivo; una caída se recupera al caducar el heartbeat del propietario.
- Uploads staged y previews `ready`: activos duraderos ligados al thread. No se
  eliminan automáticamente porque un refresh, un turn posterior o la revisión
  humana pueden necesitarlos.
- Publicaciones: candidatos congelados, operaciones, receipts, versiones y
  auditoría se conservan para idempotencia, recuperación y trazabilidad. Este
  recolector no tiene acceso al repositorio documental publicado.
- La instalación evita llenar el volumen mediante admisión previa por slots y
  margen libre, no borrando silenciosamente datos de empresa. Una política de
  borrado de datos duraderos requerirá una operación explícita de lifecycle con
  referencias y auditoría; no se debe simular con este CLI.

La ejecución predeterminada es un `dry-run` y usa una gracia de seis horas:

```bash
npm run documents:maintain -- --dry-run
```

En la imagen QA/producción usa el launcher incluido, por ejemplo:

```bash
docker compose --env-file /etc/aibrain/compose.env -f infra/hetzner/compose.yaml exec -T app \
  /usr/local/bin/aibrain-document-maintenance --dry-run
```

Revisa `wouldRemove`, `skippedLocked` y `skippedUnsafe` en el JSON. Para aplicar
exactamente la misma política:

```bash
npm run documents:maintain -- --apply
```

Sustituye el último argumento por `--apply` en el launcher del contenedor solo
después de revisar el dry-run de la misma instalación.

La gracia puede fijarse en milisegundos con `--grace-ms <n>` o
`AIBRAIN_DOCUMENT_TEMP_GRACE_MS`. No uses una gracia menor que el tiempo máximo
operativo permitido para un upload o una conversión. El CLI toma un lock global
entre procesos; cada temporal activo usa además su lock documental canónico. Si
ese lock está ocupado, el fichero se registra en `skippedLocked` y no se toca.

Antes de borrar, cada candidato debe conservar nombre, ubicación, tipo, permisos
privados e identidad de inodo. Los candidatos válidos se mueven atómicamente a
un nombre de cuarentena dentro del mismo directorio y se eliminan allí. Una
ejecución posterior reconoce cuarentenas abandonadas por una caída. Enlaces,
hardlinks, raíces inseguras y nombres inesperados quedan en `skippedUnsafe`.

Para operación periódica, ejecuta primero `--dry-run`, alerta si
`skippedUnsafe` no está vacío y solo entonces ejecuta `--apply`. Este CLI es
host-local; no debe exponerse como endpoint público ni ejecutarse contra una
instalación distinta de la indicada por `AIBRAIN_INSTALLATION_CONFIG`.
