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

## Diseño y copy automáticos

Todas las instalaciones incorporan como baseline de producto `impeccable`,
`emil-design-eng`, `design-taste-frontend`, `redesign-existing-projects`,
`ux-writing`, `human-writing` y `ogilvy-copywriting`. Se preservan las entradas
configuradas y se añaden solo los IDs ausentes. El catálogo efectivo sigue
aplicando denegaciones por usuario, grupo o rol y revoca la copia privada.

La política del servidor se incorpora en cada turno, incluidas reanudaciones.
El modelo interpreta la conversación completa, referencias y continuaciones en
cualquier idioma; no depende de palabras clave ni de selección manual.

- Diseño: Impeccable dirige coherencia y verificación.
- Frontend: Taste revisa patrones genéricos; Emil se aplica a interacciones y
  movimiento; Redesign a mejoras de interfaces existentes.
- Textos de interfaz: UX Writing, incluso en peticiones sin cambios visuales.
- Prosa entregable: Human Writing; Ogilvy solo añade criterio comercial cuando
  el objetivo sea persuasivo. Una respuesta factual no carga estas guías.

La aplicación es silenciosa: no se anuncian skills, rutas o versiones salvo
pregunta expresa. Se explican resultados y limitaciones materiales. El brief,
la marca y la función prevalecen sobre recetas estéticas. La revisión editorial
preserva hechos y voz, elimina relleno y prohíbe inventar cifras, testimonios,
causas de error o promesas. Las métricas de legibilidad son orientativas.

Solo se enlazan rutas privadas de paquetes autorizados, con versión y digest.
Una guía requerida no disponible no autoriza instalarla ni leer otra copia;
se explica la limitación en lenguaje de producto. Las tareas no relacionadas
pueden continuar. Ninguna skill amplía permisos de herramientas o proveedores.

Los seis nuevos paquetes son snapshots de las skills locales del 2026-09-10,
con manifiestos versionados. Los materiales de apoyo de UX Writing y Human
Writing se incluyen en `resources/`. Impeccable conserva su paquete versionado
existente; esta integración no actualiza su distribución.
Los límites de paquetes y cargas administrativas permanecen iguales.

Validación: sincronización íntegra e idempotente, copias aisladas, revocación
individual y política de activación/copy. Esto verifica el contrato local, no
la selección semántica real de un modelo. La aceptación tras publicación y
despliegue debe probar diseño, continuación, microcopy, correo comercial y una
consulta sin diseño; comprobar lecturas pertinentes sin anuncios internos,
y un usuario con guía denegada. CI, publicación, despliegue y aceptación
conversacional son gates independientes.

## Apps gestionadas por usuario (Composio)

`connectors.composio.toolkits` admite auth configs OAuth2 propios y herramientas
revisadas de lectura con versiones fijas. La API key se instala exclusivamente en
el entorno secreto del servidor (`AIBRAIN_COMPOSIO_API_KEY`). No crea cuentas ni
configs externos. Catálogo, consentimiento, readback ACTIVE por usuario, @,
lecturas y revocación están enlazados; las cuentas/configuración externas siguen
siendo un gate independiente. Véase [CONNECTORS.md](../CONNECTORS.md) para el
manifiesto, callbacks, scopes, comparación con Melso y aceptación pendiente.

## Flujo especializado de presentaciones

`presentation-craft` se incorpora al mismo baseline efectivo y privado para
presentaciones PPTX y PDF de diapositivas. Traslada del bundle Codex Presentations
26.905.11957 las guías editoriales, visuales, de portada y financieras. La
adaptación sustituye APIs exclusivas de escritorio por el autor PptxGenJS y las
herramientas privadas `render`/`deliver` que Arnall ya ofrece. No afirma paridad
de herramientas, importación fiel de PPTX o un finalizador automático inexistente.

El flujo exige storyboard, fuentes y cálculos coherentes, evidencia editable,
revisión de todas las imágenes finales y corrección antes de entregar. El copy
de diapositivas activa también Human Writing. La elección de guías se hace en
cada turno sin anuncios internos. Las instrucciones de frontend siguen sin
aplicarse a un deck: ahora existe una ruta editorial específica para ese medio.

La política exige la revisión al modelo; no es un bloqueo técnico que pruebe
que haya observado una imagen. Validación local de paquetes y contexto no
sustituye aceptación con un turno real. Caso de aceptación: rehacer un informe
ficticio autorizado de facturación con gráfico de cascada, verificar el total
final desde cero, unidades sin cortes, cálculos y lectura de cada página del
mismo hash; evaluar composición y copy además de conversión y entrega.
