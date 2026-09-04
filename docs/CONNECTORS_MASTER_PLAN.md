# Plan MVP de conectores personales para AiBrain

Estado: propuesta funcional revisada, 29 de agosto de 2026
Base: `main` en `6eda510`

## Estado implementado en el candidato de producto

- OAuth nativo personal de Google/Gmail y Microsoft/Outlook con PKCE, estado
  de un solo uso, tokens AES-256-GCM bajo el directorio privado del usuario y
  binding `instalación + usuario + conector`.
- Catálogo personal con conectar, reconectar, desconectar y readback de cuenta.
- Google Calendar/Drive, Microsoft Calendar/OneDrive, GitHub y Slack se
  habilitan, según soporte revisado, como toolkits Composio de solo lectura con
  versiones de tools fijadas. Composio conserva los tokens; AiBrain guarda solo
  el ID opaco de cuenta, aislado por usuario.
- El runtime expone únicamente recursos admitidos por el catálogo efectivo del
  usuario. Desconectar revoca primero el binding local y luego intenta revocar
  el proveedor, de modo que un fallo remoto no mantiene acceso local.

Configuración externa mínima exacta:

1. Google nativo: `AIBRAIN_GOOGLE_CLIENT_ID`,
   `AIBRAIN_GOOGLE_CLIENT_SECRET`, clave aleatoria de 32 bytes base64 en
   `AIBRAIN_GOOGLE_OAUTH_ENCRYPTION_KEY`, y callback
   `<publicUrl>/api/connectors/gmail/oauth/callback`.
2. Microsoft nativo: tenant UUID exacto en `connectors.outlook.tenantId`,
   `AIBRAIN_MICROSOFT_CLIENT_ID`, `AIBRAIN_MICROSOFT_CLIENT_SECRET`, clave
   aleatoria de 32 bytes base64 en
   `AIBRAIN_MICROSOFT_OAUTH_ENCRYPTION_KEY`, y callback
   `<publicUrl>/api/connectors/outlook/oauth/callback`.
3. Toolkits adicionales: `AIBRAIN_COMPOSIO_API_KEY` y, para cada uno de
   `googlecalendar`, `googledrive`, `microsoft_calendar`, `onedrive`, `github`
   y `slack`, un `authConfigId`, lista exacta de scopes y lista revisada de
   `readTools` con versión fija en `connectors.composio.toolkits` de la
   InstallationConfig. No se aceptan tools de escritura en este contrato.
4. Registrar en las consolas de proveedor las URLs de callback que muestra el
   servidor para cada toolkit y completar una autorización con dos usuarios QA.

Sin esos valores la tarjeta aparece como falta de configuración o login; el
código no degrada a tokens en navegador ni credenciales compartidas. La
aceptación real sigue requiriendo login/readback por proveedor y una prueba
negativa entre dos usuarios en el mismo SHA desplegado.

## 1. Objetivo real

Cada usuario de AiBrain debe poder entrar en **Configuración > Conectores** y conectar sus propias cuentas, igual que conecta una aplicación en Codex:

- su correo;
- su calendario;
- su cuenta de Microsoft 365 para trabajar con archivos Excel;
- más adelante, otros conectores MCP compatibles.

No hace falta construir ahora un marketplace empresarial completo ni una plataforma profunda de integraciones. El MVP debe resolver bien la conexión personal, mostrar qué está conectado y permitir que Codex use esas herramientas dentro de las conversaciones del usuario correcto.

## 2. Conectores del MVP

### Google

Una sola conexión Google por usuario, con permisos incrementales:

- Gmail: buscar y leer correos;
- Gmail: preparar borradores;
- Gmail: enviar solo después de confirmación;
- Google Calendar: consultar próximos eventos y disponibilidad;
- Google Calendar: preparar y crear eventos con confirmación.

### Microsoft 365

Una sola conexión Microsoft por usuario:

- Outlook Mail, si el usuario trabaja con correo Microsoft;
- Outlook Calendar;
- OneDrive y SharePoint para localizar archivos;
- Excel Online para leer y editar libros guardados en Microsoft 365.

### Excel MCP

AiBrain debe poder registrar un servidor MCP de Excel revisado y asignarlo a cada usuario que lo conecte. El conector será realmente útil si publica herramientas específicas como:

- listar libros y hojas;
- leer rangos y tablas;
- leer valores y fórmulas por separado;
- actualizar celdas o rangos;
- añadir filas a una tabla;
- crear una hoja;
- aplicar formato básico;
- guardar o exportar una copia;
- releer el rango modificado para confirmar el resultado.

Un MCP que solo permita descargar y volver a subir archivos no editará Excel mejor que el pipeline documental actual. La mejora viene de operar con el modelo real de Excel —workbook, worksheet, range, table y formula—, no simplemente de usar el protocolo MCP.

