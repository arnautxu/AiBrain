# Artefactos documentales generados

Los PDF, DOCX, PPTX y XLSX producidos durante un turno dejan de depender del
workspace mutable del worker antes de aparecer en el chat. El servidor valida
el formato, copia los bytes a un blob inmutable bajo el `dataRoot` de la
instalación, sincroniza el fichero y su directorio, registra su hash y solo
entonces emite el artefacto hacia la proyección durable del mensaje.

## Cadena persistente

```text
fichero generado en workspace privado
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
finales revisados se copian a `documents/` y se anuncian al capturador durable.
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
