-- JST Command Center: shared member selection for authenticated browser sessions.
-- Member names are presentation/attribution identities, not security principals.

create or replace function public.enter_jst_workspace(target_member_id uuid)
returns table (
  workspace_id uuid,
  user_id uuid,
  role public.workspace_role,
  member_id uuid,
  display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  selected_member public.band_members%rowtype;
  selected_role public.workspace_role;
begin
  if current_user_id is null then
    raise exception 'Authentication is required to enter the JST workspace.';
  end if;

  select bm.* into selected_member
  from public.band_members bm
  join public.workspaces w on w.id = bm.workspace_id
  where bm.id = target_member_id
    and lower(w.name) = lower('JumpStart Tomorrow');

  if not found then
    raise exception 'That JST band member does not exist.';
  end if;

  -- Preserve any existing profile association (including Brandon's permanent
  -- account) while updating the display name used for attribution.
  insert into public.profiles (id, display_name)
  values (current_user_id, selected_member.display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  -- New browser sessions receive ordinary workspace membership. Existing roles
  -- are never overwritten, so Brandon's established admin role remains intact.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (selected_member.workspace_id, current_user_id, 'member')
  on conflict on constraint workspace_members_pkey do nothing;

  select wm.role into selected_role
  from public.workspace_members wm
  where wm.workspace_id = selected_member.workspace_id
    and wm.user_id = current_user_id;

  return query
  select selected_member.workspace_id, current_user_id, selected_role,
         selected_member.id, selected_member.display_name;
end;
$$;

-- Retire the one-user-per-member claim path from browser clients.
revoke execute on function public.claim_jst_band_member(uuid) from authenticated;
revoke all on function public.enter_jst_workspace(uuid) from public;
grant execute on function public.enter_jst_workspace(uuid) to authenticated;
