-- AiBrain production identity and control-plane foundation.
-- Supabase Auth owns browser sessions; these public tables own authorization
-- and tenant-scoped product state. Every exposed table has RLS enabled.

create table public.tenants (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  constraint tenants_name_length check (char_length(btrim(name)) between 1 and 100)
);

create table public.tenant_memberships (
  tenant_id bigint not null,
  user_id uuid not null,
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_memberships_pkey primary key (tenant_id, user_id),
  constraint tenant_memberships_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint tenant_memberships_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint tenant_memberships_role check (role in ('owner', 'member'))
);

create index tenant_memberships_user_id_tenant_id_idx
  on public.tenant_memberships (user_id, tenant_id);

create table public.tenant_invitations (
  id bigint generated always as identity primary key,
  tenant_id bigint not null,
  email text not null,
  role text not null,
  invited_by uuid not null,
  invited_user_id uuid,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_invitations_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint tenant_invitations_invited_by_fkey
    foreign key (invited_by) references auth.users(id) on delete restrict,
  constraint tenant_invitations_invited_user_id_fkey
    foreign key (invited_user_id) references auth.users(id) on delete set null,
  constraint tenant_invitations_role check (role in ('owner', 'member')),
  constraint tenant_invitations_email_normalized
    check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  constraint tenant_invitations_tenant_email_key unique (tenant_id, email)
);

create index tenant_invitations_invited_by_idx
  on public.tenant_invitations (invited_by);
create index tenant_invitations_invited_user_id_idx
  on public.tenant_invitations (invited_user_id)
  where invited_user_id is not null;

create table public.tenant_manifest_versions (
  id bigint generated always as identity primary key,
  tenant_id bigint not null,
  version bigint not null,
  manifest jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint tenant_manifest_versions_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint tenant_manifest_versions_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  constraint tenant_manifest_versions_version_positive check (version > 0),
  constraint tenant_manifest_versions_manifest_valid check (coalesce(
    jsonb_typeof(manifest) = 'object'
    and jsonb_typeof(manifest -> 'productName') = 'string'
    and char_length(btrim(manifest ->> 'productName')) between 1 and 48
    and jsonb_typeof(manifest -> 'assistantName') = 'string'
    and char_length(btrim(manifest ->> 'assistantName')) between 1 and 32
    and jsonb_typeof(manifest -> 'role') = 'string'
    and char_length(btrim(manifest ->> 'role')) between 1 and 80
    and jsonb_typeof(manifest -> 'welcomeTitle') = 'string'
    and char_length(btrim(manifest ->> 'welcomeTitle')) between 1 and 90
    and jsonb_typeof(manifest -> 'welcomeMessage') = 'string'
    and char_length(btrim(manifest ->> 'welcomeMessage')) between 1 and 280
    and manifest ->> 'accent' in ('graphite', 'blue', 'violet')
    and manifest ->> 'density' in ('comfortable', 'compact')
    and manifest ->> 'corners' in ('soft', 'rounded', 'precise')
    and manifest -> 'showActivityPanel' in ('true'::jsonb, 'false'::jsonb)
    and jsonb_typeof(manifest -> 'windows') = 'object'
    and manifest -> 'windows' -> 'chat' = 'true'::jsonb
    and manifest -> 'windows' -> 'inspector' in ('true'::jsonb, 'false'::jsonb)
    and manifest -> 'windows' -> 'runtime' in ('true'::jsonb, 'false'::jsonb),
    false
  )),
  constraint tenant_manifest_versions_tenant_version_key unique (tenant_id, version)
);

create index tenant_manifest_versions_tenant_version_idx
  on public.tenant_manifest_versions (tenant_id, version desc);
create index tenant_manifest_versions_created_by_idx
  on public.tenant_manifest_versions (created_by)
  where created_by is not null;

