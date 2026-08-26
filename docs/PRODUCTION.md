# Producció d’AiBrain

## Estat actual

La imatge i el runtime estan preparats per aïllar recursos per tenant. El projecte Supabase hosted ja està provisionat, les migracions i la matriu RLS cross-tenant passen i l’advisor de seguretat és net. **El producte encara no està llest per exposar-se a usuaris externs**: falten el bootstrap consentit del primer owner, SMTP propi, l’host Codex persistent, quotes, backups i rotació operativa.

## Topologia mínima

AiBrain necessita un procés Node persistent. El mateix servei entrega Next.js i inicia Codex App Server per `stdio` per cada torn. No utilitzis `/api/chat` com una funció serverless: binari, autenticació Codex i threads necessiten disc i processos persistents.

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

Una preview visual pot activar el demo efímer amb `AIBRAIN_ENABLE_PREVIEW_DEMO=1`, però el codi només ho accepta quan Vercel injecta `VERCEL_ENV=preview`. Aquesta excepció no substitueix cap dels gates següents ni pot activar el demo al target de producció.

1. Completar [el bootstrap Supabase](SUPABASE.md), configurar SMTP/templates i validar una sessió i invitació reals per correu.
2. Decidir i activar MFA/SSO si el perfil dels usuaris ho requereix.
3. Provisionar i autenticar un `CODEX_HOME_ROOT/<tenant>` independent.
4. Aplicar rate limits, límits de concurrència i quotes per tenant.
5. Verificar backups, rotació de secrets, logs sense dades sensibles i recuperació.
6. Fer una prova real de separació creuada de sessions, threads, approvals, workspace i credencials.

## Acceptació del runtime

1. L’usuari no autenticat rep `401` a totes les APIs protegides.
2. Un member rep `403` al control plane.
3. Un token de thread d’un altre tenant rep `403`.
4. `/api/runtime/status` retorna el tenant correcte i `isolated: true`.
5. Un segon missatge reprèn el mateix thread mitjançant el token opac.
6. Una aprovació només es resol des del tenant que l’ha originada.
7. El canvi de manifest afecta només el tenant propietari.
8. Un torn real produeix streaming, activitat, diff i interrupció sense deixar processos vius.
