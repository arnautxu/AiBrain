---
target: tota la UI d AiBrain
total_score: 24
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-08-28T21-59-44Z
slug: src-components
---
# Auditoria integral de la UI d'AiBrain

## Salut de disseny

| # | Heurística | Nota | Problema clau |
|---|---|---:|---|
| 1 | Visibilitat de l'estat | 3/4 | Bons estats de càrrega, offline, streaming i aturada; Review buit explica poc quan serà útil. |
| 2 | Correspondència amb el món real | 2/4 | `Codex`, `Review`, `Computer Use` i `Modelo` filtren vocabulari tècnic. |
| 3 | Control i llibertat | 3/4 | Hi ha Escape, cancel·lació, stop i confirmacions; el wizard i el composer competeixen. |
| 4 | Consistència i estàndards | 2/4 | Patrons coherents en aparença, però 209 desviacions tipogràfiques i components duplicats. |
| 5 | Prevenció d'errors | 3/4 | Bons límits, disabled states, confirmacions i approvals explícites. |
| 6 | Reconeixement abans que record | 2/4 | Capacitats importants queden amagades sota `+`, cerca o compte. |
| 7 | Flexibilitat i eficiència | 3/4 | Cerca, teclat, dreceres, templates i branching; falten operacions en bloc. |
| 8 | Estètica i minimalisme | 2/4 | Shell serè, però el wizard queda tapat i massa text essencial baixa a 8–11 px. |
| 9 | Diagnòstic i recuperació | 3/4 | Copy recuperable, retry, preservació offline i branching segur. |
| 10 | Ajuda i documentació | 1/4 | No hi ha entrada visible d'ajuda ni explicació contextual persistent. |
| **Total** | | **24/40** | **Acceptable; cal una passada important abans de considerar-la tancada.** |

## Veredicte d'especificitat

AiBrain és coherent però encara no és inconfusiblement AiBrain. El shell fosc, la barra lateral, el composer flotant, la paleta de comandaments i Review remeten clarament a la família Codex. La identitat pròpia apareix de veritat a `GuidedActions`: intencions en llenguatge planer, dades necessàries, resultat esperat i revisió abans d'usar-lo. Precisament aquesta superfície és la que queda visualment més malmesa.

El detector va trobar 210 avisos: 209 de mida tipogràfica fora del contracte de `DESIGN.md` i un de color. L'avís de color és un fals positiu: `#000000` és l'extrem d'un `color-mix`, no un color independent. Alguns 8–9 px són vàlids en chrome administratiu, i els 11–13 px representen sobretot una divergència sistèmica entre la documentació i el producte, no 184 defectes independents. Els 8–11 px en xat, attachments, sidebar i estats sí són un problema real de llegibilitat.

No hi ha overlay visual fiable: la superfície d'avaluació del navegador és de només lectura i va rebutjar la injecció. L'evidència alternativa combina captures, DOM, consola i inspecció del codi real.

## Impressió general

L'entrada és tranquil·la, clara i competent. La cerca és una bona capa de descobriment per a usuaris avançats. La gran oportunitat és fer que el camí guiat sigui l'experiència principal real, no una pantalla secundària atrapada sota un composer genèric.

## Què funciona

1. L'estat inicial té un únic focus clar: pregunta, projecte seleccionat i compositor.
2. El llenguatge guiat és específic del producte: `Analiza`, `Crea`, `Mejora`, `Resume` i `Compara` expressen objectiu i resultat sense exigir coneixements de prompting.
3. Les capacitats avançades es revelen progressivament mitjançant cerca, menús, dreceres, detalls i panells, amb bona base semàntica i focus visible.

## Problemes prioritaris

### [P1] El composer tapa el flux guiat

- **Evidència:** solapament aproximat de 69 px a 1280×720 i de 100 px a 390×844.
- **Impacte:** el camí pensat per a principiants sembla trencat i dificulta el primer camp obligatori.
- **Solució:** quan `guideVisible` estigui actiu, `GuidedActions` ha de ser l'única superfície interactiva. Ocultar el dock i oferir una transició deliberada de tornada a “Escriure directament”.
- **Ordre suggerida:** `$impeccable adapt`.

