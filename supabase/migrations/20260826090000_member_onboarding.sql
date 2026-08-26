-- Role-aware member onboarding.
-- Owners define a member's job context. Members may only confirm that context
-- and persist personal working preferences through the guarded RPC below.

alter table public.tenant_memberships
  add column job_title text,
  add column role_summary text,
  add column responsibilities jsonb not null default '[]'::jsonb,
  add column first_mission text,
  add column preferred_language text not null default 'ca',
  add column response_style text not null default 'balanced',
  add column responsibility_feedback text,
  add column onboarding_completed_at timestamptz,
  add constraint tenant_memberships_job_title_length
    check (job_title is null or char_length(btrim(job_title)) between 1 and 80),
  add constraint tenant_memberships_role_summary_length
    check (role_summary is null or char_length(btrim(role_summary)) between 1 and 500),
  add constraint tenant_memberships_responsibilities_array
    check (jsonb_typeof(responsibilities) = 'array' and jsonb_array_length(responsibilities) <= 8),
  add constraint tenant_memberships_first_mission_length
    check (first_mission is null or char_length(btrim(first_mission)) between 1 and 400),
  add constraint tenant_memberships_preferred_language
    check (preferred_language in ('ca', 'es', 'en')),
  add constraint tenant_memberships_response_style
    check (response_style in ('concise', 'balanced', 'detailed')),
  add constraint tenant_memberships_responsibility_feedback_length
    check (responsibility_feedback is null or char_length(responsibility_feedback) <= 500);

alter table public.tenant_invitations
  add column job_title text,
  add column role_summary text,
  add column responsibilities jsonb not null default '[]'::jsonb,
  add column first_mission text,
  add constraint tenant_invitations_job_title_length
    check (job_title is null or char_length(btrim(job_title)) between 1 and 80),
  add constraint tenant_invitations_role_summary_length
    check (role_summary is null or char_length(btrim(role_summary)) between 1 and 500),
  add constraint tenant_invitations_responsibilities_array
    check (jsonb_typeof(responsibilities) = 'array' and jsonb_array_length(responsibilities) <= 8),
  add constraint tenant_invitations_first_mission_length
    check (first_mission is null or char_length(btrim(first_mission)) between 1 and 400);

