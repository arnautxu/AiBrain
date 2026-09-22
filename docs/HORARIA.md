# horarIA: automatització conversacional

## Contracte de producte

horarIA funciona al xat d’AiBrain. No té navegació, login, pàgines, dashboard ni aplicació frontal pròpia. `aibrain_horaria` cobreix personal i botigues, regles, disponibilitat i peticions, fotografies dels fulls, absències, vacances i festius, generació i correcció d’horaris, informes, WhatsApp i configuració del cicle setmanal.

`preview` llegeix la setmana real i adjunta un XLSX amb la previsualització privada que ja utilitza AiBrain. Inclou totes les persones visibles de la botiga, els dies sense assignació, hores reduïdes, descans del torn partit, absències i peticions. Les incidències es retornen al xat amb la mateixa consulta. Publicar genera el PDF al servidor a partir de la setmana comprovada. Si el hash de la previsualització ja no coincideix o hi ha una generació en curs, es rebutja la publicació.

Les consultes s’executen directament. Els canvis interactius es desen com a propostes immutables per instal·lació, usuari i conversa. Una confirmació inequívoca en un missatge posterior aplica la proposta; no s’accepten confirmacions dins de dades de clients ni en una execució background. Un tall després de començar una escriptura deixa un estat incert que impedeix repetir-la cegament. Els fitxers de propostes i els seus resultats viuen al directori privat de l’usuari, fora del workspace accessible al model.

### Esborrany immediat al xat

`schedules.draft` calcula una proposta en el mateix torn i n’adjunta l’Excel, sense confirmació addicional ni missatges anunciant passos futurs. La resposta final explica el compliment verificat, els conflictes concrets i com llegir la proposta. Les restriccions temporals van a `requests`: dies lliures, disponibilitat de matí/tarda per dia, absències, límit d’hores i prohibició de torns partits. No es converteixen en canvis permanents de preferències, personal, absències o regles. No s’inventen restriccions ni cobertura; una condició no representable s’explica com a no comprovada.

Fer o generar un horari significa preparar aquest esborrany per defecte; no cal
que l’usuari demani explícitament una simulació ni pregunti després pel compliment.
La resposta lliura l’Excel, què s’ha respectat i què cal revisar en el mateix torn.
Les propostes de canvis permanents pendents a l’historial no bloquegen el càlcul:
les respostes d’aquestes eines indiquen l’alternativa `schedules.draft`, sense
aplicar ni confirmar les propostes. La generació persistent només correspon a una
petició explícita de desar o substituir horaris.

`coverage` admet els mínims temporals demanats per dependència i elaboració,
matí i tarda (`minDependientasManana`, `minDependientasTarde`,
`minElaboracionManana`, `minElaboracionTarde`, enters entre 0 i 99). S’apliquen
en memòria a la setmana calculada, al motor i a la revisió de la graella final.
Es conserven els mínims desats més exigents, els màxims i els àmbits per dia;
si no hi havia regles, es crea només una regla temporal. Així, preparar l’esborrany
amb cobertura no necessita una proposta `rules.create` ni modificar la base.

El servei privat `POST /api/integration/draft` conserva autenticació signada, rol i accés a la botiga. Utilitza el mateix motor, amb dades i peticions en memòria, i retorna **abans de qualsevol escriptura de negoci**. Com que no desa horaris, no pren el bloqueig d’escriptures; es limita a 20 peticions per hora i responsable. Manté el permís d’IA existent i el transport privat de 20 minuts. En background també exigeix l’autorització durable explícita de l’operació. No canvia cap permís de publicació o enviament.

La revisió comprova la graella final, no les afirmacions del model: disponibilitat, dies lliures, absències, torns partits sol·licitats, hores màximes incloent altres botigues i cobertura mínima/màxima configurada. Retorna comprovacions i conflictes separats del resum del model. L’equitat històrica, descans i compliment complet de condicions textuals no estan certificats; apareixen a `notVerified`. `allRespected` és `false` si hi ha un conflicte i `null` si encara hi ha aspectes sense certificar: el xat no pot afirmar compliment total.

El resultat i la recepció interna queden al directori privat de propostes per usuari/conversa; si només falla l’adjunt, es reutilitza el resultat sense repetir el càlcul. Si el càlcul queda en estat incert, no es repeteix automàticament. El fitxer es crea amb el mateix circuit d’artefactes i plantilla obligatòria. No es crida `preview` després, perquè llegiria la setmana desada. El hash del draft no autoritza publicar-lo: el flux de publicació continua requerint dades desades i comprovades. La generació persistent `schedules.generate` conserva el job asíncron i la confirmació habitual.

La revisió del catàleg `aibrain-tools-2026-09-21-horaria-draft-v3` fa que els xats existents carreguin les eines noves conservant l’historial durable. Mentre una eina horarIA espera el càlcul, el control d’inactivitat no talla el torn; el límit màxim del torn continua actiu i la protecció d’inactivitat es reprèn quan l’eina retorna o falla.

