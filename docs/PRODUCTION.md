# Producció d’AiBrain

## Estat actual

La imatge i el runtime estan preparats per aïllar recursos per tenant. El projecte Supabase hosted té quatre migracions aplicades, SMTP i templates actius; el primer owner consentit i els gates live d'auth, rol, logout i revocació estan validats. Les migracions noves d’automatitzacions governades i onboarding encara són pendents de desplegament i validació hosted. La matriu RLS cross-tenant prèvia passa i l'advisor de seguretat és net. Aquest Mac ja funciona com a host persistent privat de validació, amb `CODEX_HOME` i workspace aïllats. **El producte encara no està llest per exposar-se a usuaris externs**: falten quotes pròpies per tenant, backups, rotació operativa i observabilitat de producció.

## Topologia mínima

AiBrain necessita un procés Node persistent. El mateix servei entrega Next.js i manté una sessió Codex App Server per `stdio` per cada combinació tenant/workspace. Els torns del mateix workspace es serialitzen, el catàleg i l'ús es reutilitzen durant 60 segons i el procés es tanca després de 15 minuts d'inactivitat. No utilitzis `/api/chat` com una funció serverless: binari, autenticació Codex, cues i threads necessiten disc i processos persistents.

```text
/var/lib/aibrain/
  codex/<tenant>/          credencials i estat privat de Codex
  control-plane/           overlays de manifest del prototip
/app/runtime/tenants/
  <tenant>/workspace/      workspace aïllat
```

Variables de runtime:

- `AIBRAIN_SESSION_SECRET=<secret fort, injectat al runtime>`
- `AIBRAIN_AUTH_MODE=supabase`
- `AIBRAIN_PUBLIC_URL=https://<domini>`
- `NEXT_PUBLIC_SUPABASE_URL=<project-url>`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable>`
- `SUPABASE_SECRET_KEY=<sb_secret, només servidor>`
- `CONTROL_PLANE_DATA_DIR=/var/lib/aibrain/control-plane` només per al fallback demo local
- `CHAT_RUNTIME=codex`
- `CODEX_BIN=/usr/local/bin/codex`
- `CODEX_HOME_ROOT=/var/lib/aibrain/codex`
- `CODEX_WORKSPACE_ROOT=/app/runtime/tenants`
- `CODEX_APPROVAL_POLICY=on-request`
- `CODEX_SANDBOX=workspace-write`
- `CODEX_MODEL=<opcional>`

`CODEX_HOME_ROOT` i `CONTROL_PLANE_DATA_DIR` han d’estar en un volum privat, persistent, xifrat i no compartit amb el navegador. Cap secret no s’ha d’incorporar a la imatge.

## Gates abans d’obrir trànsit

La preview protegida actual funciona amb auth Supabase real i persistència hosted, però continua sent només el frontend de validació: no allotja Codex App Server ni els volums privats del runtime. Una preview separada pot activar el demo efímer amb `AIBRAIN_ENABLE_PREVIEW_DEMO=1`, però el codi només ho accepta quan Vercel injecta `VERCEL_ENV=preview`; aquesta excepció no pot activar el demo al target de producció.

1. Mantenir els gates hosted de [Supabase](SUPABASE.md) i decidir si cal MFA/SSO abans d'incorporar més usuaris.
2. Convertir l'host privat validat en una topologia de producció monitorada o provisionar-ne un d'equivalent amb volum privat i xifrat.
3. Autenticar la subscripció Codex dins de cada `CODEX_HOME_ROOT/<tenant>` independent, sense copiar credencials al checkout ni a la imatge. Això ja està validat per al tenant de prova d'aquest Mac.
4. Mantenir la cua de concurrència per workspace i afegir quotes pròpies per tenant; la UI ja exposa el límit i l'ús que retorna Codex.
5. Verificar backups, rotació de secrets, logs sense dades sensibles i recuperació.
6. Fer una prova real de separació creuada de sessions, threads, approvals, workspace i credencials.
7. Validar la matriu d’automatitzacions: desactivada, owner, treballador autoritzat, treballador no autoritzat i intent cross-tenant.
8. Aplicar i validar hosted `automation_permissions` i `member_onboarding`, incloent assignació, onboarding completat i bloqueig de permisos per a members.

## Acceptació del runtime

1. L’usuari no autenticat rep `401` a totes les APIs protegides.
2. Un member rep `403` al control plane.
3. Un token de thread d’un altre tenant rep `403`.
4. `/api/runtime/status` retorna el tenant correcte i `isolated: true`.
5. Un segon missatge reprèn el mateix thread mitjançant el token opac.
6. Una aprovació només es resol des del tenant que l’ha originada.
7. El canvi de manifest afecta només el tenant propietari.
8. Un torn real produeix streaming, activitat, diff i interrupció; el procés calent es reutilitza i es tanca per inactivitat sense deixar processos orfes.
