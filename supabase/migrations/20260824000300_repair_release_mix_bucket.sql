-- Corrective, idempotent setup for Release Mix Version audio.
-- This migration intentionally does not modify the existing song-audio bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'release-mixes',
  'release-mixes',
  false,
  262144000,
  array[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/x-aac',
    'audio/webm',
    'audio/ogg'
  ]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "release_mix_audio_workspace_select" on storage.objects;
create policy "release_mix_audio_workspace_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'release-mixes'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "release_mix_audio_workspace_insert" on storage.objects;
create policy "release_mix_audio_workspace_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'release-mixes'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "release_mix_audio_workspace_update" on storage.objects;
create policy "release_mix_audio_workspace_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'release-mixes'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'release-mixes'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "release_mix_audio_workspace_delete" on storage.objects;
create policy "release_mix_audio_workspace_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'release-mixes'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'release-mixes'
      and name = 'release-mixes'
      and public = false
      and file_size_limit = 262144000
  ) then
    raise exception 'release-mixes bucket configuration could not be verified';
  end if;
end
$$;
