-- Project and durable-thread layer for the AiBrain workbench.
-- Browser clients receive AiBrain UUIDs only. Runtime thread tokens stay in a
-- server-selected column that is not granted to the authenticated role.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id bigint not null,
  created_by uuid,
  name text not null,
  slug text not null,
  status text not null default 'active',
  is_pinned boolean not null default false,
  manifest jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint projects_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  constraint projects_name_length
    check (char_length(btrim(name)) between 1 and 80),
  constraint projects_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  constraint projects_status
    check (status in ('active', 'archived')),
  constraint projects_manifest_object
    check (manifest is null or jsonb_typeof(manifest) = 'object'),
  constraint projects_tenant_slug_key unique (tenant_id, slug),
  constraint projects_id_tenant_id_key unique (id, tenant_id)
);

create table public.project_workspaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id bigint not null,
  project_id uuid not null,
  workspace_key text not null,
  label text not null,
  host_type text not null default 'managed',
  status text not null default 'ready',
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_workspaces_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint project_workspaces_project_tenant_fkey
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id) on delete cascade,
  constraint project_workspaces_key_format
    check (workspace_key ~ '^[a-z0-9][a-z0-9-]{0,127}$'),
  constraint project_workspaces_label_length
    check (char_length(btrim(label)) between 1 and 100),
  constraint project_workspaces_host_type
    check (host_type = 'managed'),
  constraint project_workspaces_status
    check (status in ('ready', 'pending', 'unavailable')),
  constraint project_workspaces_tenant_key_unique
    unique (tenant_id, workspace_key),
  constraint project_workspaces_id_project_key
    unique (id, project_id)
);

create unique index project_workspaces_one_primary_idx
  on public.project_workspaces (project_id)
  where is_primary;

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id bigint not null,
  project_id uuid not null,
  created_by uuid not null,
  title text not null,
  status text not null default 'active',
  is_pinned boolean not null default false,
  runtime_thread_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint threads_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint threads_project_tenant_fkey
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id) on delete cascade,
  constraint threads_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete restrict,
  constraint threads_title_length
    check (char_length(btrim(title)) between 1 and 120),
  constraint threads_status
    check (status in ('active', 'archived')),
  constraint threads_id_tenant_project_key
    unique (id, tenant_id, project_id)
);

create table public.thread_messages (
  id uuid primary key,
  tenant_id bigint not null,
  project_id uuid not null,
  thread_id uuid not null,
  role text not null,
  content text not null default '',
  status text not null,
  activity jsonb not null default '[]'::jsonb,
  plan jsonb not null default '[]'::jsonb,
  approvals jsonb not null default '[]'::jsonb,
  diff text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint thread_messages_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint thread_messages_thread_tenant_project_fkey
    foreign key (thread_id, tenant_id, project_id)
    references public.threads(id, tenant_id, project_id) on delete cascade,
  constraint thread_messages_role
    check (role in ('user', 'assistant')),
  constraint thread_messages_status
    check (status in ('complete', 'streaming', 'error', 'stopped')),
  constraint thread_messages_content_size
    check (octet_length(content) <= 1048576),
  constraint thread_messages_activity_array
    check (jsonb_typeof(activity) = 'array'),
  constraint thread_messages_plan_array
    check (jsonb_typeof(plan) = 'array'),
  constraint thread_messages_approvals_array
    check (jsonb_typeof(approvals) = 'array'),
  constraint thread_messages_diff_size
    check (octet_length(diff) <= 2097152)
);

create index projects_tenant_status_order_idx
  on public.projects (tenant_id, status, is_pinned desc, updated_at desc);
create index project_workspaces_project_primary_idx
  on public.project_workspaces (project_id, is_primary desc);
create index threads_project_status_order_idx
  on public.threads (project_id, status, is_pinned desc, updated_at desc);
create index threads_tenant_updated_at_idx
  on public.threads (tenant_id, updated_at desc);
create index thread_messages_thread_created_at_idx
  on public.thread_messages (thread_id, created_at asc, id asc);

alter table public.projects enable row level security;
alter table public.project_workspaces enable row level security;
alter table public.threads enable row level security;
alter table public.thread_messages enable row level security;

alter table public.projects force row level security;
alter table public.project_workspaces force row level security;
alter table public.threads force row level security;
alter table public.thread_messages force row level security;

