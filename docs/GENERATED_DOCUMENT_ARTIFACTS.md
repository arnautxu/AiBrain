# Artefactos documentales generados

Los PDF, DOCX, PPTX y XLSX producidos durante un turno dejan de depender del
workspace mutable del worker antes de aparecer en el chat. El servidor valida
el formato, copia los bytes a un blob inmutable bajo el `dataRoot` de la
instalación, sincroniza el fichero y su directorio, registra su hash y solo
entonces emite el artefacto hacia la proyección durable del mensaje.

## Cadena persistente

```text
fichero final en documents/ + llamada explícita a aibrain_documents.deliver
  -> validación de firma, MIME, tamaño y OOXML
  -> blob inmutable por propietario + id de artefacto
  -> índice durable proyecto + conversación + mensaje + propietario + hash
  -> evento de artefacto en la proyección durable del turno
  -> URL opaca ligada a la conversación
  -> representación PDF o PNG paginada
  -> descarga de los bytes originales
```

La ruta es `GET /api/threads/:threadId/artifacts/:artifactId`. Acepta
exclusivamente uno de estos modos:

- `?download=1`: bytes originales con `Content-Disposition: attachment`;
- `?preview=1`: representación PDF privada;
- `?preview=1&page=N`: página PNG privada para navegación y zoom.

## ACL e integridad

El `threadId` de la URL debe coincidir con el vínculo durable. El servidor
resuelve primero el acceso actual a esa conversación y solo después obtiene
la raíz de almacenamiento del propietario. Una conversación distinta, un
usuario sin acceso, otra instalación, una ruta cambiada o bytes cuyo tamaño o
SHA-256 no coincidan fallan antes de convertir o descargar.

El artefacto usa el volumen persistente de la instalación, no la vida del
proceso ni la selección de chat del navegador. Por eso conserva preview y
descarga después de refresh, cambio de chat, reapertura o reinicio de la
aplicación. El fichero del workspace puede evolucionar sin alterar el resultado
histórico mostrado en la conversación.

Las representaciones no ejecutan contenido. Office se abre con LibreOffice en
modo headless/safe y se convierte a PDF; las páginas se renderizan como PNG.
Los libros XLSM de la red documental siguen el extractor OOXML de solo datos:
no se carga ni ejecuta `vbaProject.bin`, no se recalculan fórmulas y la UI
muestra valores guardados en una superficie de libro protegida.

## Verificación local

La aceptación debe cubrir de forma separada:

1. persistencia inmutable e idempotente de los formatos generados;
2. proyección del artefacto y recuperación del mensaje tras reabrir;
3. acceso positivo del propietario y denegación por conversación, usuario e instalación;
4. hash alterado, parámetros ambiguos y página fuera de rango;
5. conversión real PDF/DOCX/PPTX/XLSX y extracción XLSM sin macros;
6. visor responsive con navegación, zoom, fullscreen, cierre y descarga.

La validación local no prueba por sí sola CI, publicación, despliegue ni
aceptación autenticada en Arnall.

## Autoría, revisión y entrega de presentaciones

Las presentaciones diseñadas siguen la ruta de autoría local con PptxGenJS
empaquetado en la imagen. El agente redacta un guion, compone las diapositivas
con texto y elementos visuales pertinentes, aplica las skills autorizadas y
revisa el resultado antes de publicarlo. No se instalan dependencias durante el
turno ni se sustituye una capacidad ausente por una presentación básica sin
explicar la limitación.

Los borradores se guardan en `.aibrain-drafts/` dentro del workspace privado.
La comprobación usa el PPTX real: conversión a PDF mediante LibreOffice,
renderizado de todas sus páginas con Poppler e inspección de composición,
legibilidad, recortes, solapamientos y número de diapositivas. Solo los archivos
finales revisados se copian a `documents/` y se entregan mediante
`aibrain_documents.deliver`. Los listados, comandos y textos no crean adjuntos.
Si se solicitan PDF y PPTX, el PDF se deriva del mismo PPTX para conservar diseño
y paginación. La captura de bytes válidos no demuestra calidad visual.

`aibrain_documents.create` y `create_batch` siguen disponibles para documentos
sencillos. Son renderizadores de contenido final, no ejecutores de prompts.
Las `slides: [{ title, body }, ...]` sirven para solicitudes explícitas de
presentaciones de texto básico. `content` es un resumen y no se imprime cuando
se proporcionan diapositivas. Cada entrada produce exactamente una página
16:9: si supera la capacidad del diseño se devuelve
`LOCAL_DOCUMENT_SLIDE_OVERFLOW`, sin cortar frases, repetir títulos ni crear
páginas adicionales. El PPTX antiguo con separadores `---` mantiene sus límites
explícitos y la misma validación de exceso. Más de 50 diapositivas produce un
error. Un PDF sin `slides` conserva el formato de informe A4.

Los recibos incluyen las diapositivas en su huella de idempotencia. Las pruebas
locales cubren formatos, límites, paginación y entrega durable; la aceptación de
una presentación requiere además inspección del archivo real generado por un
turno autenticado. CI, publicación y despliegue siguen siendo gates separados.

## Conversión headless en el contenedor restringido

El conversor usa un `/proc` vacío de solo lectura dentro de su namespace PID.
No monta el proc del host ni relaja el aislamiento cuando el kernel rechaza un
nuevo procfs. LibreOffice se ejecuta mediante su binario nativo con directorio
de bibliotecas fijo, perfil privado, backend `svp` y HOME/XDG/TMPDIR privados y
escribibles. Se conservan `--safe-mode`, `--norestore` y el nivel de seguridad de
macros. Los códigos de ciclo de vida 81/82 permiten como máximo tres ejecuciones
del mismo comando; otros errores se propagan sin reintentar.

