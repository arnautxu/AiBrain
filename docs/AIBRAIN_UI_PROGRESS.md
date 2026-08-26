# AiBrain UI parity — progreso reproducible

Última actualización: 2026-08-27 (Europe/Madrid)

## Rama y aislamiento

- Rama: `codex/aibrain-ui-parity`.
- Worktree: `/Users/arnau/automations/AiBrain-ui-parity`.
- Commit base: `a54838787fe7ca516510fb73d7e3bc4f77f2e183`.
- `main` permanece en `/Users/arnau/automations/AiBrain` con siete cambios ajenos sin commit; no se han tocado.
- Production permanece intacta. Están autorizados Preview y el host Hetzner existente, sin gasto adicional.

## Baseline

| Gate | Resultado |
| --- | --- |
| `npm ci` | Verde, 60 paquetes, 0 vulnerabilidades reportadas |
| `npm run typecheck` | Verde |
| `npm run build` | Verde, Next.js 16.3.2 |
| Lint/tests/E2E/visual/a11y | No existían en base; pendientes de implementar |
| Walkthrough local | Verde para login demo y shell base en `http://localhost:3100` |

## Checkpoints

| # | Estado | Evidencia principal |
| --- | --- | --- |
| 1. Auditoría, baseline, rutas, contratos, matriz, referencias | Completado | `REFERENCE_BRIEF.md`, `AIBRAIN_UI_AUDIT.md`, `AIBRAIN_UI_BACKEND_GAPS.md`, screenshots checkpoint 01 |
| 2. Tokens, primitivas, white-label, tipografía, tema, responsive | Completado | proyección Example/Northwind, login light/dark/mobile, snapshots visuales |
| 3. Login, shell, sidebar, navegación, proyectos, búsqueda, mobile | Completado | shell employee-first, composer persistente, Example/Northwind y desktop/mobile |
| 4. Conversación, composer, attachments, streaming, stop, recovery | Completado en la rebanada disponible | Markdown/GFM, adapter NDJSON fail-closed, imágenes, stop, recovery y scroll largo; replay definitivo bloqueado por backend 7/10 |
| 5. Plan, actividad, tools, diffs, Review, approvals, errores | Completado en la rebanada disponible | Presentación employee-first, permisos aceptar/rechazar, diff, salida y error de red; integración App Server definitiva sigue bloqueada por backend 7/10 |
| 6. PDF/Office/image, preview, publish, Browser/Computer Use | Completado en la rebanada disponible | View models fail-closed, PDF/Office/image, lifecycle de preview/publicación/browser, viewer aislado, logout y evidencia desktop/mobile; routes reales bloqueadas por backend 8/9/10 |
| 7. Responsive, temas, a11y, keyboard, motion, degraded | Pendiente | — |
| 8. Integración, ordering, dedupe, replay, reconnect, performance | Pendiente | — |
| 9. Comparación visual exhaustiva | Pendiente | — |
| 10. Regresiones, build, handoff, integración segura | Pendiente | — |

## Evidencia de pantalla

