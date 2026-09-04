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
