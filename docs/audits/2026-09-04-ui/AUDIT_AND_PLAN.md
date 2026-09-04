# Auditoría UI y plan de mejoras — AiBrain

Fecha: 4 de septiembre de 2026. Base revisada: `e4af14a2f97ea49d3b139d2c6f762fba8e510bcc`, referencia remota obtenida al comenzar. Rama de implementación: `codex/ui-audit-20260904`.

## Estado de ejecución

El plan de seis commits está implementado y verificado localmente. Se conserva a continuación el diagnóstico inicial y sus puntuaciones como línea de base, sin recalificarlas retrospectivamente. El commit de entrega de imágenes `8c5bc4c` queda incluido por ascendencia.

| Trabajo | Commit |
| --- | --- |
| Descarga móvil y contraste | `0946222` |
| Selección visible en búsqueda | `226cdab` |
| Estados y recuperación del PNG | `9068478` |
| Guía de creación, metadatos y proporciones | `8ac2368` |
| Recuperar solicitud para revisar | `e2ee17d` |
| Tipografía de administración, ayuda de modos y documentación | Commit que contiene este informe |

Se integraron los avances remotos `634e79d` y `d927d92` sin sustituir sus comprobaciones de descarga WebKit. El push requiere un nuevo `pull` de `origin/main` inmediatamente antes, según la instrucción del usuario.

## Conclusión de la auditoría inicial

La interfaz tiene una base visual coherente: entrada principal clara, colores contenidos, navegación reconocible y complejidad técnica mayoritariamente apartada del empleado. Conviene completar los flujos y corregir defectos concretos antes de ampliar el diseño.

Prioridad: **recuperar la descarga de imágenes en móvil, corregir el contraste de sus descripciones y mantener visible la selección al buscar con teclado**. Después: recuperación de errores, guía contextual y presentación de resultados.

10 hallazgos: **0 P0, 3 P1, 6 P2 y 1 P3**. P1 significa dificultad importante; no todos los P1 son incumplimientos normativos. Ningún defecto se atribuye al proveedor de generación sin evidencia.

## Alcance y límites

- Revisión del código actual, PRODUCT.md, DESIGN.md, fuentes de verdad operativa y runbook de imágenes.
- Dos evaluaciones independientes: crítica de diseño y detector de implementación, más comprobaciones funcionales de los hallazgos.
- Instancia local aislada en `127.0.0.1:3194`, usuario sintético `example-user`, sin datos ni llamadas a proveedores de producción.
- Chromium a 1440×900 y 390×844; comprobación adicional con perfil iPhone 13 y puntero táctil en Chromium y WebKit; temas claro y oscuro; movimiento reducido.
- Flujos: inicio, composer, menús, configuración, búsqueda, imagen entregada, error de vista previa. Las pruebas existentes cubren además login, aprobaciones, documentos y panel de navegador. Administración se revisó en código.
- La imagen usada en la prueba visual es una captura de referencia versionada, servida como fixture PNG. **No es una nueva imagen generada con IA**. Los fallos de red fueron inducidos localmente.
- No constituye auditoría exhaustiva de todos los conectores, pruebas con usuarios, medición de rendimiento de producción ni aceptación de una instalación desplegada.

## Commit de imágenes de IA incluido

**`8c5bc4cd95b15b1fd066a0ae4647d7a7b2bb6d4f` — `fix(images): deliver generated PNG artifacts`** ya es ancestro de la base auditada. No requiere cherry-pick ni volver a implementarlo.

Entrega PNG binario privado, URL opaca autorizada, persistencia, descarga `?download=1` y conversión de los píxeles a PDF A4. Runbook: [GENERATED_IMAGE_ARTIFACTS.md](../../GENERATED_IMAGE_ARTIFACTS.md).

También se incluyen las correcciones posteriores de la prueba WebKit: `8cd38d4`, `57394a0`, `329fa96` y `f7be595`. La última verifica la descarga nativa en la frontera HTTP. Son cobertura de entrega, no una auditoría completa de composición visual.

El plan siguiente añade mejoras de UI sobre esa entrega existente. Generar nuevas ilustraciones decorativas no forma parte de este plan: la petición de incluir el commit se interpreta como revisar el trabajo existente de imágenes.

## Puntuación orientativa

Las puntuaciones son juicio de auditoría sobre las superficies revisadas, no una certificación.

