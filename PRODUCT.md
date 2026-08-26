# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AiBrain està pensat principalment per a treballadors que no necessiten conèixer IA, prompts, models, terminal ni Git. Els owners administren el tenant, conviden persones, defineixen el seu context de feina i governen les automatitzacions disponibles.

## Product Purpose

AiBrain converteix Codex en un entorn de treball guiat. L’usuari tria una acció comprensible, aporta només la informació necessària i rep un resultat verificable que pot revisar, aprovar, descarregar o recuperar.

## Positioning

Codex continua sent el motor agentic, però AiBrain controla l’experiència, la identitat, els permisos, els projectes, les aprovacions i les automatitzacions. La complexitat tècnica queda sota la superfície i només apareix en espais administratius o avançats.

## Operating Context

- Organització multi-tenant amb owners i members.
- Projectes, workspaces, fils, missatges, resultats i automatitzacions.
- Ús des de navegador d’escriptori i mòbil.
- Els treballadors poden tenir responsabilitats, una primera missió i preferències pròpies definides durant l’onboarding.

## Capabilities and Constraints

- Auth i persistència hosted amb Supabase; RLS és una segona frontera d’autorització.
- Codex App Server s’executa en un host Node persistent amb `CODEX_HOME` i workspace aïllats.
- Vercel Preview valida UX i auth, però no és l’host persistent de Codex.
- Les automatitzacions són executors registrats al servidor i governats per l’owner; el navegador no envia ordres arbitràries.
- Terminal, Git i detalls de runtime no formen part del flux principal d’un treballador.
- Producció externa continua pendent de quotes, backups, rotació i validació cross-tenant.

## Brand Commitments

El producte es diu AiBrain. La veu és clara, directa, tranquil·la i no tècnica. Les accions expliquen què passarà i els errors indiquen com recuperar-se.

## Evidence on Hand

- Workbench funcional amb projectes, fils, streaming, plans, activitat, diffs i approvals.
- Auth Supabase invite-only, SMTP i gates de rol validats.
- Host privat d’aquest Mac amb Codex real i sessió persistent validada.
- No hi ha testimonis, mètriques comercials ni claims públics aprovats; no se n’han d’inventar.

## Product Principles

- L’usuari descriu la feina; AiBrain tradueix la intenció a Codex.
- Una acció important sempre mostra què farà abans d’executar-se.
- Els resultats han de ser visibles, reutilitzables i recuperables.
- Els permisos es validen al servidor, no només a la interfície.
- La complexitat tècnica queda disponible per a l’admin, però no interromp el treballador.

## Accessibility & Inclusion

La interfície ha de funcionar amb teclat, tenir labels accessibles, contrast suficient i copy entenedor en català. Els fluxos no poden pressuposar coneixement d’IA o desenvolupament.
