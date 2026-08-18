-- JST Command Center: cloud migration state, edit attribution, and Realtime.

create table public.cloud_migrations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  migration_key text not null,
  completed_at timestamptz not null default now(),
  completed_by uuid not null references auth.users(id) on delete restrict,
  counts jsonb not null default '{}'::jsonb,
  primary key (workspace_id, migration_key)
);

alter table public.cloud_migrations enable row level security;
create policy "cloud_migrations_workspace_access" on public.cloud_migrations
for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id) and completed_by = auth.uid());
grant select, insert, update on public.cloud_migrations to authenticated;

alter table public.songs add column if not exists last_edited_by_member_id uuid references public.band_members(id) on delete set null;
alter table public.songs add column if not exists last_edited_by_name text;
alter table public.shows add column if not exists last_edited_by_member_id uuid references public.band_members(id) on delete set null;
alter table public.shows add column if not exists last_edited_by_name text;
alter table public.rehearsals add column if not exists last_edited_by_member_id uuid references public.band_members(id) on delete set null;
alter table public.rehearsals add column if not exists last_edited_by_name text;
alter table public.releases add column if not exists last_edited_by_member_id uuid references public.band_members(id) on delete set null;
alter table public.releases add column if not exists last_edited_by_name text;
alter table public.content_items add column if not exists last_edited_by_member_id uuid references public.band_members(id) on delete set null;
alter table public.content_items add column if not exists last_edited_by_name text;
alter table public.tasks add column if not exists last_edited_by_member_id uuid references public.band_members(id) on delete set null;
alter table public.tasks add column if not exists last_edited_by_name text;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['songs','shows','rehearsals','releases','content_items','tasks'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
