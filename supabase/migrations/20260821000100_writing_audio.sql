-- JST Command Center: collaborative Writing room and private audio storage.

create table public.writing_songs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  stage text not null default 'Idea' check (stage in ('Idea','Writing','Demo','Arrangement','Ready to Record')),
  progress integer not null default 0 check (progress between 0 and 100),
  musical_key text not null default '',
  tuning text not null default 'Standard',
  next_step text not null default '',
  notes text not null default '',
  created_by_member_id uuid references public.band_members(id) on delete set null,
  created_by_name text,
  last_edited_by_member_id uuid references public.band_members(id) on delete set null,
  last_edited_by_name text,
  converted_song_id uuid unique references public.songs(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.song_audio_clips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  writing_song_id uuid not null references public.writing_songs(id) on delete cascade,
  storage_path text not null unique,
  display_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  notes text not null default '',
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_by_member_id uuid references public.band_members(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index writing_songs_workspace_updated_idx on public.writing_songs(workspace_id, updated_at desc);
create index song_audio_clips_song_created_idx on public.song_audio_clips(writing_song_id, created_at desc);
create index song_audio_clips_workspace_idx on public.song_audio_clips(workspace_id);

create trigger writing_songs_set_updated_at before update on public.writing_songs
for each row execute function public.set_updated_at();
create trigger song_audio_clips_set_updated_at before update on public.song_audio_clips
for each row execute function public.set_updated_at();

alter table public.writing_songs enable row level security;
alter table public.song_audio_clips enable row level security;

create policy "writing_songs_workspace_access" on public.writing_songs
for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "song_audio_clips_workspace_select" on public.song_audio_clips
for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "song_audio_clips_workspace_insert" on public.song_audio_clips
for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and uploaded_by = auth.uid()
  and exists (
    select 1 from public.writing_songs ws
    where ws.id = writing_song_id and ws.workspace_id = song_audio_clips.workspace_id
  )
);

create policy "song_audio_clips_workspace_update" on public.song_audio_clips
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (
  public.is_workspace_member(workspace_id)
  and exists (
    select 1 from public.writing_songs ws
    where ws.id = writing_song_id and ws.workspace_id = song_audio_clips.workspace_id
  )
);

create policy "song_audio_clips_workspace_delete" on public.song_audio_clips
for delete to authenticated
using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.writing_songs to authenticated;
grant select, insert, delete on public.song_audio_clips to authenticated;
grant update (display_name, notes) on public.song_audio_clips to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'song-audio', 'song-audio', false, 52428800,
  array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a','audio/aac','audio/x-aac']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object paths always begin with the workspace UUID. Storage access therefore
-- inherits the same workspace-membership boundary as the metadata tables.
create policy "song_audio_workspace_select" on storage.objects for select to authenticated
using (
  bucket_id = 'song-audio'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);
create policy "song_audio_workspace_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'song-audio'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);
create policy "song_audio_workspace_update" on storage.objects for update to authenticated
using (
  bucket_id = 'song-audio'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'song-audio'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);
create policy "song_audio_workspace_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'song-audio'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

create or replace function public.move_writing_song_to_catalog(target_writing_song_id uuid)
returns public.songs
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.writing_songs;
  result public.songs;
begin
  select * into draft from public.writing_songs
  where id = target_writing_song_id
  for update;

  if draft.id is null or not public.is_workspace_member(draft.workspace_id) then
    raise exception 'Writing song not found or access denied';
  end if;

  if draft.converted_song_id is not null then
    select * into result from public.songs where id = draft.converted_song_id;
    return result;
  end if;

  insert into public.songs (
    workspace_id, title, bpm, musical_key, tuning, length, status, notes,
    last_edited_by_member_id, last_edited_by_name
  ) values (
    draft.workspace_id, draft.title, 0, draft.musical_key, draft.tuning, '', 'Recording',
    concat_ws(E'\n\n', nullif(draft.notes, ''), case when draft.next_step <> '' then 'Next step: ' || draft.next_step end),
    draft.last_edited_by_member_id, draft.last_edited_by_name
  ) returning * into result;

  update public.writing_songs
  set converted_song_id = result.id, converted_at = now(), stage = 'Ready to Record', progress = 100
  where id = draft.id;

  return result;
end;
$$;

revoke all on function public.move_writing_song_to_catalog(uuid) from public;
grant execute on function public.move_writing_song_to_catalog(uuid) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['writing_songs','song_audio_clips'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
