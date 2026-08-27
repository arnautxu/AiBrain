# Autenticación y sesiones locales

AiBrain usa Supabase únicamente como proveedor de identidad para tres operaciones: verificar email y contraseña, cambiar la contraseña inicial y recuperar una contraseña. Una vez verificada la identidad, el servidor elimina la sesión del proveedor y entrega una sesión local opaca. Ningún request normal del workbench consulta Supabase.

## Configuración

- `AIBRAIN_INSTALLATION_CONFIG` apunta al `InstallationConfig` absoluto. `publicUrl` es el único origen aceptado para mutaciones y el destino de recuperación.
- `AIBRAIN_AUTH_MODE=supabase` activa el proveedor externo.
- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` son las únicas credenciales de runtime necesarias para Auth. La aplicación no necesita una service-role key para iniciar sesión.
- `AIBRAIN_AUTH_CHALLENGE_SECRET` debe ser un secreto aleatorio de al menos 32 bytes. Si no se define, el servidor deriva una clave separada desde `AIBRAIN_SESSION_SECRET`; en producción al menos uno de los dos es obligatorio.
- En producción, `publicUrl` debe ser HTTPS. Las cookies `__Host-aibrain-session` y `__Host-aibrain-auth-challenge` son `Secure`, `HttpOnly`, `SameSite=Lax`, sin atributo `Domain` y con ruta `/`.

El template de recuperación de Supabase debe dirigir exclusivamente a:

```text
{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}&type=recovery
```

`SiteURL` debe coincidir con `InstallationConfig.publicUrl`. No habilitar signup público, magic links ni callbacks de invitación genéricos; `/auth/confirm` los rechaza.

## Perfil local provisionado

Supabase no contiene datos de producto. Tras verificar el UUID de Auth, AiBrain exige este fichero en `InstallationConfig.paths.usersRoot/<uuid>/user.json`:

```json
{
  "schemaVersion": 1,
  "userId": "0198b9f0-6631-7000-8000-000000000010",
  "email": "employee@example.test",
  "displayName": "Synthetic Employee",
  "enabled": true,
  "workerId": "synthetic-employee"
}
```

El email debe estar normalizado y coincidir con la identidad verificada. Para forzar el cambio inicial, crear un fichero regular `password-change-required` en el mismo directorio. El servidor lo elimina únicamente después de que Supabase confirme la nueva contraseña.

## Persistencia, expiración y revocación

- Las sesiones viven en `<dataRoot>/sessions/records`. El nombre contiene SHA-256 del identificador; el valor crudo de 256 bits solo existe en la cookie.
- Idle timeout: 7 días. Límite absoluto: 30 días. La actividad renueva el idle como máximo una vez cada 24 horas y nunca amplía el límite absoluto.
- Los challenges de cambio inicial viven en `<dataRoot>/auth-challenges`, caducan a los 15 minutos y se consumen exactamente una vez. Las credenciales efímeras del proveedor se cifran con AES-256-GCM y metadata autenticada; no aparecen en claro en el filesystem ni en la cookie.
- Logout elimina el registro local y ambas cookies. Marcar `enabled:false` revoca todas las sesiones del usuario en la siguiente comprobación; el provisionador puede llamar además a `revokeUser` para revocación inmediata.
- Los directorios de sesiones, challenges y rate limits forman parte del volumen
  runtime activo, nunca se publican ni se montan en el worker y se excluyen de
  los snapshots de producto. Un restore obliga a volver a autenticar y no
  revive cookies, credenciales temporales ni buckets antiguos.
- Login se limita a 30 intentos por cliente y 10 por email cada 15 minutos;
  reset a 10/cliente y 3/email por hora; recovery y cambio inicial combinan
  20/cliente y 10/prueba por hora. Las claves persistidas son HMAC y no contienen
  IP, email, token, código ni challenge crudos.

## Validación sin credenciales reales

```bash
npm run typecheck
npx vitest run tests/unit/local-auth-stores.test.ts tests/unit/auth-request-security.test.ts
npx vitest run tests/integration/local-auth-service.integration.test.ts
```

La integración real pendiente requiere configurar un proyecto Supabase de QA, desactivar signup/magic links, aplicar el template anterior, crear un usuario sintético y comprobar login, primer cambio y recuperación. La caída posterior de Supabase ya está cubierta localmente: la sesión y el workbench continúan resolviéndose desde filesystem.
