---
name: AiBrain
description: Un entorn de treball guiat, tranquil i verificable sobre Codex.
colors:
  black: "#0a0a0a"
  white: "#ffffff"
  canvas: "#ffffff"
  work-surface: "#ffffff"
  soft-surface: "#f7f7f5"
  sidebar-surface: "#f7f7f5"
  ink: "#0a0a0a"
  text-secondary: "#575752"
  border: "rgba(0, 0, 0, 0.10)"
  success: "#3f7450"
  warning: "#846224"
  error: "#934d3d"
typography:
  display:
    fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.333
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.643
  secondary:
    fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  reading:
    fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"
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

Actualitzat el 2026-09-06 a partir de `src/app/globals.css`,
`src/styles/typography.css`, `src/styles/theme.css` i els components del workbench.
Aquest document descriu la direcció **Mineral Quiet**: una interfície gairebé
binària, amb Poppins, jerarquia forta i profunditat material continguda.

## Intenció

**Mode: Operate.** L'empleat descriu una feina, aporta documents i revisa el
resultat. L'aplicació és calmada, precisa i recuperable. El blanc i el negre
ordenen l'acció; l'espai, el pes tipogràfic i el material creen profunditat
sense construir una escala de grisos ornamental. La jerarquia comença per la
petició i el resultat; models, runtime, ordres i permisos detallats pertanyen a
controls contextuals o superfícies administratives.

La marca, el nom i els assets provenen d'`InstallationConfig`. La configuració
no permet exposar dades o controls aliens al rol de l'usuari.

## Superfícies i color

- Clar: canvas i superfície principal `#ffffff`; `#f7f7f5` és l'única zona
  clara alternativa i s'utilitza per separar regions grans, especialment la
  navegació. El text i les accions primàries són `#0a0a0a`.
- Fosc: canvas i superfície principal `#000000`; `#0a0a0a` queda reservat a
  superfícies elevades. Els estats de hover i selecció es deriven de blanc amb
  transparència, no d'una nova escala de grisos.
- `#575752` en clar i `#b8b8b2` en fosc són l'únic neutre secundari. Els tokens
  històrics `--text-secondary`, `--text-muted` i `--text-subtle` l'aliasen per
  compatibilitat i mantenen contrast de lectura en text petit.
- Els components consumeixen `--surface`, `--text`, `--text-secondary`,
  `--border`, `--danger` i els altres tokens semàntics, no opacitats arbitràries
  sobre el foreground. Els valors foscos viuen a `:root[data-theme="dark"]`.
- Les accions actives utilitzen `--active` i `--active-text`: fons negre amb text
  blanc en clar i fons blanc amb text negre en fosc. Els estats previs que encara necessiten
  un fons neutre poden consumir `--surface-selected` sense perdre llegibilitat.
- L'accent de `InstallationConfig` continua disponible per a identitat i
  configuració white-label, però no tenyeix decorativament el workbench.
- Verd, ambre i terracota comuniquen estat amb text; mai només amb color.
- Les vores deriven del negre o blanc amb alpha. Les ombres són escasses,
  direccionals i exclusives de capes que realment floten.
- La lectura normal exigeix contrast mínim 4,5:1 sobre el fons efectiu,
  incloent descripcions, placeholders i contingut desplegat en tots dos temes.

## Tipografia

Poppins és la veu de producte i es carrega amb `next/font` en pesos 400, 500 i
600, servida localment amb fallback mètric per limitar salts de layout. El pes 600 també
resol els usos històrics de «bold» per evitar síntesi d'un 700 no carregat.
Geist Mono queda reservada a codi, ordres i identificadors. La rampa completa
de components viu a `src/styles/typography.css`.

| Ús | Mida habitual | Aplicació |
| --- | --- | --- |
| Pregunta inicial | 24 / 32 px | Un títol centrat, pes 500 |
| Secció o nom de resultat | 14 px | Pes 500–600 |
| Resposta de l'assistent i missatge d'usuari | 16 / 24 px | Lectura de conversa |
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
- El sidebar és un material liquid glass sobre una textura neutra molt subtil:
  translúcid sobre el patró inferior, amb blur, una vora lluminosa
  fina i fallback sòlid per `prefers-reduced-transparency`. No s'apilen dues
  superfícies translúcides.
- La textura queda a la part inferior, sota el vidre i fora dels menús animats;
  cap capa decorativa intercepta clics. El rail, el drawer, els springs de hover
  i focus, els desplegables i les preferències persistides conserven el comportament.
  L'èmfasi dels controls usa un crossfade 500/600 en la mateixa caixa perquè Poppins
  no té un eix variable de pes. Es respecta moviment reduït.
- El missatge d'usuari conserva una superfície neutra; la inversió blanc/negre
  es reserva a les accions primàries i la selecció del sidebar.
- Profunditat moderada per a composer i capes flotants; estat actiu per inversió
  blanc/negre, vores i espai. No afegir ombres a totes les files.

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
