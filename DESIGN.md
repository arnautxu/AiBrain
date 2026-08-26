---
name: AiBrain
description: Un entorn de treball guiat, tranquil i verificable sobre Codex.
colors:
  graphite: "#171717"
  graphite-soft: "#ecebea"
  white: "#ffffff"
  canvas: "#f1f3ef"
  work-surface: "#fbfbfa"
  sidebar-surface: "#efefec"
  ink: "#292725"
  text-muted: "#77736d"
  border: "#d8d6d1"
  success: "#4f8a5d"
  warning: "#d4a64c"
  error: "#9d4f3a"
  blue: "#315ee7"
  blue-soft: "#e9efff"
  violet: "#7656d8"
  violet-soft: "#f0ebff"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "42px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "normal"
rounded:
  message-tail: "4px"
  precise: "5px"
  sm: "8px"
  control: "12px"
  surface: "16px"
  rounded: "20px"
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
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.white}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "20px"
  action-row:
    backgroundColor: "{colors.work-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "16px 20px"
  sidebar-item-active:
    backgroundColor: "{colors.border}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
---

# Design System: AiBrain

## Overview

**Creative North Star: "Operate"**

AiBrain és un taulell d'operacions serè: familiar com una eina de feina quotidiana, precís quan demana una decisió i discret respecte del motor tècnic que hi ha a sota. La jerarquia visual comença per la intenció de l'usuari —accions, plantilles, resultats i aprovacions— abans d'exposar activitat, models o runtime.

El sistema treballa amb paper càlid, tinta de grafit, vores fines i una densitat compacta però respirable. L'accent és configurable i funcional: marca la selecció, l'acció principal o el pas en curs; no converteix la interfície en un aparador de color. Members reben llenguatge planer i recorreguts guiats. Owners conserven Review, Runtime, control plane i detalls d'administració sense contaminar el flux principal.

**Key Characteristics:**

- Jerarquia guiada abans que controls tècnics.
- Neutrals càlids i grafit com a llenguatge dominant.
- Tipografia Geist compacta, clara i de contrast fort.
- Vores fines i elevació escassa, reservada a capes flotants.
- Estat, permisos i recuperació explicats en llenguatge natural.

## Colors

La paleta és gairebé monocroma; el color només aporta acció, estat o personalització explícita.

### Primary

- **Grafit operatiu:** accions principals, marques actives, iconografia emfatitzada i panell fosc de l'onboarding.
- **Grafit suau:** fons de selecció, eines actives i respostes de l'usuari sense perdre la calma neutral.

### Secondary

- **Blau operatiu i blau suau:** alternativa configurable per entorns d'operacions; conserva exactament la mateixa jerarquia que el grafit.
- **Violeta operatiu i violeta suau:** alternativa configurable, mai un segon accent simultani dins d'una mateixa pantalla.

### Tertiary

- **Verd d'èxit:** connexió, finalització i canvis preparats.
- **Ambre d'espera:** comprovacions i estats temporals.
- **Terracota d'error:** errors, accions destructives i avisos recuperables.

### Neutral

- **Paper de fons:** llenç exterior lleugerament verd-gris que separa l'aplicació del blanc pur.
- **Superfície de treball:** pla principal gairebé blanc per lectura, conversa i formularis.
- **Superfície lateral:** gris càlid per distingir navegació i estructura sense ombra.
- **Tinta:** text principal i títols.
- **Text secundari:** explicacions, metadades i etiquetes de baixa prioritat.
- **Vora:** divisors, targetes, camps i agrupacions.

### Named Rules

**The One Accent Rule.** Cada context usa grafit, blau o violeta com un únic accent actiu; no es barregen accents per decorar.

**The Status Has Meaning Rule.** Verd, ambre i terracota només comuniquen estat o risc, mai jerarquia ornamental.

## Typography

**Display Font:** Geist (amb `system-ui` i `sans-serif`)
**Body Font:** Geist (amb `system-ui` i `sans-serif`)
**Label/Mono Font:** Geist Mono (amb `ui-monospace` i `monospace`)

**Character:** una sola família sans funcional sosté tota la interfície. Els titulars guanyen caràcter amb pes 600 i tracking negatiu; el cos i les etiquetes són petits però airejats. El mono queda reclòs a ordres, paths, diffs i sortida tècnica per a qui decideix obrir-los.

### Hierarchy

- **Display** (600, 42px; 32px en mòbil, 1.05): pregunta principal de l'acció guiada.
- **Headline** (600, 34px, 1.05): passos d'onboarding i formularis d'acció.
- **Title** (600, 14px, 1.5): noms d'acció, seccions i contingut prioritari.
- **Body** (400, 14px, aproximadament 1.7): explicacions i respostes; es limita habitualment a 62–76 caràcters.
- **Label** (500, 10px, 1.4): navegació, metadades i controls compactes; pot baixar a 8–9px en chrome administratiu.
- **Mono** (400, 9px, 1.75): detalls de runtime, ordres i diff, sempre dins de superfícies explícitament tècniques.

### Named Rules

**The Plain First Rule.** La capa principal parla amb Geist i llenguatge natural; Geist Mono només apareix després que l'usuari obri un detall avançat.

## Layout

L'escriptori divideix l'aplicació en una barra lateral fixa d'uns 280px i un espai de treball flexible. El chrome superior mesura 48px. Les accions guiades s'obren en un contenidor centrat de 860px; conversa i formularis treballen entre 760px i 820px per mantenir línies llegibles. El ritme dominant és de 8px, amb agrupacions de 12, 16, 20, 24 i 32px.

