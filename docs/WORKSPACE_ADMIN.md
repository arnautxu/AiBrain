# Workspace Admin Center

AiBrain dispone de un centro de administración local para la instalación. Su alcance es deliberadamente operativo: personas provisionadas, roles, grupos, políticas de capacidades/apps, proyectos compartidos, estado de workers, uso interno y auditoría. No incluye billing.

## Autorización y aislamiento

- Solo una sesión `local` del mismo `installationId` puede consultar `/api/admin`.
- Los roles persistidos `workspace-owner` y `workspace-admin` pueden administrar. `workspace-member` no puede abrir ni mutar el centro.
- `AIBRAIN_ADMIN_USER_IDS` es únicamente un bootstrap de host para crear el primer `workspace-owner`. Debe contener al menos un UUID ya provisionado cuando todavía no existe `state.json`.
- Después de crear `state.json`, los roles persistidos son la única fuente de autorización: cambiar la variable no promociona usuarios existentes ni nuevos. Toda alta posterior entra como `workspace-member` hasta una mutación administrativa auditada.
- `AIBRAIN_USAGE_ADMIN_USER_IDS` no concede permisos y ya no se consulta.
- No se aceptan identificadores de otro tenant ni se recorren raíces fuera de `InstallationConfig.paths.dataRoot` y `usersRoot`.
- El único propietario no se puede degradar ni desactivar.

## Personas y altas

El alta de la UI llama al `UserProvisioner` existente y exige el UUID, correo y nombre de una identidad ya creada en el IdP. Crea el perfil, el worker y las raíces privadas locales. No existe una credencial de administración del IdP ni un servicio de correo en este repositorio, por lo que la API responde explícitamente `identityCreated:false` y `emailSent:false`.

Habilitar y deshabilitar reutiliza `UserLifecycleService`; deshabilitar revoca sesiones y detiene worker/navegador de esa persona.

## Políticas

Roles y grupos se guardan en `dataRoot/workspace-admin/state.json`. La política efectiva es la intersección del rol y todos los grupos: cualquier `false` bloquea. Los switches de apps se aplican en Settings, chat y navegador; los bloqueos de capacidades se incorporan al snapshot inmutable de permisos del turno. No existe un límite comercial de miembros codificado en el schema.

## Compartición

Un proyecto `shared` solo aparece a una cuenta local habilitada cuyo correo esté en `sharing.members`. Los correos sin una cuenta local siguen como `invited-local` y no obtienen visibilidad. `viewer` es solo lectura; `editor` puede actualizar el contexto del proyecto. La identidad y el worker continúan aislados por usuario.

## Auditoría

Cada mutación administrativa se añade a `dataRoot/workspace-admin/audit.jsonl` con secuencia, actor, acción, destino, resumen y fecha. La UI muestra los últimos 100 eventos. El journal y el estado usan locks, validación estricta y escrituras atómicas.