## 3. Qué significa “editar mejor Excel”

Sí, un buen conector MCP de Excel puede mejorar mucho la edición cuando el libro está en OneDrive o SharePoint:

- Codex trabaja con celdas y tablas, no con el ZIP interno del `.xlsx`;
- puede conservar mejor fórmulas, tipos y estructura;
- puede leer el estado antes de modificarlo;
- puede realizar un cambio pequeño sin reconstruir todo el archivo;
- puede releer el rango y comprobar que el cambio quedó aplicado;
- el usuario sigue viendo el mismo archivo en Excel Online.

Pero no resuelve automáticamente todos los casos:

- macros VBA;
- Power Query;
- conexiones externas;
- add-ins;
- modelos muy complejos;
- automatización visual del Excel de escritorio.

Para archivos `.xlsx` subidos directamente a AiBrain, se mantiene el flujo local existente: copiar, editar la copia, generar preview, confirmar y descargar/publicar. Para Excel Online se usa el MCP o Microsoft Graph. Son dos caminos complementarios.

## 4. Experiencia de usuario

### Pantalla Conectores

Añadir una sección con tres tarjetas iniciales:

| Conector | Estado | Acción principal |
| --- | --- | --- |
| Google | No conectado / Conectado / Reconectar | Conectar Gmail y Calendar |
| Microsoft 365 | No conectado / Conectado / Reconectar | Conectar Outlook, Calendar, OneDrive y Excel |
| Excel MCP | No disponible / Disponible / Conectado | Conectar Excel |

Cada tarjeta mostrará:

- cuenta conectada;
- servicios habilitados;
- última comprobación;
- `Conectar`, `Reconectar` o `Desconectar`;
- una explicación breve de qué puede leer y qué necesita confirmación.

### Dentro del chat

El usuario no debería configurar herramientas en cada conversación. Si la cuenta está conectada, Codex puede elegir el conector adecuado y mostrar actividad clara:

- `Buscando en tu correo`;
- `Consultando tu calendario`;
- `Leyendo Ventas.xlsx`;
- `Preparando cambios en Hoja 1`;
- `Esperando tu confirmación para enviar`.

Cuando sea útil, el composer puede permitir acotar el turno con chips simples: `Correo`, `Calendario` o `Excel`.

## 5. Modelo de conexión personal

Cada conexión queda vinculada a:

```text
instalación + usuario + proveedor + cuenta
```

Una cuenta nunca se comparte automáticamente con otro usuario de la empresa.

Flujo:

1. El usuario pulsa `Conectar`.
2. AiBrain abre el OAuth del proveedor o del App/MCP gestionado por Codex.
3. El usuario concede permisos.
4. El backend vincula la conexión al usuario autenticado.
5. La UI comprueba que el conector está realmente disponible.
6. Al iniciar un turno, el worker expone solo las herramientas conectadas de ese usuario.
7. `Desconectar` revoca o invalida el binding y deja de exponer las herramientas.

Los tokens no se guardan en el navegador, el chat, el workspace ni el repositorio. Codex recibe herramientas y resultados, no credenciales.

## 6. Uso de Codex App Server y MCP

La ruta más corta es aprovechar la base ya implementada en AiBrain:

- inventario de Apps y MCP del App Server;
- bindings personales;
- catálogo de recursos;
- filtrado de herramientas por usuario;
- actividad y resultados MCP en el chat;
- aprobaciones durables para acciones sensibles.

Hay que añadir un controlador de conexión seguro. La sesión del empleado no podrá llamar directamente a cualquier `mcpServer/oauth/login`; la UI pedirá conectar un proveedor conocido y el servidor resolverá el App/MCP exacto, iniciará OAuth y guardará únicamente el binding resultante.

La documentación oficial de OpenAI contempla herramientas MCP y conectores predefinidos, pero no documenta actualmente un conector oficial de Excel con un contrato concreto. Antes de integrar uno se debe inspeccionar su inventario de tools, autenticación, mantenimiento y comportamiento de escritura.

## 7. Permisos sencillos

No hace falta una matriz complicada para el usuario final. Bastan estas reglas:

- leer correo y calendario: permitido cuando el usuario lo ha conectado;
- leer Excel: permitido cuando el usuario lo ha conectado;
- crear borradores: permitido, mostrando el resultado;
- enviar correo: confirmación obligatoria;
- crear o modificar un evento: confirmación obligatoria;
- modificar un Excel: mostrar resumen o diff y pedir confirmación;
- eliminar, compartir públicamente o sobrescribir datos importantes: confirmación obligatoria o fuera del MVP.