| Dimensión técnica | /4 | Evidencia principal |
| --- | ---: | --- |
| Accesibilidad | 2 | Contraste de descripción de imagen y selección de búsqueda fuera de vista |
| Rendimiento | 3 | Sin defecto medido; revisión de código, pendiente perfil de producción |
| Responsive | 2 | Descarga fuera de la pantalla con una descripción larga |
| Theming | 3 | Temas coherentes, excepción de opacidad en resultados |
| Integridad de implementación | 3 | Sistema coherente; documentación de tokens desfasada |
| **Total provisional** | **13/20** | Aceptable, con trabajo significativo en los flujos señalados |

| Heurística de uso | /4 |
| --- | ---: |
| Visibilidad de estado | 3 |
| Lenguaje del usuario | 3 |
| Control y salida | 3 |
| Consistencia | 3 |
| Prevención de errores | 3 |
| Reconocimiento de opciones | 2 |
| Eficiencia | 3 |
| Claridad visual | 3 |
| Recuperación de errores | 2 |
| Ayuda contextual | 2 |
| **Total** | **27/40** |

Carga cognitiva global baja en la entrada principal: 1/8 criterios problemáticos en la evaluación visual; el modo imagen conserva indicaciones propias de tareas de texto. No se justifica una sustitución general del diseño.

## Hallazgos y aceptación

### UI-01 · P1 · La descarga queda fuera de pantalla en móvil

**Evidencia reproducida:** con una descripción larga, la tarjeta mide 420 px dentro de un contenedor de 358 px a viewport de 390 px. En Chromium y WebKit táctiles, el enlace de descarga ocupa `x=392…436`, completamente fuera de la pantalla. El documento sigue midiendo 390 px: comprobar solo `scrollWidth` no detecta el recorte interno.

Ubicación: `src/components/chat-workspace.tsx:344`, `src/components/assistant-ui/elements/image-generation.tsx:36`, `:104`, `src/components/turn-artifact-card.tsx:113`.

**Cambio:** contener el tamaño mínimo intrínseco de la tarjeta y su fila de descripción, usar columnas explícitamente contraíbles y conservar las acciones dentro del ancho disponible. No esconder el fallo con otro `overflow:hidden`.

**Aceptación:** descripción corta, larga y cadena sin espacios; una y varias imágenes; 320/390/768 px y escritorio; descarga visible y accionable mediante hit-test y click táctil, no solo existencia en DOM. Categoría: Responsive. Comando: `/adapt`.

### UI-02 · P1 · Contraste insuficiente de la descripción de imagen

**Evidencia reproducida con axe:** texto de 12 px, ratio **3,11:1 en claro y 3,99:1 en oscuro**, con `text-foreground/45`. Se reproduce en ambas anchuras.

Ubicación: `src/components/assistant-ui/elements/image-generation.tsx:104`.

**Cambio:** usar un token semántico de texto secundario que alcance 4,5:1 sobre el fondo efectivo en ambos temas; revisar también la legibilidad del icono de descarga.

