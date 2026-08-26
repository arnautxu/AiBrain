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
| 3. Login, shell, sidebar, navegación, proyectos, búsqueda, mobile | En curso | — |
| 4. Conversación, composer, attachments, streaming, stop, recovery | Pendiente | — |
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

## Commits y push

- `8314cc6 chore(ui): establish parity baseline` — checkpoint 1, tooling y correcciones de lint.
- Rama publicada en `origin/codex/aibrain-ui-parity` sin force-push.

## Siguiente acción

Implementar el shell employee-first del checkpoint 3: sidebar, historial/proyectos, búsqueda, navegación mobile y composer siempre visible, retirando del camino principal onboarding y controles técnicos heredados.