La empresa puede desactivar por completo un conector, pero la conexión concreta pertenece al usuario.

## 8. Plan de implementación

### Fase 1 — Base común de conexión

Objetivo: que un usuario pueda conectar y desconectar una App/MCP desde AiBrain.

Trabajo:

- generalizar el actual `codex-managed-app` para más de una App;
- endpoints server-side de conectar, callback, estado y desconectar;
- binding obligatorio por usuario;
- tarjeta de Conectores en Configuración;
- health check y estado `Reconectar`;
- ocultar el conector en los threads de otros usuarios;
- registrar las tools efectivas al crear el runtime thread.

Aceptación:

- Arnau conecta una cuenta;
- David no puede verla ni utilizarla;
- al desconectar desaparecen las tools;
- ningún token aparece en respuestas, logs o archivos del workspace.

### Fase 2 — Correo y calendario Google

Objetivo: Gmail y Calendar personales.

Primera entrega:

- buscar y leer mensajes;
- ver próximos eventos;
- consultar disponibilidad;
- preparar un borrador de correo;
- preparar un evento.

Segunda entrega:

- enviar el borrador tras aprobación;
- crear el evento tras aprobación;
- comprobar el resultado en Gmail o Calendar.

Aceptación:

- búsqueda real en una cuenta QA;
- evento real leído;
- borrador creado sin envío involuntario;
- envío y creación de evento confirmados directamente en Google.

### Fase 3 — Microsoft 365 y Excel MCP

Objetivo: conectar una cuenta Microsoft y editar un libro de Excel Online.

Trabajo:

- registrar y revisar el MCP de Excel elegido;
- conectar OAuth personal;
- listar archivos disponibles en OneDrive/SharePoint;
- leer hojas, rangos, tablas y fórmulas;
- preparar un cambio y mostrar las celdas afectadas;
- ejecutar tras confirmación;
- releer exactamente el rango modificado;
- mostrar enlace al workbook y resultado.

Aceptación:

- abrir un workbook QA real;
- leer valores y fórmulas correctamente;
- cambiar un rango pequeño;
- comprobar el cambio desde Excel Online;
- detectar si el archivo cambió antes de escribir;
- no repetir una escritura cuyo resultado sea incierto.

### Fase 4 — Outlook y Calendar Microsoft

Reutilizar la misma conexión Microsoft para:

- buscar y leer correo Outlook;
- preparar y enviar un borrador con confirmación;
- consultar calendario;
- preparar y crear eventos con confirmación.

### Fase 5 — Otros MCP

Cuando lo anterior funcione, permitir que la empresa habilite otros conectores revisados. No hace falta un marketplace completo: una lista administrada de Apps/MCP compatibles es suficiente.

## 9. Criterios para elegir el MCP de Excel

Antes de decidir cuál integrar, debe pasar esta prueba:

- autenticación Microsoft por usuario;
- compatible con OneDrive/SharePoint usados por el cliente;
- tools de rango, tabla y fórmula;
- schemas de entrada estrictos;
- lectura antes y después de escribir;
- control de versión o conflicto;
- errores claros;
- límites de tamaño y paginación;
- proyecto mantenido y origen confiable;
- no solicita credenciales dentro de argumentos de tools;
- permite aprobación antes de escribir;
- prueba real con un workbook representativo.

Si no cumple estos puntos, conviene construir un adaptador pequeño sobre Microsoft Graph en lugar de depender del MCP.

## 10. Orden recomendado

1. Pantalla y flujo genérico de conexión personal.
2. Gmail y Google Calendar.
3. Evaluación práctica de 2–3 MCP de Excel con el mismo workbook de prueba.
4. Integración del mejor MCP o adaptador Microsoft Graph.
5. Edición Excel con preview, confirmación y readback.
6. Outlook y Microsoft Calendar.
7. Otros conectores según uso real.

## 11. Definition of Done del MVP

El MVP estará terminado cuando:

- cada usuario pueda conectar su propia cuenta Google;
- pueda leer Gmail y Calendar desde su conversación;
- enviar o crear eventos requiera confirmación;
- cada usuario pueda conectar Microsoft 365/Excel;
- Codex pueda leer y editar un workbook QA real;
- la edición muestre qué va a cambiar y confirme el resultado;
- una conexión nunca sea visible ni utilizable por otro usuario;
- desconectar retire inmediatamente las tools;
- ninguna credencial aparezca en chat, logs o workspace;
- los resultados se hayan comprobado en Gmail, Calendar y Excel Online, no solo mediante respuestas HTTP.

## Fuentes oficiales consultadas

- [OpenAI API: herramientas MCP y conectores](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [OpenAI Developers: Codex, plugins y MCP](https://developers.openai.com/)
