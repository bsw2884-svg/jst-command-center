-- JST Command Center: workspace-scoped in-app notifications.
-- This does not enable browser push, service-worker push, email, or external messaging.

alter table public.song_audio_clips
  add column if not exists source_type text not null default 'upload';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'song_audio_clips_source_type_check') then
    alter table public.song_audio_clips add constraint song_audio_clips_source_type_check
      check (source_type in ('upload', 'record_idea'));
  end if;
end $$;

create table if not exists public.notification_member_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null references public.band_members(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_id)
);

create index if not exists notification_member_sessions_member_idx
  on public.notification_member_sessions(workspace_id, member_id);

alter table public.notification_member_sessions enable row level security;
revoke all on public.notification_member_sessions from public, anon, authenticated;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  recipient_member_id uuid not null references public.band_members(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_member_id uuid references public.band_members(id) on delete set null,
  actor_name text not null default 'JST member',
  type text not null check (type in (
    'writing_clip_added', 'record_idea_added', 'mix_note_added', 'mix_version_added',
    'task_created', 'task_assigned', 'task_completed', 'writing_moved_to_songs',
    'release_stage_changed'
  )),
  title text not null check (length(trim(title)) > 0),
  message text not null check (length(trim(message)) > 0),
  entity_type text not null check (entity_type in ('writing_song', 'release', 'task', 'song')),
  entity_id uuid not null,
  related_id uuid,
  event_key text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (workspace_id, recipient_member_id, event_key)
);

create index if not exists notifications_recipient_created_idx
  on public.notifications(workspace_id, recipient_member_id, created_at desc);
create index if not exists notifications_recipient_unread_idx
  on public.notifications(workspace_id, recipient_member_id, is_read, created_at desc);

alter table public.notifications enable row level security;
alter table public.notifications replica identity full;