| Pantalla | Estado | Viewport | Evidencia | Resultado |
| --- | --- | --- | --- | --- |
| Referencia ChatGPT | conversación temporal vacía, sidebar colapsada, dark | 1516×678 recortado | `artifacts/ui-parity/reference/chatgpt-temporary-empty-dark.png` | Segura: no historial ni prompts |
| AiBrain base | shell vacío demo Studio, light | 1440×900 | `artifacts/ui-parity/checkpoint-01/aibrain-baseline-shell-1440x900.png` | Baseline capturado |
| Example login | light | 1440×900 | `artifacts/ui-parity/checkpoint-02/example-login-light-1440x900.png` | Marca y sesión sintética verificadas |
| Example login | dark | 1440×900 | `artifacts/ui-parity/checkpoint-02/example-login-dark-1440x900.png` | Tema oscuro y logo adaptativo verificados |
| Example login | light, mobile | 390×844 | `artifacts/ui-parity/checkpoint-02/example-login-light-390x844.png` | Responsive verificado |
| Northwind login | light | 1440×900 | `artifacts/ui-parity/checkpoint-02/northwind-login-light-1440x900.png` | Segunda instalación, cuenta y metadatos verificados |
| Example shell | light | 1440×900 | `artifacts/ui-parity/checkpoint-03/example-shell-light-1440x900.png` | Shell, proyectos, sugerencias y composer persistente |
| Example shell | dark | 1440×900 | `artifacts/ui-parity/checkpoint-03/example-shell-dark-1440x900.png` | Jerarquía y tokens semánticos verificados |
| Example shell | light, mobile | 390×844 | `artifacts/ui-parity/checkpoint-03/example-shell-light-390x844.png` | Composer persistente y navegación compacta |
| Example sidebar | light, mobile | 390×844 | `artifacts/ui-parity/checkpoint-03/example-sidebar-light-390x844.png` | Drawer, backdrop y cierre verificados |
| Northwind shell | light | 1440×900 | `artifacts/ui-parity/checkpoint-03/northwind-shell-light-1440x900.png` | Member sin onboarding, marca, proyectos y accent propios |
| Example conversación, inicio | light | 1440×900 | `artifacts/ui-parity/checkpoint-04/example-conversation-start-light-1440x900.png` | Mensaje usuario, actividad, Markdown y control de volver al final |
| Example conversación, resultado | light | 1440×900 | `artifacts/ui-parity/checkpoint-04/example-conversation-light-1440x900.png` | Listas GFM, tabla, acciones y composer persistente |
| Example conversación, inicio mobile | light | 390×844 | `artifacts/ui-parity/checkpoint-04/example-conversation-start-light-390x844.png` | Historia y respuesta responsive con composer fijo |
| Example conversación, resultado mobile | light | 390×844 | `artifacts/ui-parity/checkpoint-04/example-conversation-light-390x844.png` | Tabla responsive, acciones y composer móvil |
| Example turno con approval | light | 1440×900 | `artifacts/ui-parity/checkpoint-05/example-turn-approval-light-1440x900.png` | Plan, comando, permiso explícito, diff y acciones de resultado |
| Example turno con approval mobile | light | 390×844 | `artifacts/ui-parity/checkpoint-05/example-turn-approval-light-390x844.png` | Decisiones táctiles, resultado y composer móvil |
| Example Review diff | light | 1440×900 | `artifacts/ui-parity/checkpoint-05/example-review-diff-light-1440x900.png` | Panel lateral, fichero, contadores y diff legible |
| Example Review diff mobile | light | 390×844 | `artifacts/ui-parity/checkpoint-05/example-review-diff-light-390x844.png` | Review a viewport completo y diff horizontal seguro |
| Example preview documental | light | 1440×900 | `artifacts/ui-parity/checkpoint-06/example-document-preview-light-1440x900.png` | PDF sintético, metadata, página 1 de 2, descarga y confirmación pendiente |
| Example preview documental mobile | light | 390×844 | `artifacts/ui-parity/checkpoint-06/example-document-preview-light-390x844.png` | Preview adaptada y metadata sin ruta interna |
| Example Computer Use | light | 1440×900 | `artifacts/ui-parity/checkpoint-06/example-browser-viewer-light-1440x900.png` | Viewer sandboxed sintético, estado activo y datos aislados |
| Example Computer Use mobile | light | 390×844 | `artifacts/ui-parity/checkpoint-06/example-browser-viewer-light-390x844.png` | Viewer responsive y acciones posteriores legibles |
| Codex desktop | no capturado | — | restricción Computer Use | Bloqueo de referencia, no de implementación |

## Contratos consumidos

- Backend fijado para checkpoint 1: `7a20c51f6d5870a9f02ba3df8311b6955dd3b386`.
- Backend reverificado para checkpoint 4: `b8b0f3c64119e0e723ddf286077da97cf1555c59`.
- Codex App Server fijado por backend: `0.149.1`.
- InstallationConfig v1.
- Transporte privado durable v1 con cursor, ordering, dedupe, replay y ACK.
- Contrato UI propuesto documentado en `AIBRAIN_UI_BACKEND_GAPS.md`.
- La rama UI consume todavía el NDJSON legacy de `/api/chat`; el envelope durable con `eventId`, `sequence`, replay y ACK no está conectado y no se simula.

## Fuentes y decisiones

- El plan maestro vinculante sustituye las decisiones antiguas de Supabase como store de producto, onboarding obligatorio, control plane y governance de automatizaciones para V1.
- `AIBRAIN_NOTAS_VINCULANTES_PLAN_DEFINITIVO.md` no está disponible; registrado como fuente ausente.
- Las capturas autenticadas se limitan a datos sintéticos/temporales. Cualquier captura con información privada se descarta y no se versiona.
- La capacidad guiada se conserva como sugerencias secundarias, no como paso obligatorio antes del composer.

## Gates del checkpoint 1

