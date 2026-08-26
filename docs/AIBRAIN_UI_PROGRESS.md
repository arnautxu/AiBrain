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
| 4. Conversación, composer, attachments, streaming, stop, recovery | En curso | — |
| 5. Plan, actividad, tools, diffs, review, approvals, errores | Pendiente | — |
| 6. PDF/Office/image, preview, publish, Browser/Computer Use | Pendiente | — |
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
| Codex desktop | no capturado | — | restricción Computer Use | Bloqueo de referencia, no de implementación |

## Contratos consumidos

- Backend fijado para checkpoint 1: `7a20c51f6d5870a9f02ba3df8311b6955dd3b386`.
- Codex App Server fijado por backend: `0.149.1`.
- InstallationConfig v1.
- Transporte privado durable v1 con cursor, ordering, dedupe, replay y ACK.
- Contrato UI propuesto documentado en `AIBRAIN_UI_BACKEND_GAPS.md`.

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

## Commits y push

- `8314cc6 chore(ui): establish parity baseline` — checkpoint 1, tooling y correcciones de lint.
- `49c624a docs(ui): record checkpoint one` — evidencia y SHA del checkpoint 1.
- `d2ad083 feat(ui): add white-label visual foundation` — checkpoint 2, tokens, marca, temas, login y regresión visual.
- `1b2d4f1 docs(ui): record checkpoint two` — evidencia y SHA del checkpoint 2.
- `af29858 feat(ui): build employee-first workbench shell` — checkpoint 3, navegación, búsqueda, proyectos, mobile y composer persistente.
- Rama publicada en `origin/codex/aibrain-ui-parity` sin force-push.

## Siguiente acción

Completar el checkpoint 4 sobre la rebanada real: conversación y composer en español, attachments con contrato ampliado, streaming/reanudación/stop/error y persistencia de hilos sin exponer detalles internos.
