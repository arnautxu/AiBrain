# Paritat UX amb Codex

## Veredicte actual

AiBrain ja té el shell visual, el contracte agentic i les dues primeres capes de paritat: organització durable i command center. Projectes, workspace principal, fils, cerca global, rename, pin, archive, represa privada de Codex, command palette i Review conviuen dins del mateix flux. Ja no és una llista local de converses; el model hosted viu a Supabase i la preview protegida utilitza auth i persistència reals.

La preview de Vercel valida la UX i l'auth Supabase real, però no executa Codex. El runtime real ja funciona en aquest Mac sobre un host Node persistent amb workspace i `CODEX_HOME` privats; Vercel continua sent només la superfície de preview.

## Referència funcional

La documentació oficial actual agrupa xats, fitxers, instruccions i fonts dins de projectes; també descriu projectes locals connectats a carpetes, múltiples xats per projecte, pin, rename, search, archive, worktrees, review pane, adjunts, plugins i memòria:

- https://learn.chatgpt.com/docs/projects
- https://learn.chatgpt.com/docs/features
- https://learn.chatgpt.com/docs/reference/settings

No cal copiar cada detall visual. Sí que cal reproduir aquesta jerarquia d’informació i fer-la configurable per manifest.

## Matriu de gap

| Superfície | Estat AiBrain | Falta principal |
|---|---|---|
| Projectes | Implementat | Importació de repositoris i configuració avançada per projecte |
| Carpetes i workspaces | Primari persistent | Carpetes secundàries, provisioning remot i estat de sincronització |
| Fils | Implementat | Paginació i col·laboració multiusuari en temps real |
| Represa Codex | Implementat i actiu a l'host privat | Validar separació cross-tenant i recuperació després d'un reinici |
| Plans, activitat i streaming | Implementat | Poliment i estats de recuperació |
| Aprovacions i diffs | Review per torn implementat | Historial agregat entre torns i accions Git sobre els canvis |
| Composer | Modes, model, esforç, web, skills i imatges implementats | Personalitat, fitxers no visuals, àudio i preferències persistents per projecte |
| Worktrees i Git | No implementat | Branch/worktree, estat Git, PR i accions sobre repositori primari |
| Terminal i fitxers | No implementat | Finestres registrables de terminal, arbre de fitxers i preview d’artefactes |
| Cerca i command palette | Implementat | Més accions contextuals i preferències de dreceres |
| Plugins, skills i fonts | Contracte extensible | Catàleg, activació per tenant/projecte i estat d’execució visible |
| Automatitzacions | Catàleg segur, activació per tenant i permisos per treballador | Programació recurrent, historial durable i notificacions |
| Configuració visual | Parcial | Tema complet, tipografia, dreceres, notificacions i preferències per usuari |
| Auth, tenants i rols | Hosted + RLS + SMTP + owner live validats | MFA/SSO només si el perfil dels usuaris ho requereix |

## Milestone completat: Projects + durable threads

Aquest tall vertical ja està implementat i desplegat a la base hosted. El navegador només rep IDs d’AiBrain; paths, claus administratives i tokens de represa continuen server-side.

### Model

- `projects`: tenant, nom, slug, estat, manifest opcional i timestamps.
- `project_workspaces`: projecte, tipus d’host, path opac/validat, carpeta primària i estat.
- `threads`: projecte, autor, títol, token Codex opac, pinned, archived i timestamps.
- El navegador només rep IDs d’AiBrain. Els paths reals i IDs crus de Codex continuen server-side.

### UX d’acceptació

1. La sidebar mostra més d’un projecte i permet crear-ne o seleccionar-ne un.
2. Cada projecte mostra els seus fils i conserva l’última selecció.
3. Un fil es pot crear, reprendre, reanomenar, fixar, cercar i arxivar.
4. Recarregar o entrar des d’un altre navegador no perd els fils en mode Supabase.
5. Canviar de projecte canvia manifest, workspace i namespace del runtime sense fuites cross-tenant.
6. La preview Vercel persisteix projectes a Supabase; l'host persistent encara ha de validar la represa real amb Codex.

## Milestone completat: command center + Review

