-- JST Command Center: predefined band identities and authenticated member claiming.

create table public.band_members (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null,
  display_name text not null,
  default_role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

alter table public.profiles
  add column band_member_id uuid unique references public.band_members(id) on delete set null;

create index band_members_workspace_id_idx on public.band_members(workspace_id);

alter table public.band_members enable row level security;

create policy "band_members_select_workspace_members" on public.band_members
for select to authenticated
using (public.is_workspace_member(workspace_id));

-- A band-member association is security-sensitive. Users may edit their display
-- name directly, but only the controlled claim function may set band_member_id.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.band_members to authenticated;

create or replace function public.claim_jst_band_member(target_member_id uuid)
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
  jst_workspace_id uuid;
  selected_member public.band_members%rowtype;
  existing_member_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required to select a band member.';
  end if;

  -- Serialize first-run setup and reuse an earlier JST workspace if one exists.
  perform pg_advisory_xact_lock(hashtext('jst-command-center-workspace-bootstrap'));
  select w.id into jst_workspace_id
  from public.workspaces w
  where lower(w.name) = lower('JumpStart Tomorrow')
  order by w.created_at
  limit 1;

  if jst_workspace_id is null then
    jst_workspace_id := '10000000-0000-4000-8000-000000000001';
    insert into public.workspaces (id, name, created_by)
    values (jst_workspace_id, 'JumpStart Tomorrow', current_user_id);
  end if;

  insert into public.band_members (id, workspace_id, slug, display_name, default_role)
  values
    ('20000000-0000-4000-8000-000000000001', jst_workspace_id, 'brandon', 'Brandon', 'admin'),
    ('20000000-0000-4000-8000-000000000002', jst_workspace_id, 'tyler', 'Tyler', 'member'),
    ('20000000-0000-4000-8000-000000000003', jst_workspace_id, 'danny', 'Danny', 'member'),
    ('20000000-0000-4000-8000-000000000004', jst_workspace_id, 'mike', 'Mike', 'member')
  on conflict (id) do update set
    workspace_id = excluded.workspace_id,
    slug = excluded.slug,
    display_name = excluded.display_name,
    default_role = excluded.default_role;

  select bm.* into selected_member
  from public.band_members bm
  where bm.id = target_member_id and bm.workspace_id = jst_workspace_id
  for update;

  if not found then
    raise exception 'That JST band member does not exist.';
  end if;

  select p.band_member_id into existing_member_id
  from public.profiles p
  where p.id = current_user_id;

  if existing_member_id is not null and existing_member_id <> target_member_id then
    raise exception 'This account is already associated with another band member.';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.band_member_id = target_member_id and p.id <> current_user_id
  ) then
    raise exception '% is already linked to another secured session.', selected_member.display_name;
  end if;

  insert into public.profiles (id, display_name, band_member_id)
  values (current_user_id, selected_member.display_name, selected_member.id)
  on conflict (id) do update set
    display_name = excluded.display_name,
    band_member_id = excluded.band_member_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (jst_workspace_id, current_user_id, selected_member.default_role)
  on conflict on constraint workspace_members_pkey do update set role = excluded.role;

  return query
  select jst_workspace_id, current_user_id, selected_member.default_role,
         selected_member.id, selected_member.display_name;
end;
$$;

revoke all on function public.claim_jst_band_member(uuid) from public;
grant execute on function public.claim_jst_band_member(uuid) to authenticated;