create policy projects_select_member
  on public.projects for select to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy projects_insert_member
  on public.projects for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy projects_update_member
  on public.projects for update to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  )
  with check (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy project_workspaces_select_member
  on public.project_workspaces for select to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy project_workspaces_insert_member
  on public.project_workspaces for insert to authenticated
  with check (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy threads_select_member
  on public.threads for select to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy threads_insert_member
  on public.threads for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy threads_update_member
  on public.threads for update to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  )
  with check (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy thread_messages_select_member
  on public.thread_messages for select to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy thread_messages_insert_member
  on public.thread_messages for insert to authenticated
  with check (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy thread_messages_update_member
  on public.thread_messages for update to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  )
  with check (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
    )
  );

create or replace function aibrain_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function aibrain_private.touch_updated_at()
  from public, anon, authenticated;

create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function aibrain_private.touch_updated_at();
create trigger project_workspaces_touch_updated_at
  before update on public.project_workspaces
  for each row execute function aibrain_private.touch_updated_at();
create trigger threads_touch_updated_at
  before update on public.threads
  for each row execute function aibrain_private.touch_updated_at();
create trigger thread_messages_touch_updated_at
  before update on public.thread_messages
  for each row execute function aibrain_private.touch_updated_at();

create or replace function public.create_project(
  p_tenant_slug text,
  p_name text,
  p_slug text,
  p_workspace_key text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_project_id uuid;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if char_length(btrim(p_name)) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'invalid_project_name';
  end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$' then
    raise exception using errcode = '22023', message = 'invalid_project_slug';
  end if;
  if p_workspace_key !~ '^[a-z0-9][a-z0-9-]{0,127}$' then
    raise exception using errcode = '22023', message = 'invalid_workspace_key';
  end if;

  select tenant.id
    into v_tenant_id
  from public.tenants as tenant
  join public.tenant_memberships as membership
    on membership.tenant_id = tenant.id
  where tenant.slug = p_tenant_slug
    and membership.user_id = v_actor;

  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'tenant_membership_required';
  end if;

  insert into public.projects (tenant_id, created_by, name, slug)
  values (v_tenant_id, v_actor, btrim(p_name), p_slug)
  returning id into v_project_id;

  insert into public.project_workspaces (
    tenant_id,
    project_id,
    workspace_key,
    label,
    host_type,
    status,
    is_primary
  ) values (
    v_tenant_id,
    v_project_id,
    p_workspace_key,
    'Workspace principal',
    'managed',
    'ready',
    true
  );

  return v_project_id;
end;
$$;

revoke all on public.projects from public, anon, authenticated;
revoke all on public.project_workspaces from public, anon, authenticated;
revoke all on public.threads from public, anon, authenticated;
revoke all on public.thread_messages from public, anon, authenticated;

grant select, insert, update, delete on public.projects to service_role;
grant select, insert, update, delete on public.project_workspaces to service_role;
grant select, insert, update, delete on public.threads to service_role;
grant select, insert, update, delete on public.thread_messages to service_role;

grant select on public.projects to authenticated;
grant insert (tenant_id, created_by, name, slug, status, is_pinned, manifest)
  on public.projects to authenticated;
grant update (name, status, is_pinned, manifest)
  on public.projects to authenticated;

grant select on public.project_workspaces to authenticated;
grant insert (
  tenant_id,
  project_id,
  workspace_key,
  label,
  host_type,
  status,
  is_primary
) on public.project_workspaces to authenticated;

grant select (
  id,
  tenant_id,
  project_id,
  created_by,
  title,
  status,
  is_pinned,
  created_at,
  updated_at
) on public.threads to authenticated;
grant insert (tenant_id, project_id, created_by, title, status, is_pinned)
  on public.threads to authenticated;
grant update (title, status, is_pinned, updated_at)
  on public.threads to authenticated;

grant select on public.thread_messages to authenticated;
grant insert (
  id,
  tenant_id,
  project_id,
  thread_id,
  role,
  content,
  status,
  activity,
  plan,
  approvals,
  diff,
  created_at
) on public.thread_messages to authenticated;
grant update (content, status, activity, plan, approvals, diff)
  on public.thread_messages to authenticated;

revoke all on function public.create_project(text, text, text, text)
  from public, anon;
grant execute on function public.create_project(text, text, text, text)
  to authenticated;

with project_seed(tenant_slug, name, slug, workspace_key, workspace_label) as (
  values
    ('studio', 'AiBrain', 'aibrain', 'workspace', 'Workspace principal'),
    ('studio', 'Laboratori', 'laboratori', 'laboratori', 'Laboratori'),
    ('operations', 'Operacions', 'operacions', 'workspace', 'Workspace principal'),
    ('operations', 'Automatitzacions', 'automatitzacions', 'automatitzacions', 'Automatitzacions')
)
insert into public.projects (tenant_id, created_by, name, slug)
select tenant.id, null, project_seed.name, project_seed.slug
from project_seed
join public.tenants as tenant on tenant.slug = project_seed.tenant_slug
on conflict (tenant_id, slug) do nothing;

with workspace_seed(tenant_slug, project_slug, workspace_key, workspace_label) as (
  values
    ('studio', 'aibrain', 'workspace', 'Workspace principal'),
    ('studio', 'laboratori', 'laboratori', 'Laboratori'),
    ('operations', 'operacions', 'workspace', 'Workspace principal'),
    ('operations', 'automatitzacions', 'automatitzacions', 'Automatitzacions')
)
insert into public.project_workspaces (
  tenant_id,
  project_id,
  workspace_key,
  label,
  host_type,
  status,
  is_primary
)
select
  tenant.id,
  project.id,
  workspace_seed.workspace_key,
  workspace_seed.workspace_label,
  'managed',
  'ready',
  true
from workspace_seed
join public.tenants as tenant on tenant.slug = workspace_seed.tenant_slug
join public.projects as project
  on project.tenant_id = tenant.id
 and project.slug = workspace_seed.project_slug
on conflict (tenant_id, workspace_key) do nothing;
