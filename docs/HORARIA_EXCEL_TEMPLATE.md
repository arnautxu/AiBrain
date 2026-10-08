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
ni escriu dades de negoci. L’eina exigeix els set dies marcats, contrasta
les hores de cada codi amb els intervals i retorna el total i la cobertura
calculats de la graella final. El worker només publica una resposta final
d’aquest tipus si ha projectat l’Excel de la plantilla; en cas contrari
retorna un error explícit. Aquesta revisió no certifica totes les condicions
textuals ni l’optimització de canvis posteriors: cal comparar la revisió
amb cada condició demanada i fer acceptació autenticada al xat desplegat.
La revisió del catàleg d’eines es renova perquè els xats existents
recuperin l’historial en un runtime nou que exposi aquesta eina.

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

Arnall configura els responsables i contactes reals. Les proves tècniques
de repartiment utilitzen exclusivament un destinatari de prova autoritzat.

## Retorn de l’Excel al xat (candidat 2026-10-08)

Les noves propostes generades per horarIA registren l’original privat i
retornen `reviewSourceId`. `schedules.review-upload` rep l’adjunt corregit,
el compara amb aquell original i conserva els bytes exactes. Permet canviar
els codis de torn i les dues línies d’hores de les persones ja presents.
No substitueix l’arxiu, no torna a calcular el pla ni importa torns a la base
de dades. El canvi retornat inclou persona, cel·la i valors abans/després.

El verificador rebutja una altra botiga/setmana, canvis de noms, dades als
auxiliars, fórmules alterades, altres fulls, macros, connexions externes,
comentaris/objectes incrustats i cadenes compartides ocultes sense ús.
Comprova els límits reals de descompressió i CRC de cada membre del ZIP.
Els recursos de format, les taules auxiliars i la configuració d’impressió
han de conservar la mateixa estructura semàntica. Reescriure el llibre
amb un editor que elimina validacions o reorganitza aquests recursos pot
ser rebutjat; no se’n presenta una còpia simplificada com si fos l’original.
Una prova amb openpyxl ha detectat precisament aquesta reescriptura i s’ha
rebutjat. La prova d’un retorn des de Microsoft Excel continua sent un gate
separat de les proves de correcció de cel·les conservant OOXML.

`schedules.reviewed-send` envia aquesta versió exacta al destinatari revisat
després de la confirmació del xat. Si canvia el telèfon o el responsable,
cal revisar de nou el mateix fitxer; un resultat incert no es reintenta
automàticament. Cada fitxer i rebut estan vinculats a usuari, instal·lació
i botiga. Vegeu `HORARIA_WHATSAPP.md` per al canal XLSX, la finestra de resposta
i els rebuts del proveïdor. L’Excel retornat es pot desar per revisar-lo encara
que Arnall no hagi acabat de configurar-ne la destinatària.

## Acceptació i incidència de previsualització — 2026-10-08

El candidat `a000342a4748737781bd01587e1ba9a5d2da2a78` ha passat
Backend CI `37769762810`, publicació GHCR `37770359026` i desplegament
`37770712285`, amb imatges i revisió verificades al servidor. El compte
onboarding ha generat un esborrany real de Girona/2026-W42 amb el rebut de
l’original. La disponibilitat de prova de dimecres només tarda s’ha respectat.
El pla continua sent un esborrany: hi ha conflictes i condicions textuals que
requereixen revisió humana abans d’un repartiment operatiu.

El retorn del fitxer al xat ha exposat dues incidències del visor. Primer,
el perfil seccomp del host era anterior al perfil ja provat i versionat:
faltaven `close_range` i la resposta ENOSYS de `clone3`. S’ha conservat una
còpia privada de l’estat anterior i s’ha promogut transaccionalment la mateixa
imatge amb el perfil del candidat. A les 11:44 UTC, estat durable, app i worker
confirmen SHA-256 del perfil
`549dbde61695d3e4344e63270c1ffaace4d82a5a80bddf3ec411fead97e33eda`;
live/ready són correctes. La ruta d’operacions també conserva aquest perfil
per als desplegaments següents. No s’ha exposat `/proc` ni canviat dades o
contactes d’horarIA.

Després, Calc ha avortat en dibuixar `SinglePageSheets` per aquest llibre.
La conversió del mateix XLSX amb la impressió original ha produït una pàgina
A4 vàlida, comprovada amb qpdf i renderitzada amb Poppler dins del mateix
contenidor restringit. El visor incorpora un únic reintent en aquest cas,
conservant l’Excel original; vegeu `GENERATED_DOCUMENT_ARTIFACTS.md`.
La prova autenticada de retorn i enviament s’ha de repetir amb aquesta
correcció desplegada. Això no acredita una edició des de Microsoft Excel.

## Límits i gates

L’operació `schedules.publish` continua generant un PDF des de la base de
dades; **no és una importació ni un repartiment de l’Excel revisat**. El nou
circuit usa les operacions `schedules.review-*` i conserva el document
retornat. Les proves locals no acrediten l’acceptació autenticada del
retorn d’un Excel real ni l’entrega als responsables. Aquestes comprovacions
requereixen el candidat desplegat, l’adjunt retornat i destinataris configurats.

La fidelitat estructural s’ha comparat amb el full original i s’ha revisat
la impressió amb LibreOffice. No s’ha fet una acceptació en Microsoft Excel.
L’exportació i les comprovacions locals no impliquen Backend CI remot,
publicació GHCR, desplegament ni acceptació al xat d’Arnall. Cap d’aquests
gates remots s’havia executat en la validació original de setembre; l’estat
del candidat d’octubre consta a la secció d’acceptació anterior.

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