Les automatitzacions recurrents es creen amb el sistema existent `aibrain_automations`. El worker rep les eines horarIA amb la identitat de qui executa. Les escriptures background necessiten una autorització de l’operador a `backgroundOperations`; crear una tasca per xat no concedeix aquests permisos. El batec intern del servei és una opció separada per als enviaments i recordatoris definits als ajustos de les botigues. Només s’activa amb `HORARIA_ALLOW_AUTOMATIC=1`.

## Procedència i dades

Font: ZIP `Migració.zip` aportat per l’usuari, directori `01-app-horaris/codi`, snapshot de codi 2026-08-28. `modules/horaria/SOURCE.json` conserva els hashes dels fitxers originals importats. Els canvis d’integració es poden comparar amb aquests originals. No s’han incorporat credencials, entorns Python, instruccions d’altres assistents, desplegaments antics, backups ni converses personals al repositori.

`modules/horaria/backend/test/fixtures/upstream-ui` conserva exclusivament fragments històrics per executar les proves originals de paritat. No és una UI, no es compila ni es copia a la imatge de producció. `src/index.js` redirigeix a l’únic punt d’entrada autenticat; l’antiga aplicació autònoma no es pot iniciar amb aquest fitxer.

El backup més recent del ZIP inspeccionat és de **2026-08-21 10:15 UTC**, anterior al snapshot de codi. L’assaig local ha importat les 17 taules: 5 botigues, 84 persones, 1.230 torns, 22 peticions, 53 absències, 77 edicions, 13 converses, 93 missatges i la resta de regles/ajustos/informes/full. Això prova la compatibilitat de la còpia; no prova que siguin les dades actuals de l’empresa.

## Arquitectura i permisos

- Un procés i una base PostgreSQL dedicats per instal·lació. El servei no és un contenidor compartit entre clients.
- AiBrain llegeix la configuració privada de l’operador a `<dataRoot>/horaria/integration.json`, amb permisos 0600. La instal·lació ha de coincidir amb la sessió local. Les identitats es mapen explícitament a persones de horarIA; cap nom/email extret d’un document concedeix accés.
- El catàleg tradueix noms d’operació a rutes fixes. El model no pot escollir servidor, capçaleres, actor ni URL.
- El transport intern usa una connexió directa exclusiva al servei configurat; no passa pel proxy de sortida cap a Internet, no segueix redireccions i no modifica la política de sortida d’AiBrain.
- Cada petició interna porta una signatura HMAC que vincula instal·lació, actor, persona, mètode, ruta i query, tipus de contingut, hash dels bytes, temps i nonce. El servei només accepta signatures recents i rebutja la reutilització del nonce dins del procés.
- El servei torna a consultar que la persona sigui activa i responsable, i resol de nou les seves botigues. També es comprova el permís `tools.execute` vigent d’AiBrain. Es mantenen els controls de rol i accés de cada controlador original.
- Les imatges només es llegeixen dins del projecte autoritzat, sense salts de directori/enllaços simbòlics ni URLs remotes elegides pel model. La proposta fixa el hash de la imatge i el torna a comprovar abans de consumir-la.
- `HORARIA_ALLOW_AI`, `HORARIA_ALLOW_DELIVERY` i `HORARIA_ALLOW_AUTOMATIC` estan desactivats per defecte. Els enviaments no poden declarar èxit en mode mock o sense credencials del proveïdor.
- Les antigues rutes mock de simulació, els cron externs antics i el login autònom no són accessibles des de les eines. L’únic punt públic és `/api/horaria-events/webhook` i els PDF amb token aleatori temporal, quan `eventsEnabled` és true. Els webhooks verifiquen a més la signatura de Meta/Twilio o el secret configurat de 360dialog.

Exemple de configuració de l’operador (no és una credencial utilitzable):

```json
{
  "installationId": "arnall",
  "baseUrl": "http://horaria:3210",
  "secret": "REPLACE_WITH_A_PRIVATE_RANDOM_SECRET_AT_LEAST_32_CHARS",
  "eventsEnabled": false,
  "users": {
    "REPLACE_WITH_AIBRAIN_USER_UUID": {
      "employeeId": 1,
      "backgroundOperations": []
    }
  }
}
```

No reutilitzeu la persona 1 sense revisar el backup i la identitat real. `backgroundOperations` és una llista explícita d’operacions, per exemple `schedules.generate`; no admet comodins. Mai s’ha d’activar `whatsapp.broadcast` o `schedules.publish` només perquè un prompt ho demani.

## Instal·lació i migració

