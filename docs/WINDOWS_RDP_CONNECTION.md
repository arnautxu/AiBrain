# Connexió Hetzner → Windows Server

Aquest document descriu el canal RDP d'operació entre el host Hetzner d'AiBrain
i els dos Windows Server del client. És una connexió d'administració acotada;
no és encara un connector de producte disponible als empleats ni una prova que
AiBrain pugui controlar qualsevol escriptori.

## Topologia

El tallafoc del client publica dos ports externs diferents que redirigeixen a
RDP `3389` intern. Només accepta com a origen la IP pública del Hetzner. Els
ports RDP estàndard, SMB i WinRM no s'obren a Internet.

```text
Hetzner (únic origen autoritzat)
  ├─ TCP extern TS ──> Windows Terminal Server:3389
  └─ TCP extern DB ──> Windows Database Server:3389
```

Els host, ports, noms TLS i fingerprints SHA-256 reals viuen exclusivament a
`/etc/aibrain/<installation>/rdp/endpoints.env`. L'usuari, domini i password
viuen a `credentials.env`. Tots dos fitxers, i `policy.json`, són `root:root`,
mode `0600`, regulars, sense symlinks ni hardlinks. Cap password entra a Git,
arguments de procés, logs o captures.

## Política obligatòria: read-only-export

AiBrain pot:

- inventariar unitats i carpetes;
- llegir fitxers autoritzats;
- copiar una font del Windows a una destinació nova del Hetzner.

AiBrain no pot:

- crear, editar, afegir contingut o sobreescriure al Windows;
- esborrar, moure o reanomenar fitxers o carpetes;
- canviar permisos o propietaris;
- executar ordres arbitràries;
- substituir una còpia ja existent al Hetzner.

Cada còpia ha de preservar l'original, escriure només sota el
`copyDestinationRoot` del policy, calcular SHA-256 i registrar ruta font,
destinació, mida i hash. El wrapper falla tancat si el policy permet qualsevol
operació addicional o si la destinació és group/world-writable.

Aquest control al Hetzner limita el camí normal d'AiBrain. Com que el compte
Windows actual pot tenir privilegis més amplis, la garantia de defensa en
profunditat requereix que l'administrador del client creï un compte RDP dedicat
amb ACL de només lectura sobre les carpetes aprovades. Fins llavors no s'ha
d'usar una sessió RDP genèrica com a connector d'empleat.

## Mètode utilitzat i evidència

La validació de 2026-09-01 es va fer des de Hetzner amb FreeRDP 3.30:

1. connexió NLA als dos NAT restringits per origen;
2. validació del CN i del fingerprint SHA-256 de cada servidor;
3. autenticació `auth-only` als dos endpoints;
4. sessió RDP headless temporal per a un inventari de només lectura;
5. PowerShell obert dins de Windows mitjançant automatització de teclat;
6. readback pel portapapers RDP, sense escriure al disc del Windows.

No es va utilitzar l'eina Computer Use d'OpenAI/AiBrain. Es va utilitzar una
sessió RDP gràfica headless controlada des de consola. Un primer intent de
readback va apuntar a una unitat redirigida del Hetzner, no al disc Windows, i
la política del servidor el va rebutjar; el readback final es va fer només pel
portapapers.

## Instal·lació al host

```bash
sudo install -d -m 0700 /etc/aibrain/<installation>/rdp
sudo install -d -m 0750 /var/lib/aibrain/rdp-imports/<company>
sudo install -m 0600 infra/hetzner/rdp.env.example \
  /etc/aibrain/<installation>/rdp/endpoints.env
sudo install -m 0600 infra/hetzner/rdp-policy.example.json \
  /etc/aibrain/<installation>/rdp/policy.json
```

Crear `credentials.env` fora de terminals gravades:

```text
AIBRAIN_RDP_USERNAME=<windows-user>
AIBRAIN_RDP_DOMAIN=<windows-domain>
AIBRAIN_RDP_PASSWORD=<password>
```

Editar els endpoints i el policy amb els valors aprovats. No copiar els valors
reals de tornada al checkout.

## Verificació segura

```bash
sudo infra/hetzner/verify-rdp-connections.sh \
  --config /etc/aibrain/<installation>/rdp/endpoints.env \
  --target all
```

