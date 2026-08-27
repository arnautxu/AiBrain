# Handoff — AiBrain UI parity

Fecha: 2026-08-27 (Europe/Madrid)

## Resultado entregado

- Rama de entrega: `codex/aibrain-ui-parity`.
- Base UI: `a54838787fe7ca516510fb73d7e3bc4f77f2e183`; último checkpoint UI previo: `5032e63229372b17c59dbda613b028d0830c33fc`.
- Backend integrado y revisado: `origin/codex/aibrain-backend-definitivo@812e20c8f3f13e84bd6c4291872d8ac2dfa84787`.
- Integración preparada en el worktree temporal `/Users/arnau/automations/AiBrain-ui-integration`; después de los gates se avanza por fast-forward la rama de entrega, sin mergear `main`.
- `main` conserva sus cambios ajenos sin commit. Production, DNS y servicios existentes permanecen intactos.

La entrega ya no es una maqueta ni una rama visual desconectada. La UI white-label consume los contratos públicos reales de AiBrain para sesión, workbench, proyectos, threads, streaming NDJSON, stop/steer, approvals, documentos, publicación en dos fases y Browser/Computer Use. Codex App Server continúa detrás del gateway privado: el navegador nunca recibe acceso directo al worker, CDP, mounts o secretos.

## Decisión visual Codex

La actividad del turno conserva lo más valioso de Codex sin fingir ni revelar razonamiento privado:

- antes del primer evento se muestra `Pensando…`;
- los eventos reales se presentan como `Editando archivos`, `Ejecutando comando`, `Buscando en la web`, `Usando herramienta` o la etiqueta segura equivalente;
- el estado activo tiene spinner, guía vertical y shimmer; `prefers-reduced-motion` elimina la animación decorativa;
- al terminar, el detalle se compacta bajo `Trabajo completado` y la respuesta final mantiene la jerarquía principal.

Evidencia sintética: `artifacts/ui-parity/checkpoint-05/example-activity-shimmer-light-763x952.png`.

Las referencias fueron fijadas el 27-08-2026 con una superficie temporal/sintética de ChatGPT Work y material oficial de Codex. Computer Use bloqueó explícitamente el control de `com.openai.codex`; por honestidad no se afirma una comparación píxel a píxel de Codex Desktop no observada.

## Integración y seguridad

- Los conflictos de integración se resolvieron archivo a archivo. Backend conserva autoridad sobre auth, stores, workers, runtime, publicación, Browser, permisos e infraestructura; la rama UI conserva autoridad sobre componentes, estilos, adapters y regresiones visuales.
- `document-ui-adapter.ts`, `publication-ui-adapter.ts` y `browser-ui-adapter.ts` validan payloads y IDs opacos de forma estricta. El token de confirmación documental vive solo en estado React y no se persiste ni registra.
- El transcript enlaza al viewer Browser aislado y no incrusta un iframe CDP dentro del mensaje.
- Demo existe únicamente con flags explícitos de desarrollo/Preview. No hay fallback productivo que simule Codex ni capacidades reales.

## Verificación final local

| Gate | Resultado |
| --- | --- |
| `npm test` | 110 ficheros verdes + 2 skip; 506 tests verdes + 4 skip explícitos |
| `npm run test:a11y` | 5/5; cero incidencias critical/serious |
| `npm run test:visual` | 36 verdes + 1 skip mobile-only; 7 viewports; umbral `0.005`; sin masks |
| `npm run test:e2e` | backend 4/4; UI 22/22 + 1 skip que requiere target externo |
| `npm run typecheck` | verde |
| `npm run lint` | verde, 0 errores/warnings |
| `npm run build` | verde, Next.js 16.3.2, TypeScript y 39 rutas/páginas |
| `git diff --check` | verde |

El smoke App Server real se ejecutó previamente en el host Hetzner existente mediante contenedor QA efímero y tunnel loopback. Devolvió `mode: codex`, `ready: true`, `isolated: true`; completó primer turno, resume del mismo thread y cancelación, sin errores de consola/red. Se usaron datos sintéticos y el contenedor/túnel se retiraron sin alterar los servicios originales. Evidencias:

- `artifacts/ui-parity/checkpoint-08/real-app-server-resume-1280x720.png`
- `artifacts/ui-parity/checkpoint-08/real-app-server-cancelled-1280x720.png`

## Preview

| Campo | Valor |
| --- | --- |
| Deployment | `dpl_4MTkfJPc77HFrmueB8PWv2qAGsd3` |
| URL estable | `https://aibrain-workbench-preview.vercel.app` |
| URL inmutable | `https://aibrain-workbench-olpddgjdg-arnautxus-projects.vercel.app` |
| Inspector | `https://vercel.com/arnautxus-projects/aibrain-workbench/4MTkfJPc77HFrmueB8PWv2qAGsd3` |
| Commit | `97eb769` |
| Target / estado | Preview / Ready |

La configuración `example-lab-preview` queda incluida de forma explícita en el trace serverless y Vercel recibe únicamente la ruta absoluta `/var/task/config/installations/vercel-preview.example.json`. La garantía backend de `InstallationConfig` obligatorio en producción no se relajó.

Checks con Deployment Protection activa: `/login` `200` y contiene `Example Brain` / `Example Laboratory`; `/api/auth/session` `401` anónimo; `/api/health/live` `200`; logs de error vacíos. `/api/health/ready` devuelve `503` de forma intencional porque Vercel es la UI/Auth Preview y no aloja el runtime Codex persistente. No se usó `--prod`, no se desactivó protección y Production quedó intacta.

## Orden recomendado de integración

La entrega ya contiene ambos padres revisados. El orden seguro para incorporarla en otro destino es:

1. revisar el merge commit de `codex/aibrain-ui-parity` y comprobar que el padre backend es exactamente `812e20c`;
2. ejecutar typecheck, lint, tests, E2E, a11y, visual y build con la configuración de instalación objetivo;
3. hacer QA autenticada con una identidad sintética y validar `/api/health/ready` (`ready` e `isolated`);
4. desplegar primero Preview y comprobar login, un turno, stop, approval, documento/publicación y Browser;
5. no proponer Production hasta completar los gates operativos propios de la instalación.

No se recomienda reaplicar manualmente la antigua rama visual sobre backend: este merge ya conserva las fronteras tipadas y las resoluciones verificadas.