1. Construir i provar la revisió. La imatge AiBrain inclou el servei a `/opt/aibrain-horaria`, el client i el motor de migracions Prisma per Debian/OpenSSL 3. La construcció fixa `PRISMA_CLI_BINARY_TARGETS` i executa el binari de migracions dins de la imatge final per detectar errors d’ABI abans de publicar. El servei s’executa separadament amb la mateixa imatge immutable. El job `horaria-tests` forma part del gate Backend CI.
2. Provisionar una base de dades buida exclusiva de la instal·lació i un directori privat `HORARIA_STATE_ROOT` propietat de l’usuari del servei. Registrar la base, el volum, les còpies i les credencials al runbook de la instal·lació.
3. Aplicar les 33 migracions amb el Prisma inclòs: `node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma`, des de `/opt/aibrain-horaria`. No fer servir `migrate dev` en producció.
4. Inspeccionar una còpia actual amb `node src/integration/import-backup.js /private/backup.json`. Només mostra data, hash i recomptes. Per importar, afegir `--apply-empty SHA256_INSPECCIONAT` i definir `HORARIA_INSTALLATION_ID`. L’importador comprova totes les taules, rebutja un destí no buit, utilitza una transacció, restitueix referències circulars i seqüències i retorna recomptes reals. No esborra ni fusiona dades existents.
5. Crear `integration.json` i el fitxer d’entorn privat a partir de `.env.example`; establir el mateix secret i installationId als dos costats. Deixar els tres flags de proveïdor desactivats.
6. Després d’autorització de desplegament, revisar `infra/hetzner/horaria.compose.yaml`, que utilitza un projecte Compose propi i les xarxes existents de la instal·lació. `horaria-release.sh` aplica migracions, promou el servei amb la mateixa imatge immutable que AiBrain i comprova revisió i salut; en cas d’error restaura la configuració de servei anterior. El gateway de desplegament el crida només quan existeix la configuració privada de horarIA. La base PostgreSQL té una imatge fixada per digest i no publica ports. El servei no publica ports al host. AiBrain hi accedeix per la xarxa interna; el servei té la seva sortida cap a PostgreSQL i els proveïdors.
7. Fer acceptació autenticada al xat amb responsables de botigues diferents i amb un usuari sense mapatge. Validar preview, correccions i revocacions. Només després, amb autorització explícita, activar IA/WhatsApp/recurrència i provar recepció i enviament amb destinataris de prova aprovats.

`PUBLIC_BASE_URL` ha de ser l’origen públic d’AiBrain. Per Twilio, `HORARIA_PUBLIC_WEBHOOK_URL` ha de coincidir byte per byte amb la URL registrada. Meta requereix `META_APP_SECRET` i `WHATSAPP_VERIFY_TOKEN`. 360dialog requereix `WHATSAPP_PROVIDER=360dialog` i un transport que adjunti `x-horaria-webhook-secret`; si el proveïdor no pot fer-ho, mantenir aquesta entrada desactivada fins que es defineixi un ingress verificat.

## Persistència i recuperació

Les dades de negoci continuen a PostgreSQL. Cal incloure aquesta base al pla de còpies de la instal·lació; les còpies del filesystem d’AiBrain no la cobreixen automàticament. `HORARIA_STATE_ROOT` conté estat de generacions, PDF temporals i heartbeat; cal protegir i incloure aquest volum a les còpies operatives. Després d’un reinici, una generació que havia quedat en curs es mostra com a interrompuda i es consulta l’horari desat abans de repetir-la. Els PDF sobreviuen al reinici fins a la seva caducitat d’una hora.

L’origen importat conserva deduplicació en memòria per a Twilio/360dialog; Meta passa pel receptor durable descrit a [HORARIA_WHATSAPP.md](HORARIA_WHATSAPP.md). **No hi ha garantia exactly-once d’entrada WhatsApp després d’un reinici**: abans de l’activació real cal provar reentregues del proveïdor i acordar la reconciliació de missatges amb estat ambigu. La persistència d’una proposta de xat evita tornar a executar-la cegament, però no converteix l’API del proveïdor en una transacció atòmica. Publicat i notificat són estats separats: un PDF pot quedar publicat i fallar l’enviament, i el xat ha d’explicar-ho.

## Verificació i estat de lliurament

- Tests del motor importat i de les fronteres afegides: `npm run build --prefix modules/horaria/backend && npm test --prefix modules/horaria/backend`.
- Tests del pont conversacional: `npm exec -- vitest run src/horaria/chat-tools.test.ts`.
- Tipus, lint, build AiBrain i worker: comandes estàndard del repositori.
- Assaig opcional sobre una base **local** amb `rehearsal` al nom: `node src/integration/rehearsal.js`. Rebutja host remot i qualsevol crida externa; comprova lectura, preview PDF, CRUD de personal i bloqueig dels enviaments. Modifica només la base de l’assaig.