El verificador accepta només `ts`, `db` o `all`, comprova ownership/permisos,
valida el policy exacte, fixa els certificats i utilitza `+auth-only`. Genera
un args file efímer `0600` perquè la contrasenya no aparegui a `ps`, i l'elimina
abans d'emetre el receipt. Èxit esperat:

```text
AIBRAIN_RDP_AUTH_OK target=ts ... policy=read-only-export
AIBRAIN_RDP_AUTH_OK target=db ... policy=read-only-export
```

`AUTH_OK` prova xarxa, identitat TLS i credencials. No prova accés a una carpeta,
no concedeix autorització de negoci i no habilita escriptori arbitrari a AiBrain.

## Accés operatiu des d'Hetzner

<code>infra/hetzner/rdp-access.py</code> ofereix <code>list</code> i <code>copy</code>
per a l'operador del host. Utilitza el RDP existent; no configura VPN, ports,
serveis ni permisos al Windows. Només root pot executar-lo. La configuració i
les credencials es mantenen al host; no es munten al contenidor d'AiBrain ni es
lliuren als empleats.

Un manifest privat <code>access.json</code>, basat en
<code>rdp-access.example.json</code>, fixa l'endpoint, les arrels d'inventari i
lectura, el límit de fitxers (màxim 16 MiB) i el nombre d'entrades retornades.
Es rebutgen traversal, streams alternatius, rutes UNC aportades pel caller,
noms de dispositiu, fitxers sensibles i reparse points. Les rutes font entren
a PowerShell com a dades codificades; la CLI no accepta ordres arbitràries.

Instal·lació del candidat revisat:

    sudo install -d -m 0750 /usr/local/lib/aibrain
    sudo install -m 0750 infra/hetzner/rdp-access.py /usr/local/lib/aibrain/rdp-access.py
    sudo install -m 0600 infra/hetzner/rdp-access.example.json \
      /etc/aibrain/<installation>/rdp/access.json

L'operador ha d'ajustar les arrels del manifest a les carpetes autoritzades
abans d'executar-lo. Exemple amb una ruta fictícia:

    sudo python3 /usr/local/lib/aibrain/rdp-access.py list \
      --path 'Y:\Approved folder' \
      --config /etc/aibrain/<installation>/rdp/endpoints.env \
      --access /etc/aibrain/<installation>/rdp/access.json

<code>copy</code> pren els mateixos arguments amb una ruta de fitxer. Escriu
en una carpeta nova dins de <code>copyDestinationRoot</code>, conserva el nom
original sota <code>files/</code> i crea <code>receipt.json</code> amb origen,
mida, data i SHA-256 verificat al Windows i al Hetzner. No substitueix còpies
anteriors. Els rebuigs queden a <code>failure.json</code>. El fitxer Windows
s'obre només per llegir; la destinació és la unitat redirigida del Hetzner,
oberta amb <code>CreateNew</code>.

La sessió té un límit de 180 segons, un lock per instal·lació, un display X11
amb autenticació pròpia i neteja dels processos i arguments temporals. El text
generat es pega pel portapapers per evitar activacions de tecles especials de
Windows. La còpia de fitxers pel portapapers està desactivada. El nom de la
unitat redirigida és <code>AiBrain</code>, dins del límit de vuit bytes d'RDPDR.

### Còpia verificada el 2026-09-02 a les 08:16 UTC

- Després del canvi de l'administrador Windows, la política retorna
  <code>fDisableCdm=0</code> i la configuració efectiva retorna
  <code>DriveMapping=0</code>, <code>PolicySourceDriveMapping=1</code>.
  La destinació <code>\\tsclient\AiBrain</code> és accessible.
- El valor del listener continua a <code>fDisableCdm=1</code>, però la
  política de grup el deixa sense efecte. L'eina s'ha corregit perquè
  consulti <code>Win32_TSClientSetting</code> i rebutgi una política
  prohibitiva, un resultat efectiu desconegut o una destinació absent,
  sense tractar el valor del listener sobreescrit com un bloqueig vigent.
- S'ha copiat un PDF de 223219 bytes, amb SHA-256 idèntic calculat al
  Windows i comprovat al Hetzner. El receipt privat és a
  <code>20260902T081607Z-714ea0f47838/receipt.json</code> dins del destí
  d'importacions. La font s'ha obert només per llegir.
