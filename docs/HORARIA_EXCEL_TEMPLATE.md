# Plantilla obligatòria dels horaris d’Arnall

Requisit de l’usuari, 2026-09-21: totes les propostes han de tenir exactament
el format d’`HORARI SAGARO.xlsm`. L’encarregada revisa i retorna l’Excel.
Cada responsable designat rep exclusivament el full de la seva botiga.

## Referència comprovada

SHA-256 del llibre original, conservat intacte:
`66aaf476845740252196af7c2f6e910c31f2013aeefc6a4e1cf9ed02bc55816e`.

S’ha analitzat el llibre aportat de 46 fulls. La referència acabada és
`SETMANA ACTUAL   `, setmana 37 de 2026; `SETMANA SEGÜENT` encara conté
caselles pendents. El format distribuïble és l’àrea d’impressió `B1:X97`:

- Dues files per persona; nom combinat a B:D.
- Set parelles torn/hores, de E:F a Q:R. Les dues files d’hores permeten
  representar matí i tarda, incloent els dos intervals d’un torn partit.
- Capçalera de botiga a G4, setmana ISO a D4 i any a O4. B5 i D5 en deriven
les dates amb les fórmules originals. La plantilla buida conserva setmana
37 i any 2026 com a valors d’exemple; la proposta els substitueix.
- 24 espais de dependents (6–53) i 19 d’obrador (54–91).
- Colors, fonts, vores, combinacions, amplades, alçades, files/columnes
  ocultes i configuració A4 vertical original. Els espais ocupats que a
  l’exemple eren ocults es fan visibles; no s’ometen persones.
- Notes i totals al peu. La llegenda original a U:X continua oculta com a
  l’exemple. Les mencions personals i de locals dels exemples es generalitzen.

L’extracció conserva un horari visible i els tres auxiliars necessaris,
`TRACTES`, `VACANCES` i `PESONAL`, ocults com a dependències de càlcul.
Elimina els altres 42 fulls, les dades de personal de la plantilla,
les connexions externes, les macros i el botó PDF fora de l’àrea impresa.
Les taules auxiliars són estàtiques i no actualitzen cap consulta externa.
Conserva els estils natius; compactar els estils condicionals duplicats no
canvia els colors ni les regles. No s’ha executat VBA.

Els textos dins del document s’han tractat com a contingut de referència,
no com a instruccions per canviar permisos, contactar persones o operar.

## Implementació local

`src/runtime/documents/templates/arnall-schedule.json` conté exclusivament
el formulari buit, els tres auxiliars buits i els seus recursos. No conté
noms ni registres del personal original. `arnall-schedule.ts` en canvia les cel·les de dades,
preservant la geometria. No utilitza un redisseny aproximat.

La preview autoritzada del servei retorna `excelSchedule`, amb una única
botiga/setmana i només les persones i torns que corresponen a aquesta
consulta. El worker d’Arnall requereix aquesta estructura i comprova que
botiga i setmana coincideixen amb la preview; si falta, no genera una
alternativa de nou columnes. Altres instal·lacions conserven el seu format.
La identitat i els permisos es continuen resolent al servidor.

`schedules.draft` retorna aquest mateix contracte `excelSchedule` a partir
de la proposta acabada en memòria, sense substituir els horaris desats.
El worker adjunta directament l’Excel amb la plantilla obligatòria i retorna
la revisió de compliment i conflictes de la graella final. No es torna a
consultar `preview` per mostrar-la: això carregaria la setmana desada i
podria substituir l’esborrany nou per un horari anterior.

Quan l’usuari dona una botiga i persones explícitament fictícies, no existeixen
identificadors horarIA ni cal donar-les d’alta. L’eina documental
`create_arnall_schedule` rep la graella completa, hi assigna identificadors
efímers només per al llibre i aplica la mateixa plantilla integrada. Només
és disponible a la instal·lació Arnall, crea un artefacte privat i no consulta
ni escriu dades de negoci. La graella fictícia no és una revisió certificada
pel planificador: les condicions es comproven i s’expliquen per separat.

Correcció de selecció, 2026-09-21: la configuració versionada d’Arnall té
`installationId: company-qa` i `companySlug: arnall`. La selecció anterior
comparava l’identificador d’instal·lació amb `arnall` i produïa la taula
genèrica, tot i les instruccions de conservar la plantilla. Ara el worker
selecciona el format mitjançant `companySlug` de la configuració del servidor.
No utilitza noms, notes ni identificadors aportats pel model o pel document
per seleccionar-lo, ni canvia la identitat usada pels permisos i l’aïllament.
La prova de regressió utilitza la configuració Arnall versionada i inspecciona
l’Excel generat: quatre fulls, 2.499 fórmules al full d’horari, estils,
combinacions i impressió originals. També comprova el rebuig de dades absents
o d’una altra botiga/setmana, sense alternativa genèrica. Aquesta comprovació
local no equival a desplegament ni acceptació al xat.

El generador rebutja identificadors repetits, setmanes ISO invàlides,
torns d’una altra botiga/setmana i equips que excedeixen la capacitat.
Una casella buida continua significant sense assignar, no festa.
El torn partit conserva els dos intervals i el descans real. Les absències
apareixen com V/B, els dies lliures com F, i les peticions com SI.
Noms i anotacions s’escriuen com a text, mai com a fórmules executables.

