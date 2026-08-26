-- Cover tenant-scoped foreign keys used by project and thread mutations.
create index project_workspaces_project_tenant_idx
  on public.project_workspaces (project_id, tenant_id);
create index projects_created_by_idx
  on public.projects (created_by)
  where created_by is not null;
create index threads_project_tenant_idx
  on public.threads (project_id, tenant_id);
create index threads_created_by_idx
  on public.threads (created_by);
create index thread_messages_tenant_id_idx
  on public.thread_messages (tenant_id);
create index thread_messages_thread_tenant_project_idx
  on public.thread_messages (thread_id, tenant_id, project_id);

-- A single SELECT policy avoids evaluating two permissive policies for every
-- invitation row while preserving owner and invitee visibility.
drop policy tenant_invitations_select_owner on public.tenant_invitations;
drop policy tenant_invitations_select_self on public.tenant_invitations;

create policy tenant_invitations_select_visible
  on public.tenant_invitations
  for select
  to authenticated
  using (
    invited_user_id = (select auth.uid())
    or tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );
