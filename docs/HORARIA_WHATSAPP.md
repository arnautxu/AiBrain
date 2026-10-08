# Recepció de WhatsApp a horarIA

Estat del candidat: implementat i verificat localment. Aquest document no prova
publicació, desplegament, canvi a Meta ni recepció real. La configuració de
credencials és independent de l’activació del canal.

## Diagnòstic per botiga i recordatoris amb termini relatiu

`workflow.readiness` consulta `GET /api/integration/readiness` amb
`establecimiento` obligatori. Aplica la mateixa identitat signada i permisos
de botiga que la resta del servei. Retorna bloquejos separats de recollida,
automatització i PDF, persones sense telèfon, responsable assignat i la
finestra activa o següent a Europe/Madrid. No retorna números de telèfon,
no activa ajustos, no envia missatges i no modifica dades.

`configurationReady` només acredita configuració comprovada en aquella
consulta. Els rebuts d’enviament i la resposta real continuen pendents de
comprovació específica. La consulta identifica que repartir l’Excel corregit
requereix un fitxer retornat i revisat. Vegeu
`HORARIA_EXCEL_TEMPLATE.md`, apartat «Revisió i repartiment».

La plantilla real de recordatori pot dir «El termini finalitza demà».
El servei detecta aquesta expressió en el catàleg de Meta i només envia
la plantilla quan el termini cau l’endemà segons el calendari de Madrid,
també durant els canvis d’hora. En cas contrari retorna
`saltats[].motiu = termini_no_es_dema`, sense enviar ni marcar recordatori.
Les plantilles que només indiquen data i hora conserven el comportament
anterior. L’avís opcional a la responsable mostra el termini real, sense
fixar-lo a dimecres. Es renova la revisió del catàleg d’eines perquè els
xats existents puguin consultar el nou diagnòstic.

### Acceptació limitada, 2026-10-08

Sobre la revisió desplegada `7789a4b72fbd0572e5d18b5d00aefdde3c57d1eb`,
Meta retorna APPROVED per a `solicitud_preferencies:ca`,
`recordatori_broadcast:ca` i `enviament_horari_pdf_document:ca`.
L’última conserva capçalera DOCUMENT i tres variables de cos, i les tres
coincideixen amb les vinculacions del servei. L’usuari confirma que el PDF
amb document funciona; aquesta sessió no ha fet un nou enviament de PDF.

Amb autorització explícita de l’usuari s’ha enviat un sol recordatori al
contacte de prova seleccionat (employeeId 123, Girona), sense reiniciar
la conversa ni contactar altres persones. El proveïdor l’ha acceptat a
les 10:34:43 UTC. L’usuari ha confirmat la recepció i resposta; la lectura
del servidor acredita entrada a les 10:35:10, preferència activa de la
setmana 2026-W42 desada a les 10:35:21 amb `MIERCOLES: TARDE`, i resposta
de confirmació a les 10:35:22. La conversa queda COMPLETADO. Aquesta prova
afecta el registre de prova, no acredita un desplegament dels canvis nous.

L’usuari ha indicat que Arnall configurarà els contactes i responsables
reals. En la lectura d’aquesta sessió faltava responsable a S’Agaró i Torre
Valentina i telèfon de la responsable de Palamós; hi havia també telèfons
de treballadors pendents. L’automatisme global i el de totes les botigues
continuaven apagats. No s’han modificat aquests ajustos ni destinatàries.
La finestra configurada és dimarts 09:00 a dijous 13:00, Europe/Madrid;
Arnall ha de validar-la abans d’activar cada botiga. El termini de la
conversa de prova era divendres 09/10 a les 13:00 perquè una petició manual
fora del marge habitual concedeix almenys 24 hores.

Les proves locals inclouen el rebuig de consultes a botigues alienes,
bloquejos de preparació i zero enviaments/escriptures quan «demà» seria
incorrecte. El circuit de retorn d’Excel té proves específiques de conservació
exacta, aïllament, destinatari i no repetició.
Backend CI, publicació GHCR, desplegament i acceptació del nou candidat
s’han de comprovar separadament; aquesta prova en viu correspon només a
la revisió desplegada indicada a dalt.

