# Provisionamiento local de empleados

El UUID de cada empleado debe existir primero en Supabase Auth. AiBrain usa ese mismo UUID como identidad filesystem y crea un worker, `CODEX_HOME`, workspace, staging, artifacts, browser profile y políticas privados. El proceso no tiene un límite comercial de empleados y es idempotente.

## Entrada

Crear fuera del repositorio un JSON regular, protegido y sin contraseñas ni tokens:

```json
[
  {
    "userId": "00000000-0000-4000-8000-000000000001",
    "email": "employee@example.test",
    "displayName": "Synthetic Employee",
    "enabled": true,
    "requireInitialPasswordChange": true
  }
]
```

`userId`, email normalizado, nombre, estado y worker son identidad local inmutable en esta operación. Un cambio posterior pasa por la operación de lifecycle descrita abajo; el provisionador falla si el registro existente difiere.

## Ejecución reproducible

```bash
export AIBRAIN_INSTALLATION_CONFIG=/etc/aibrain/installation.json
npm run users:provision -- --input /secure/operator/users.json
```

La salida contiene solo instalación y recuentos, nunca emails, paths, tokens o contenido. Repetir exactamente el comando devuelve los usuarios como `unchanged`. Si el empleado ya consumió `password-change-required`, una repetición no lo recrea.

## Resultado por usuario

```text
<usersRoot>/<uuid>/
  user.json
  PROFILE.md
  PERMISSIONS.md
  PREFERENCES.md
  password-change-required
  worker.json
  runtime/codex-home/
  workspace/
  staging/
  artifacts/
  browser/profile/
  browser/downloads/
```

La primera ejecución también crea `<companyContextRoot>/PERMISSIONS.md` con una política de instalación conservadora. La publicación queda denegada hasta que el administrador sustituya de forma atómica la regla correspondiente, incremente `policyVersion` y conserve la versión anterior. `PERMISSIONS.md` se mantiene `0400`; directorios privados `0700`, secretos/estado `0600`.

El command no crea el usuario remoto, no cambia suscripciones, no toca Supabase product data y no realiza ninguna acción sobre NAS, DNS o producción.

## Baja, reactivación y recuperación

Cada mutación exige un `requestId` UUID estable. La baja marca el perfil como deshabilitado, revoca todas sus cookies locales y detiene únicamente su worker y browser. La reactivación vuelve a habilitar el perfil. La recuperación lo habilita, revoca las sesiones existentes, detiene sus runtimes y crea el marcador de cambio inicial de contraseña si todavía no existe. Repetir el mismo comando devuelve el receipt guardado sin repetir efectos; reutilizar el `requestId` para otro usuario o acción falla con conflicto.

Con la aplicación activa, usar exclusivamente el endpoint host-local que Nginx bloquea de Internet:

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $AIBRAIN_MAINTENANCE_SECRET" \
  --header "Origin: https://brain.example.com" \
  --header "Content-Type: application/json" \
  --data '{"schemaVersion":1,"requestId":"10000000-0000-4000-8000-000000000001","action":"disable","userId":"00000000-0000-4000-8000-000000000001"}' \
  http://127.0.0.1:3101/api/operations/users
```

El puerto y el Origin deben corresponder a la instalación. El bearer es el secreto independiente de operador y nunca una cookie de empleado. El receipt no contiene email, contenido, paths ni secretos y queda auditado en `dataRoot/operations/user-lifecycle/`.

Si la aplicación está completamente detenida, existe un camino offline explícito:

```bash
export AIBRAIN_INSTALLATION_CONFIG=/etc/aibrain/installation.json
npm run users:manage -- \
  --offline \
  --action recover \
  --user-id 00000000-0000-4000-8000-000000000001 \
  --request-id 10000000-0000-4000-8000-000000000002
```

No ejecutar el modo offline con la aplicación activa: no puede cerrar objetos de runtime que viven en otro proceso. La protección durable (`enabled:false` y revocación de sesiones) sigue evitando accesos nuevos, pero el endpoint host-local es el mecanismo correcto para una baja inmediata.