- Sidebar col·lapsable amb jerarquia projecte → workspace → fils i drawer mòbil.
- Cerca global de projectes i fils amb command palette, navegació per teclat i `⌘K`.
- Dreceres reals per crear fil (`⌘N`) i projecte (`⌘⇧P`).
- Top bar mínima amb breadcrumb, estat del runtime i accés a Review, Runtime i personalització.
- Review separat de la conversa amb fitxers, comptadors, diff línia a línia, còpia i pestanya d’activitat.
- Composer persistent amb projecte, runtime i dreceres visibles.
- Review a pantalla completa en mòbil i shell sense overflow a 390×844.

## Milestone completat: composer agentic

- Modes Agent, Pla i Pregunta: Agent conserva el sandbox configurat; Pla i Pregunta imposen només lectura al servidor.
- Selector de model alimentat per `model/list`; el servidor torna a validar que el model continuï disponible abans del torn.
- Selector de profunditat alimentat pels esforços compatibles de cada model. `Ràpid` usa esforç baix per defecte i cada torn es torna a validar al servidor.
- Cerca web condicionada per les capacitats del provider i aplicada com a configuració real del thread.
- Selector de skills alimentat per `skills/list`; el navegador només rep nom i descripció, mai el path intern.
- Fins a 3 imatges PNG, JPEG, WebP o GIF per torn, amb límit de 2 MB cadascuna i entrada `image` nativa a Codex.
- El manifest del tenant pot activar o desactivar modes, model, web, skills i imatges.
- La migració `20260825210000_composer_attachments.sql` persisteix la metadada dels adjunts, no el contingut base64.

## Milestone completat: host Codex privat i rendiment

- Servei Node persistent a aquest Mac, accessible només per la xarxa privada configurada.
- Un Codex App Server calent per tenant/workspace, amb cua de torns i tancament després de 15 minuts d'inactivitat.
- Catàleg de models, skills, capacitats, límits i ús reutilitzat durant 60 segons.
- Runtime panel amb estat del procés, consum de la finestra i tokens acumulats quan el compte els retorna.
- Activitat de cada torn amb temps fins al primer text i temps total per distingir latència del runtime i del model.

## Milestone implementat: automatitzacions governades

- Apartat d’Automatitzacions amb accions guiades i resultats en llenguatge natural.
- L’owner activa cada automatització per al tenant des del Control plane.
- L’owner decideix individualment quins treballadors poden executar-la.
- L’API filtra el catàleg i torna a validar el permís abans de cada execució.
- RLS, grants explícits i auditoria atòmica protegeixen configuració i permisos.
- Les automatitzacions continuen sent executors registrats al servidor; el navegador no pot enviar ordres arbitràries.

## Milestone implementat: experiència guiada per a treballadors

- La pantalla inicial pregunta “Què vols aconseguir?” i ofereix Analitza, Crea, Millora, Resumeix i Compara.
- Cada acció obre un formulari curt i envia a Codex el context complet sense exposar el prompt tècnic a la conversa.
- Cada projecte ofereix plantilles ràpides per a informes, resums de reunió i comparacions.
- Els resultats acabats es poden aprovar visualment, copiar, descarregar com a text o convertir en una nova versió sense perdre l’original.
- Després de cada resultat apareixen seguiments entenedors i, quan hi ha canvis, una acció explícita per demanar que es desfacin.
- Les aprovacions expliquen la decisió en llenguatge natural; ordres i paths queden plegats com a detall administratiu.
- Els members no veuen Runtime, model, profunditat ni skills al flux principal; els owners conserven els controls avançats.
- L’onboarding de member presenta rol, responsabilitats, preferències i una primera missió preparada per l’admin.

## Següent tall vertical

1. Artefactes no visuals amb preview, versions aprovades i historial durable de recuperació.
2. Plantilles administrables i específiques per negoci, rol i projecte.
3. Programació recurrent, historial durable i notificacions per a automatitzacions aprovades.
4. Steering d'un torn en curs, fork de fils i Review natiu de Codex.
5. Arbre de fitxers, Git i terminal només com a finestres avançades activables per l’owner, no com a navegació principal.
6. Personalitat, àudio, catàleg de plugins i preferències de dreceres.
7. Quotes pròpies, backups, rotació i prova cross-tenant abans de considerar l'host apte per a producció.