## Excel corregit retornat al xat

La generació i preview d’Arnall registren l’Excel original en el volum privat
d’horarIA, a través d’un endpoint intern que no s’exposa al catàleg del model.
El worker comprova el hash del rebut documental abans de registrar-lo.
El resultat del draft inclou `reviewSourceId`, conservat en el rebut durable
del torn. Les propostes antigues sense aquest rebut no s’importen silenciosament
ni es regeneren per simular una revisió.

L’usuari adjunta la versió corregida al mateix entorn privat d’AiBrain i
executa `schedules.review-upload` amb la botiga i `sourceId` originals.
La validació compara els torns i les dues línies d’hores amb l’original.
Es conserven tots dos fitxers byte per byte, amb hashes diferents si hi ha
canvis. No s’escriuen torns a la base de dades ni es recalcula el planificador.
El retorn mostra cel·la, persona, valor anterior i nou, destinatari, hash del
fitxer i `previewHash` que vincula aquella versió amb aquell telèfon.

La destinatària habitual es resol des de la configuració de responsable
de la botiga. Una responsable general pot indicar explícitament un altre
`recipientEmployeeId` actiu de la mateixa botiga, incloent una prova limitada;
els noms o números escrits al llibre no trien el receptor. Si falta contacte,
el fitxer corregit es conserva i la resposta mostra el bloqueig, sense enviar.

Després de revisar, `schedules.reviewed-send` utilitza la confirmació existent
del xat. El servei torna a validar identitat, botiga, versió i destinatari.
Puja els bytes exactes a Meta i envia un document XLSX, sense usar la plantilla
PDF. Requereix una entrada de WhatsApp del destinatari durant les darreres
24 hores; si falta, cal que aquest respongui abans. No es contacta una altra
persona ni es converteix el fitxer a PDF per superar aquest bloqueig.

El rebut distingeix `reviewed`, `sending`, `accepted` i `uncertain`.
`accepted` significa que Meta ha retornat un identificador de missatge,
no recepció al dispositiu. Es desa l’intent abans de contactar el proveïdor;
si el procés cau o el resultat és incert, un reinici o repetició no reenvia.
`schedules.reviewed-status` recupera el resultat. Un operador ha de resoldre
els enviaments incerts amb evidència de Meta abans de plantejar-ne un altre.

Els fitxers `review-source-*.json` i `reviewed-*.json` formen part del volum
privat d’estat i les seves còpies de seguretat. Contenen els originals i
rebuts; no són una memòria cau per purgar després d’enviar. L’accés exigeix
la mateixa instal·lació, usuari i botiga que va crear l’original, i permisos
vigents. Cap URL pública del llibre ni credencial de Meta entra al xat.

## Frontera d’execució

Meta envia els missatges a `/api/horaria-events/webhook`. AiBrain només els
reenvia quan `eventsEnabled=true` i existeix `eventActorId`, resolt des de
`<dataRoot>/horaria/integration.json`, amb permisos 0600. L’actor ha d’existir a
`users`; les dades de WhatsApp no poden triar-lo ni canviar l’employeeId.

El servei comprova la signatura sobre els bytes originals, el WABA de cada
entrada i el Phone Number ID de cada canvi. Per a Meta són obligatoris
`META_APP_SECRET`, `WHATSAPP_BUSINESS_ACCOUNT_ID` i `WHATSAPP_PHONE_NUMBER_ID`.
La ruta GET comprova `WHATSAPP_VERIFY_TOKEN` i retorna el challenge de Meta.