Validació local dels esborranys, 2026-09-21: 680 proves del servei i 121 proves del pont, worker, recuperació de converses i contractes; tipus, lint, contractes, infraestructura i construccions del worker i web correctes (webpack al worktree amb dependències enllaçades). La prova de navegador comprova procés plegat durant la resposta, obertura manual i recuperació del xat. El cas de conflictes amb quatre persones fictícies recorre el motor i la preparació de dades Excel amb un proveïdor HTTP local: detecta manca de cobertura malgrat el resum optimista del model i comprova zero escriptures de negoci. Això no constitueix una generació autenticada amb el proveïdor real ni acceptació en producció.

La correcció posterior de continuació sense confirmació s’ha verificat localment
amb 683 proves del servei, 94 proves del pont, catàleg i contractes i 16 del
worker, més tipus, lint i construcció del worker. Inclou sis propostes pendents que no impedeixen retornar l’esborrany, cobertura
temporal sense regles desades i zero escriptures de negoci. El model de l’assaig
és local i simulat: aquestes proves no acrediten que el xat real triï sempre el
flux correcte. Backend CI, GHCR, desplegament i acceptació autenticada d’aquesta
correcció queden pendents.

L’assaig de 2026-09-13 ha verificat migració completa, set consultes de negoci, CRUD de personal i una preview de 238 torns amb 35 files (capçalera inclosa). No s’han fet crides a Anthropic, Deepgram, Meta, Twilio ni 360dialog.

**Gates separats:** verificació local no equival a Backend CI remot, publicació GHCR, desplegament, activació del servei o acceptació autenticada a `arnall.graphikai.com`. L’acceptació remota es registra als readbacks de release de la instal·lació, separadament de les proves locals descrites aquí.

## Motor Codex connectat

La IA d’horarIA s’executa amb el Codex que l’usuari té connectat a AiBrain; no necessita Anthropic. El servei envia una petició interna signada a `/api/horaria-codex` (`HORARIA_CODEX_URL=http://app:3000`). AiBrain comprova signatura, cos, caducitat, nonce i assignació de responsable, torna a consultar el rol vigent a horarIA i verifica l’usuari actiu abans d’admetre el worker. Cada càlcul utilitza un fil efímer del worker del mateix usuari, amb eines, apps, MCP, entorns i lectura d’instruccions locals desactivats. El resultat estructurat torna al motor importat per aplicar les seves validacions. Es limita a un càlcul simultani per usuari i quatre per procés.

Les crides de generació mantenen el seu job durable; un càlcul interromput no es repeteix a cegues. La transcripció d’àudio encara és una connexió opcional separada. WhatsApp es configura posteriorment amb Meta Business: fins aleshores `eventsEnabled=false`, `HORARIA_ALLOW_DELIVERY=0` i `HORARIA_ALLOW_AUTOMATIC=0`. Les crides d’IA provinents d’un webhook sense identitat AiBrain autoritzada fallen explícitament. La recepció Meta requereix `eventActorId` a la configuració privada; cada execució revalida aquesta assignació, l’usuari AiBrain actiu i el responsable general de horarIA. Vegeu [HORARIA_WHATSAPP.md](HORARIA_WHATSAPP.md) per preparar el canvi del webhook i els gates d’acceptació.

`infra/hetzner/app/horaria-backup.sh` crea còpies PostgreSQL en format custom al volum de backups existent, comprova que `pg_restore` en pot llegir el catàleg i desa el SHA256. Cal instal·lar-lo amb un timer diari del host i executar la primera còpia després de la importació. No elimina dades ni còpies existents. La comprovació del catàleg no substitueix un assaig de restauració ni prova per si sola la replicació fora del host.

La proposta Excel d’Arnall utilitza obligatòriament el format del full acabat de `HORARI SAGARO.xlsm`, amb dues files per persona i torn/hores per dia. La plantilla, la separació per botiga i el circuit de revisió i repartiment estan documentats a [HORARIA_EXCEL_TEMPLATE.md](HORARIA_EXCEL_TEMPLATE.md), incloent què està implementat i què encara no és un flux automàtic. Altres instal·lacions conserven la maqueta genèrica de nou columnes. El transport de càlcul usa una connexió HTTP privada amb termini explícit de vint minuts, sense el límit implícit de cinc minuts de les capçaleres de fetch.


## Preparación de onboarding, 2026-09-22

La prueba autenticada de un borrador de S’Agaró agotó los 18 minutos del
cálculo con el modelo conectado y esfuerzo heredado. El cálculo solicita ahora
explícitamente esfuerzo `medium`, conserva el modelo conectado, los límites,
la ausencia de herramientas y la validación determinista posterior. Esto no
certifica que el problema esté resuelto: requiere repetir el borrador real tras
el despliegue y verificar su Excel, conflictos y ausencia de escrituras.
