# Centro de tareas y notificaciones

## Alcance

El Centro de tareas presenta el trabajo real de las conversaciones del usuario con cuatro estados: `running`, `needs_attention`, `completed` y `failed`. No crea un scheduler ni una cola paralela. El historial se reconstruye desde los mensajes y proyecciones durables del workbench, que siguen siendo la fuente de verdad.

Una tarea puede continuar al cambiar de conversación. Tras recargar, `/api/task-center` vuelve a leer el workbench y recupera el estado más reciente. La UI sondea cambios con mayor frecuencia mientras existe trabajo en curso y también al recuperar el foco. Esta continuidad requiere que el servidor y el worker de la instalación sigan activos; no se presenta como ejecución cloud garantizada.

## Persistencia y aislamiento

Para sesiones locales, las lecturas y preferencias se guardan en:

`<usersRoot>/<userId>/state/task-center.json`

El documento contiene `installationId` y `userId`, se valida estrictamente, se escribe de forma atómica y se protege con el mismo modelo de locks del almacenamiento. La ruta se resuelve dentro del usuario autenticado. Las tareas no se duplican en ese fichero: sus resultados permanecen en el historial de conversación.

En browser preview, el mismo contrato se conserva en almacenamiento local con clave de tenant y usuario. Es un modo de demostración, no almacenamiento de producción.

## API

`GET /api/task-center` devuelve:

- tareas derivadas del workbench;
- ids ya leídos;
- preferencias `inApp` y `desktop`;
- `continuity: "worker_required"` para que ningún cliente prometa ejecución sin worker.

`PATCH /api/task-center` acepta exclusivamente una de estas operaciones:

- `{ "action": "mark_read", "taskIds": [...] }`
- `{ "action": "preferences", "preferences": { "inApp": true, "desktop": false } }`

Ambas requieren sesión y responden con el snapshot actualizado sin caché compartida.

## Permisos de avisos

Los avisos dentro de AiBrain están activos por defecto y se pueden desactivar. Los avisos del navegador están desactivados por defecto. `Notification.requestPermission()` solo se ejecuta después de que el usuario active explícitamente esa opción. Un permiso denegado no se vuelve a solicitar automáticamente.
