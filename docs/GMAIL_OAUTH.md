# Gmail personal en AiBrain

Gmail usa OAuth personal por empleado. El servidor genera `state` de un solo uso y PKCE S256, guarda el verifier únicamente en almacenamiento privado, cifra access/refresh tokens con AES-256-GCM y enlaza el binding a `installationId + userId`. No existe fallback a una credencial compartida.

## Google Cloud externo

1. En Google Cloud crea o selecciona el proyecto de la instalación y habilita **Gmail API**.
2. Configura la pantalla de consentimiento. Solicita únicamente `https://www.googleapis.com/auth/gmail.readonly`; no añadas `gmail.modify`, `gmail.send`, Drive ni scopes offline adicionales.
3. Crea un cliente OAuth tipo **Web application**.
4. Registra exactamente este callback para producción:

   `https://<dominio-instalacion>/api/connectors/gmail/oauth/callback`

   Para QA registra su dominio exacto por separado. No uses comodines ni callbacks de otra instalación.
5. Entrega al servicio, mediante el gestor de secretos del host, estas variables:

   - `AIBRAIN_GOOGLE_CLIENT_ID`
   - `AIBRAIN_GOOGLE_CLIENT_SECRET`
   - `AIBRAIN_GOOGLE_OAUTH_ENCRYPTION_KEY` — 32 bytes aleatorios en base64. Se puede generar fuera del repositorio con `openssl rand -base64 32`.

No escribas ninguno de esos valores en JSON de instalación, documentación, logs, imágenes ni tickets. `connectors.gmail.enabled=true` solo habilita el producto; no contiene credenciales.

Mientras falte cualquiera de las tres variables, Ajustes muestra Gmail como pendiente de configuración administrativa y el inicio OAuth falla cerrado: no se genera state ni se redirige a Google.

## Flujo y verificación

- Ajustes → Conectores → Gmail inicia `/api/connectors/gmail/oauth/start`.
- El callback consume `state` una sola vez, intercambia el código con el verifier PKCE, exige el scope mínimo y realiza readback de `/gmail/v1/users/me/profile` antes de marcar la conexión como activa.
- Access tokens próximos a caducar se refrescan server-side; el refresh token nunca llega al navegador ni al agente.
- Desconectar marca primero el binding local como revocado, después solicita revocación a Google y solo borra el token cifrado cuando Google la confirma. Si Google no responde, AiBrain sigue bloqueando el uso y devuelve un código para reintento operativo.
- Una reconexión posterior conserva la identidad del binding, incrementa su versión durable y no puede reutilizar la credencial de otro empleado.
- `@gmail` aparece solo si el catálogo efectivo autoriza el recurso para ese usuario. Las tools son read-only (`search` y `read`) y además exigen que `@gmail` haya sido seleccionado en ese turno.

Después de configurar Google Cloud, valida con dos usuarios reales: A conecta y lee su propio perfil; B no ve ni puede consumir el state, binding o token de A; desconectar A elimina `@gmail` como fuente legible; volver a conectar A incrementa la versión del binding. Una respuesta HTTP o un health check no sustituyen este readback.

Los documentos generados siguen guardándose en el workspace local del servidor. Conectar Gmail no habilita Google Drive ni cambia el destino documental por defecto.
