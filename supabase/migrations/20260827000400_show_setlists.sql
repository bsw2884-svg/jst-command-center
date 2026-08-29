-- Show-scoped setlists. Existing shows.setlist arrays are imported only on Save.
-- No songs, shows, or other existing rows are changed by this migration.
begin;

create unique index if not exists shows_workspace_id_id_setlist_idx on public.shows(workspace_id, id);
create unique index if not exists songs_workspace_id_id_setlist_idx on public.songs(workspace_id, id);

create table if not exists public.show_setlists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  show_id uuid not null,
  name text not null default 'Setlist' check (length(trim(name)) between 1 and 120),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, show_id),
  unique (workspace_id, id),
  constraint show_setlists_show_fkey foreign key (workspace_id, show_id)
    references public.shows(workspace_id, id) on delete cascade
);

create table if not exists public.show_setlist_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  setlist_id uuid not null,
  song_id uuid not null,
  position integer not null check (position >= 0),
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (setlist_id, position),
  constraint show_setlist_items_setlist_fkey foreign key (workspace_id, setlist_id)
    references public.show_setlists(workspace_id, id) on delete cascade,
  -- Deleting a catalog song remains possible; it also removes its setlist entries.
  constraint show_setlist_items_song_fkey foreign key (workspace_id, song_id)
    references public.songs(workspace_id, id) on delete cascade
);
create index if not exists show_setlist_items_workspace_idx on public.show_setlist_items(workspace_id, setlist_id);

alter table public.show_setlists enable row level security;
alter table public.show_setlist_items enable row level security;
alter table public.show_setlists replica identity full;
alter table public.show_setlist_items replica identity full;

drop policy if exists "workspace members manage setlists" on public.show_setlists;
create policy "workspace members manage setlists" on public.show_setlists for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists "workspace members manage setlist items" on public.show_setlist_items;
create policy "workspace members manage setlist items" on public.show_setlist_items for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
revoke all on public.show_setlists, public.show_setlist_items from anon;
grant select, insert, update, delete on public.show_setlists, public.show_setlist_items to authenticated;

drop trigger if exists set_show_setlists_updated_at on public.show_setlists;
create trigger set_show_setlists_updated_at before update on public.show_setlists
  for each row execute function public.set_updated_at();
drop trigger if exists set_show_setlist_items_updated_at on public.show_setlist_items;
create trigger set_show_setlist_items_updated_at before update on public.show_setlist_items
  for each row execute function public.set_updated_at();

-- One atomic save: failed validation/reordering never leaves half a setlist.
-- Invoker rights retain normal workspace RLS for every operation.
create or replace function public.save_show_setlist(
  p_show_id uuid, p_name text, p_items jsonb,
  p_expected_revision integer, p_allow_duplicates boolean default false
) returns public.show_setlists
language plpgsql security invoker set search_path = '' as $$
declare
  target_workspace uuid;
  saved public.show_setlists;
  item jsonb;
  item_song uuid;
  prior_rows jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select workspace_id into target_workspace from public.shows where id=p_show_id for update;
  if target_workspace is null or not public.is_workspace_member(target_workspace) then
    raise exception 'This show is not available in your workspace.';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Enter a setlist name (1–120 characters).'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Setlist items must be an array.'; end if;
  if jsonb_array_length(p_items)>200 then raise exception 'A setlist can contain up to 200 songs.'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'A saved revision is required.'; end if;
  select * into saved from public.show_setlists where workspace_id=target_workspace and show_id=p_show_id for update;
  if coalesce(saved.revision,0)<>p_expected_revision then
    raise exception 'This setlist changed on another device. Reload it before saving.' using errcode='40001';
  end if;
  if not coalesce(p_allow_duplicates,false) and exists (
    select 1 from jsonb_array_elements(p_items) x group by (x->>'song_id')::uuid having count(*)>1
  ) then raise exception 'Duplicate songs require explicit permission.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x group by (x->>'id')::uuid having count(*)>1) then
    raise exception 'Setlist row IDs must be unique.';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    item_song := (item->>'song_id')::uuid;
    if not exists(select 1 from public.songs where id=item_song and workspace_id=target_workspace) then
      raise exception 'A song is missing or belongs to another workspace. Reload the catalog.';
    end if;
    if item->>'id' is null or length(coalesce(item->>'notes',''))>2000 then raise exception 'Invalid setlist row.'; end if;
    if exists(select 1 from public.show_setlist_items where id=(item->>'id')::uuid and setlist_id is distinct from saved.id) then
      raise exception 'A row belongs to a different setlist.';
    end if;
  end loop;
  if saved.id is null then
    insert into public.show_setlists(workspace_id,show_id,name) values(target_workspace,p_show_id,trim(p_name)) returning * into saved;
  else
    update public.show_setlists set name=trim(p_name),revision=revision+1 where id=saved.id returning * into saved;
  end if;
  -- Replace rows transactionally; row IDs and original created dates are preserved.
  select jsonb_agg(jsonb_build_object('id',id,'created_at',created_at)) into prior_rows
    from public.show_setlist_items where setlist_id=saved.id;
  delete from public.show_setlist_items where setlist_id=saved.id;
  insert into public.show_setlist_items(id,workspace_id,setlist_id,song_id,position,notes,created_at)
  select (x.value->>'id')::uuid,target_workspace,saved.id,(x.value->>'song_id')::uuid,
    (x.ordinality-1)::integer,coalesce(x.value->>'notes',''),coalesce(o.created_at,now())
  from jsonb_array_elements(p_items) with ordinality x(value,ordinality)
  left join jsonb_to_recordset(coalesce(prior_rows,'[]'::jsonb)) as o(id uuid,created_at timestamptz)
    on o.id=(x.value->>'id')::uuid;
  -- Keep the existing recap/backup show song-ID projection in sync. The new tables
  -- remain authoritative; stage Previous/Next never calls this function.
  update public.shows set setlist=coalesce((
    select jsonb_agg(coalesce(s.legacy_id,s.id::text) order by i.position)
    from public.show_setlist_items i join public.songs s on s.id=i.song_id where i.setlist_id=saved.id
  ),'[]'::jsonb) where id=p_show_id;
  return saved;
end $$;
revoke all on function public.save_show_setlist(uuid,text,jsonb,integer,boolean) from public, anon;
grant execute on function public.save_show_setlist(uuid,text,jsonb,integer,boolean) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.show_setlists;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.show_setlist_items;
exception when duplicate_object then null; end $$;
notify pgrst, 'reload schema';
commit;