Cada missatge es desa abans de retornar HTTP 200. La bústia privada
`HORARIA_STATE_ROOT/whatsapp-inbox` utilitza un rebut pel hash del message ID,
fitxers 0600 i directori 0700. Processa tots els missatges del lot en ordre de
recepció, serialitzats amb les escriptures interactives. Els avisos d’estat
sense missatges es validen i es confirmen sense iniciar IA. Els altres avisos de compte/plantilla del mateix WABA es confirmen
sense efectes ni lectura de contingut com a missatge; aquest canvi no
implementa un historial d’estats d’entrega.

Abans d’efectes, el servei revalida el responsable general actiu i fa una
consulta interna signada a AiBrain amb `source=whatsapp` i
`authorizationOnly=true`. AiBrain torna a comprovar `eventsEnabled`,
`eventActorId`, l’assignació employeeId, l’usuari actiu i el rol actual del
responsable. Aquesta consulta no inicia cap model. La comprovació es repeteix
un cop adquirit el torn d’escriptura, per no reutilitzar una autorització que
hagi quedat antiga mentre s’esperava. Les crides posteriors a Codex mantenen
`source=whatsapp` i les fronteres existents de tasques sense eines.

La identitat del remitent es continua resolent pel seu telèfon a horarIA i
manté les comprovacions originals de responsable/treballador. L’actor
configurat és qui autoritza l’execució d’AiBrain, no substitueix el remitent.

## Persistència i incidències

- `queued`: rebut desat, pendent; es reprèn després d’arrencar el servei HTTP.
- `processing`: l’execució ha començat. Si el procés s’interromp, passa a
  `uncertain` a l’arrencada; no es torna a executar automàticament.
- `completed`: el gestor ha acabat; s’elimina el contingut del rebut i es
  conserva la deduplicació. No és per si sol prova d’entrega d’una resposta:
  alguns errors de negoci/proveïdor són gestionats pel motor original.
- `blocked`: la revalidació prèvia ha fallat, inclosa una indisponibilitat del
  callback. Es conserva el missatge per revisió de l’operador.
- `uncertain`: el gestor ha fallat o s’ha interromput després de començar.
  Comprovar les dades de negoci i el proveïdor abans de qualsevol reintent.

El GET intern `/api/integration/whatsapp-inbox` exigeix una signatura d’usuari
responsable general i retorna només recomptes. Els errors operatius no
inclouen el text dels missatges. Cal incloure la bústia a les còpies del volum.
El límit és de 10.000 rebuts: a partir d’aquí es rebutgen nous IDs amb 503,
sense eliminar rebuts ni repetir efectes. L’operador ha de supervisar capacitat,
`blocked` i `uncertain`; aquest candidat no afegeix purga ni reintent automàtic.
No hi ha garantia transaccional exactly-once entre base de dades i Meta.

## Activació d’una instal·lació

1. Verificar que les credencials del servidor corresponen a l’app, WABA i
   número previstos. Conservar còpia privada de l’entorn i del webhook actual.
2. Publicar i desplegar el candidat pel circuit Backend CI → GHCR → Deploy
   autoritzat. Registrar SHA/digests i verificar salut i usuari autenticat.
3. Configurar `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_TOKEN`, `META_APP_SECRET` i `WHATSAPP_VERIFY_TOKEN` al servei privat.
   La URL pública continua sent l’origen d’AiBrain. L’API Meta usa v23.0.
4. Assignar `eventActorId` a l’usuari AiBrain autoritzat, vinculat a un
   responsable general actiu. Només després de l’autorització d’activació,
   establir `HORARIA_ALLOW_DELIVERY=1` i `eventsEnabled=true`.
   `HORARIA_ALLOW_AUTOMATIC=0` es manté fins a una autorització separada.
5. Abans de canviar Meta: validar GET amb challenge, rebuig de token incorrecte,
   POST sense signatura, POST signat per a un altre número/WABA i un avís
   sintètic d’estat sense destinatari ni missatge. No enviar dades d’un
   treballador real en una simulació.
6. Quan els checks públics passin, canviar el callback a Meta i subscriure el
   camp `messages` i l’app al WABA. Preservar els valors previs per al retorn.
