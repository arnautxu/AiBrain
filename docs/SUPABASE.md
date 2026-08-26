# Supabase Auth-only

## Límite arquitectónico

Supabase es exclusivamente el proveedor de identidad externo de AiBrain. El
backend usa su API de Auth para:

- verificar email y contraseña durante el login;
- exigir el cambio de la contraseña inicial;
- solicitar y validar la recuperación de contraseña;
- invalidar en el cliente aislado las credenciales remotas temporales.

Supabase no almacena datos de producto. No hay tablas, RLS, RPC, Storage,
Realtime, manifests, proyectos, threads, mensajes, permisos, auditoría,
documentos ni sesiones de workbench en Postgres. Esos datos viven en los stores
filesystem de la instalación.

El navegador nunca recibe la sesión de Supabase. El servidor crea un cliente
no persistente, verifica la identidad, comprueba que el UUID y email coinciden
con el perfil local provisionado y emite una cookie local opaca. Desde ese
momento el workbench sigue funcionando aunque Supabase no esté disponible.

## Variables

```dotenv
AIBRAIN_AUTH_MODE=supabase
AIBRAIN_INSTALLATION_CONFIG=/etc/aibrain/installation.json
AIBRAIN_SESSION_SECRET=<32-o-mas-bytes-aleatorios>
AIBRAIN_AUTH_CHALLENGE_SECRET=<32-bytes-aleatorios-independientes>
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

No se necesita una `service_role`/secret key. La publishable key se utiliza
únicamente desde código server-side con `persistSession`, `autoRefreshToken` y
`detectSessionInUrl` desactivados. Los dos secretos de AiBrain deben ser
independientes, inyectarse en runtime y no formar parte de una imagen o backup
sin cifrar.

La URL pública y los redirects proceden de `InstallationConfig`; no existe un
dominio hardcodeado en variables separadas.

## Preparación de una instalación

1. Crear un proyecto Supabase dedicado a la empresa o seleccionar el proyecto
   Auth aprobado para esa instalación.
2. Desactivar signup público y anónimo. Mantener solo email/contraseña y
   recuperación.
3. Configurar la Site URL con `InstallationConfig.publicUrl` y permitir
   exactamente `<publicUrl>/auth/recovery`. Añadir localhost solo en QA local.
4. Configurar SMTP y el template de recuperación
   `supabase/templates/recovery.html` sin copiar credenciales al repositorio.
5. Crear cada identidad mediante un procedimiento administrativo humano. No
   hay endpoint de invitaciones en el producto V1.
6. Provisionar localmente el mismo UUID de `auth.users.id` y el mismo email:

```bash
export AIBRAIN_INSTALLATION_CONFIG=/etc/aibrain/installation.json
npm run users:provision -- --input /secure/operator/users.json
```

El login falla de forma genérica si UUID o email no coinciden, el perfil no
existe o está deshabilitado. Deshabilitar un perfil local revoca todas sus
sesiones locales sin modificar el proveedor externo.

## Seguridad de sesión local

- Cookie `__Host-aibrain-session`: `HttpOnly`, `Secure` en producción,
  `SameSite=Lax`, path `/`, sin Domain.
- Identificador aleatorio de 256 bits; en disco solo se conserva SHA-256.
- Inactividad máxima: 7 días. Duración absoluta: 30 días. Renovación: 24 horas.
- Logout borra la sesión local y cualquier challenge pendiente.
- Login, logout y cambios de contraseña exigen Origin de la instalación o
  `Sec-Fetch-Site: same-origin`; se rechaza CSRF cross-origin.
- El challenge de contraseña inicial dura 15 minutos y cifra access/refresh
  tokens con AES-256-GCM y AAD antes de escribirlos en filesystem.
- Los tokens remotos se descartan después del intercambio; nunca autorizan
  proyectos, archivos, permisos ni runtime.

## Recuperación

El template enlaza a:

```text
<publicUrl>/auth/recovery?token_hash=<token>&type=recovery
```

El backend valida el token con Supabase Auth, comprueba el perfil local, cambia
la contraseña, elimina el marcador inicial y crea una sesión local nueva. La
respuesta de solicitud es siempre `202 accepted` para no revelar si existe la
cuenta.

## Verificación externa pendiente

La implementación local y los tests no autorizan cambios destructivos en un
proyecto Supabase real. Antes de producción, un operador debe registrar como
evidencia:

- proyecto/ref y entorno correctos;
- signup público y anónimo desactivados;
- Site URL y redirect exactos de la instalación;
- SMTP y template de recuperación activos;
- UUID/email remoto idénticos al perfil local;
- login, cambio inicial, recovery, logout y revocación local;
- workbench operativo durante una indisponibilidad posterior de Supabase;
- ausencia de service key y ausencia de tablas o RPC de producto usadas por
  AiBrain.

No ejecutar `supabase db push`: AiBrain no distribuye migraciones de producto.
`supabase/config.toml` es una fixture de Auth para desarrollo; Storage, Realtime
y migraciones están desactivados.