- SHA-256 de l'eina corregida, instal·lada i utilitzada en aquesta prova:
  <code>c631f54da6b086a0f73aca398e52b07a214f5fa9ff299aa1badbd3dd071d4b45</code>.
  Les vuit proves locals passen. No s'ha desplegat cap canvi de l'aplicació
  ni s'han exposat aquests fitxers als empleats.

### Diagnòstic inicial del 2026-09-02, anterior al canvi de l'administrador

- Eina instal·lada a <code>/usr/local/lib/aibrain/rdp-access.py</code>, amb
  wrapper <code>/usr/local/sbin/arnall-files</code> que fixa els manifests
  privats d'Arnall. SHA-256 del script acceptat al host:
  <code>c5b219a0ab7fcc5a9c0f077640ea88e2274c569b8c8203fffe90ff32378df96e</code>.
- Autenticació TS/DB correcta i inventari real d'una carpeta de negoci
  recuperat al Hetzner, amb cinc entrades i receipt privat.
- Windows retorna <code>fDisableCdm=1</code> tant a la política de Terminal
  Services com a la configuració de <code>RDP-Tcp</code>. La unitat redirigida
  no està disponible.
- <code>copy</code> comprova aquesta restricció abans d'obrir el fitxer font
  i retorna <code>RDP_DRIVE_REDIRECTION_DISABLED</code>. No hi ha acceptació
  de còpia de fitxers.
- Habilitar transferències requereix una decisió autoritzada de
  l'administrador Windows. L'eina no canvia la política ni intenta evitar-la
  amb un altre canal.
- Diagnòstic del mateix dia a les 06:58 UTC: el compte configurat no té el
  SID d'Administrators al token ni un token elevat. Windows denega amb
  <code>SecurityException</code> l'obertura amb dret <code>SetValue</code> de
  les dues claus anteriors; no s'ha escrit cap valor. El compte tampoc té
  accés al resultant de polítiques (RSOP).
- <code>Win32_TSClientSetting</code> retorna <code>DriveMapping=1</code> i
  <code>PolicySourceDriveMapping=1</code>: el bloqueig efectiu prové de
  Group Policy. La denegació de RSOP impedeix determinar si la GPO és local
  o de domini. El receipt de diagnòstic queda privat al directori
  <code>20260902T065859Z-8944cea8a660</code> del destí d'importacions.

### Procediment si torna a quedar bloquejada la còpia

El bloqueig inicial es va resoldre amb la intervenció de l'administrador.
Si reapareix, cal que l'administrador revisi la política efectiva del TS;
el compte de lectura disponible no té permisos per modificar-la.

1. Amb un compte administrador autoritzat, identificar la GPO guanyadora mitjançant RSOP o
   <code>gpresult</code> i conservar els valors actuals abans del canvi.
2. Configurar <code>Do not allow drive redirection</code> com a
   <code>Disabled</code> a la política aplicable al TS, sota
   <code>Computer Configuration / Administrative Templates / Windows
   Components / Remote Desktop Services / Remote Desktop Session Host /
   Device and Resource Redirection</code>. Limitar el canvi al servidor
   necessari: és una política d'equip i pot afectar altres sessions del TS.
3. Revisar també la configuració <code>RDP-Tcp</code>, sense substituir
   manualment un valor imposat per GPO. Aplicar la política i coordinar
   qualsevol reinici necessari amb l'operador del TS.
4. Obrir una nova connexió des de Hetzner, comprovar la unitat
   <code>\\tsclient\AiBrain</code> i executar una única còpia de prova amb
   <code>arnall-files copy</code>. Només donar-la per acceptada quan el
   SHA-256 i la mida coincideixin al Windows i al Hetzner.

Referència: [configuració oficial de redirecció d'unitats de Microsoft](https://learn.microsoft.com/en-us/azure/virtual-desktop/redirection-configure-drives-storage).

L'accés d'operador i els seus receipts no s'exposen al xat. La sincronització
i la publicació de text dins dels scopes empresarials estan descrites a
[WINDOWS_DOCUMENT_SYNC.md](WINDOWS_DOCUMENT_SYNC.md), amb l'acceptació real
del xat i la regressió posterior de la política Windows. Les ACL de només
lectura del compte Windows encara requereixen verificació independent.

Prova local de les fronteres:

    python3 -m unittest discover -s tests/infra -p 'test_rdp_access.py' -v
