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

Cada còpia futura ha de preservar l'original, escriure només sota el
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
