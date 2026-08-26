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

`userId`, email normalizado, nombre, estado y worker son identidad local inmutable en esta operación. Un cambio posterior debe pasar por una operación administrativa explícita; el provisionador falla si el registro existente difiere.

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
