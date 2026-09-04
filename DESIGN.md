---
name: AiBrain
description: Un entorn de treball guiat, tranquil i verificable sobre Codex.
colors:
  graphite: "#171717"
  graphite-soft: "#e7e7e7"
  white: "#ffffff"
  canvas: "#ffffff"
  work-surface: "#ffffff"
  sidebar-surface: "#f9f9f9"
  ink: "#0d0d0d"
  text-secondary: "#5d5d5d"
  text-muted: "#737373"
  text-subtle: "#686868"
  border: "rgba(0, 0, 0, 0.10)"
  success: "#3f7450"
  warning: "#846224"
  error: "#934d3d"
  blue: "#315ee7"
  blue-soft: "#e9efff"
  violet: "#7656d8"
  violet-soft: "#f0ebff"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.333
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.643
  secondary:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  reading:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  precise: "5px"
  sm: "8px"
  control: "12px"
  surface: "16px"
  rounded: "20px"
  message: "22px"
  composer: "24px"
  shell: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
---

# Design System: AiBrain

Actualitzat el 2026-09-04 a partir de `src/app/globals.css`,
`src/styles/typography.css`, `src/styles/theme.css` i els components del workbench.
Aquest document descriu la identitat actual; no prescriu tornar a la paleta,
Geist sans o la densitat de versions anteriors.

## Intenció

**Mode: Operate.** L'empleat descriu una feina, aporta documents i revisa el
resultat. L'aplicació és discreta, clara i recuperable. La jerarquia comença
per la petició i el resultat; models, runtime, ordres i permisos detallats
pertanyen a controls contextuals o superfícies administratives.

La marca, el nom i els assets provenen d'`InstallationConfig`. La configuració
no permet exposar dades o controls aliens al rol de l'usuari.

## Superfícies i color

- Clar: canvas i superfície principal blancs; sidebar `#f9f9f9`, selecció
  `#e7e7e7`, text principal `#0d0d0d`.
- Fosc: canvas `#000000`, superfície elevada `#1f1f1f`, superfície secundària
  `#262626`, text principal `#f1f0ec`, text secundari `#b2afa8`.
- Els components consumeixen `--surface`, `--text`, `--text-secondary`,
  `--border`, `--danger` i els altres tokens semàntics, no opacitats arbitràries
  sobre el foreground. Els valors foscos viuen a `:root[data-theme="dark"]`.
- Les accions del workbench són de grafit; l'accent de la instal·lació serveix
  per a la identitat. No s'afegeixen blau i violeta com a decoració simultània.
- Verd, ambre i terracota comuniquen estat amb text; mai només amb color.
- La lectura normal exigeix contrast mínim 4,5:1 sobre el fons efectiu,
  incloent descripcions, placeholders i contingut desplegat en tots dos temes.

## Tipografia

La família sans segueix la plataforma: SF a Apple i Segoe UI a Windows, amb
fallback sans-serif. Geist Mono queda reservada a codi, ordres i identificadors.
La rampa completa de components viu a `src/styles/typography.css`.

| Ús | Mida habitual | Aplicació |
| --- | --- | --- |
| Pregunta inicial | 24 / 32 px | Un títol centrat, pes 500 |
| Secció o nom de resultat | 14 px | Pes 500–600 |
| Resposta de l'assistent | 14 / 23 px | Lectura de conversa |
| Navegació i secundari | 13 px | `--font-secondary`, `text-body-2-*` |
| Metadades i etiquetes | 12 px | `--font-caption`, `text-caption-1-*` |
| Entrada tàctil | 16 / 24 px | Evitar zoom involuntari en focus |
| Administració | 14 px camps; 12–13 px secundari | 16 px en camps amb punter tàctil |

Les etiquetes antigues d'11 px poden existir en chrome secundari; no són la
referència per a formularis nous. No reduir dades essencials a 8–10 px per
aconseguir més densitat. La densitat compacta modifica espai, no jerarquia.

## Composició

- Sidebar expandit: token `--sidebar-width: 256px`; drawer sota 768 px.
- Chrome superior compacte; conversa i composer en contenidors de fins a
  768 px, amb padding propi. Els tokens de referència són
  `--conversation-width: 760px` i `--composer-width: 720px`; no substitueixen
  automàticament els límits explícits dels components.
- Composer de radi 24 px; missatge d'usuari de radi 22 px; controls de
  8–12 px i resultats de 12–16 px. El radi configurable continua governant
  les superfícies que ja consumeixen `--brain-radius`.
- Ritme base de 4/8 px, agrupacions de 12/16 px i separacions de 24/32 px.
- Profunditat moderada per a composer i capes flotants; estat actiu per to,
  vores i espai. No afegir ombres a totes les files.

## Patrons del flux

### Composer i suggeriments

Una sola entrada dominant. «Crear imagen» és un mode explícit amb chip que
es pot desactivar. Quan està actiu, pregunta, placeholder i exemples són
coherents amb imatges. Els suggeriments omplen el borrador per revisar-lo;
no envien una petició i no descarten text ja escrit.

Les tres experiències ofereixen exemples de tasca, sense prometre temps de
resposta o qualitat que el runtime no garanteix. Les capacitats segueixen
els permisos i l'estat reals del servidor.

### Resultats d'imatge

Una imatge usa una columna; múltiples imatges poden usar dues a partir de
640 px. Cap fill pot imposar un mínim intrínsec que tregui la descàrrega de
pantalla. El resultat mostra nom, proporció acotada, dimensions verificades,
descripció desplegable i accions «Ampliar» i «Descargar PNG».

Els nous PNG inclouen les dimensions validades pel servidor; els antics
conserven un marc provisional fins a llegir les dimensions naturals. Les
proporcions extremes es contenen en un marc limitat, sense retallar els píxels.
La vista prèvia té càrrega i error explícits. «Volver a cargar» torna a llegir
el mateix recurs privat, sense regeneració. Vegeu
[GENERATED_IMAGE_ARTIFACTS.md](docs/GENERATED_IMAGE_ARTIFACTS.md).

### Errors, cerca i administració

Una resposta fallida ofereix recuperar la sol·licitud per editar-la. Els
resultats parcials es conserven i els adjunts no disponibles són explícits;
no es repeteixen efectes automàticament.

La cerca manté el focus al combobox i desplaça l'opció activa a la vista.
L'administració prioritza camps llegibles, agrupació i registre comprensible;
els identificadors de l'auditoria es poden desplegar.

## Accessibilitat i moviment

Focus visible, labels descriptius, Escape i retorn de focus als overlays.
Els controls tàctils amplien l'àrea a 44 px amb `pointer:coarse`. Cal verificar
la posició real i el click, no només l'amplada del document. Provar 320/390 px,
viewport intermedi, escriptori, zoom i text llarg.

Respectar `prefers-reduced-motion`; l'estat continua sent llegible sense
animació. Les imatges privades usen `unoptimized` perquè l'optimitzador no
transfereix la cookie d'autorització. No introduir una caché pública per
millorar una puntuació de rendiment.