create or replace function public.set_notification_member(target_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_workspace_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select bm.workspace_id into target_workspace_id
  from public.band_members bm
  where bm.id = target_member_id;

  if target_workspace_id is null or not public.is_workspace_member(target_workspace_id) then
    raise exception 'That member is not available in your workspace.';
  end if;

  insert into public.notification_member_sessions (user_id, workspace_id, member_id, updated_at)
  values (current_user_id, target_workspace_id, target_member_id, now())
  on conflict (user_id, workspace_id) do update
    set member_id = excluded.member_id, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_notification_member(uuid) from public;
grant execute on function public.set_notification_member(uuid) to authenticated;

create or replace function public.current_notification_member(target_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sessions.member_id
  from public.notification_member_sessions sessions
  where sessions.user_id = auth.uid()
    and sessions.workspace_id = target_workspace_id;
$$;

revoke all on function public.current_notification_member(uuid) from public;
grant execute on function public.current_notification_member(uuid) to authenticated;

drop policy if exists "notification recipients can read" on public.notifications;
create policy "notification recipients can read" on public.notifications
for select to authenticated
using (
  public.is_workspace_member(workspace_id)
  and recipient_member_id = public.current_notification_member(workspace_id)
);

drop policy if exists "notification recipients can update read state" on public.notifications;
create policy "notification recipients can update read state" on public.notifications
for update to authenticated
using (
  public.is_workspace_member(workspace_id)
  and recipient_member_id = public.current_notification_member(workspace_id)
)
with check (
  public.is_workspace_member(workspace_id)
  and recipient_member_id = public.current_notification_member(workspace_id)
);

revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant update (is_read, read_at) on public.notifications to authenticated;

create or replace function public.create_workspace_notifications(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_actor_member_id uuid,
  target_actor_name text,
  target_type text,
  target_title text,
  target_message text,
  target_entity_type text,
  target_entity_id uuid,
  target_related_id uuid,
  target_event_key text,
  only_recipient_member_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (
    workspace_id, recipient_member_id, actor_user_id, actor_member_id, actor_name,
    type, title, message, entity_type, entity_id, related_id, event_key
  )
  select
    target_workspace_id, member.id, target_actor_user_id, target_actor_member_id,
    coalesce(nullif(trim(target_actor_name), ''), 'JST member'), target_type, target_title,
    target_message, target_entity_type, target_entity_id, target_related_id, target_event_key
  from public.band_members member
  where member.workspace_id = target_workspace_id
    and member.id is distinct from target_actor_member_id
    and (only_recipient_member_id is null or member.id = only_recipient_member_id)
  on conflict (workspace_id, recipient_member_id, event_key) do nothing;
$$;

revoke all on function public.create_workspace_notifications(uuid, uuid, uuid, text, text, text, text, text, uuid, uuid, text, uuid) from public, anon, authenticated;

create or replace function public.notify_writing_audio_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  song_title text;
  actor text := coalesce(nullif(trim(new.uploaded_by_name), ''), 'A band member');
  notification_type text;
  notification_title text;
  notification_message text;
begin
  select song.title into song_title from public.writing_songs song where song.id = new.writing_song_id;
  if new.source_type = 'record_idea' then
    notification_type := 'record_idea_added';
    notification_title := 'New Record Idea';
    notification_message := actor || ' saved "' || new.display_name || '" to ' || coalesce(song_title, 'a Writing song') || '.';
  else
    notification_type := 'writing_clip_added';
    notification_title := 'New writing clip';
    notification_message := actor || ' uploaded "' || new.display_name || '" to ' || coalesce(song_title, 'a Writing song') || '.';
  end if;

  perform public.create_workspace_notifications(
    new.workspace_id, new.uploaded_by, new.uploaded_by_member_id, actor,
    notification_type, notification_title, notification_message,
    'writing_song', new.writing_song_id, new.id,
    notification_type || ':' || new.id::text
  );
  return new;
end;
$$;

drop trigger if exists notify_writing_audio_added on public.song_audio_clips;
create trigger notify_writing_audio_added after insert on public.song_audio_clips
for each row execute function public.notify_writing_audio_added();

create or replace function public.notify_mix_version_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  release_name text;
  actor text := coalesce(nullif(trim(new.uploaded_by_name), ''), 'A band member');
begin
  select release.song_name into release_name from public.releases release where release.id = new.release_id;
  perform public.create_workspace_notifications(
    new.workspace_id, new.uploaded_by, new.uploaded_by_member_id, actor,
    'mix_version_added', 'New mix version',
    actor || ' created ' || new.display_name || ' for ' || coalesce(release_name, 'a release') || '.',
    'release', new.release_id, new.id, 'mix_version_added:' || new.id::text
  );
  return new;
end;
$$;

drop trigger if exists notify_mix_version_added on public.release_mix_versions;
create trigger notify_mix_version_added after insert on public.release_mix_versions
for each row execute function public.notify_mix_version_added();

create or replace function public.notify_mix_note_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  release_name text;
  version_name text;
  actor text := coalesce(nullif(trim(new.author_name), ''), 'A band member');
begin
  select release.song_name into release_name from public.releases release where release.id = new.release_id;
  select version.display_name into version_name from public.release_mix_versions version where version.id = new.mix_version_id;
  perform public.create_workspace_notifications(
    new.workspace_id, new.author_user_id, new.author_member_id, actor,
    'mix_note_added', 'New mix note',
    actor || ' added a ' || new.category || ' note to ' || coalesce(release_name, 'a release') || ' · ' || coalesce(version_name, 'mix') || '.',
    'release', new.release_id, new.id, 'mix_note_added:' || new.id::text
  );
  return new;
end;
$$;

drop trigger if exists notify_mix_note_added on public.release_mix_notes;
create trigger notify_mix_note_added after insert on public.release_mix_notes
for each row execute function public.notify_mix_note_added();

create or replace function public.notify_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := coalesce(nullif(trim(new.last_edited_by_name), ''), 'A band member');
  assigned_member_id uuid;
begin
  if nullif(trim(new.assigned), '') is not null then
    select member.id into assigned_member_id
    from public.band_members member
    where member.workspace_id = new.workspace_id
      and (lower(member.display_name) = lower(trim(new.assigned)) or lower(member.slug) = lower(trim(new.assigned)))
    limit 1;
  end if;

  if tg_op = 'INSERT' then
    if assigned_member_id is not null then
      perform public.create_workspace_notifications(
        new.workspace_id, auth.uid(), new.last_edited_by_member_id, actor,
        'task_assigned', 'Task assigned', actor || ' assigned you: ' || new.name || '.',
        'task', new.id, null, 'task_assigned:create:' || new.id::text, assigned_member_id
      );
    else
      perform public.create_workspace_notifications(
        new.workspace_id, auth.uid(), new.last_edited_by_member_id, actor,
        'task_created', 'New task', actor || ' created a task: ' || new.name || '.',
        'task', new.id, null, 'task_created:' || new.id::text
      );
    end if;
    return new;
  end if;

  if new.complete and not old.complete then
    perform public.create_workspace_notifications(
      new.workspace_id, auth.uid(), new.last_edited_by_member_id, actor,
      'task_completed', 'Task completed', actor || ' completed: ' || new.name || '.',
      'task', new.id, null, 'task_completed:' || new.id::text || ':' || new.updated_at::text
    );
  end if;

  if new.assigned is distinct from old.assigned and assigned_member_id is not null then
    perform public.create_workspace_notifications(
      new.workspace_id, auth.uid(), new.last_edited_by_member_id, actor,
      'task_assigned', 'Task assigned', actor || ' assigned you: ' || new.name || '.',
      'task', new.id, null, 'task_assigned:' || new.id::text || ':' || new.updated_at::text, assigned_member_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_task_activity on public.tasks;
create trigger notify_task_activity after insert or update on public.tasks
for each row execute function public.notify_task_activity();

create or replace function public.notify_writing_moved_to_songs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := coalesce(nullif(trim(new.last_edited_by_name), ''), 'A band member');
begin
  if old.converted_song_id is null and new.converted_song_id is not null then
    perform public.create_workspace_notifications(
      new.workspace_id, auth.uid(), new.last_edited_by_member_id, actor,
      'writing_moved_to_songs', 'Writing song moved to Songs',
      actor || ' moved ' || new.title || ' into the Songs catalog.',
      'song', new.converted_song_id, new.id, 'writing_moved_to_songs:' || new.id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_writing_moved_to_songs on public.writing_songs;
create trigger notify_writing_moved_to_songs after update on public.writing_songs
for each row execute function public.notify_writing_moved_to_songs();

create or replace function public.release_milestone_statuses(value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', item.value->>'id', 'status', item.value->>'status') order by item.ordinality), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) with ordinality as item(value, ordinality);
$$;

create or replace function public.notify_release_stage_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := coalesce(nullif(trim(new.last_edited_by_name), ''), 'A band member');
begin
  if new.artwork_status is distinct from old.artwork_status
    or new.recording_status is distinct from old.recording_status
    or new.mixing_status is distinct from old.mixing_status
    or new.mastering_status is distinct from old.mastering_status
    or new.distribution_status is distinct from old.distribution_status
    or new.promotion_status is distinct from old.promotion_status
    or public.release_milestone_statuses(new.milestones) is distinct from public.release_milestone_statuses(old.milestones)
  then
    perform public.create_workspace_notifications(
      new.workspace_id, auth.uid(), new.last_edited_by_member_id, actor,
      'release_stage_changed', 'Release stage updated',
      actor || ' changed a release stage for ' || new.song_name || '.',
      'release', new.id, null, 'release_stage_changed:' || new.id::text || ':' || new.updated_at::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_release_stage_changed on public.releases;
create trigger notify_release_stage_changed after update on public.releases
for each row execute function public.notify_release_stage_changed();

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
