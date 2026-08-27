# Comparación visual exhaustiva

Fecha de cierre: 2026-08-27

Rama: `codex/aibrain-ui-parity`

Base: `a54838787fe7ca516510fb73d7e3bc4f77f2e183`

## Alcance y límites de la referencia

La única captura autenticada que pudo conservarse de forma segura es una conversación temporal vacía de ChatGPT en tema oscuro, sin historial ni prompts, bajo `artifacts/ui-parity/reference/chatgpt-temporary-empty-dark.png`. La ventana de Codex Desktop no pudo capturarse por la restricción explícita de Computer Use. Por tanto:

- la comparación ChatGPT → AiBrain es humana y geométrica, no un diff numérico entre dos productos con contenido, viewport y marca distintos;
- la regresión píxel a píxel reproducible se aplica a AiBrain contra sus propias baselines deterministas;
- no se declara identidad visual con ChatGPT ni paridad visual de Codex Desktop no observada;
- Production no se utilizó y todas las conversaciones, cuentas, documentos y viewers de prueba son sintéticos.

## Comparación de geometría y patrones

| Área | Referencia segura | AiBrain final | Veredicto |
| --- | --- | --- | --- |
| Canvas | Conversación centrada, gran espacio negativo | Conversación centrada, `max-width: 760px` | Patrón equivalente |
| Composer | Superficie única y persistente, aproximadamente 480 px en la captura | Superficie persistente dentro de un contenedor de hasta 820 px | Misma prioridad; ancho adaptado a trabajo documental |
| Navegación | Rail colapsado de aproximadamente 32 px | Sidebar de 260 px en desktop; drawer `min(280px, 88vw)` en móvil | Diferencia intencional para proyectos y threads AiBrain |
| Cabecera | Utilidad mínima en el rail | Barra de 56 px con proyecto, thread, Review y preferencias | Diferencia intencional y employee-first |
| Ritmo | Una superficie principal, controles discretos | Una superficie principal, actividad progresiva y acciones al final | Patrón equivalente sin copiar identidad |
| Tema | Oscuro casi negro | Claro, oscuro y sistema con tokens semánticos por instalación | Capacidad ampliada y white-label |
| Acciones | Iconos compactos alrededor del composer | 44 px táctiles en móvil, 40 px en acciones de resultado | Adaptación accesible |

## Diferencias deliberadas

- No se copian logotipos, assets, textos, nombres ni identidad de OpenAI.
- AiBrain conserva proyectos, conversaciones, Review, aprobación explícita y artefactos porque forman parte de su contrato de producto.
- El shell no muestra runtime, tenant, rol, control plane ni jerga de Codex al empleado.
- Documento, Browser/Computer Use y publicación solo muestran estados autorizados por el contrato; no inventan una sesión o route productiva ausente.
- Example Laboratory y Northwind QA cambian identidad, cuenta, color y copy mediante configuración; no existen forks visuales por cliente.

## Matriz reproducible

Viewports exactos:

- 1440×900
- 1280×800
- 1024×768
- 768×1024
- 600×900
- 390×844
- 375×812

Cada viewport cubre login claro/oscuro, shell oscuro, preferencias oscuras, offline claro, turno con plan/actividad/diff/aprobación, Review, documento y Browser. Los tres viewports menores de 768 px añaden el drawer móvil. Son 66 nuevas baselines; junto con las suites anteriores existen 101 PNG versionados.

La matriz exige en cada captura:

- contenido y rutas sintéticos deterministas;
- fuentes, preview e iframe cargados;
- `prefers-reduced-motion: reduce`;
- cero masks sobre zonas importantes;
- overflow horizontal máximo de 1 px;
- `maxDiffPixelRatio: 0.005`;
- scroll terminal reproducible y separación de aprobación, documento y browser en turnos independientes.

## Corrección iterativa del checkpoint 9

1. La primera pasada descubrió que un único fixture mezclaba aprobación, documento y viewer; sus cargas competían legítimamente con el autoscroll.
2. Se dividió el recorrido en tres turnos sintéticos, se esperó la decodificación de la preview y se estabilizó el scroll interno durante 12 frames.
3. La aprobación conserva el comportamiento real de seguimiento al final. Documento y viewer desactivan ese seguimiento mediante scroll de usuario simulado y centran el artefacto antes de capturar.
4. Se añadió un gate de overflow por captura y se redujo el umbral estable de 0,01 a 0,005 sin masks ni ampliaciones de tolerancia.
5. Los avisos transitorios se esperan hasta su desaparición natural antes de capturar; no se eliminan del DOM ni se enmascaran.
6. Se abrieron manualmente capturas representativas de los siete tamaños. No se encontraron solapes, cortes de acciones, mojibake ni contenido fuera del ancho; Preferencias mantiene footer fijo y cuerpo desplazable.

## Resultado

- `npm run test:visual`: 36 tests verdes y 1 skip intencional mobile-only en el proyecto desktop.
- Matriz nueva: 7/7 tests verdes sin regeneración, 66/66 baselines estables.
- Revisión humana: login, shell, preferencias, drawer, offline, aprobación, Review, documento y browser revisados en desktop/tablet/mobile.
- La referencia ChatGPT valida jerarquía, espacio negativo, prioridad del composer y densidad; el diff numérico de AiBrain valida regresiones de su implementación propia.

## Evidencia seleccionada

| Estado | Viewport | Archivo |
| --- | --- | --- |
| Login dark | 1024×768 | `artifacts/ui-parity/checkpoint-09/login-dark-1024x768.png` |
| Shell dark | 768×1024 | `artifacts/ui-parity/checkpoint-09/shell-dark-768x1024.png` |
| Preferencias dark | 600×900 | `artifacts/ui-parity/checkpoint-09/preferences-dark-600x900.png` |
| Drawer dark | 375×812 | `artifacts/ui-parity/checkpoint-09/drawer-dark-375x812.png` |
| Offline light | 1024×768 | `artifacts/ui-parity/checkpoint-09/shell-offline-light-1024x768.png` |
| Aprobación light | 768×1024 | `artifacts/ui-parity/checkpoint-09/turn-approval-light-768x1024.png` |
| Review light | 600×900 | `artifacts/ui-parity/checkpoint-09/review-light-600x900.png` |
| Documento light | 375×812 | `artifacts/ui-parity/checkpoint-09/document-light-375x812.png` |
| Browser light | 375×812 | `artifacts/ui-parity/checkpoint-09/browser-light-375x812.png` |
| Browser light | 1440×900 | `artifacts/ui-parity/checkpoint-09/browser-light-1440x900.png` |

## Reproducción

```bash
npm run typecheck
npm run lint
npm run test:visual
```

Las baselines se actualizan únicamente tras revisar el cambio visual:

```bash
npx playwright test --project=visual-matrix --update-snapshots
npx playwright test --project=visual-matrix
```