### [P1] La UI trenca la promesa de llenguatge no tècnic

- **Evidència:** `Escribe a Codex…`, `Review`, `Computer Use`, `Modelo automático` i `cron jobs` continuen visibles.
- **Impacte:** el treballador ha d'interpretar el motor intern que AiBrain promet amagar.
- **Solució:** usar sempre el nom configurable de l'assistent, renombrar Review a “Canvis i resultats”, Computer Use a “Navegador”, i donar explicacions d'una línia quan apareguin opcions avançades.
- **Ordre suggerida:** `$impeccable clarify`.

### [P1] Massa opcions quan l'usuari demana guia

- **Evidència:** la portada guiada presenta 3 plantilles i 5 categories; la cerca buida mostra 7 accions i 3 projectes.
- **Impacte:** obliga l'usuari a classificar la seva intenció abans d'entendre el producte.
- **Solució:** mostrar tres accions contextuals o recents i deixar la taxonomia completa sota “Veure totes les accions”. Separar plantilles i categories en passos diferents.
- **Ordre suggerida:** `$impeccable distill`.

### [P2] La mida mínima de text és massa baixa

- **Evidència:** 209 avisos del detector; attachments, sidebar, Review, estats i metadades usen sovint 8–11 px.
- **Impacte:** baixa la llegibilitat a distància, en mòbil, amb fatiga o baixa visió.
- **Solució:** 12 px com a mínim per a labels orientats a l'usuari i 14 px per a instruccions; reservar 8–10 px només per a metadades tècniques obertes voluntàriament. Convertir la rampa en tokens reals compartits.
- **Ordre suggerida:** `$impeccable typeset`.

### [P2] Falta una signatura visual pròpia fora del wizard

- **Evidència:** sense logo ni accent, el shell podria pertànyer a qualsevol workbench de la família Codex; el tema fosc dilueix el “paper càlid” de `DESIGN.md`.
- **Impacte:** el white-label canvia nom i color, però no comunica d'una ullada “treball guiat, traçable i segur”.
- **Solució:** convertir la cadena intenció → fonts → resultat → revisió/aprovació en un motiu visual reutilitzable i discret.
- **Ordre suggerida:** `$impeccable bolder`.

## Càrrega cognitiva

Fallen 5 de 8 criteris: càrrega alta en el flux guiat. Fallen focus únic, segmentació, jerarquia, una decisió cada vegada i límit d'opcions. Passen agrupació, memòria de treball i revelació progressiva general. Els punts més carregats són la portada guiada amb 8 opcions i la cerca buida amb 10 resultats visibles.

## Alertes per persona

- **Alex, usuari avançat:** bona cerca, teclat i branching; Review, Browser, Memòria i Biblioteca depenen massa de recordar la cerca. No hi ha gestió en bloc de projectes o converses.
- **Jordan, primer contacte:** veu vocabulari tècnic, no troba Ajuda, rep vuit opcions en el camí “guiat” i el primer camp queda tapat pel compositor.
- **Casey, mòbil i distret:** drawer i botó d'enviament tenen bona mida, però el compositor tapa 100 px del wizard; les etiquetes secundàries petites són difícils d'escanejar amb una mà.

## Observacions menors

- `Review del turno` i `Resultados` denominen la mateixa superfície de dues maneres.
- L'estat buit de Review no explica què l'omplirà.
- La jerarquia niuada de projectes i xats consumeix molt espai abans que hi hagi converses.
- Una mostra de prompt contextual podria accelerar el primer ús sense convertir la pantalla en una graella de targetes.
- Focus, semàntica, confirmacions destructives, offline, retry i preservació de resultats tenen una base sòlida.

## Preguntes de disseny

- Si les accions guiades són el diferencial, per què el composer genèric continua dominant després d'escollir-les?
- Un empleat nou hauria de veure mai `Codex`, `Review`, `Computer Use` o `model`?
- Què faria que una captura fos reconeixible com AiBrain sense logo ni color d'accent?
- Review ha de ser una destinació global o una etapa contextual que apareix només quan hi ha alguna cosa per revisar?
