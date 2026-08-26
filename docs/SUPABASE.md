# Supabase per a AiBrain

## Estat exacte

La integració està implementada i el projecte hosted `aibrain-workbench` (`rqjmqzfwimiysrkvmnya`, `eu-west-3`, pla Free) està creat i vinculat al checkout. Les migracions remotes són `aibrain_multitenant_foundation`, `projects_durable_threads` i `hosted_advisor_hardening`.

El mateix esquema ha passat una matriu local i hosted amb creació de projecte, fil i missatge, separació cross-tenant i bloqueig de la columna privada de represa. L’advisor de seguretat no retorna avisos; el de rendiment només marca índexs encara no utilitzats perquè el projecte no té trànsit real. La Site URL, els redirects exactes i el bloqueig d’alta pública ja estan aplicats al projecte hosted. Continuen pendents el bootstrap consentit del primer owner, SMTP/templates hosted i el gate complet de sessió per correu.

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

1. Projecte confirmat: `aibrain-workbench`, ref `rqjmqzfwimiysrkvmnya`, regió `eu-west-3`, cost confirmat `0 €/mes` al pla Free.
2. Site URL aplicada: `https://aibrain-workbench-preview.vercel.app`. Redirects permesos: la seva ruta `/auth/confirm` i les dues variants locals de desenvolupament.
3. L’alta pública està desactivada al servei hosted. L’aplicació també envia `shouldCreateUser: false` en el login.
4. Configura SMTP propi abans d’obrir trànsit; el correu incorporat és només de prova. El pla Free amb el proveïdor compartit rebutja per API la personalització de plantilles, per tant no es considera configurada.
5. Quan hi hagi SMTP propi, aplica els templates de `supabase/templates/` a **Invite user** i **Magic link**. Utilitzen `TokenHash`, imprescindible per validar la sessió al servidor. Desactiva email tracking; si el proveïdor consumeix links amb Safe Links, canvia el flux a OTP o afegeix una confirmació intermèdia.
6. Enllaça el CLI i aplica la migració només quan el projecte correcte estigui confirmat:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Les migracions versionades són [20260825174319_aibrain_multitenant_foundation.sql](../supabase/migrations/20260825174319_aibrain_multitenant_foundation.sql), [20260825185207_projects_durable_threads.sql](../supabase/migrations/20260825185207_projects_durable_threads.sql) i [20260825191156_hosted_advisor_hardening.sql](../supabase/migrations/20260825191156_hosted_advisor_hardening.sql).

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

## Desenvolupament local Supabase

`supabase/config.toml` deixa l’alta pública desactivada, inclou els redirects locals i carrega els dos templates. Requereix Docker:

```bash
supabase start
supabase db reset
supabase status
```

Mailpit queda disponible a l’URL que retorna `supabase status`. En aquesta màquina el daemon Docker no estava actiu durant aquesta implementació, així que el stack complet local encara no s’ha executat.

## Gates de verificació live

- Login d’un convidat crea cookie SSR i obre només el seu tenant.
- Un correu no convidat rep la mateixa resposta genèrica, però no obté sessió.
- Un member rep `403` al control plane i no pot escriure manifests.
- Un owner desa versions consecutives i cada canvi crea `manifest.saved`.
- Un usuari de `operations` no pot llegir manifests, invitacions ni audit de `studio`.
- Revocar una membership talla l’accés en la següent petició.
- Rotar la publishable key no requereix canviar la secret key, i a l’inrevés.
- L’advisor de seguretat queda net. En una base nova, els avisos `unused_index` de rendiment són informatius fins que hi hagi trànsit suficient; no s’han de retirar índexs de claus foranes per aquest motiu.
