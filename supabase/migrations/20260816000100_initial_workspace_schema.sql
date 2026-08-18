-- JST Command Center: authentication, shared workspaces, and cloud data foundation.
-- Existing browser localStorage data is intentionally not read or modified here.

create extension if not exists pgcrypto;

create type public.workspace_role as enum ('admin', 'member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members(user_id);

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  title text not null,
  bpm integer not null default 0 check (bpm >= 0),
  musical_key text not null default '',
  tuning text not null default '',
  length text not null default '',
  status text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, legacy_id)
);

create table public.shows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  name text not null,
  venue text not null default '',
  location text not null default '',
  show_date date,
  load_in time,
  soundcheck time,
  set_time time,
  ticket_goal integer not null default 0,
  tickets_sold integer not null default 0,
  ticket_price numeric(10,2) not null default 0,
  contact text not null default '',
  promoter text not null default '',
  sound_engineer text not null default '',
  address text not null default '',
  ticket_notes text not null default '',
  parking_notes text not null default '',
  entrance_notes text not null default '',
  wifi_notes text not null default '',
  green_room_notes text not null default '',
  notes text not null default '',
  quick_notes text not null default '',
  poster_reference text,
  setlist jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb,
  merch jsonb not null default '[]'::jsonb,
  recap jsonb,
  show_mode_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, legacy_id)
);

create table public.rehearsals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  rehearsal_date date,
  start_time time,
  end_time time,
  location text not null default '',
  attendees text not null default '',
  goals jsonb not null default '[]'::jsonb,
  songs jsonb not null default '[]'::jsonb,
  notes text not null default '',
  after_notes jsonb not null default '{}'::jsonb,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, legacy_id)
);

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  song_name text not null,
  release_date date,
  artwork_status text not null default 'Not Started',
  recording_status text not null default 'Not Started',
  mixing_status text not null default 'Not Started',
  mastering_status text not null default 'Not Started',
  distribution_status text not null default 'Not Started',
  promotion_status text not null default 'Not Started',
  artwork_reference text,
  promotion_information jsonb not null default '{}'::jsonb,
  milestones jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, legacy_id)
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  title text not null,
  content_type text not null default '',
  platform text not null default '',
  status text not null default '',
  song text not null default '',
  show_name text not null default '',
  planned_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, legacy_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  name text not null,
  category text not null default '',
  due_date date,
  priority text not null default 'Normal',
  assigned text not null default '',
  notes text not null default '',
  complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, legacy_id)
);

create index songs_workspace_id_idx on public.songs(workspace_id);
create index shows_workspace_id_idx on public.shows(workspace_id);
create index rehearsals_workspace_id_idx on public.rehearsals(workspace_id);
create index releases_workspace_id_idx on public.releases(workspace_id);
create index content_items_workspace_id_idx on public.content_items(workspace_id);
create index tasks_workspace_id_idx on public.tasks(workspace_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger songs_set_updated_at before update on public.songs for each row execute function public.set_updated_at();
create trigger shows_set_updated_at before update on public.shows for each row execute function public.set_updated_at();
create trigger rehearsals_set_updated_at before update on public.rehearsals for each row execute function public.set_updated_at();
create trigger releases_set_updated_at before update on public.releases for each row execute function public.set_updated_at();
create trigger content_items_set_updated_at before update on public.content_items for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- SECURITY DEFINER helpers avoid recursive workspace_members RLS checks.
create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.shares_workspace_with(target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members mine
    join public.workspace_members theirs using (workspace_id)
    where mine.user_id = auth.uid() and theirs.user_id = target_user_id
  );
$$;

create or replace function public.add_workspace_creator_as_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'admin');
  return new;
end;
$$;

create trigger on_workspace_created after insert on public.workspaces
for each row execute function public.add_workspace_creator_as_admin();

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.is_workspace_admin(uuid) from public;
revoke all on function public.shares_workspace_with(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.songs enable row level security;
alter table public.shows enable row level security;
alter table public.rehearsals enable row level security;
alter table public.releases enable row level security;
alter table public.content_items enable row level security;
alter table public.tasks enable row level security;

create policy "profiles_select_workspace_peers" on public.profiles for select to authenticated
using (id = auth.uid() or public.shares_workspace_with(id));
create policy "profiles_update_self" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy "workspaces_select_members" on public.workspaces for select to authenticated
using (public.is_workspace_member(id));
create policy "workspaces_insert_creator" on public.workspaces for insert to authenticated
with check (created_by = auth.uid());
create policy "workspaces_update_admins" on public.workspaces for update to authenticated
using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));
create policy "workspaces_delete_admins" on public.workspaces for delete to authenticated
using (public.is_workspace_admin(id));

create policy "workspace_members_select_members" on public.workspace_members for select to authenticated
using (public.is_workspace_member(workspace_id));
create policy "workspace_members_insert_admins" on public.workspace_members for insert to authenticated
with check (public.is_workspace_admin(workspace_id));
create policy "workspace_members_update_admins" on public.workspace_members for update to authenticated
using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
create policy "workspace_members_delete_admins" on public.workspace_members for delete to authenticated
using (public.is_workspace_admin(workspace_id));

create policy "songs_workspace_access" on public.songs for all to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "shows_workspace_access" on public.shows for all to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "rehearsals_workspace_access" on public.rehearsals for all to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "releases_workspace_access" on public.releases for all to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "content_items_workspace_access" on public.content_items for all to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "tasks_workspace_access" on public.tasks for all to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.songs to authenticated;
grant select, insert, update, delete on public.shows to authenticated;
grant select, insert, update, delete on public.rehearsals to authenticated;
grant select, insert, update, delete on public.releases to authenticated;
grant select, insert, update, delete on public.content_items to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
