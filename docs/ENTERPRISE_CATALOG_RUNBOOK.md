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

## Alta de Arnall reutilizable

`config/installations/arnall.qa.example.json` incluye una skill base de GraphikAI. Para habilitar un recurso adicional, un administrador debe crear primero el recurso y después reglas `allow` explícitas. Para una acción MCP sensible, declara el servidor, la lista de lectura y `sensitiveWriteTools`; configura el adaptador gestionado con aprobación durable y readback correlacionado antes de conceder `write`.

No uses este fixture como credencial ni lo completes con secretos. La evidencia de una acción real sigue exigiendo OAuth, binding personal/compartido correcto, aprobación, una única ejecución, readback del provider y auditoría correlacionada.
