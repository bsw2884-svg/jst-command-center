create table if not exists public.release_mix_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  storage_path text not null unique,
  display_name text not null check (length(trim(display_name)) > 0),
  description text not null default '',
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  duration_seconds numeric null check (duration_seconds is null or duration_seconds >= 0),
  approval_status text not null default 'In Review' check (approval_status in ('In Review', 'Approved')),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_by_member_id uuid null references public.band_members(id) on delete set null,
  uploaded_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.release_mix_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  mix_version_id uuid not null references public.release_mix_versions(id) on delete cascade,
  timestamp_seconds numeric not null default 0 check (timestamp_seconds >= 0),
  category text not null check (category in ('Overall', 'Vocals', 'Drums', 'Bass', 'Guitars', 'FX', 'Other')),
  note text not null check (length(trim(note)) > 0),
  status text not null default 'Open' check (status in ('Open', 'Resolved')),
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_member_id uuid null references public.band_members(id) on delete set null,
  author_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists release_mix_versions_release_idx on public.release_mix_versions(workspace_id, release_id, created_at desc);
create index if not exists release_mix_notes_version_idx on public.release_mix_notes(workspace_id, mix_version_id, timestamp_seconds);
create index if not exists release_mix_notes_release_idx on public.release_mix_notes(workspace_id, release_id, status);

drop trigger if exists set_release_mix_versions_updated_at on public.release_mix_versions;
create trigger set_release_mix_versions_updated_at before update on public.release_mix_versions
for each row execute function public.set_updated_at();

drop trigger if exists set_release_mix_notes_updated_at on public.release_mix_notes;
create trigger set_release_mix_notes_updated_at before update on public.release_mix_notes
for each row execute function public.set_updated_at();

alter table public.release_mix_versions enable row level security;
alter table public.release_mix_notes enable row level security;

drop policy if exists "workspace members read release mix versions" on public.release_mix_versions;
create policy "workspace members read release mix versions" on public.release_mix_versions for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members create release mix versions" on public.release_mix_versions;
create policy "workspace members create release mix versions" on public.release_mix_versions for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and uploaded_by = auth.uid()
  and exists (select 1 from public.releases r where r.id = release_id and r.workspace_id = workspace_id)
);

drop policy if exists "workspace members update release mix versions" on public.release_mix_versions;
create policy "workspace members update release mix versions" on public.release_mix_versions for update to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members delete release mix versions" on public.release_mix_versions;
create policy "workspace members delete release mix versions" on public.release_mix_versions for delete to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members read release mix notes" on public.release_mix_notes;
create policy "workspace members read release mix notes" on public.release_mix_notes for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members create release mix notes" on public.release_mix_notes;
create policy "workspace members create release mix notes" on public.release_mix_notes for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and author_user_id = auth.uid()
  and exists (
    select 1 from public.release_mix_versions v
    where v.id = mix_version_id and v.release_id = release_mix_notes.release_id and v.workspace_id = release_mix_notes.workspace_id
  )
);

drop policy if exists "workspace members update release mix notes" on public.release_mix_notes;
create policy "workspace members update release mix notes" on public.release_mix_notes for update to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members delete release mix notes" on public.release_mix_notes;
create policy "workspace members delete release mix notes" on public.release_mix_notes for delete to authenticated
using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.release_mix_versions to authenticated;
grant select, insert, update, delete on public.release_mix_notes to authenticated;

update storage.buckets
set allowed_mime_types = array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a','audio/aac','audio/webm','audio/ogg']
where id = 'song-audio';

do $$
begin
  alter publication supabase_realtime add table public.release_mix_versions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.release_mix_notes;
exception when duplicate_object then null;
end $$;
