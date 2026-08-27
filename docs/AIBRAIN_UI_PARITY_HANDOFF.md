# Handoff — AiBrain UI parity

Fecha: 2026-08-27 (Europe/Madrid)

## Resultado entregado

- Rama: `codex/aibrain-ui-parity`.
- Base: `a54838787fe7ca516510fb73d7e3bc4f77f2e183`.
- Último commit funcional antes del handoff: `43465f834a705ad363ac68af92a995db19656b77`.
- Main no fue modificado: conserva sus siete cambios ajenos sin commit.
- Production, DNS y servicios existentes permanecieron intactos.
- La rama está publicada en `origin/codex/aibrain-ui-parity` sin force-push.

La UI white-label, responsive, accesible y multi-instalación está cerrada dentro del perímetro permitido. La integración definitiva con la rama backend no se hizo porque el encargo prohíbe merge automático y cambios backend fuera de adapters/documentación.

## Preview publicada

| Campo | Valor |
| --- | --- |
| Deployment | `dpl_FNhrn5kbngN7JYYRMUASVN3JHE6y` |
| URL | `https://aibrain-workbench-8t3zdjdes-arnautxus-projects.vercel.app` |
| Inspector | `https://vercel.com/arnautxus-projects/aibrain-workbench/FNhrn5kbngN7JYYRMUASVN3JHE6y` |
| Target | Preview |
| Estado | Ready |
| Commit desplegado | `43465f834a705ad363ac68af92a995db19656b77` |
| Framework | Next.js 16.3.2 |
| Duración | 48 s |

Checks protegidos: `/login` respondió `200`; `/api/auth/session` y `/api/runtime/status` respondieron `401` sin sesión, como corresponde. El login real se abrió con la sesión Vercel autorizada, cambió light/dark sin overflow y no produjo errores ni warnings de consola. No se envió email ni se creó cuenta. Sin una sesión AiBrain existente o credencial sintética autorizada no fue posible recorrer el shell autenticado de este deployment exacto.

La guía de despliegue Vercel determinó el flujo seguro: deployment explícitamente Preview, inspección de estado, requests protegidos y consulta de logs; no se usó `--prod`.

## Verificación final

- `npm run typecheck`: verde.
- `npm run lint`: verde, 0 errores/warnings.
- `npm run test:unit`: 6 ficheros, 18 tests verdes.
- `npm run test:adapter`: 3 ficheros, 9 tests verdes.
- `npm run test:component`: 5 ficheros, 22 tests verdes.
- `npm run test:e2e`: Example 22 verdes + 1 skip externo; Northwind 22 verdes + 1 skip externo.
- `npm run test:a11y`: Example 5/5 y Northwind 5/5, sin violaciones critical/serious.
- `npm run test:visual`: 36 verdes + 1 skip mobile-only; 7 viewports, 101 PNG totales, umbral `0.005`, sin masks ni overflow.
- Builds secuenciales Example y Northwind: verdes, 17 páginas estáticas cada uno.
- `git diff --check`: verde antes del cierre.

El checkpoint 8 añadió evidencia real, no fixture: primer turno, resume del mismo thread y cancelación a través de AiBrain `/api/chat` y Codex App Server `stdio` sobre un contenedor QA efímero en Hetzner. El contenedor y túnel se retiraron; los servicios originales siguieron activos.

## Backend fijado y plan de integración

Backend verificado: `origin/codex/aibrain-backend-definitivo@6bc7bc2f8a9d4e5706c8796fd57b2621929ca5eb`.

Ese commit ya publica `/api/auth/session`, proyectos/threads durables, `/api/chat` NDJSON idempotente, stop/steer, approvals, runtime status, upload/preview, publicación en dos fases y Browser/Computer Use HTTP aislado. El detalle exacto y los gaps están en `docs/AIBRAIN_UI_BACKEND_GAPS.md`.

Orden seguro:

1. Crear la futura rama de integración desde el backend, autoridad para seguridad, rutas, schemas, stores y runtime.
2. Incorporar manualmente tokens, componentes y tests de esta rama, archivo a archivo.
3. Resolver primero los clientes de workbench y branding server-side.
4. Adaptar `/api/chat` al NDJSON público real; recuperación por replay idempotente del mismo request, no por un WebSocket browser inventado.
5. Conectar stop/steer, approvals, documentos y publicación con los IDs opacos exactos.
6. Implementar browser solo con `/api/runtime/browser*`; ocultar tabs, URL/title y downloads hasta que exista contrato.
7. Ejecutar la matriz completa, smoke App Server real y QA autenticada de Preview antes de cualquier propuesta de Production.

Conflictos probables: `brain-app.tsx`, `chat-workspace.tsx`, `details-panel.tsx`, `turn-activity.tsx`, `chat-contract.ts`, `/api/chat` y `src/runtime/*`. No aceptar automáticamente “ours” o “theirs”.

## Estado de la definición de terminado

Cumplido en esta rama: arquitectura visual propia, white-label, dos instalaciones, login/shell/conversación/Review/approvals/documentos/browser como superficies UI, responsive, temas, teclado, a11y, reduced motion, regresiones, evidencia visual, commits pequeños, push y handoff.

No cumplido globalmente:

- esta Preview exacta no tuvo recorrido autenticado del workbench;
- la rama UI no está integrada con los contratos definitivos de backend `6bc7bc2`;
- la invocación browser final con approval/auditoría, DNS-pinned egress y QA operativa externa sigue abierta en backend;
- Production no fue ni debe considerarse aceptada.

Por ello el trabajo local seguro del checkpoint UI queda agotado, pero el objetivo completo no puede marcarse como terminado sin una futura integración autorizada y sus gates end-to-end.
