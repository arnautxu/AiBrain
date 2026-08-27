# Referencia viva de ChatGPT Work

Fecha de observación: 2026-08-27

## Resultado

AiBrain debe percibirse de inmediato como una superficie de trabajo de la misma familia visual e interactiva que ChatGPT Work, sin copiar marca, datos ni controles sin contrato real.

La identidad de la instalación, la autenticación, el aislamiento, el runtime, las aprobaciones y la persistencia siguen siendo autoridad de AiBrain. Esta referencia gobierna presentación e interacción.

## Evidencia

| Fuente | Autoridad | Qué establece | Límites |
| --- | --- | --- | --- |
| Captura aportada `image-1.png`, 4096×2076 | Autoritativa | Conversación activa, sidebar, header, composer y panel flotante Resultados/Fuentes | Captura Retina; dimensiones visuales equivalen aproximadamente a la mitad |
| ChatGPT Work autenticado en `chatgpt.com`, viewport 1280×720 | Autoritativa y observable | Empty state, sidebar abierta/cerrada, composer, menús, turno activo, stop y resultados | Se usó únicamente contenido sintético; no se abrió ninguna conversación privada |
| `assistant-ui` ChatGPT example y thread shell | Referencia MIT autorizada | Geometría de conversación, composer, acciones y transición de rail | Solo se adaptan patrones de presentación; AiBrain conserva marca, iconos, textos y lógica |
| Contratos y tests de AiBrain | Autoritativa | Los controles deben conservar funciones reales y fronteras de seguridad | La paridad visual no puede relajar contratos |
| Baselines de `artifacts/ui-parity` | Evidencia de regresión | Estados ya cubiertos y comportamiento responsive propio | No prueban paridad con ChatGPT por sí solos |

## Medidas observadas en ChatGPT Work

Viewport lógico: 1280×720, DPR 2.

| Superficie | Geometría / estilo observado |
| --- | --- |
| Sidebar abierta | 260 px; contenido principal empieza en x=275 |
| Sidebar colapsada | rail de 52 px; contenido principal empieza en x=67; no desaparece |
| Header activo | 52 px; padding 8 px; fondo `rgb(252,252,252)` |
| Tipografía | stack del sistema Apple/UI; cuerpo 16/24; color `rgb(13,13,13)` |
| Título empty | 24 px, peso 400, línea 28 px |
| Selector Chat/Work | 228.6×36 px, píldora completa, centrada al header |
| Composer empty | 768×128 px; radio 28 px; x=386, y=302 |
| Composer activo con Results | 610×52 px; radio 28 px; x=299, y=644 |
| Sombra composer | ring 1 px a 4%; 0 2px 8px a 4%; 0 4px 80px 8px a 2.4% |
| Menú d'eines | mateixa amplada del composer; superfície adjunta amb 8 px de separació i radio aproximat de 20 px |
| Menús petits | 224 px; radio 20 px; padding vertical 10 px; mateixa ombra del composer |
| Bombolla usuari | `rgb(232,243,254)`; text `rgb(12,39,74)`; radio 22 px; padding 10×16 px |
| Panell Resultats | 300 px d'ample; x=949; y=52; radio 24 px; border 5%; ombra 0 4px 16px a 5% |
| Activitat | estat inicial `En procés`; després temps `Treballant des de fa …`; resum plegable; stop passa per `Aturant` i acaba en `Pensament interromput` |

La referencia MIT confirma de forma independiente una conversación de 768 px, ritmo vertical de 32 px, composer con radio 28 px, input de 16 px, acciones circulares de 36 px, burbuja de usuario con radio 22 px y transición de sidebar de 200 ms.

## Invariants

- No copiar noms, converses, projectes, avatars, fonts o contingut privat observat.
- Els menús només ofereixen capacitats suportades pel manifest i el runtime.
- L'estat actiu pot mostrar activitat segura, però mai chain-of-thought privat.
- El rail col·lapsat conserva accés a conversa nova, cerca, projectes i perfil.
- `prefers-reduced-motion` elimina shimmer i moviment decoratiu.
- Mobile continua sent drawer modal; desktop col·lapsa a rail.

## Estats observats

- Empty: sidebar oberta i rail; selector Work; heading; composer gran; menú d'eines; selector de projecte; selector de model.
- Active: header amb títol i utilitats; bombolla blava; composer compacte al peu; Results flotant.
- Running: `En procés`, temps transcorregut, stop disponible.
- Stopping/stopped: `Aturant`; `Pensament interromput` plegable.
- Focus: focus visible natiu d'alt contrast en controls de disclosure.
- Disabled: send atenuat; share desactivat durant execució.

## Llesca implementada

1. La sidebar desktop col·lapsa a un rail funcional de 52 px en lloc de desaparèixer.
2. El composer buit mesura 768×128 px al viewport de referència i l'actiu es compacta a una fila de 52 px.
3. El botó `+` obre un menú adjunt amb adjunts, web, imatge i accions guiades reals.
4. La bombolla d'usuari usa el blau, text, radio i padding observats en Work.
5. Review es presenta com una targeta flotant de 300 px en desktop i continua sent un dialog segur en mobile.
6. La tipografia, els neutres, el radi, l'ombra i l'activitat amb shimmer segueixen les mesures vives i la referència MIT.

## Diferències deliberades pendents

- No s'afegeixen dictat ni mode de veu perquè AiBrain no té encara aquest contracte funcional.
- Es mantenen la marca, els textos, les icones i l'accent d'AI Brain; no es copien actius d'OpenAI.
- Computer Use conserva el seu viewer existent perquè és una capacitat pròpia amb controls de seguretat, no una superfície decorativa.
- L'aplicació nativa de Codex no és automatitzable per la política de seguretat de l'entorn; la captura aportada i ChatGPT Work autenticat són les referències observables.

## Llesca de referència

Primer recorregut a demostrar: obrir app → empty Work → obrir menú d'eines → crear conversa → observar running → aturar → obrir resum → col·lapsar sidebar a rail → obrir Resultats/Review.

La prova mínima exigeix comparació a 1280×720, captura equivalent de desktop, focus visible, navegació per teclat i regressió funcional dels contractes existents.