- `npm run lint`: verde, 0 errores y 0 warnings.
- `npm run test:unit`: verde, 1 fichero y 3 tests.
- `npm run typecheck`: verde.
- `npm run test:e2e`: verde, login anónimo 1/1; comprueba consola, excepciones y red.
- `npm run build`: verde, Next.js 16.3.2 y 24 rutas de aplicación.
- Revisión visual humana: las dos capturas seguras se abrieron a resolución original.
- La primera ejecución de lint detectó seis errores y seis warnings heredados; se corrigieron sin desactivar reglas.

## Gates del checkpoint 2

- `npm run lint`: verde, 0 errores y 0 warnings.
- `npm run typecheck`: verde.
- `npm run test:unit`: verde, 3 ficheros y 7 tests.
- `npm run test:component`: verde, 1 fichero y 2 tests.
- `npm run test:e2e`: verde, 2/2 en Example y 2/2 con `AIBRAIN_UI_INSTALLATION=northwind-qa`.
- `npm run test:visual`: verde, 4/4 snapshots de login desktop/mobile y light/dark sin regeneración.
- `npm run test:a11y`: verde, 1/1 y sin violaciones critical/serious de axe.
- `npm run build`: verde en Example y en Northwind, Next.js 16.3.2 y 24 rutas de aplicación.
- Revisión visual humana: las cuatro capturas se abrieron; la evidencia Northwind se regeneró después del último cambio de tokens.
- Axe detectó inicialmente contraste insuficiente en el texto auxiliar; se corrigió el token semántico y el gate pasó después sin excepciones.

## Gates del checkpoint 3

- `npm run lint`: verde, 0 errores y 0 warnings.
- `npm run typecheck`: verde.
- `npm run test:unit`: verde, 3 ficheros y 7 tests.
- `npm run test:component`: verde, 1 fichero y 2 tests.
- `npm run test:e2e`: verde, 4/4 en Example y 4/4 en Northwind; cubre acceso owner/member, ausencia de onboarding obligatorio, búsqueda, menús, diálogo de proyecto y drawer móvil.
- `npm run test:visual`: verde, 9 tests y 1 skip intencional de interacción mobile-only; shell desktop/mobile light/dark y drawer bajo snapshots deterministas.
- `npm run test:a11y`: verde, 2/2; el shell autenticado se escanea en estado base, búsqueda abierta y preferencias abiertas, sin violaciones critical/serious.
- `npm run build`: verde en Example y Northwind, Next.js 16.3.2 y 24 rutas de aplicación.
- La primera pasada del shell detectó un input de adjuntos sin nombre, un listbox sin nombre y contraste insuficiente en resultados seleccionados; los tres problemas se corrigieron y se reejecutó axe sin excepciones.
- Playwright usa Preview demo sintético y determinista durante pruebas; no escribe en el workbench local ni utiliza datos reales.

## Gates del checkpoint 4

- `npm run lint`: verde, 0 errores y 0 warnings.
- `npm run typecheck`: verde.
- `npm run test:unit`: verde, 4 ficheros y 9 tests; incluye chunks NDJSON fragmentados, orden y fallo cerrado.
- `npm run test:component`: verde, 2 ficheros y 3 tests; incluye headings, listas, enlaces, tabla GFM y bloque de código copiable.
- `npm run test:e2e`: verde, 7/7 en Example y 7/7 en Northwind; cubre autosize, error y drag/drop de imagen, stream completado, stop, recarga y conversación larga con scroll inteligente.
- `npm run test:visual`: verde, 11 tests y 1 skip intencional; añade conversación completa en desktop/mobile y vistas estabilizadas al inicio/final.
- `npm run test:a11y`: verde, 2/2; el recorrido autenticado añade conversación completa sin violaciones critical/serious.
- `npm run build`: verde en Example y Northwind, Next.js 16.3.2 y 24 rutas de aplicación.
- Revisión visual humana: cuatro capturas sintéticas abiertas a resolución original; ninguna contiene historial o datos privados.
- Axe encontró inicialmente dos contrastes insuficientes en el estado de resultado; ambos se corrigieron y el gate se reejecutó sin excepciones.
- El parser cliente no inventa garantías: el ordering de lectura está verificado, pero dedupe, replay, reconnect y ACK quedan explícitamente pendientes hasta que backend checkpoints 7/10 publiquen el contrato final.

## Gates del checkpoint 5

