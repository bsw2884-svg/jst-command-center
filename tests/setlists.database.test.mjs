// Optional isolated PostgreSQL test. Install test-only dependency with:
// npm install --prefix .test-artifacts/setlist-db --no-audit --no-fund @electric-sql/pglite
// No production credentials, network calls, or existing database data are used.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
const modulePath=new URL('../.test-artifacts/setlist-db/node_modules/@electric-sql/pglite/dist/index.js',import.meta.url)
test('migration, atomic saves, conflicts, independent copies, and workspace RLS in isolated PostgreSQL', {skip:!existsSync(modulePath)}, async()=>{
 const {PGlite}=await import(modulePath.href)
 const db=new PGlite()
 try{
 await db.exec(`create role authenticated; create role anon; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function public.is_workspace_member(w uuid) returns boolean language sql stable as $$select w::text=current_setting('test.workspace',true) and auth.uid() is not null$$;
 create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
 create table public.workspaces(id uuid primary key);
 create table public.shows(id uuid primary key,workspace_id uuid references public.workspaces,legacy_id text,setlist jsonb default '[]');
 create table public.songs(id uuid primary key,workspace_id uuid references public.workspaces,legacy_id text);
 alter table public.shows enable row level security; alter table public.songs enable row level security;
 create policy test_show_workspace on public.shows for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
 create policy test_song_workspace on public.songs for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
 grant usage on schema public,auth to authenticated,anon; grant select on public.workspaces to authenticated;
 grant select,update on public.shows to authenticated; grant select,delete on public.songs to authenticated;
 create publication supabase_realtime;`)
 const migration=readFileSync(new URL('../supabase/migrations/20260827000400_show_setlists.sql',import.meta.url),'utf8')
 await db.exec(migration);await db.exec(migration)
 const workspace='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002'
 const show='20000000-0000-4000-8000-000000000001',copyShow='20000000-0000-4000-8000-000000000002',otherShow='20000000-0000-4000-8000-000000000003'
 const a='30000000-0000-4000-8000-000000000001',b='30000000-0000-4000-8000-000000000002',foreignSong='30000000-0000-4000-8000-000000000003'
 await db.exec(`insert into public.workspaces values('${workspace}'),('${other}'); insert into public.shows(id,workspace_id) values('${show}','${workspace}'),('${copyShow}','${workspace}'),('${otherShow}','${other}');insert into public.songs values('${a}','${workspace}','legacy-a'),('${b}','${workspace}',null),('${foreignSong}','${other}',null);set role authenticated; set test.actor='40000000-0000-4000-8000-000000000001';set test.workspace='${workspace}';`)
 const makeRow=(song,notes='')=>({id:crypto.randomUUID(),song_id:song,notes})
 const initial=[makeRow(a,'Intro'),makeRow(b,'Capo 2')]
 const save=async(showId,items,revision,allow=false)=>(await db.query('select * from public.save_show_setlist($1,$2,$3::jsonb,$4,$5)',[showId,'Setlist',JSON.stringify(items),revision,allow])).rows[0]
 const saved=await save(show,initial,0);assert.equal(saved.revision,1)
 const ordered=async(id)=>(await db.query('select id,song_id,position,notes from public.show_setlist_items where setlist_id=$1 order by position',[id])).rows
 assert.deepEqual((await ordered(saved.id)).map(x=>x.song_id),[a,b])
 assert.deepEqual((await db.query('select setlist from public.shows where id=$1',[show])).rows[0].setlist,['legacy-a',b])
 await save(show,[{...initial[1],notes:'Edited cue'},initial[0]],1)
 assert.equal((await ordered(saved.id))[0].notes,'Edited cue')
 await assert.rejects(save(show,initial,1),/changed on another device/)
 await assert.rejects(save(show,[makeRow(a),makeRow(a)],2),/Duplicate songs/)
 await assert.rejects(save(show,[makeRow(foreignSong)],2),/missing or belongs/)
 assert.equal((await ordered(saved.id)).length,2)
 await save(show,[initial[1]],2);assert.equal((await ordered(saved.id)).length,1)
 const copy=await save(copyShow,[makeRow(b,'Copied note')],0)
 await save(copyShow,[],1);assert.equal((await ordered(saved.id)).length,1)
 await assert.rejects(save(otherShow,[makeRow(a)],0),/not available/)
 await assert.rejects(db.query('insert into public.show_setlist_items(workspace_id,setlist_id,song_id,position) values($1,$2,$3,5)',[workspace,saved.id,foreignSong]),/foreign key/)
 await assert.rejects(db.query('insert into public.show_setlists(workspace_id,show_id) values($1,$2)',[other,otherShow]),/row-level security/)
 await db.exec(`set test.workspace='${other}';`)
 assert.equal((await db.query('select * from public.show_setlists')).rows.length,0)
 assert.equal((await db.query('select * from public.show_setlist_items')).rows.length,0)
 await db.exec('set role anon;')
 await assert.rejects(db.query('select * from public.show_setlists'),/permission denied/)
 await assert.rejects(save(show,[],3),/permission denied/)
 await db.exec(`set role authenticated;set test.workspace='${workspace}';`)
 await db.query('delete from public.songs where id=$1',[b])
 assert.equal((await ordered(saved.id)).length,0)
 assert.equal((await ordered(copy.id)).length,0)
 }finally{await db.close()}
})
