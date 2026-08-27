# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AiBrain està pensat per empreses d’1 a 20 treballadors o més. El flux principal
és per a persones que no necessiten conèixer prompts, models, terminal o Git;
els owners governen identitat, context, permisos i accions sensibles.

## Product Purpose

AiBrain converteix Codex en un entorn de treball guiat. L’usuari descriu la
feina, aporta els documents necessaris i rep un resultat traçable que pot
revisar, aprovar, descarregar, publicar o recuperar.

## Positioning

Codex és el motor agentic. AiBrain és la capa white-label que controla
l’experiència, la sessió, els projectes, els permisos, la memòria explícita, els
documents, les approvals i Browser/Computer Use. Una nova empresa canvia
configuració i infraestructura, no el codi.

## Operating Context

- Una instal·lació i servidor dedicats per empresa en producció.
- Un worker calent i espais privats per empleat.
- Projectes, threads, turns, resultats i memòria persistents en filesystem.
- Ús des de navegador d’escriptori i mòbil.
- Backpressure tècnic sense quotes comercials artificials.

## Capabilities and Constraints

- Supabase és exclusivament el proveïdor d’Auth; no emmagatzema dades de
  producte.
- Codex App Server s’executa al worker persistent de cada empleat i només es
  connecta amb Next.js per transport privat autenticat.
- `PERMISSIONS.md` es resol server-side i cada turn conserva el fingerprint.
- Office, PDF, text i imatges passen per staging i preview aïllats.
- Codex no pot escriure al repositori documental oficial; el publicador exigeix
  confirmació explícita, hash, control de conflicte, versió i auditoria.
- Browser/Computer Use separa perfil, targets, descàrregues, viewer i takeover
  per usuari/thread.
- Les respostes completades es poden convertir en visualitzacions tipades o
  llocs interns sanejats. Cada versió és immutable; la publicació continua
  exigint sessió d’empresa i no promet domini ni hosting públic.
- App nativa, veu i vídeo són fora de V1. Les automatitzacions programades s'ofereixen només mitjançant el worker local explícit, sense promesa d'execució cloud.

## Brand Commitments

La veu és clara, directa, tranquil·la i no tècnica. Les accions expliquen què
passarà i els errors indiquen com recuperar-se. Identitat, domini, assets i
accent provenen de `InstallationConfig`.

## Product Principles

- La UI no fabrica respostes ni estats de Codex.
- Una acció sensible mostra què farà i espera aprovació explícita.
- Els resultats són visibles, reutilitzables, recuperables i auditables.
- Els permisos i límits de filesystem es validen al servidor.
- La complexitat tècnica queda disponible per a l’operador sense interrompre el
  treballador.

## Accessibility & Inclusion

La interfície ha de funcionar amb teclat, tenir labels accessibles, contrast
suficient i copy entenedor. Els fluxos no pressuposen coneixement d’IA o
desenvolupament.

## External Gates

La implementació local no demostra per si sola login real Codex/Supabase,
DNS/TLS, NAS, backup offsite, alertes, deploy, reboot o rollback al servidor QA.
Aquests gates s’executen amb credencials i autoritzacions separades.
