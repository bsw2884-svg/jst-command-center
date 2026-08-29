-- Correct the stale-save signal on already-migrated projects. SQLSTATE 40001 is
-- a serialization/retry class error and can leave an HTTP RPC request pending.
-- P0001 is an immediate, deterministic application exception for the client.
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
    raise exception using errcode='P0001', message='SETLIST_REVISION_CONFLICT',
      detail='This setlist changed on another device. Reload it before saving.';
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
  select jsonb_agg(jsonb_build_object('id',id,'created_at',created_at)) into prior_rows
    from public.show_setlist_items where setlist_id=saved.id;
  delete from public.show_setlist_items where setlist_id=saved.id;
  insert into public.show_setlist_items(id,workspace_id,setlist_id,song_id,position,notes,created_at)
  select (x.value->>'id')::uuid,target_workspace,saved.id,(x.value->>'song_id')::uuid,
    (x.ordinality-1)::integer,coalesce(x.value->>'notes',''),coalesce(o.created_at,now())
  from jsonb_array_elements(p_items) with ordinality x(value,ordinality)
  left join jsonb_to_recordset(coalesce(prior_rows,'[]'::jsonb)) as o(id uuid,created_at timestamptz)
    on o.id=(x.value->>'id')::uuid;
  update public.shows set setlist=coalesce((
    select jsonb_agg(coalesce(s.legacy_id,s.id::text) order by i.position)
    from public.show_setlist_items i join public.songs s on s.id=i.song_id where i.setlist_id=saved.id
  ),'[]'::jsonb) where id=p_show_id;
  return saved;
end $$;

notify pgrst, 'reload schema';
