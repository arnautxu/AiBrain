# Migració d’AiBrain a Hetzner

## Estat preparat

El host Hetzner es comparteix amb BGreenly, però AiBrain queda separat sota `/opt/aibrain`, `/var/lib/aibrain` i `/etc/aibrain`. El contenidor web només publica Next.js a `127.0.0.1:3000`; Nginx serà l’únic punt d’entrada HTTPS. El navegador gràfic també queda limitat a loopback (`6080` per noVNC i `9222` per CDP) i no s’ha d’obrir al firewall.

OpenClaw i el seu helper de bootstrap s’han retirat del runtime BGreenly. La seva còpia de recuperació queda protegida a `/opt/bgreenly/backups/retired-openclaw-20260826T101738Z`. L’API BGreenly i el portal continuen actius.

## Directoris

```text
/opt/aibrain/app/                         checkout o release immutable
/etc/aibrain/aibrain.env                 secrets de runtime, root:aibrain 0640
/var/lib/aibrain/codex/<tenant>/         identitat i estat Codex privat
/var/lib/aibrain/workspaces/<tenant>/    workspaces i projectes
/var/lib/aibrain/control-plane/           fallback local, no Supabase
/var/lib/aibrain/computer/<tenant>/home/  escriptori, descàrregues i perfil Chromium
```

Cap `CODEX_HOME`, perfil de navegador o secret s’ha de muntar en més d’un tenant. El tenant del navegador ha de coincidir amb el tenant resolt server-side per la sessió Supabase.

## Computer use

La base preparada executa un escriptori XFCE complet amb terminal, gestor de fitxers, editor de text i Chromium, sobre una pantalla virtual amb noVNC i CDP dins un contenidor separat. L’usuari i l’agent veuen i controlen la mateixa sessió. El directori personal és persistent per tenant, de manera que es conserven preferències, descàrregues i aplicacions web instal·lades com a PWA.

Les aplicacions del sistema s’incorporen de forma administrada a la imatge. L’usuari del desktop no té accés root ni al socket Docker. En el cas de WhatsApp, l’opció suportada a Linux és WhatsApp Web instal·lat com a PWA des de Chromium; no s’ha d’instal·lar un client no oficial amb accés a la sessió. La implementació segueix tres límits:

1. L’escriptori, el navegador i el directori personal són aïllats per tenant.
2. noVNC i CDP només escolten a loopback; mai s’exposen directament a Internet.
3. Les accions sensibles continuen passant per aprovació humana i el contingut de les pàgines es tracta com a entrada no fiable.

El servei gràfic no usa `no-new-privileges`, perquè aquesta bandera impedeix el helper setuid que implementa el sandbox de Chromium. En lloc d’obrir tot el contenidor, aplica el perfil seccomp recomanat per Playwright, que afegeix únicament els syscalls de namespace necessaris (`clone`, `setns` i `unshare`) al perfil Docker. El procés continua executant-se com a usuari no-root, sense socket Docker ni muntatges del host fora del perfil del tenant. No s’accepta `--no-sandbox` com a alternativa.

Per validar la pantalla abans de tenir domini i gateway autenticat:

```bash
ssh -L 6080:127.0.0.1:6080 bgreenly-hetzner
```

Després es pot obrir `http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale`. Aquest túnel és només una prova privada. Per a usuaris finals, Nginx haurà de fer `auth_request` contra AiBrain, emetre una sessió curta vinculada a tenant i fil, i només llavors fer proxy del WebSocket noVNC. No s’ha de publicar una URL estàtica ni compartir la cookie Supabase amb noVNC.

## Gates pendents abans de trànsit real

1. Assignar un domini propi d’AiBrain i el certificat TLS.
2. Injectar les variables Supabase i el secret de sessió directament a `/etc/aibrain/aibrain.env`; no copiar-les al repositori ni a la imatge.
3. Autenticar Codex de forma independent dins `/var/lib/aibrain/codex/<tenant>`.
4. Afegir el gateway de sessions curtes de computer use i validar que un tenant no pot obrir el navegador d’un altre.
5. Definir quotes de CPU, memòria, disc, temps de sessió i egress per tenant.
6. Configurar backup xifrat extern de `/var/lib/aibrain` i provar una restauració.
7. Validar `ready: true`, `isolated: true`, primer torn, represa, approvals, streaming sense buffering i tancament net.

No s’ha d’apuntar DNS ni activar Production fins que aquests gates passin i hi hagi autorització separada.
