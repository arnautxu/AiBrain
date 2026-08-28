# Visualizaciones y sitios internos

AiBrain puede convertir una respuesta completada en dos artefactos de trabajo sin inventar contenido:

- una **visualización segura** cuando la respuesta contiene una tabla Markdown numérica válida, o cuando el runtime entrega la especificación limitada y tipada;
- un **sitio interno** creado desde el contenido de la respuesta o desde HTML que el servidor sanea antes de persistirlo.

La Library muestra ambos tipos, permite abrir la vista previa, descargar HTML, exportar un ZIP autocontenido y volver a la conversación de origen. Una visualización se explora mediante controles React propios; nunca se ejecuta una especificación JavaScript externa.

## Seguridad y aislamiento

- Los artefactos se guardan bajo el espacio privado del usuario autenticado. La API vuelve a resolver la conversación y exige que la fuente sea una respuesta real, completa y propiedad de esa sesión.
- Cada versión es un fichero nuevo creado de forma exclusiva. Una versión anterior no se sobrescribe. El manifiesto conserva el hash SHA-256 del contenido y cada publicación conserva el hash del HTML resultante.
- Las publicaciones se sirven exclusivamente desde `/api/artifacts/.../published/...`, que exige sesión. La etiqueta de producto es **sitio interno**: no implica dominio, hosting público ni acceso anónimo.
- El saneador usa una allowlist pequeña, elimina scripts, formularios, imágenes, estilos y manejadores de eventos. Los enlaces solo admiten `http`, `https` y `mailto`.
- Preview y publicación aplican una CSP independiente con `script-src 'none'`, `connect-src 'none'`, `object-src 'none'`, `form-action 'none'` y `frame-ancestors 'self'`.
- Los iframes de Library usan `sandbox` vacío y `no-referrer`. La versión interactiva de gráficos recibe solo datos que superan el validador estricto.

## Contrato funcional

- `POST /api/artifacts`: crea desde `threadId + messageId` y devuelve la versión 1.
- `POST /api/artifacts/:id/versions`: crea una versión inmutable desde otra respuesta real.
- `GET /api/artifacts/:id`: devuelve resumen y snapshot tipado; acepta `?version=N`.
- `GET /api/artifacts/:id/preview`: preview HTML autenticada y sin scripts.
- `GET /api/artifacts/:id/download?format=html|zip`: exportación autenticada.
- `POST /api/artifacts/:id/publish`: publica idempotentemente la última versión como sitio interno.
- `GET /api/artifacts/:id/published/:version`: snapshot publicado, todavía autenticado.

No existe hosting público en este contrato. Si una instalación añade un proveedor externo en el futuro, deberá incorporar un flujo de aprobación y permisos separado; no debe reutilizar la publicación interna como autorización implícita.
