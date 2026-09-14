# Recepció de WhatsApp a horarIA

Estat del candidat: implementat i verificat localment. Aquest document no prova
publicació, desplegament, canvi a Meta ni recepció real. La configuració de
credencials és independent de l’activació del canal.

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
sense missatges es validen i es confirmen sense iniciar IA; aquest canvi no
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