7. Fer recepció i resposta reals amb un destinatari de prova autoritzat.
   Comprovar el rebut, resultat de negoci i entrega. Una prova sintètica no
   substitueix aquesta acceptació. No donar per activades notes de veu sense
   la connexió de transcripció.

Si cal aturar el canal: restituir el callback anterior de Meta, desactivar
`eventsEnabled` i `HORARIA_ALLOW_DELIVERY` i reiniciar el servei pel circuit
operatiu. Preservar bústia/base/volums. Revisar els rebuts incerts abans de
reprendre; no eliminar-los per forçar un reintent.

## Arnall: dades contrastades el 2026-09-14

- App: `1701718814436098`; WABA: `1753534135960275`;
  Phone Number ID: `1252255684639221`.
- El webhook comunicat és `https://shiftai.onrender.com/api/whatsapp/webhook`.
  El destí previst és `https://arnall.graphikai.com/api/horaria-events/webhook`.
- Meta ha acceptat lectures amb token i prova HMAC de l’App Secret des del
  servidor d’Arnall. Això prova credencials/lectura, no enviament ni recepció.
- Plantilles retornades per Meta: `solicitud_preferencies` (`ca`, tres variables),
  `recordatori_broadcast` (`en`, dues variables) i `hello_world` (`en_US`).
  Totes estan aprovades. `recordatori_broadcast` és un recordatori al responsable
  per iniciar la ronda (no un recordatori al treballador), i el seu text encara
  indica que cal usar la pestanya WhatsApp de ShiftAI. Cal revisar aquesta còpia
  abans de configurar-la a AiBrain. No s’ha trobat cap plantilla amb capçalera DOCUMENT
  per enviar horaris fora de la finestra de conversa; no reutilitzar una
  plantilla només perquè coincideixi el nombre de variables.
- Credencials configurades al servei amb la revisió anterior
  `19865a09e1152ea5ad2242fb21bd84123c6fdfa1`, enviaments i recepció desactivats.
  El secret i el token no es guarden en aquest document ni en Git.

## Proves locals

`npm test --prefix modules/horaria/backend`, `npm exec -- vitest run src/horaria`,
`npm run typecheck`, `npm run lint`, `npm run build` i
`npm run build:automation-worker`. Els tests nous proven lots HTTP signats,
WABA/número aliens, cos alterat, actor no resolt, deduplicació després de
reinici, ordre, revocació, estat corrupte, límit de capacitat i interrupció
sense reexecució. Tots els proveïdors i efectes de negoci dels tests són locals
amb substituts explícits; no s’envien WhatsApps reals.

## Converses iniciades pel treballador

Un remitent associat a un treballador actiu pot iniciar una conversa sense
broadcast previ. El primer text queda desat a `whatsapp_messages` i és visible
amb la consulta de conversa existent d’AiBrain. Els números desconeguts o
inactius no creen converses ni obtenen accés a l’historial.

La conversa nova utilitza la finestra activa o la següent de la configuració
del servidor, amb `fechaApertura` i `fechaLimite` exactes. Abans de l’obertura
es registra el text i s’envia l’avís de dates, sense recollir preferències.
El model exclou de l’historial de recollida els missatges previs a l’obertura.
Dins de la finestra, una salutació inicia el diàleg i una petició concreta
continua pel motor habitual, amb les mateixes validacions. Una conversa
iniciada així es renova en el següent cicle conservant els missatges anteriors;
els bloquejos del mateix cicle es mantenen. Les rondes iniciades manualment
conserven el seu termini i comportament anteriors.

La migració afegeix una columna nullable; no reescriu ni elimina registres.
Els errors del proveïdor preserven l’entrada i es propaguen al rebut durable.
Una resposta desada acredita l’acceptació de l’enviament pel proveïdor, no
l’entrega al dispositiu. No s’activen broadcasts, recordatoris ni automatismes.
La publicació requereix els gates habituals i una nova prova real d’entrada,
lectura autenticada al xat i resposta al telèfon sobre la revisió desplegada.