create or replace function public.record_tenant_invitation_v2(
  p_tenant_slug text,
  p_email text,
  p_invited_user_id uuid,
  p_role text,
  p_actor_user_id uuid,
  p_job_title text,
  p_role_summary text,
  p_responsibilities jsonb,
  p_first_mission text
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $record_invitation$
declare
  v_tenant_id bigint;
  v_invitation_id bigint;
  v_email text := lower(btrim(p_email));
  v_job_title text := nullif(btrim(p_job_title), '');
  v_role_summary text := nullif(btrim(p_role_summary), '');
  v_first_mission text := nullif(btrim(p_first_mission), '');
  v_responsibilities jsonb := coalesce(p_responsibilities, '[]'::jsonb);
begin
  if p_role not in ('owner', 'member') then
    raise exception using errcode = '22023', message = 'invalid_membership_role';
  end if;
  if jsonb_typeof(v_responsibilities) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_responsibilities';
  end if;
  if jsonb_array_length(v_responsibilities) > 8
    or exists (
      select 1
      from jsonb_array_elements(v_responsibilities) as responsibility(value)
      where jsonb_typeof(responsibility.value) <> 'string'
        or char_length(btrim(responsibility.value #>> '{}')) not between 1 and 160
    ) then
    raise exception using errcode = '22023', message = 'invalid_responsibilities';
  end if;
  if p_role = 'member' and (
    v_job_title is null
    or char_length(v_job_title) > 80
    or v_role_summary is null
    or char_length(v_role_summary) > 500
    or jsonb_array_length(v_responsibilities) = 0
    or v_first_mission is null
    or char_length(v_first_mission) > 400
  ) then
    raise exception using errcode = '22023', message = 'member_assignment_required';
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
    role,
    job_title,
    role_summary,
    responsibilities,
    first_mission,
    onboarding_completed_at
  ) values (
    v_tenant_id,
    p_invited_user_id,
    p_role,
    case when p_role = 'member' then v_job_title end,
    case when p_role = 'member' then v_role_summary end,
    case when p_role = 'member' then v_responsibilities else '[]'::jsonb end,
    case when p_role = 'member' then v_first_mission end,
    null
  )
  on conflict (tenant_id, user_id) do update
  set role = case
      when public.tenant_memberships.role = 'owner' then 'owner'
      else excluded.role
    end,
    job_title = case
      when public.tenant_memberships.role = 'owner' then public.tenant_memberships.job_title
      else excluded.job_title
    end,
    role_summary = case
      when public.tenant_memberships.role = 'owner' then public.tenant_memberships.role_summary
      else excluded.role_summary
    end,
    responsibilities = case
      when public.tenant_memberships.role = 'owner' then public.tenant_memberships.responsibilities
      else excluded.responsibilities
    end,
    first_mission = case
      when public.tenant_memberships.role = 'owner' then public.tenant_memberships.first_mission
      else excluded.first_mission
    end,
    onboarding_completed_at = case
      when public.tenant_memberships.role = 'owner' then public.tenant_memberships.onboarding_completed_at
      else null
    end,
    updated_at = now();

  insert into public.tenant_invitations (
    tenant_id,
    email,
    role,
    invited_by,
    invited_user_id,
    job_title,
    role_summary,
    responsibilities,
    first_mission,
    expires_at,
    accepted_at,
    revoked_at
  ) values (
    v_tenant_id,
    v_email,
    p_role,
    p_actor_user_id,
    p_invited_user_id,
    case when p_role = 'member' then v_job_title end,
    case when p_role = 'member' then v_role_summary end,
    case when p_role = 'member' then v_responsibilities else '[]'::jsonb end,
    case when p_role = 'member' then v_first_mission end,
    now() + interval '7 days',
    null,
    null
  )
  on conflict (tenant_id, email) do update
  set role = excluded.role,
      invited_by = excluded.invited_by,
      invited_user_id = excluded.invited_user_id,
      job_title = excluded.job_title,
      role_summary = excluded.role_summary,
      responsibilities = excluded.responsibilities,
      first_mission = excluded.first_mission,
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
    jsonb_build_object('email', v_email, 'role', p_role, 'jobTitle', v_job_title)
  );

  return v_invitation_id;
end;
$record_invitation$;

create or replace function aibrain_private.complete_member_onboarding(
  p_tenant_slug text,
  p_preferred_language text,
  p_response_style text,
  p_responsibility_feedback text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $complete_member_onboarding$
declare
  v_actor uuid := (select auth.uid());
  v_tenant_id bigint;
  v_feedback text := nullif(btrim(p_responsibility_feedback), '');
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_preferred_language not in ('ca', 'es', 'en')
    or p_response_style not in ('concise', 'balanced', 'detailed')
    or char_length(coalesce(v_feedback, '')) > 500 then
    raise exception using errcode = '22023', message = 'invalid_member_preferences';
  end if;

  select tenant.id
    into v_tenant_id
  from public.tenants as tenant
  join public.tenant_memberships as membership
    on membership.tenant_id = tenant.id
  where tenant.slug = p_tenant_slug
    and membership.user_id = v_actor
    and membership.role = 'member'
    and membership.job_title is not null
    and membership.role_summary is not null
    and jsonb_array_length(membership.responsibilities) > 0
    and membership.first_mission is not null;

  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'member_assignment_required';
  end if;

  update public.tenant_memberships
  set preferred_language = p_preferred_language,
      response_style = p_response_style,
      responsibility_feedback = v_feedback,
      onboarding_completed_at = coalesce(onboarding_completed_at, now()),
      updated_at = now()
  where tenant_id = v_tenant_id
    and user_id = v_actor;

  insert into public.audit_events (
    tenant_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  ) values (
    v_tenant_id,
    v_actor,
    'member.onboarding_completed',
    'tenant_membership',
    v_actor::text,
    jsonb_build_object(
      'preferredLanguage', p_preferred_language,
      'responseStyle', p_response_style,
      'hasResponsibilityFeedback', v_feedback is not null
    )
  );

  return true;
end;
$complete_member_onboarding$;

create or replace function public.complete_member_onboarding(
  p_tenant_slug text,
  p_preferred_language text,
  p_response_style text,
  p_responsibility_feedback text
)
returns boolean
language sql
security invoker
set search_path = ''
as $complete_member_onboarding_wrapper$
  select aibrain_private.complete_member_onboarding(
    p_tenant_slug,
    p_preferred_language,
    p_response_style,
    p_responsibility_feedback
  );
$complete_member_onboarding_wrapper$;

revoke all on function public.record_tenant_invitation_v2(
  text, text, uuid, text, uuid, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.record_tenant_invitation_v2(
  text, text, uuid, text, uuid, text, text, jsonb, text
) to service_role;

revoke all on function public.complete_member_onboarding(text, text, text, text)
  from public, anon;
grant execute on function public.complete_member_onboarding(text, text, text, text)
  to authenticated;

revoke all on function aibrain_private.complete_member_onboarding(text, text, text, text)
  from public, anon, authenticated;
grant usage on schema aibrain_private to authenticated;
grant execute on function aibrain_private.complete_member_onboarding(text, text, text, text)
  to authenticated;
