# Supabase per a AiBrain

## Estat exacte

La integració està implementada i el projecte hosted `aibrain-workbench` (`rqjmqzfwimiysrkvmnya`, `eu-west-3`, pla Pro) està creat i vinculat al checkout. Les migracions remotes són `aibrain_multitenant_foundation`, `projects_durable_threads`, `hosted_advisor_hardening` i `composer_attachments`.

El mateix esquema ha passat una matriu local i hosted amb creació de projecte, fil i missatge, separació cross-tenant i bloqueig de la columna privada de represa. L’advisor de seguretat no retorna avisos; el de rendiment només marca índexs encara no utilitzats perquè el projecte no té trànsit real. La Site URL, els redirects exactes i el bloqueig d’alta pública ja estan aplicats al projecte hosted. Resend està verificat per `auth.palsec.agency`, l’SMTP i els templates hosted estan actius, i el primer owner consentit ha completat els gates live d’accés, rol, logout i revocació.

## Decisió d’arquitectura

- Supabase Auth gestiona sessions, revocació i refresh tokens.
- `@supabase/ssr` manté la sessió a cookies per Next.js. `@supabase/server` no s’utilitza perquè està pensat per JWT rebuts en headers, no per sessions SSR.
- `getClaims()` verifica la identitat; cap autorització confia en `getSession()` ni en metadata de l’usuari.
- `tenant_memberships` és l’única font de tenant i rol.
- Postgres RLS torna a limitar totes les lectures i escriptures per tenant.
- `projects`, `project_workspaces`, `threads` i `thread_messages` persisteixen la jerarquia del workbench; la preview UX conserva el mateix contracte però continua sent efímera.
- La clau `SUPABASE_SECRET_KEY` només serveix per crear invitacions des d’una ruta que abans verifica sessió i rol owner. No arriba mai al navegador.
- Els manifests són append-only. Triggers privats assignen la versió i escriuen auditoria, fins i tot si un owner crida directament la Data API.

## Variables

```dotenv
AIBRAIN_AUTH_MODE=supabase
AIBRAIN_PUBLIC_URL=https://brain.example.com
AIBRAIN_SESSION_SECRET=<secret-aleatori-llarg>
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

`AIBRAIN_SESSION_SECRET` continua sent necessari per signar els tokens opacs dels threads Codex; no és una clau de Supabase. La secret key de Supabase és server-only i s’ha d’injectar al runtime, mai a la imatge.

## Projecte hosted

1. Projecte confirmat: `aibrain-workbench`, ref `rqjmqzfwimiysrkvmnya`, regió `eu-west-3`, pla Pro actiu.
2. Site URL aplicada: `https://aibrain-workbench-preview.vercel.app`. Redirects permesos: la seva ruta `/auth/confirm` i les dues variants locals de desenvolupament.
3. L’alta pública està desactivada al servei hosted. L’aplicació també envia `shouldCreateUser: false` en el login.
4. SMTP propi actiu amb Resend a `smtp.resend.com:465`, remitent `AiBrain <no-reply@auth.palsec.agency>` i una API key restringida a l’enviament des d’aquest domini. DKIM i SPF estan verificats; el tracking d’obertures i clics està desactivat. Cap credencial queda al checkout.
5. Els templates de `supabase/templates/` estan aplicats al servei hosted per a **Invite user** i **Magic link**. Utilitzen `TokenHash`, imprescindible per validar la sessió al servidor. Si un proveïdor de correu consumeix links amb Safe Links, cal canviar el flux a OTP o afegir una confirmació intermèdia.
6. Enllaça el CLI i aplica la migració només quan el projecte correcte estigui confirmat:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Les migracions versionades són [20260825174319_aibrain_multitenant_foundation.sql](../supabase/migrations/20260825174319_aibrain_multitenant_foundation.sql), [20260825185207_projects_durable_threads.sql](../supabase/migrations/20260825185207_projects_durable_threads.sql), [20260825191156_hosted_advisor_hardening.sql](../supabase/migrations/20260825191156_hosted_advisor_hardening.sql) i [20260825210000_composer_attachments.sql](../supabase/migrations/20260825210000_composer_attachments.sql).

## Primer owner

La migració crea els tenants `studio` i `operations`, però deliberadament no inventa cap UUID d’Auth. Primer crea o convida la identitat des del Dashboard. Després, des del SQL Editor del projecte correcte, assigna el primer owner:

```sql
insert into public.tenant_memberships (tenant_id, user_id, role)
select tenant.id, auth_user.id, 'owner'
from public.tenants as tenant
join auth.users as auth_user
  on lower(auth_user.email) = lower('<correu-owner>')
where tenant.slug = 'studio'
on conflict (tenant_id, user_id) do update
set role = 'owner', updated_at = now();
```

A partir d’aquí, l’owner pot convidar members o altres owners des de `/control`. Si el correu ja té una identitat Supabase, s’afegeix al tenant sense crear-ne una de nova.

El primer owner consentit, `arnaupinyolwork@gmail.com`, va ser convidat el 26 d’agost de 2026 i té rol `owner` al tenant `studio`. Resend confirma el lliurament tant de la invitació com del magic link. La preview `dpl_XNYiHgBDWWvj1sxVUFdJrarDoAPe`, publicada a l’àlies estable `https://aibrain-workbench-preview.vercel.app`, funciona amb auth Supabase real i variables restringides a Preview. El flux live ha validat callback, verificació OTP, cookie SSR, entrada al workbench, accés owner a `/control`, runtime status, auditoria `manifest.saved`, logout, bloqueig d’un member i revocació/restauració immediata de membership. També s’ha comprovat que la resposta genèrica per a un correu no convidat no crea cap usuari. L’usuari member QA, la membership i les sessions temporals s’han eliminat després de la prova. Deployment Protection continua activa i exigeix una sessió Vercel al navegador.

## Desenvolupament local Supabase

`supabase/config.toml` deixa l’alta pública desactivada, inclou els redirects locals i carrega els dos templates. Requereix Docker:

```bash
supabase start
supabase db reset
supabase status
```

Mailpit queda disponible a l’URL que retorna `supabase status`. En aquesta màquina el daemon Docker no estava actiu durant aquesta implementació, així que el stack complet local encara no s’ha executat.

## Gates de verificació live

- [x] Login d’un convidat crea cookie SSR i obre el tenant `studio` amb rol `owner`.
- [x] Un correu no convidat rep la mateixa resposta genèrica i no crea cap identitat.
- [x] Un member temporal autenticat entra al workbench però `/control` el retorna a `/?control=forbidden`; no obté la superfície d’escriptura del manifest.
- [x] L’owner pot desar un manifest i el canvi crea `manifest.saved`.
- [x] La matriu SQL/RLS hosted bloqueja l’accés cross-tenant entre `operations` i `studio`.
- [x] Logout elimina la sessió i retorna a `/login`; el member QA va quedar amb `0` sessions abans d’eliminar-lo.
- [x] Revocar la membership de l’owner talla l’accés en la següent petició; restaurar-la recupera `/control` amb rol `Owner` sobre la mateixa sessió.
- Rotar la publishable key no requereix canviar la secret key, i a l’inrevés.
- L’advisor de seguretat queda net. En una base nova, els avisos `unused_index` de rendiment són informatius fins que hi hagi trànsit suficient; no s’han de retirar índexs de claus foranes per aquest motiu.