create table public.audit_events (
  id bigint generated always as identity primary key,
  tenant_id bigint not null,
  actor_user_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint audit_events_actor_user_id_fkey
    foreign key (actor_user_id) references auth.users(id) on delete set null,
  constraint audit_events_action_length check (char_length(action) between 1 and 100),
  constraint audit_events_target_type_length check (char_length(target_type) between 1 and 80),
  constraint audit_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_tenant_created_at_idx
  on public.audit_events (tenant_id, created_at desc);
create index audit_events_actor_user_id_idx
  on public.audit_events (actor_user_id)
  where actor_user_id is not null;

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_invitations enable row level security;
alter table public.tenant_manifest_versions enable row level security;
alter table public.audit_events enable row level security;

alter table public.tenants force row level security;
alter table public.tenant_memberships force row level security;
alter table public.tenant_invitations force row level security;
alter table public.tenant_manifest_versions force row level security;
alter table public.audit_events force row level security;

create policy tenants_select_member
  on public.tenants
  for select
  to authenticated
  using (
    id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy tenant_memberships_select_self
  on public.tenant_memberships
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy tenant_invitations_select_owner
  on public.tenant_invitations
  for select
  to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy tenant_invitations_select_self
  on public.tenant_invitations
  for select
  to authenticated
  using (invited_user_id = (select auth.uid()));

create policy tenant_invitations_accept_self
  on public.tenant_invitations
  for update
  to authenticated
  using (invited_user_id = (select auth.uid()))
  with check (invited_user_id = (select auth.uid()));

create policy tenant_manifest_versions_select_member
  on public.tenant_manifest_versions
  for select
  to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy tenant_manifest_versions_insert_owner
  on public.tenant_manifest_versions
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy audit_events_select_owner
  on public.audit_events
  for select
  to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create schema if not exists aibrain_private;
revoke all on schema aibrain_private from public, anon, authenticated;

create or replace function aibrain_private.prepare_manifest_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is not null and not exists (
    select 1
    from public.tenant_memberships as membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = v_actor
      and membership.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'owner_membership_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(new.tenant_id);
  select coalesce(max(manifest_version.version), 0) + 1
    into new.version
  from public.tenant_manifest_versions as manifest_version
  where manifest_version.tenant_id = new.tenant_id;
  new.created_by := v_actor;
  return new;
end;
$$;

create or replace function aibrain_private.audit_manifest_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    tenant_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  ) values (
    new.tenant_id,
    new.created_by,
    case when new.created_by is null then 'manifest.seeded' else 'manifest.saved' end,
    'tenant_manifest',
    new.id::text,
    jsonb_build_object('version', new.version)
  );
  return new;
end;
$$;

create or replace function aibrain_private.audit_invitation_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.accepted_at is null and new.accepted_at is not null then
    insert into public.audit_events (
      tenant_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      metadata
    ) values (
      new.tenant_id,
      (select auth.uid()),
      'invitation.accepted',
      'tenant_invitation',
      new.id::text,
      '{}'::jsonb
    );
  end if;
  return new;
end;
$$;

revoke all on function aibrain_private.prepare_manifest_version()
  from public, anon, authenticated;
revoke all on function aibrain_private.audit_manifest_version()
  from public, anon, authenticated;
revoke all on function aibrain_private.audit_invitation_acceptance()
  from public, anon, authenticated;

create trigger tenant_manifest_versions_prepare
  before insert on public.tenant_manifest_versions
  for each row execute function aibrain_private.prepare_manifest_version();

create trigger tenant_manifest_versions_audit
  after insert on public.tenant_manifest_versions
  for each row execute function aibrain_private.audit_manifest_version();

create trigger tenant_invitations_acceptance_audit
  after update of accepted_at on public.tenant_invitations
  for each row execute function aibrain_private.audit_invitation_acceptance();

create or replace function public.save_tenant_manifest(
  p_tenant_slug text,
  p_manifest jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_saved_version bigint;
begin
  if jsonb_typeof(p_manifest) <> 'object' then
    raise exception using errcode = '22023', message = 'manifest_must_be_an_object';
  end if;

  select tenant.id
    into v_tenant_id
  from public.tenants as tenant
  join public.tenant_memberships as membership
    on membership.tenant_id = tenant.id
  where tenant.slug = p_tenant_slug
    and membership.user_id = (select auth.uid())
    and membership.role = 'owner';

  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'owner_membership_required';
  end if;

  insert into public.tenant_manifest_versions (
    tenant_id,
    version,
    manifest,
    created_by
  ) values (
    v_tenant_id,
    1,
    p_manifest,
    (select auth.uid())
  )
  returning version into v_saved_version;

  return v_saved_version;
end;
$$;

create or replace function public.record_tenant_invitation(
  p_tenant_slug text,
  p_email text,
  p_invited_user_id uuid,
  p_role text,
  p_actor_user_id uuid
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_invitation_id bigint;
  v_email text := lower(btrim(p_email));
begin
  if p_role not in ('owner', 'member') then
    raise exception using errcode = '22023', message = 'invalid_membership_role';
  end if;

  select tenant.id
    into v_tenant_id
  from public.tenants as tenant
  join public.tenant_memberships as membership
    on membership.tenant_id = tenant.id
  where tenant.slug = p_tenant_slug
    and membership.user_id = p_actor_user_id
    and membership.role = 'owner';

  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'owner_membership_required';
  end if;

  insert into public.tenant_memberships (
    tenant_id,
    user_id,
    role
  ) values (
    v_tenant_id,
    p_invited_user_id,
    p_role
  )
  on conflict (tenant_id, user_id) do update
  set role = case
      when public.tenant_memberships.role = 'owner' then 'owner'
      else excluded.role
    end,
    updated_at = now();

  insert into public.tenant_invitations (
    tenant_id,
    email,
    role,
    invited_by,
    invited_user_id,
    expires_at,
    accepted_at,
    revoked_at
  ) values (
    v_tenant_id,
    v_email,
    p_role,
    p_actor_user_id,
    p_invited_user_id,
    now() + interval '7 days',
    null,
    null
  )
  on conflict (tenant_id, email) do update
  set role = excluded.role,
      invited_by = excluded.invited_by,
      invited_user_id = excluded.invited_user_id,
      expires_at = excluded.expires_at,
      accepted_at = null,
      revoked_at = null,
      updated_at = now()
  returning id into v_invitation_id;

  insert into public.audit_events (
    tenant_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  ) values (
    v_tenant_id,
    p_actor_user_id,
    'member.invited',
    'tenant_membership',
    p_invited_user_id::text,
    jsonb_build_object('email', v_email, 'role', p_role)
  );

  return v_invitation_id;
end;
$$;

create or replace function public.accept_tenant_invitations()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.tenant_invitations as invitation
    set accepted_at = coalesce(invitation.accepted_at, now()),
        updated_at = now()
  where invitation.invited_user_id = (select auth.uid())
    and invitation.revoked_at is null
    and invitation.accepted_at is null;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

create or replace function public.find_auth_user_id_by_email(p_email text)
returns uuid
language sql
security invoker
stable
set search_path = ''
as $$
  select auth_user.id
  from auth.users as auth_user
  where lower(auth_user.email) = lower(btrim(p_email))
  order by auth_user.created_at asc
  limit 1;
$$;

revoke all on public.tenants from public, anon, authenticated;
revoke all on public.tenant_memberships from public, anon, authenticated;
revoke all on public.tenant_invitations from public, anon, authenticated;
revoke all on public.tenant_manifest_versions from public, anon, authenticated;
revoke all on public.audit_events from public, anon, authenticated;

grant select on public.tenants to authenticated;
grant select on public.tenant_memberships to authenticated;
grant select, update (accepted_at, updated_at) on public.tenant_invitations to authenticated;
grant select, insert on public.tenant_manifest_versions to authenticated;
grant select on public.audit_events to authenticated;

grant usage, select on sequence public.tenant_manifest_versions_id_seq to authenticated;

revoke all on function public.save_tenant_manifest(text, jsonb) from public, anon;
grant execute on function public.save_tenant_manifest(text, jsonb) to authenticated;

revoke all on function public.record_tenant_invitation(text, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_tenant_invitation(text, text, uuid, text, uuid)
  to service_role;

revoke all on function public.find_auth_user_id_by_email(text)
  from public, anon, authenticated;
grant execute on function public.find_auth_user_id_by_email(text) to service_role;

revoke all on function public.accept_tenant_invitations() from public, anon;
grant execute on function public.accept_tenant_invitations() to authenticated;

insert into public.tenants (slug, name)
values
  ('studio', 'Arnau Studio'),
  ('operations', 'Northstar Operations')
on conflict (slug) do update
set name = excluded.name,
    updated_at = now();

insert into public.tenant_manifest_versions (tenant_id, version, manifest, created_by)
select
  tenant.id,
  1,
  seed.manifest,
  null
from public.tenants as tenant
join (
  values
    (
      'studio',
      '{
        "productName": "AiBrain Studio",
        "assistantName": "Codex",
        "role": "Agent de producte personalitzable",
        "welcomeTitle": "Què vols construir?",
        "welcomeMessage": "Converteix una idea en feina verificable, segueix el pla en directe i revisa cada canvi abans que s’executi.",
        "accent": "graphite",
        "density": "comfortable",
        "corners": "soft",
        "showActivityPanel": true,
        "windows": {"chat": true, "inspector": true, "runtime": true}
      }'::jsonb
    ),
    (
      'operations',
      '{
        "productName": "AiBrain Operations",
        "assistantName": "Atlas",
        "role": "Copilot d’operacions",
        "welcomeTitle": "Què hem de resoldre avui?",
        "welcomeMessage": "Coordina incidències, automatitzacions i canvis operatius amb traçabilitat i aprovacions explícites.",
        "accent": "blue",
        "density": "compact",
        "corners": "precise",
        "showActivityPanel": true,
        "windows": {"chat": true, "inspector": true, "runtime": true}
      }'::jsonb
    )
) as seed(slug, manifest)
  on seed.slug = tenant.slug
on conflict (tenant_id, version) do nothing;
