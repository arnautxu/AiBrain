# Outlook personal en AiBrain

Outlook usa OAuth delegado por empleado contra un tenant exacto de Microsoft Entra. AiBrain no admite `common`, `consumers` ni un OAuth compartido. El servidor enlaza `installationId + userId`, usa state de un solo uso y PKCE S256, cifra access/refresh tokens con AES-256-GCM y usa esa autoridad exacta en autorización e intercambio antes de aceptar el readback de Microsoft Graph. Los access tokens se tratan como opacos y no se fía autorización a claims decodificados sin verificar.

## Configuración externa exacta

1. En Microsoft Entra registra una aplicación web para la instalación.
2. `connectors.outlook.enabled=true` publica Outlook únicamente en el catálogo autorizado de la instalación. Hasta que configures `connectors.outlook.tenantId` con el UUID real del directorio y completes los secretos siguientes, Ajustes lo muestra como pendiente de configuración administrativa y el inicio OAuth falla cerrado.
3. Registra exactamente este redirect URI de tipo Web:

   `https://<dominio-instalacion>/api/connectors/outlook/oauth/callback`

4. Añade solo permisos delegados de Microsoft Graph: `User.Read` y `Mail.Read`. El flujo solicita además `offline_access` para renovar la sesión. No añadas `Mail.ReadWrite`, `Mail.Send`, Files, calendarios ni permisos de aplicación.
5. Entrega al servicio mediante el gestor de secretos del host:

   - `AIBRAIN_MICROSOFT_CLIENT_ID`
   - `AIBRAIN_MICROSOFT_CLIENT_SECRET`
   - `AIBRAIN_MICROSOFT_OAUTH_ENCRYPTION_KEY` — 32 bytes aleatorios en base64.

No copies estos valores al repositorio, JSON de instalación, logs o tickets.

La configuración externa queda completa solo cuando el UUID de `tenantId`, el redirect URI y las tres variables anteriores están presentes. No uses un UUID de ejemplo, `common` ni `consumers`; si falta cualquiera de esos valores, no se genera state ni se redirige al proveedor.

## Flujo, revocación y aceptación

- Ajustes → Conectores → Outlook inicia el OAuth personal. El callback consume state una vez, exige los scopes mínimos, verifica el tenant y lee `/v1.0/me` antes de crear el binding activo.
- `@outlook` aparece únicamente cuando el catálogo efectivo concede lectura y el binding personal sigue conectado. Las tools `search` y `read` revalidan usuario, instalación, thread y turn.
- Desconectar revoca primero el binding durable y borra la credencial cifrada local. Microsoft no ofrece revocación RFC 7009 de un único refresh token delegado; AiBrain no usa `revokeSignInSessions` porque revocaría todas las sesiones del usuario y exigiría scopes excesivos. Si la política de la empresa exige revocación también en Microsoft, el usuario o administrador debe retirar el consentimiento de la aplicación en Entra/My Apps. El binding local bloquea cualquier uso aunque esa coordinación externa quede pendiente.
- Valida con dos usuarios reales: cada uno conecta su cuenta; A no puede consumir state, binding o token de B; desconectar A elimina `@outlook`; reconectar A incrementa la versión durable. Una respuesta HTTP o health check no es evidencia de conexión.

Las escrituras de correo no están implementadas. Cuando se añadan, deben ser operaciones separadas del catálogo, con scopes distintos, aprobación durable, dispatch at-most-once y readback del proveedor; nunca se habilitan por el scope de lectura.
