# Reconstrucción del índice de acceso compartido

Este comando rellena explícitamente los grants de proyectos y threads ya
compartidos antes de desplegar K1 o reiniciar una instalación que aún no tenga
su índice. No es una ruta HTTP, no se ejecuta al arrancar y nunca usa la sesión
de un miembro para descubrir datos de otro propietario.

Ejecuta el comando únicamente con la aplicación drenada o detenida, el
`AIBRAIN_INSTALLATION_CONFIG` de la instalación objetivo y un `operator-id` de
un usuario local habilitado. El operador debe revisar primero el resultado sin
mutaciones:

```bash
npm run workbench:rebuild-shared-access -- \
  --offline --operator-id <uuid-operador> --dry-run
```

El informe JSON incluye propietarios habilitados examinados, snapshots
existentes, usuarios deshabilitados o enlaces simbólicos ignorados y el delta
de grants. El dry-run no escribe el índice ni la auditoría, ni crea estados de
workbench que no existían.

Si el resultado es el esperado, ejecuta exactamente el mismo comando con
`--apply`:

```bash
npm run workbench:rebuild-shared-access -- \
  --offline --operator-id <uuid-operador> --apply
```

`--apply` reemplaza atómicamente la proyección con los snapshots de propietarios
habilitados; por ello retira grants revocados, obsoletos o pertenecientes a
usuarios deshabilitados. Registra la operación en
`dataRoot/workbench-shared-access/audit.jsonl`. Un rerun con los mismos
snapshots no duplica grants y devuelve `changed: false`.

No ejecutes este comando desde una petición, una sesión de miembro ni contra
una instalación distinta de la indicada por su configuración. Si aparecen
usuarios omitidos por enlaces simbólicos o snapshots faltantes, corrige el
estado operativo y repite el dry-run antes de aplicar.