La guía de autoría del worker utiliza los mismos launchers de conversión desde
un directorio temporal autorizado, para evitar heredar caches de solo lectura
o intentar abrir un display. El estado correcto exige un PDF real y páginas PNG
válidas; un preflight que solo comprueba montajes o una salida cero no demuestra
conversión. La prueba de contenedor debe usar las restricciones de producción y
comprobar exportación y renderizado, además de las fronteras de privacidad.

El perfil seccomp permite `close_range` para cerrar descriptores sin consultar
`/proc`; `clone3` sigue denegado con ENOSYS para conservar el fallback de libc
a las reglas restringidas de `clone`. La publicación de este cambio requiere
actualizar también el perfil del host. Backend CI ejecuta
`scripts/container-document-conversion-acceptance.mjs` en la imagen final:
PptxGenJS → PDF de dos páginas → texto verificado → dos PNG, sin red ni datos de
clientes. La reproducción aislada con la imagen desplegada también convirtió
el deck recuperado de Minecraft en ocho páginas PDF y ocho PNG. Esto no prueba
que el cambio esté desplegado ni sustituye una nueva aceptación autenticada.

## Revisión de presentaciones fuera del shell del agente

La conversión desde el contenedor no prueba conversión desde un comando Codex:
el sandbox anidado del agente deniega el socket `NETLINK_ROUTE` que bubblewrap
usa al inicializar loopback. La herramienta cerrada `aibrain_documents.render`
se despacha en el servidor, tras comprobar identidad de instalación, usuario,
proyecto, turno y permiso `tools.execute`. Lee únicamente un borrador relativo
al workspace autorizado, valida sus bytes y utiliza el servicio de preview con
sus límites de concurrencia y los mismos wrappers aislados. No se amplían los
permisos del shell ni se añade acceso de red al conversor.

Cada llamada devuelve una página PNG para inspección, el número de páginas,
el hash del origen y un PDF de revisión dentro de `.aibrain-drafts/`; nunca
crea una entrega final. Una modificación del origen invalida la revisión.
Solo después de inspeccionar todas las páginas el agente promueve los formatos
solicitados a `documents/`. Las conversaciones con un catálogo antiguo abren
un runtime actualizado conservando el historial durable de la conversación:
las herramientas dinámicas no se pueden añadir a un runtime ya creado.

La aceptación de contenedor debe ejercitar la herramienta de renderizado con
el servicio real y comprobar imagen, PDF, aislamiento y ausencia de artefactos
finales prematuros. Sigue siendo distinta de una nueva aceptación autenticada
que demuestre autoría, revisión visual y entrega desde un turno del producto.

El renderizado de páginas posteriores a la primera usa también un directorio
`.work-*` privado y una copia verificada del PDF dentro de él. Pasar la ruta
al PDF del directorio padre queda prohibido por el wrapper. La prueba real
recorre al menos dos páginas para cubrir tanto la página inicial cacheada como
la generación posterior; una prueba de conversión única no cubre esa ruta.
Las llamadas de revisión `render` no activan el temporizador de cierre reservado
a la entrega de documentos: el agente puede continuar inspeccionando páginas.

Verificación local del candidato (2026-09-08): la herramienta real ejecutada en
un contenedor desechable con la imagen desplegada y sus restricciones produjo
10 páginas PDF y 10 respuestas PNG del PPTX de la incidencia; el origen conservó
su SHA-256 y una identidad incorrecta se rechazó antes de convertir. No se
montaron volúmenes de producción en el contenedor de prueba ni se modificó el servicio
en ejecución. El despliegue del candidato y un nuevo turno autenticado siguen
pendientes.

## Entrega explícita y persistencia de imágenes

La inferencia de entregas desde texto de comandos, listados o historial está
retirada: mencionaba archivos antiguos y los adjuntaba al turno equivocado.
`aibrain_documents.deliver` acepta únicamente una ruta relativa bajo
`documents/`, tras validar identidad exacta del turno y permisos. La lectura
segura y validación de bytes preceden a la publicación privada inmutable; una
segunda llamada con los mismos bytes conserva el artefacto y no puede cambiarlo.
La revisión `render` sigue sin entregar archivos. El catálogo versionado renueva
los runtimes anteriores con su historial durable para disponer de `deliver`.

El validador de persistencia del mensaje acepta las dimensiones opcionales
`width` y `height` de imágenes generadas, igual que el contrato público. Ambas
deben estar presentes como enteros válidos; campos desconocidos siguen
rechazados. Antes de este ajuste, un turno con imágenes podía verse en la
proyección incremental pero fallar al finalizar el almacenamiento del chat.

La guía de revisión muestra cómo emitir la imagen retornada desde code mode
sin imprimir su base64 como texto. La incidencia observada alcanzó primero
el límite de diez minutos del turno y después falló al persistir las imágenes;
corregir la persistencia no equivale a haber completado ese trabajo interrumpido.

## Preview de entregas sin paginación persistida

Las entregas explícitas pueden conservar `pages: null`. El visor identifica la
ruta de artefactos generados y solicita igualmente la primera página PNG,
sin depender del visor PDF nativo del navegador. La respuesta autenticada incluye
`X-Document-Page-Count`, obtenido de la conversión validada, para habilitar la
navegación. Esto recupera también mensajes históricos sin reescribir sus blobs
ni su metadata durable. Descarga, integridad y ACL mantienen la misma frontera.