A menys de 768px la barra lateral es converteix en drawer i el contingut usa 20px laterals. Les plantilles passen de tres columnes a una, però la llista d'accions conserva la seva seqüència i àrea tàctil. A partir de 640px, accions i botons poden tornar a files; a 1024px, l'onboarding recupera el rail lateral de 340px. La densitat compacta redueix espai vertical, no mida de text essencial ni ordre informatiu.

**The Guided Hierarchy Rule.** En una pantalla de member, l'acció comprensible i el resultat esperat precedeixen qualsevol selector de model, eina o activitat interna.

## Elevation & Depth

El sistema és pla per defecte i crea profunditat amb canvis tonals, vores d'un píxel i separació espacial. Les ombres apareixen en el composer, menús flotants, avisos i la closca d'onboarding; són àmplies i difuses, mai brillants. El composer incrementa lleument l'ombra quan rep focus, mentre targetes i files només canvien de fons o vora en hover.

### Shadow Vocabulary

- **Composer ambient:** dues ombres càlides i una línia interior blanca; identifica l'únic punt d'entrada persistent.
- **Floating menu:** ombra curta i difusa per separar menús contextuals del rail lateral.
- **Onboarding shell:** ombra molt ampla i baixa que presenta el recorregut com una tasca acotada.

### Named Rules

**The Flat by Default Rule.** Les superfícies en repòs són planes; només una capa que flota, demana focus o delimita una missió pot projectar ombra.

## Shapes

La forma habitual és un rectangle suaument arrodonit: 8px per controls petits, 12px per camps i botons, 16px per targetes i 28px només per la closca d'onboarding. El radi semàntic configurable ofereix 5px, 12px o 20px, però s'aplica de manera consistent dins del context triat. Els missatges de l'usuari retallen una cantonada a 4px per suggerir direcció; punts d'estat i skeletons usen píndoles completes. Les vores són fines, càlides i visibles; no hi ha contorns gruixuts decoratius.

**The Nested Radius Rule.** Un element interior mai ha de semblar més monumental que el contenidor que l'envolta: controls de 8–12px viuen dins de superfícies de 16–28px.

## Components

### Buttons

- **Shape:** controls petits de 8px; accions principals i botons de formulari de 12px.
- **Primary:** accent sòlid, text de contrast, pes 600 i padding habitual de 12px vertical per 20px horitzontal.
- **Hover / Focus:** l'hover dels neutrals canvia el to de fons; el focus visible usa un outline de 2px barrejat amb l'accent i offset de 2px; l'active pot comprimir-se fins a 0.98.
- **Secondary / Ghost:** blanc amb vora càlida per alternatives persistents; fons transparent o gris pàl·lid per navegació i accions de baixa prioritat.
- **Disabled:** conserva la forma i redueix opacitat a 0.30–0.40, sense cursor d'acció.

### Chips

- **Style:** rectangles compactes de 8–12px amb vora fina, fons blanc o accent suau i text de 9–12px.
- **State:** l'opció seleccionada passa a accent sòlid o a accent suau amb text d'accent; `aria-pressed` expressa el mateix estat.

### Cards / Containers

- **Corner Style:** 12px per plantilles; 16px per grups d'accions i contingut; 28px per onboarding.
- **Background:** blanc o superfície de treball sobre paper de fons.
- **Shadow Strategy:** plans a repòs; consulteu Elevation & Depth per a les úniques excepcions.
- **Border:** una línia gris càlida que també divideix files contigües.
- **Internal Padding:** 16–24px segons densitat i importància.

### Inputs / Fields

- **Style:** blanc, vora càlida, radi de 12px, text de 14px i padding de 12px per 16px.
- **Focus:** manté el fons i enfosqueix la vora; el focus global afegeix outline quan correspon.
- **Error / Disabled:** l'error usa superfície terracota pàl·lida i copy de recuperació; disabled redueix opacitat sense amagar el control.

### Navigation

La barra lateral usa files compactes, icones lineals i jerarquia per to. El projecte o fil actiu rep una superfície gris més fosca; hover i focus revelen accions contextuals. En mòbil, el rail és un drawer de 286px i la capçalera conserva només les accions essencials. Control plane i dades de runtime es mostren als owners; els members veuen noms funcionals i un estat d'entorn segur.

### Guided Action Row

És el patró de signatura: icona dins d'una rajola neutra, verb curt, explicació, resultat esperat i fletxa. En desktop alinea verb i detall en columnes; en mòbil s'apila sense canviar l'ordre semàntic. L'hover eleva mínimament la claredat del fons i trasllada la fletxa, sense introduir color gratuït.

### Approval Card

Agrupa títol, explicació planera, detall avançat col·lapsat i decisions explícites. L'acció afirmativa usa l'accent; cancel·lar i permetre durant la tasca mantenen jerarquia neutral. Cap ordre o path tècnic és visible fins que l'usuari obre el detall.

## Do's and Don'ts

### Do:

- **Do** començar per una acció amb verb entenedor, la informació necessària i el resultat que l'usuari podrà revisar.
- **Do** mantenir el grafit i els neutrals càlids com a mínim el 90% de la superfície visual.
- **Do** usar color d'estat amb una explicació textual; el color mai és l'únic senyal.
- **Do** conservar Review, Runtime, ordres i paths dins de capes avançades accessibles als owners.
- **Do** preservar focus visible, labels accessibles, àrees tàctils còmodes i la reducció de moviment del sistema.

### Don't:

- **Don't** presentar prompts, models, terminal o Git com a punt d'entrada principal per a un worker.
- **Don't** barrejar grafit, blau i violeta en una mateixa jerarquia ni usar gradients d'accent decoratius.
- **Don't** afegir ombres a cada targeta; la vora i el canvi tonal són la separació habitual.
- **Don't** ocultar què passarà, què s'ha preparat o com recuperar-se d'un error.
- **Don't** exposar controls d'owner a members només per aconseguir paritat visual.
