-- Owner-governed automation availability and per-member permissions.

create table public.tenant_automation_settings (
  tenant_id bigint not null,
  automation_id text not null,
  enabled boolean not null default false,
  configured_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_automation_settings_pkey primary key (tenant_id, automation_id),
  constraint tenant_automation_settings_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint tenant_automation_settings_configured_by_fkey
    foreign key (configured_by) references auth.users(id) on delete restrict,
  constraint tenant_automation_settings_automation_id
    check (char_length(btrim(automation_id)) between 1 and 100)
);

create table public.member_automation_permissions (
  tenant_id bigint not null,
  user_id uuid not null,
  automation_id text not null,
  enabled boolean not null default false,
  configured_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_automation_permissions_pkey
    primary key (tenant_id, user_id, automation_id),
  constraint member_automation_permissions_membership_fkey
    foreign key (tenant_id, user_id)
    references public.tenant_memberships(tenant_id, user_id) on delete cascade,
  constraint member_automation_permissions_setting_fkey
    foreign key (tenant_id, automation_id)
    references public.tenant_automation_settings(tenant_id, automation_id) on delete cascade,
  constraint member_automation_permissions_configured_by_fkey
    foreign key (configured_by) references auth.users(id) on delete restrict,
  constraint member_automation_permissions_automation_id
    check (char_length(btrim(automation_id)) between 1 and 100)
);

create index member_automation_permissions_user_idx
  on public.member_automation_permissions (user_id, tenant_id)
  where enabled = true;

alter table public.tenant_automation_settings enable row level security;
alter table public.member_automation_permissions enable row level security;
alter table public.tenant_automation_settings force row level security;
alter table public.member_automation_permissions force row level security;

create policy tenant_automation_settings_select_member
  on public.tenant_automation_settings
  for select
  to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy tenant_automation_settings_insert_owner
  on public.tenant_automation_settings
  for insert
  to authenticated
  with check (
    configured_by = (select auth.uid())
    and tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy tenant_automation_settings_update_owner
  on public.tenant_automation_settings
  for update
  to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  )
  with check (
    configured_by = (select auth.uid())
    and tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy tenant_automation_settings_delete_owner
  on public.tenant_automation_settings
  for delete
  to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy member_automation_permissions_select_authorized
  on public.member_automation_permissions
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy member_automation_permissions_insert_owner
  on public.member_automation_permissions
  for insert
  to authenticated
  with check (
    configured_by = (select auth.uid())
    and tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy member_automation_permissions_update_owner
  on public.member_automation_permissions
  for update
  to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  )
  with check (
    configured_by = (select auth.uid())
    and tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy member_automation_permissions_delete_owner
  on public.member_automation_permissions
  for delete
  to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

revoke all on table public.tenant_automation_settings from public, anon, authenticated;
revoke all on table public.member_automation_permissions from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_automation_settings to authenticated;
grant select, insert, update, delete on table public.member_automation_permissions to authenticated;

create or replace function aibrain_private.audit_automation_configuration()
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
    new.configured_by,
    case
      when tg_table_name = 'tenant_automation_settings' then 'automation.configured'
      else 'automation.permission_changed'
    end,
    'automation',
    new.automation_id,
    jsonb_build_object(
      'enabled', new.enabled,
      'userId', case
        when tg_table_name = 'member_automation_permissions' then new.user_id
        else null
      end
    )
  );
  return new;
end;
$$;

revoke all on function aibrain_private.audit_automation_configuration()
  from public, anon, authenticated;

create trigger tenant_automation_settings_audit
  after insert or update on public.tenant_automation_settings
  for each row execute function aibrain_private.audit_automation_configuration();

create trigger member_automation_permissions_audit
  after insert or update on public.member_automation_permissions
  for each row execute function aibrain_private.audit_automation_configuration();