- `npm run lint`: verde, 0 errores y 0 warnings.
- `npm run typecheck`: verde.
- `npm run test:unit`: verde, 4 ficheros y 9 tests.
- `npm run test:component`: verde, 3 ficheros y 5 tests; plan, comando, salida, approval y Review/diff.
- `npm run test:e2e`: verde, 9/9 en Example y 9/9 en Northwind; el fixture de contrato verifica aceptar una vez, rechazar, payloads de decisión, Review, diff, salida y 503 anunciado sin excepción de página.
- `npm run test:visual`: verde, 15 tests y 1 skip intencional; añade approval y Review en desktop/mobile.
- `npm run test:a11y`: verde, 3/3; shell, conversación, approval y Review sin violaciones critical/serious.
- `npm run build`: verde en Example y Northwind, Next.js 16.3.2 y 24 rutas de aplicación.
- Revisión visual humana: cuatro capturas nuevas sintéticas abiertas a resolución original; aprobación, acciones táctiles y diff son legibles.
- Axe detectó contrastes insuficientes en texto auxiliar, acciones, badge y contadores del diff. Se corrigieron todos y se reejecutó el gate completo sin desactivar reglas.
- Approval/tool call end-to-end contra el App Server real no se declara completado: backend checkpoints 7/10 aún no conectan el transporte durable al producto. La UI y sus decisiones están cubiertas mediante fixtures exclusivos de test.

## Gates del checkpoint 6

- `npm run lint`: verde, 0 errores y 0 warnings.
- `npm run typecheck`: verde.
- `npm run test:unit`: verde, 4 ficheros y 11 tests; valida documentos/browser, límites, rutas y actualización por ID sin duplicados.
- `npm run test:adapter`: verde, 1 fichero y 2 tests. El script se corrigió para ejecutar la suite real del parser NDJSON en lugar de fallar por un directorio inexistente.
- `npm run test:component`: verde, 4 ficheros y 21 tests; PDF/DOCX/XLSX/PPTX, conversión/error, ciclo completo de publicación, viewer sandboxed, control, reconexión, caída y cierre.
- `npm run test:e2e`: verde, 10/10 en Example y 10/10 en Northwind; PDF, imagen generada, transición processing→ready sin duplicar, publicación pendiente, Computer Use aislado, descarga y desmontaje del viewer al logout.
- `npm run test:visual`: verde, 17 tests y 1 skip intencional; añade preview documental y viewer en desktop/mobile sin regeneración en el gate final.
- `npm run test:a11y`: verde, 4/4; documento y estados de browser sin violaciones critical/serious.
- `npm run build`: verde en Example y Northwind, Next.js 16.3.2 y 24 rutas de aplicación.
- Revisión visual humana: cuatro capturas sintéticas abiertas a resolución original; no contienen historial ni datos privados y no presentan mojibake.
- Axe detectó inicialmente seis contrastes insuficientes entre 3,45:1 y 4,10:1. Se corrigieron los textos de estado y el gate completo pasó después sin excepciones.
- El backend fijado aporta generación de imagen real y servicios documentales v1, pero no routes de upload/preview/publicación ni gateway de Browser/Computer Use. La rama UI no inventa esas routes: input Office/PDF, paginación más allá de la página 1, confirmación/takeover reales y smoke App Server permanecen como bloqueos verificables de backend checkpoints 8/9/10.

## Commits y push

- `8314cc6 chore(ui): establish parity baseline` — checkpoint 1, tooling y correcciones de lint.
- `49c624a docs(ui): record checkpoint one` — evidencia y SHA del checkpoint 1.
- `d2ad083 feat(ui): add white-label visual foundation` — checkpoint 2, tokens, marca, temas, login y regresión visual.
- `1b2d4f1 docs(ui): record checkpoint two` — evidencia y SHA del checkpoint 2.
- `af29858 feat(ui): build employee-first workbench shell` — checkpoint 3, navegación, búsqueda, proyectos, mobile y composer persistente.
- `dc19cf5 feat(ui): complete conversation streaming slice` — checkpoint 4, Markdown/GFM, adapter NDJSON, attachments, stop, recovery, scroll y regresiones.
- `72e7d17 feat(ui): complete turn review and approvals` — checkpoint 5, plan, actividad, comandos, permisos, Review, diff, error de red y regresiones.
- `1bdd060 feat(ui): add honest capability artifact states` — checkpoint 6, PDF/Office/image, preview/publicación, Computer Use, seguridad del viewer y regresiones.
- Rama publicada en `origin/codex/aibrain-ui-parity` sin force-push.

## Siguiente acción

Completar el checkpoint 7: responsive en toda la matriz de viewports, temas claro/oscuro/sistema, teclado/focus, motion reducido y estados degradados. Corregir durante esta pasada el solapamiento móvil del control flotante de scroll observado en previews largas.
