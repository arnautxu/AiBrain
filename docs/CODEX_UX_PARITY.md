# Paritat UX amb Codex

## Veredicte actual

AiBrain ja té el shell visual, el contracte agentic i les dues primeres capes de paritat: organització durable i command center. Projectes, workspace principal, fils, cerca global, rename, pin, archive, represa privada de Codex, command palette i Review conviuen dins del mateix flux. Ja no és una llista local de converses; el model de producció viu a Supabase i la preview simula el mateix contracte al navegador.

La preview de Vercel és una demo efímera de la UX. El runtime Codex real necessita l’host persistent i no s’executa dins Vercel.

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
| Represa Codex | Implementat server-side | Validar-la de punta a punta sobre l’host Codex persistent de producció |
| Plans, activitat i streaming | Implementat | Poliment i estats de recuperació |
| Aprovacions i diffs | Review per torn implementat | Historial agregat entre torns i accions Git sobre els canvis |
| Composer | Modes, model, web, skills i imatges implementats | Fitxers no visuals, àudio i preferències persistents per projecte |
| Worktrees i Git | No implementat | Branch/worktree, estat Git, PR i accions sobre repositori primari |
| Terminal i fitxers | No implementat | Finestres registrables de terminal, arbre de fitxers i preview d’artefactes |
| Cerca i command palette | Implementat | Més accions contextuals i preferències de dreceres |
| Plugins, skills i fonts | Contracte extensible | Catàleg, activació per tenant/projecte i estat d’execució visible |
| Configuració visual | Parcial | Tema complet, tipografia, dreceres, notificacions i preferències per usuari |
| Auth, tenants i rols | Hosted + RLS validada | Bootstrap del primer owner, SMTP i sessió real per correu |

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
6. La preview Vercel pot simular projectes; l’host persistent valida la represa real amb Codex.

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
- Cerca web condicionada per les capacitats del provider i aplicada com a configuració real del thread.
- Selector de skills alimentat per `skills/list`; el navegador només rep nom i descripció, mai el path intern.
- Fins a 3 imatges PNG, JPEG, WebP o GIF per torn, amb límit de 2 MB cadascuna i entrada `image` nativa a Codex.
- El manifest del tenant pot activar o desactivar modes, model, web, skills i imatges.
- La migració `20260825210000_composer_attachments.sql` persisteix la metadada dels adjunts, no el contingut base64.

## Següent tall vertical

1. Aplicar la migració d’adjunts hosted abans de desplegar aquest tall sobre auth Supabase.
2. Arbre de fitxers, terminal i previews d’artefactes com a finestres registrables.
3. Git, worktrees, historial de Review i PR vinculats al projecte.
4. Catàleg de plugins, preferències de dreceres i configuració avançada.
