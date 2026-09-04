# Catálogo empresarial de AiBrain

El catálogo es la única capa que expone skills, apps, conectores y herramientas MCP a una persona. Parte de una denegación por defecto: no se instala ni se administra nada desde la sesión de un empleado.

## Modelo y precedencia

1. GraphikAI declara las skills base inmutables en `catalog.graphikAIManagedSkills` de la configuración de instalación.
2. Un administrador de la empresa registra recursos adicionales y reglas mediante `GET/PATCH /api/admin/catalog`; ambos requieren sesión local, pertenencia a la instalación, rol administrador y origen same-origin.
3. Para la misma operación y recurso se aplica la primera regla que coincida, por este orden: usuario, grupo, rol, instalación. Dos reglas de grupo se resuelven con denegación dominante. Si no hay regla, se deniega.

Los recursos OAuth personales se enlazan por usuario. Una credencial compartida solo se admite para un recurso marcado explícitamente como `shared-resource` y `sharedResource: true`; nunca se reutiliza OAuth personal.

## Operación segura

- `skills/list`, `app/list`, `app/installed` y `mcpServerStatus/list` se filtran en el runtime antes de devolverse al worker.
- Toda herramienta MCP no declarada se rechaza. Las de lectura declaradas se permiten por policy. Las escrituras sensibles necesitan permiso `write`, capacidad `execute`, una aprobación durable y readback del provider mediante un adaptador gestionado; la ruta MCP genérica se rechaza.
- No se expone `credentialRef`, token OAuth, secreto, ni callback OAuth por la API de catálogo.
- No añadas rutas de `plugin/install`, `skills/config/write`, `skills/extraRoots/set` o `mcpServer/oauth/login` al cliente: el transport las deniega para empleados.

## Integración con Runtime

El punto de integración para el task Runtime es `runWorkerCodexTurn` en `src/runtime/worker-codex-turn.ts`, inmediatamente antes de añadir una skill a `turn/start`. Allí el worker vuelve a resolver el principal autenticado y rechaza una skill que no tenga lectura explícita en el catálogo. No sustituye ni relaja los flujos existentes: `auto_review` sigue determinando el revisor de las aprobaciones y una política `DENY` continúa rechazando la ejecución genérica antes de crear una aprobación. Para apps, conectores y MCP, el límite equivalente es el `CatalogEnforcedTransport`: filtra los inventarios antes de devolverlos al adaptador y rechaza instalaciones, OAuth desde la sesión y herramientas MCP no declaradas.

## Correo inicial y alta de Arnall reutilizable

Gmail y Outlook son recursos GraphikAI gestionados pero se añaden al catálogo durable únicamente cuando su bloque de instalación tiene `enabled=true`. Deshabilitar un proveedor retira su recurso y sus reglas gestionadas; no basta con ocultarlo en la UI. Las reglas de usuario/grupo/rol pueden restringir después ese baseline de instalación. Ajustes distingue un recurso autorizado pendiente de configuración administrativa de otro listo para el OAuth personal; la ausencia de tarjeta significa que la instalación o la política efectiva no lo autoriza. El selector `@` solo ofrece recursos permitidos y conectados; el menú `+` puede mostrar los recursos permitidos todavía pendientes, deshabilitados y con su estado honesto.

Cada proveedor usa un callback, secreto de aplicación, clave de cifrado y directorio por conector. Cada empleado tiene un binding y token cifrado bajo su UUID; no existe fallback compartido. Consulta [GMAIL_OAUTH.md](GMAIL_OAUTH.md) y [OUTLOOK_OAUTH.md](OUTLOOK_OAUTH.md) para la configuración externa exacta.

`config/installations/arnall.qa.example.json` incluye una skill base de GraphikAI. Para habilitar un recurso adicional, un administrador debe crear primero el recurso y después reglas `allow` explícitas. Para una acción MCP sensible, declara el servidor, la lista de lectura y `sensitiveWriteTools`; configura el adaptador gestionado con aprobación durable y readback correlacionado antes de conceder `write`.

No uses este fixture como credencial ni lo completes con secretos. La evidencia de una acción real sigue exigiendo OAuth, binding personal/compartido correcto, aprobación, una única ejecución, readback del provider y auditoría correlacionada.

## Diseño de Arnall: Impeccable obligatorio

Las instalaciones con `companySlug: arnall` incorporan `impeccable` como skill
GraphikAI base, también con configuraciones existentes que todavía no la enumeran.
El valor procede de la configuración del servidor, nunca del texto de un chat.
La sincronización usa el catálogo efectivo: una denegación por usuario, grupo o
rol sigue prevaleciendo y retira la copia privada de ese usuario.

Cada turno incluye una instrucción de aplicación obligatoria para trabajo de
diseño, revisión visual o refinamiento, también cuando otra skill esté seleccionada.
El modelo decide la relevancia a partir de toda la conversación y las referencias,
sin depender de palabras clave ni de que el empleado seleccione una skill.
La regla enlaza el `SKILL.md` privado con versión y digest y exige leerlo y aplicar
el playbook correspondiente antes de actuar. Se conserva al reanudar una
conversación y mediante el contexto de aplicación de los turnos en memoria.
Si la skill está denegada o no disponible, debe explicar el bloqueo de diseño;
no puede instalarla ni sustituirla silenciosamente. El trabajo ajeno al diseño
no activa sus guías.

`skills/impeccable` contiene una copia completa, con normalización de espacios, de la skill
instalada Impeccable 4.1.1 (153 archivos), más el manifiesto de AiBrain.
Los paquetes del repositorio admiten hasta 256 archivos, 512 KiB por archivo y
4 MiB en total, con rutas acotadas de recursos, referencias, scripts y agentes.
Las cargas administrativas mantienen el límite de 24 archivos de texto,
64 KiB por archivo y 256 KiB por paquete; no admiten scripts. Copiar un script
no lo ejecuta ni autoriza herramientas, proveedores, costes o publicaciones.
Las capacidades opcionales de Impeccable siguen sujetas al runtime disponible.
El tracing standalone existente incluye el paquete completo en la imagen.

Validación local: catálogo base idempotente, copia íntegra en dos hogares
privados, denegación y revocación individual, separación entre empresas,
límites de cargas administrativas y contexto de nuevos turnos/reanudaciones.
La aplicación en Arnall requiere publicar y desplegar el candidato por el flujo
protegido, y después comprobar una petición real de diseño y una continuación
con lectura observable de Impeccable. Esos gates live son independientes.

## Apps gestionadas por usuario (Composio)

`connectors.composio.toolkits` admite auth configs OAuth2 propios y herramientas
revisadas de lectura con versiones fijas. La API key se instala exclusivamente en
el entorno secreto del servidor (`AIBRAIN_COMPOSIO_API_KEY`). No crea cuentas ni
configs externos. Catálogo, consentimiento, readback ACTIVE por usuario, @,
lecturas y revocación están enlazados; las cuentas/configuración externas siguen
siendo un gate independiente. Véase [CONNECTORS.md](../CONNECTORS.md) para el
manifiesto, callbacks, scopes, comparación con Melso y aceptación pendiente.