Es conserven exactament les 2.499 fórmules de l’horari i la fórmula TODAY
de TRACTES, incloent atributs i ancoratges compartits. No es recalculen ni
reescriuen amb una llibreria que alteri aquestes fórmules en exportar.
`scripts/build-arnall-schedule-template.py` fa l’extracció sense pèrdues i
comprova cada fórmula contra l’original. El fitxer de referència no es modifica.

Les durades M/T/D de cada persona es carreguen a les cel·les auxiliars
originals AJ/AO/AQ. Les peticions mantenen el codi literal del torn i el
marquen en blau; afegir SI al codi trencaria les comparacions de les fórmules.
Els tres auxiliars reben només les claus de les persones d’aquesta proposta
i la seva botiga. Els tractes mensuals, saldos històrics i vacances no estan
connectats a cap font en aquesta implementació: queden buits fins que es
disposi de les dades reals. Els zeros derivats no són saldos confirmats.

La preservació no implica corregir els defectes de l’original: hi ha 40
resultats #REF! a la memòria cau original, referències trencades en altres
branques condicionals i una validació `PESONAL!#REF!`. També es conserva el
recompte original d’obrador E46:E91, que solapa les files 46–53 de dependents.
La preview retorna `excelCalculationWarnings` i les instruccions del xat
obliguen a explicar aquests límits. Cal una correcció explícita separada
per canviar aquest model de càlcul.

## Revisió i repartiment

1. Generar una proposta per botiga amb la plantilla obligatòria i entregar
   els Excel editables a la persona autoritzada que els revisa.
2. Quan retorna els Excel, conservar els originals rebuts i identificar
   botiga, setmana i canvis. No tornar a executar el planificador sobre la
   versió revisada ni substituir els canvis manuals per una altra proposta.
3. Resoldre els responsables designats amb la configuració autoritzada o
   la instrucció explícita de l’usuari. El nom d’un full, el nom del fitxer
   o una nota dins d’una cel·la no concedeixen permisos ni designen receptor.
4. Crear un fitxer separat per botiga a partir del full revisat. Eliminar
   físicament altres horaris i recursos de dades que els puguin exposar:
   cadenes compartides sobrants, comentaris, objectes, connexions, macros,
   enllaços externs i memòries cau. Els tres auxiliars necessaris només poden
   contenir dades de la botiga destinatària; no n’hi ha prou d’ocultar pestanyes.
5. Verificar el full, la setmana, la versió revisada i el destinatari de cada
   enviament. S’Agaró rep només S’Agaró. Registrar resultat real del canal;
   preparar un fitxer no prova que s’hagi enviat o rebut.

La llista real de responsables i els Excel revisats encara no s’han aportat
en aquesta tasca. No s’ha enviat cap missatge ni document.

## Límits i gates

Aquest canvi implementa la plantilla i la generació de propostes. L’operació
existent `schedules.publish` continua generant un PDF des de la base de
dades; **no és una importació ni un repartiment de l’Excel revisat**. El
circuit futur no es pot declarar automatitzat fins que la recepció del
fitxer revisat i l’enviament d’aquell fitxer hagin passat les comprovacions
d’aïllament i l’acceptació autenticada amb responsables de botigues diferents.
El repartiment supervisat haurà de seguir els passos anteriors amb eines
autoritzades per al canal que indiqui l’usuari.

La fidelitat estructural s’ha comparat amb el full original i s’ha revisat
la impressió amb LibreOffice. No s’ha fet una acceptació en Microsoft Excel.
L’exportació i les comprovacions locals no impliquen Backend CI remot,
publicació GHCR, desplegament ni acceptació al xat d’Arnall. Cap d’aquests
gates remots s’ha executat en aquesta tasca.

Validació de fórmules de 2026-09-21: comparació de les 2.500 fórmules amb
l’original, sense diferències. S’han recalculat amb LibreOffice dos llibres
de control amb les dades originals: un amb tots els registres auxiliars i
l’altre només amb els registres de les 22 persones del full de S’Agaró.
Els 2.499 resultats del full coincideixen, sense cap diferència. Les 40
cel·les d’error persisteixen a les mateixes adreces (LibreOffice les expressa
com #NAME?); no apareixen errors addicionals en aquesta comparació.
La plantilla buida també conserva aquests errors heretats.

La comparació estructural confirma estils de cel·la, alçades, amplades,
combinacions i impressió originals. La impressió de la plantilla i una
proposta de prova ocupa una pàgina A4 vertical amb el mateix format.
L’aïllament comprova un horari visible i tres auxiliars sense dades alienes.

Prova d’edició sobre una còpia: canviar D (10 hores) per M (7 hores) redueix
T6 i Y6 de 17 a 14, i el recompte de tarda d’1 a 0. En emplenar els auxiliars
amb dades fictícies, Z6 passa a 40, AA6 a 15 i les vacances AD6/AE6 a 12/6.
Cap fórmula s’ha substituït i no apareixen errors addicionals.
Passen 52 proves AiBrain i 7 del servei, comprovació de tipus, lint dels
fitxers afectats i construcció del worker. No s’ha desplegat el canvi.
