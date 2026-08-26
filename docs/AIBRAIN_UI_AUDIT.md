# Auditoría inicial de UI parity

Fecha: 2026-08-27

Rama: `codex/aibrain-ui-parity`

Base: `a54838787fe7ca516510fb73d7e3bc4f77f2e183`

## Baseline reproducible

- `npm ci`: verde, 60 paquetes, 0 vulnerabilidades reportadas.
- `npm run typecheck`: verde.
- `npm run build`: verde con Next.js 16.3.2.
- El proyecto base no define lint, unit, component, adapter, E2E, visual ni accessibility tests. Se consideran gaps, no validaciones verdes.
- `next dev` regenera temporalmente `next-env.d.ts` hacia `.next/dev/types`; el gate de build lo normaliza antes de commits.
- Viewport visual baseline: 1440×900 en el browser integrado.

## Rutas base

### Páginas

| Ruta | Archivo | Veredicto objetivo |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | Se conserva como workbench principal |
| `/login` | `src/app/login/page.tsx` | Rehacer white-label y cubrir password/recovery |
| `/onboarding` | `src/app/onboarding/page.tsx` | Retirar del flujo obligatorio de V1 |
| `/control` | `src/app/control/page.tsx` | No forma parte del shell de empleado; revisar en integración |
| `/auth/error` | `src/app/auth/error/page.tsx` | Mantener como error de sesión con marca de instalación |

### API

| Familia | Rutas base | Estado frente al plan maestro |
| --- | --- | --- |
| Auth | `/api/auth/login`, `/logout`, `/session`, `/auth/confirm` | Frontera útil; adaptar a Auth-only/local session |
| Workbench | `/api/workbench`, `/projects`, `/threads` | Contrato legado Supabase; reemplazar tras adapter backend |
| Turns | `/api/chat`, `/api/runtime/status`, `/api/runtime/approvals` | Slice real existente sobre stdio; normalizar eventos |
| Artifacts | `/api/projects/:id/artifacts/:id`, `/messages/:id/result` | Parcial; faltan registry/preview/publicación definitiva |
| Governance | `/api/automations`, `/api/control-plane/*`, `/api/onboarding/member` | Fuera de V1 de empleado según plan maestro |

## Inventario de contratos

| Contrato | Fuente | Estado |
| --- | --- | --- |
| `WorkbenchSnapshot`, project, workspace, thread | `src/workbench/types.ts` | Legado con persistencia Supabase/filesystem-demo/browser-preview |
| `ChatMessage` y eventos NDJSON | `src/lib/chat-contract.ts`, `/api/chat` | Funcional, pero no asegura replay/dedupe/reconnect |
| `InstallationConfig` v1 | backend `src/config/installation-schema.ts` | Estable para identidad, marca y rutas; UI usa proyección pública |
| `AppServerRequest/Event`, `ReplayCursor`, `TransportHealth` | backend `src/runtime/transport/contracts.ts` | Estable en `7a20c51`; base del adapter UI |
| Worker frames v1 | backend `src/runtime/transport/wire-protocol.ts` | Ready/accepted/event/ACK/ping/pong/rejected/overloaded |
| RPC Codex | `contracts/codex/0.149.1` en backend | Generado de la versión fijada; no duplicar manualmente |

## Hallazgos P0/P1

| Severidad | Hallazgo | Evidencia | Resolución prevista |
| --- | --- | --- | --- |
| P0 | El backend definitivo todavía no expone el contrato final UI ni integra todos los stores/worker registry | backend progress `7a20c51` | Adapter versionado + gaps honestos; integración final cuando el endpoint exista |
| P1 | `BrainApp` usa un `sending` global y bloquea navegación durante turnos | `src/components/brain-app.tsx` | Estado por thread y abort por turn |
| P1 | No existen ordering, dedupe, replay ni reconnect en cliente | contrato actual | Reducer/adapter con cursor durable y tests |
| P1 | El estado vacío oculta el composer detrás de acciones guiadas | baseline screenshot | Composer siempre visible; acciones como sugerencias secundarias |
| P1 | El shell expone Runtime, Control plane, tenant, rol y modo demo | baseline screenshot | Retirar del empleado y usar lenguaje de producto |
| P1 | Mensajes sin Markdown seguro/GFM | `chat-workspace.tsx` | Renderer seguro con tests |
| P1 | Adjuntos limitados a 3 imágenes de 2 MB | composer/route actual | Contrato de attachments y estados PDF/Office/image |
| P1 | Login y manifest contienen branding AiBrain/Codex hardcodeado | `/login`, manifest | Proyección pública de InstallationConfig |
| P1 | Solo existe tema claro funcional | CSS/manifest | light/dark/system con persistencia y contraste |

## Matriz visual objetivo

Leyenda: `B` baseline existente, `I` por implementar, `G` gap backend real.

| Superficie | Estado | Desktop | Tablet | Mobile | Tema | Prioridad |
| --- | --- | --- | --- | --- | --- | --- |
| Login/password/recovery/error | I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| Shell vacío + composer | B→I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| Sidebar expandida/colapsada/drawer | B→I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| Proyectos/search/pin/archive/history | B→I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| Conversación corta/larga/streaming/stop | B→I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| Plan/activity/tool/command/diff/review | B→I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| Approval allow/deny/pending | B→I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| Network error/reconnect/replay/degraded | I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| PDF/Office/image preview | G→I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| Publish confirmation/success/failure | G→I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| Browser/Computer Use viewer | G→I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |
| Settings/theme/profile/logout | I | 1440×900 | 1024×768 | 390×844 | light/dark | P1 |

## Diferencias de la rebanada visual

1. Geometría: AiBrain usa sidebar de 280 px y catálogo central ancho; referencia colapsada usa rail de 32 px y composer de unos 480 px.
2. Jerarquía: la referencia reserva el canvas para conversación; AiBrain prioriza una taxonomía de acciones.
3. Composer: persistente en referencia, ausente en el empty state de AiBrain.
4. Ruido: AiBrain muestra seis entradas técnicas/administrativas y un badge `ALPHA`; la referencia reduce utilidades a iconos discretos.
5. Tema: la evidencia de referencia está en oscuro y el baseline de AiBrain solo en claro.
6. Ritmo: referencia usa una sola superficie elevada; AiBrain presenta tarjetas, filas y topbar simultáneamente.

## Decisión

Se mantiene la capacidad guiada como sugerencias pequeñas alrededor del composer; deja de ser el gate obligatorio. La implementación seguirá la geometría y el ritmo de la referencia sin copiar identidad, assets ni texto.
