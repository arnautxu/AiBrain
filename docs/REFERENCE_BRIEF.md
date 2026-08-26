# AiBrain UI parity — reference brief

Última actualización: 2026-08-27 (Europe/Madrid)

## Resultado observable

Una interfaz web white-label propia, comparable en claridad y ritmo a ChatGPT Work y Codex, donde una persona abre su instalación, encuentra proyectos y conversaciones, escribe inmediatamente en un composer persistente y sigue un turno real de Codex sin ver conceptos internos de runtime, tenants, rutas, terminal o Git.

## Jerarquía de fuentes

1. `AIBRAIN_UI_PARITY_GOAL 2.md` adjunto: definición de producto y aceptación de esta rama.
2. `docs/AIBRAIN_V1_PLAN_MAESTRO.md` del checkout principal: decisiones vinculantes de arquitectura de V1. Se leyó sin copiar el fichero no versionado a esta rama.
3. Contratos generados de Codex App Server `0.149.1` y transporte durable de `origin/codex/aibrain-backend-definitivo@7a20c51`.
4. Inspección visual autenticada de ChatGPT en una conversación temporal vacía y datos sintéticos, realizada el 2026-08-27.
5. Implementación actual de AiBrain en el commit base `a548387` como baseline, no como especificación final.

`AIBRAIN_NOTAS_VINCULANTES_PLAN_DEFINITIVO.md` no existe en el checkout ni en los adjuntos disponibles. Su ausencia se registra como gap de fuente y no bloquea el trabajo seguro.

## Invariantes

- Supabase se limita a Auth en la arquitectura objetivo. Los datos de producto y la sesión durable pertenecen al backend local/file-backed definitivo.
- El navegador nunca recibe credenciales de Codex, rutas internas ni acceso directo a App Server.
- `InstallationConfig` configura marca, empresa, origen y assets sin forks por cliente.
- La UI consume IDs opacos y un adapter de aplicación versionado; no interpreta el protocolo RPC directamente en componentes.
- Los eventos aceptados se ordenan por `sequence`, se deduplican por `eventId` y se reanudan desde un cursor durable.
- Un turno activo puede continuar mientras la persona cambia de proyecto o conversación.
- Approvals, publicación, Computer Use y estados de archivos solo se muestran cuando proceden de estado real.
- No hay respuestas falsas ni runtime mocks en producción. Los fixtures deterministas pertenecen exclusivamente a tests y visual regression.
- La UI no presenta OpenAI, ChatGPT o Codex como marca del producto. Codex puede citarse únicamente como motor en superficies administrativas apropiadas.
- Production permanece intacta; Preview y el host existente son las únicas superficies externas autorizadas.

## Slice de referencia

La primera rebanada vertical es `shell + empty conversation + composer + real thread`:

1. Login con marca de instalación.
2. Sidebar tranquila con proyectos, búsqueda, pins y conversaciones.
3. Estado vacío centrado con composer persistente y adjuntos.
4. Creación o reanudación de una conversación mediante IDs AiBrain.
5. Turno que recibe del adapter texto, plan, actividad, diff, approval, error y completion.
6. Stop, refresh y reconnect sin duplicados.

Esta rebanada demuestra geometría, white-label, navegación y contrato antes de ampliar previews, publicación y Computer Use.

## Evidencia visual aceptada

| Evidencia | Estado | Restricción |
| --- | --- | --- |
| `artifacts/ui-parity/reference/chatgpt-temporary-empty-dark.png` | ChatGPT autenticado, conversación temporal vacía, sidebar colapsada | Se recortó el chrome del navegador; no contiene historial, prompts ni datos de cliente |
| `artifacts/ui-parity/checkpoint-01/aibrain-baseline-shell-1440x900.png` | AiBrain base, demo Studio, proyecto sin conversaciones | Datos sintéticos del repositorio |
| Codex desktop | Inspección bloqueada por la política de Computer Use del host | No se fabricará una captura ni se sorteará la restricción |

No se conservaron capturas que mostraran historial o drafts privados. La primera captura no apta se eliminó de forma inmediata.

## Rasgos extraídos, no copiados

- Canvas dominante y navegación de baja intensidad visual.
- Composer compacto, persistente, centrado y cercano al contenido.
- Sidebar estrecha, colapsable y jerárquica.
- Controles secundarios discretos; el estado del agente aparece cerca del turno.
- Tipografía de interfaz neutra, bordes suaves, pocos fondos elevados y motion funcional.
- Estados oscuros y claros equivalentes, no un tema invertido incompleto.

No se copian assets privados, texto de marca, iconografía propietaria ni estructuras DOM de terceros.

## Dependencias y riesgos

| Dependencia | Estado 2026-08-27 | Tratamiento UI |
| --- | --- | --- |
| InstallationConfig | Implementado en backend checkpoint 1 | Consumir su proyección pública; mantener fallback de desarrollo no secreto |
| Transporte WS durable | Implementado y probado en `7a20c51` | Adapter tipado con ordering, dedupe, replay, reconnect y ACK |
| Auth-only + sesión local | Pendiente en backend | Mantener frontera intercambiable; no extender persistencia Supabase |
| Stores de producto file-backed | En curso | No acoplar componentes al store actual |
| Contrato final para UI | Pendiente en backend checkpoint 10 | Versionar el contrato de aplicación de esta rama y documentar el mapping |
| PDF/Office/publicación | Pendiente | Estados honestos y tests del adapter; smoke real solo cuando exista backend |
| Browser/Computer Use aislado | Pendiente | Viewer y estados tipados sin fingir disponibilidad |

## Anti-slop aplicado

- Una sola jerarquía de sidebar y una sola familia de superficies.
- Sin gradients decorativos, glassmorphism, paneles flotantes arbitrarios ni tarjetas para cada bloque.
- Iconos Phosphor existentes; no se añade otra librería.
- Tokens semánticos antes de valores ad hoc.
- Lenguaje de producto para empleados; detalles técnicos plegados y solo cuando son necesarios para una decisión.