**Aceptación:** axe sobre resultado con imagen, descripción y acciones, claro/oscuro. [WCAG 1.4.3: contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Categoría: Accesibilidad/Theming. Comando: `/harden`.

### UI-03 · P1 · Buscar con flechas pierde la selección visible

**Evidencia reproducida:** con 35 conversaciones y 27 pulsaciones de Flecha abajo, la opción seleccionada aparece alrededor de `y=1593` mientras la lista acaba en `y=549`; `scrollTop=0`. Reproducido en Chromium y WebKit. El input mantiene el foco y cambia `aria-activedescendant`, pero la lista no acompaña la selección.

Ubicación: `src/components/command-palette.tsx:38`, `:46`.

**Cambio:** desplazar únicamente la opción activa a la región visible, respetando el foco del combobox y movimiento reducido.

**Aceptación:** 35+ resultados, recorrido hacia abajo/arriba y circular; buscar de nuevo después de navegar; comprobar posición real de la selección antes de pulsar Enter. Categoría: Accesibilidad/Interacción. Comando: `/harden`.

### UI-04 · P2 · Imagen fallida sin explicación ni recuperación

**Evidencia reproducida:** respuesta HTTP 503 deja imagen rota/alt dentro de un marco vacío, la descripción habitual y el enlace de descarga. No hay estado de error ni recarga de vista previa.

Ubicación: `src/components/assistant-ui/elements/image-generation.tsx:45`, `src/components/turn-artifact-card.tsx:108`.

**Cambio:** estados de carga, listo y fallo; mensaje breve; acción «Volver a cargar». Diferenciar caducidad de sesión cuando la respuesta lo permita. No anunciar una descarga como disponible si no se ha comprobado.

**Aceptación:** carga lenta, desconexión, 401/403/404/503 y recuperación. Reintentar la vista previa solo vuelve a pedir el PNG: no genera otra imagen ni provoca gasto. Categoría: Estados/Recuperación. Comando: `/harden`.

### UI-05 · P2 · «Crear imagen» no adapta la guía

**Evidencia visual y de código:** activar el modo conserva el placeholder genérico y las sugerencias «Prioridades», «Estado del proyecto» y «Actualización al equipo». Estas sugerencias llaman directamente a `onSend`.

Ubicación: `src/components/chat-workspace.tsx:857`, `:875`, `:1008–1010`.

**Cambio:** placeholder «Describe la imagen que quieres crear…», ejemplos pertinentes al modo y selección de ejemplo que rellene el composer para revisarlo antes de enviar. Mantener la activación y desactivación explícitas y los permisos actuales.

**Aceptación:** alternar texto/imagen actualiza indicaciones y ejemplos, conserva el borrador y no inicia un turno al seleccionar una sugerencia. Categoría: Guía/Prevención. Comando: `/clarify`.

### UI-06 · P2 · Resultado de imagen pequeño y difícil de identificar

**Evidencia:** una sola imagen usa dos columnas en escritorio: tarjeta de 346 px en una región de 704 px. El marco es siempre cuadrado aunque el PNG sea horizontal. La descripción queda truncada; no se muestran nombre, dimensiones ni etiqueta visible de descarga. Pulsar la imagen abre otra pestaña.

Ubicación: `src/components/chat-workspace.tsx:344`, `src/components/assistant-ui/elements/image-generation.tsx:42`, `:104–119`, `src/components/turn-artifact-card.tsx:106`.

**Cambio:** una columna para un resultado, rejilla para varios, proporción natural acotada; nombre corto y acciones «Ampliar»/«Descargar PNG»; descripción desplegable. Mostrar dimensiones solo si proceden de metadatos verificados o de la imagen cargada. El contrato actual no ofrece todas estas propiedades: definir su origen antes de ampliar la UI.

**Aceptación:** cuadrada, vertical, horizontal, múltiples resultados y descripción larga; sin recorte del contenido ni desplazamiento brusco al cargar. Categoría: Jerarquía/Resultados. Comando: `/layout` y `/clarify`.

### UI-07 · P2 · Error de respuesta sin acción para repetir o editar

**Evidencia de código:** «No se ha podido completar esta respuesta. Inténtalo de nuevo.» no incluye una acción; las acciones del resultado ofrecen copia.

Ubicación: `src/components/chat-workspace.tsx:334–338`, `:243–266`.

**Cambio:** recuperar la petición en el composer mediante «Editar solicitud». Añadir «Reintentar» solo con semántica definida para respuestas parciales y efectos ya ejecutados; no repetir automáticamente acciones sensibles.

**Aceptación:** conserva petición, adjuntos y contexto permitido; distingue fallo antes/después de efectos; no duplica un turno terminado. Categoría: Recuperación. Comando: `/harden`.

### UI-08 · P2 · Texto demasiado pequeño en administración

**Evidencia de código:** campos de 10–11 px; fechas de 9 px e identificador del actor de 8 px en el registro.

Ubicación: `src/components/admin-center.tsx:129`, `:133`, `:160`.

**Cambio:** normalizar campos y registro a tokens legibles; detalles técnicos secundarios desplegables. La compactación debe reducir espacio, no la legibilidad de datos importantes.

**Aceptación:** recorrido owner con contenido realista, 200 % de zoom, campos y registro en móvil. Tamaño pequeño por sí solo no demuestra un incumplimiento WCAG. Categoría: Tipografía. Comando: `/typeset`.

### UI-09 · P2 · DESIGN.md ya no describe fielmente la UI

**Evidencia:** documenta Geist y sidebar aproximado de 280 px; CSS usa fuente del sistema y 256 px. La escala documentada omite tamaños habituales actuales. Esto genera gran parte del ruido del detector.

Ubicación: `DESIGN.md:23–54`, `:188`, `src/app/globals.css:48–54`, `:136`.

**Cambio:** reconciliar documentación y tokens con la identidad actual. No sustituir fuentes, colores o 304 tamaños automáticamente para satisfacer un documento antiguo.

**Aceptación:** escala, colores, densidad y dimensiones documentados coinciden con las decisiones adoptadas; detector clasificado sin cambios cosméticos masivos. Categoría: Integridad. Comando: `/audit` para verificar, con actualización documental explícita.

### UI-10 · P3 · Ayuda poco concreta en modos de trabajo

**Evidencia de código:** «Rápido / Inteligente / Experto» y descripciones genéricas no ilustran claramente qué tareas encajan en cada opción.

Ubicación: `src/components/chat-workspace.tsx:962–968`.

**Cambio:** ejemplos breves de tareas; mantener tres opciones y no introducir estimaciones de latencia o calidad sin evidencia. Categoría: Copy. Comando: `/clarify`.

## Detector: hallazgos frente a falsos positivos

318 coincidencias: 315 avisos informativos (304 tipografía, 8 colores, 3 radios) y 3 advertencias. **No equivalen a 318 defectos.**

- Dos advertencias de `side-tab` son citas de fuentes en `knowledge-review-panel.tsx:88` y `globals.css:901`.
- El texto con gradiente de `globals.css:1513` es un shimmer neutral de estado con tratamiento de movimiento reducido; no justifica un rediseño.
- La mayoría de avisos tipográficos procede del desfase de DESIGN.md.
- No se ha demostrado un problema de rendimiento. `unoptimized` puede ser apropiado para recursos autenticados; no introducir una caché pública al optimizarlos.
- Los controles táctiles ya crecen a 44 px con `pointer:coarse`. La descarga problemática tiene 44×44 px, pero está fuera de vista. No confundir tamaño con posición. [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) establece 24×24 px o las excepciones correspondientes; 44 px es aquí un objetivo de comodidad, no el mínimo AA universal.

## Plan por commits

Plan original, ejecutado según la tabla de estado anterior.

| Orden | Commit | Contenido y aceptación |
| --- | --- | --- |
| Base, completado | `8c5bc4c fix(images): deliver generated PNG artifacts` | Mantener entrega privada, descarga, persistencia y cobertura WebKit posterior |
| 1 | `fix(ui): keep image downloads visible and captions readable` | UI-01 y UI-02; geometría, click táctil y contraste claro/oscuro con descripciones largas |
| 2 | `fix(ui): keep active search results in view` | UI-03; lista larga y teclado sin mover el foco del input |
| 3 | `fix(ui): add recoverable image preview states` | UI-04; recarga del PNG sin nueva generación, errores y sesión |
| 4 | `feat(ui): guide image creation and clarify generated results` | UI-05 y UI-06; entrada contextual, ejemplos revisables, proporción y acciones visibles |
| 5 | `fix(chat): restore failed requests for review` | UI-07; editar solicitud, preservar adjuntos y definir reintento sin duplicar efectos |
| 6 | `polish(ui): align readable admin typography and design guidance` | UI-08, UI-09 y UI-10; tipografía, ayuda práctica, documentación y pasada final `/polish` |

Dependencias: 1 precede a 3/4; 2 es independiente. El commit 5 requiere revisar el contrato de turnos antes de implementar un botón que repita acciones. Cada commit incorpora las pruebas específicas de su comportamiento.

Antes de implementar: fetch fresco, worktree dedicado desde la revisión remota actual, leer las guías relevantes de `node_modules/next/dist/docs/`. Preservar permisos, aislamiento, borradores y la política de aprobaciones. Si cambia contrato o arquitectura, actualizar el runbook correspondiente en ese commit.

## Validación de la auditoría inicial

**Realizada:**

```sh
PLAYWRIGHT_PORT=3194 \
PLAYWRIGHT_INSTALLATION_CONFIG=/private/tmp/aibrain-ui-audit-config.json \
npx playwright test --project=accessibility --project=accessibility-mobile \
  --project=webkit-iphone --workers=2
```

**9/9 pruebas pasan, 14,2 segundos.** Esto incluye login, shell, configuración, aprobaciones, documentos, navegador, overlays móviles y PNG visible/descargable tras recarga en WebKit. Los contenidos son sintéticos.

La comprobación adicional encontró contraste insuficiente al incorporar una imagen, estado que las pruebas a11y actuales no ejercitan. La prueba WebKit existente usa una descripción corta y comprueba el ancho del documento; por eso no detecta la tarjeta larga recortada. Añadir esos escenarios al mismo conjunto de regresión.

Tras implementar: typecheck y build; componentes afectados; suite a11y con imágenes; regresión WebKit; búsqueda con listas largas; casos de fallo/recuperación y persistencia; revisión visual acotada desktop/móvil/claro/oscuro. Al tocar turnos, ampliar a los contratos de continuidad, interrupción y no duplicación afectados.

**Límite de la auditoría inicial:** no incluyó generación real, benchmark de producción ni release. Los resultados posteriores se registran abajo.

## Evidencia

- [Métricas y axe por viewport/tema](evidence/live-report.json).
- [Recorte y búsqueda en Chromium/WebKit táctiles](evidence/edge-report.json).
- [Salida original del detector](evidence/detector.json).
- [Inicio de escritorio](evidence/home-1440.png).
- [Modo imagen con sugerencias de texto](evidence/image-mode.png).
- [Imagen con descripción larga en WebKit iPhone](evidence/image-iphone-webkit.png).
- [Búsqueda con selección fuera de vista](evidence/palette-iphone-webkit.png).
- [Fallo de carga de la imagen](evidence/image-error-390.png).

Las capturas son locales y sintéticas; el indicador de Next.js pertenece al servidor de desarrollo y no se contabiliza como defecto de producto. El directorio conserva evidencias de los hallazgos, no nuevas imágenes de marca ni assets de producción.

## Verificación de la implementación

- `npm run lint`, `npm run typecheck` y `npm run build`: correctos.
- `npm test`: **255 archivos / 1.314 pruebas pasan**, 8 archivos / 22 pruebas omitidos por sus condiciones declaradas; 255,45 s.
- Suite Chromium, WebKit iPhone y accesibilidad: **81 pasan, 1 omitida y 2 fallos iniciales**. La identidad de instalación esperaba `example-lab-playwright` y recibió el identificador aislado de auditoría; repitiendo con el identificador esperado y las mismas rutas de datos aisladas, pasa. La prueba de fluidez excedió su presupuesto bajo carga concurrente; ejecutada sola pasa sin cambiar el presupuesto: p95 16,8 ms, 0,28 % de frames superiores a 50 ms y 362 ms acumulados de tareas largas.
- Dos nuevas pruebas E2E de recuperación pasan: documento original autorizado, archivo ausente que bloquea el envío, contenido parcial conservado, cero envíos automáticos y el mismo `documentUploadIds` en la solicitud enviada tras revisión.
- Ocho pruebas E2E de imagen cubren 401/403/404/503, recarga de URL privada sin nuevo turno, carga lenta, proporción reservada, cadenas largas y acciones a 320/390/768/1440 px. La prueba WebKit incluye descripción larga, descarga nativa tras recarga y axe en claro/oscuro.
- Revisión visual acotada: escritorio/móvil, claro/oscuro, modo imagen y error; administración renderizada como **componente real con fixture sintético de propietario y el CSS servido actual**, sin franquear la autorización de `/admin`. No es aceptación autenticada de la ruta de administración. No hay overflow a 390 px ni con la anchura equivalente a zoom 200 % (720 px desde 1440); este último caso comprueba redistribución, no un zoom nativo del navegador.
- Axe no detecta incidencias en las tarjetas de imagen ni en el componente de administración en las cuatro combinaciones de tamaño/tema. Los campos de administración del fixture miden 14 px y el texto secundario 12 px como mínimo. Una comprobación adicional del CSS servido con puntero táctil confirma campos a 16 px; el fixture de administración cambió a puntero fino al sustituir el documento.
- Detector final limitado a seis archivos de UI cambiados: **34 coincidencias (32 informativas y 2 advertencias)**. Las dos advertencias están en CSS anterior: citas `side-tab` y shimmer neutral de actividad. Las informativas restantes señalan tamaños compactos existentes fuera de esta intervención. No se cambian arbitrariamente para satisfacer el detector.
- Los metadatos de dimensiones son opcionales y emparejados; proceden del PNG validado. Eventos antiguos mantienen compatibilidad y la imagen cargada aporta sus dimensiones naturales. La vista previa no distingue 401/403/404 porque el elemento imagen no expone el código HTTP: usa un estado de error veraz y permite repetir la lectura autorizada.
- Recuperar una solicitud mantiene el hilo y sus entradas originales; no revierte efectos ni repite el turno fallido. Los documentos se vuelven a autorizar y deben coincidir con su versión original. Adjuntos antiguos sin un documento recuperable quedan visibles como no disponibles y bloquean enviar hasta volver a adjuntarlos o quitarlos. La experiencia y conectores vigentes deben revisarse antes de enviar.

Evidencias posteriores: [métricas y axe](evidence/verification-after.json), [detector](evidence/detector-after.json), [imagen móvil](evidence/after-image-390-light.png), [imagen de escritorio oscura](evidence/after-image-1440-dark.png), [guía de creación](evidence/after-image-mode-390.png), [recuperación del PNG](evidence/after-error-390.png), [administración móvil](evidence/after-admin-390-light.png).

Backend CI remoto, publicación GHCR, despliegue y aceptación autenticada de Arnall son gates independientes del resultado local. Este commit no declara una release ni genera imágenes nuevas mediante un proveedor.
