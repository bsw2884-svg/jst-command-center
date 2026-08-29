import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const compile = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'))
const helpersUrl = moduleUrl(compile('../src/lib/setlists.ts'))
const { durationSeconds, runtimeSummary, tuningChanges, moveSetlistRow, copySetlistRows, validateSetlist, resolveCatalogSong } = await import(helpersUrl)
const song = (id, length = '2:48', tuning = 'Standard') => ({ id, title: id, length, tuning })
const row = (id, length, tuning) => ({ id: `row-${id}`, song_id: id, notes: `cue ${id}`, song: song(id, length, tuning) })
test('runtime uses only valid existing durations and labels incomplete sets', () => {
  assert.equal(durationSeconds('2:48'), 168)
  for (const value of ['', '3:60', 'three minutes', '0:00', null]) assert.equal(durationSeconds(value), null)
  assert.equal(runtimeSummary([row('A'), row('B', '1:12')]), '2 SONGS · 4:00 EST.')
  assert.equal(runtimeSummary([row('A'), row('B', '')]), '2 SONGS · 2:48 KNOWN · INCOMPLETE')
  assert.equal(runtimeSummary([row('A', '')]), '1 SONG · RUNTIME NOT SET')
})
test('tuning change detection ignores unknown/case-only changes', () => {
  assert.equal(tuningChanges(song('A'), song('B', '', 'Drop D')), true)
  assert.equal(tuningChanges(song('A'), song('B', '', ' standard ')), false)
  assert.equal(tuningChanges(null, song('B')), false)
  assert.equal(tuningChanges(song('A', '', ''), song('B')), false)
})
test('reorder, removal and independent copying preserve per-row notes', () => {
  const original = [row('A'), row('B'), row('C')]
  const moved = moveSetlistRow(original, 0, 2)
  assert.deepEqual(moved.map(x => x.song_id), ['B', 'C', 'A'])
  assert.equal(moved[2].notes, 'cue A')
  assert.deepEqual(original.map(x => x.song_id), ['A', 'B', 'C'])
  assert.equal(moveSetlistRow(original, 0, -1), original)
  assert.equal(moveSetlistRow(original, 2, 3), original)
  const copied = copySetlistRows(moved)
  assert.notEqual(copied[0].id, moved[0].id)
  copied[0].notes = 'changed'; copied[0].song.title = 'different'
  assert.equal(moved[0].notes, 'cue B'); assert.equal(moved[0].song.title, 'B')
  assert.equal(copied.filter(x => x.id !== copied[0].id).length, 2)
})
test('UUID and legacy IDs resolve uniquely; explicit repeated-song permission is required', () => {
  const catalog = [{ ...song('uuid-A'), legacy_id: 'legacy-A' }]
  assert.equal(resolveCatalogSong(catalog, 'legacy-A').id, 'uuid-A')
  assert.equal(resolveCatalogSong(catalog, 'uuid-A').id, 'uuid-A')
  assert.equal(resolveCatalogSong(catalog, 'missing'), null)
  assert.throws(() => resolveCatalogSong([...catalog, { ...song('uuid-B'), legacy_id: 'uuid-A' }], 'uuid-A'), /More than one/)
  const rows = [row('A'), { ...row('A'), id: 'encore' }]
  assert.throws(() => validateSetlist(rows, false), /repeated songs/)
  assert.doesNotThrow(() => validateSetlist(rows, true))
  assert.throws(() => validateSetlist([row('A'), row('A')], true), /row IDs/)
  assert.throws(() => validateSetlist([{ ...row('A'), song: null }], false), /unavailable/)
  assert.throws(() => validateSetlist([{ ...row('A'), notes: 'x'.repeat(2001) }], false), /2,000/)
})
const coreUrl = moduleUrl(`
  export const calls=[];
  const builder={ select(){return this}, eq(...args){calls.push(['eq',...args]);return this}, or(value){calls.push(['or',value]);return this}, async limit(){return {data:[{id:'db-show'}],error:null}} };
  export const requireSupabase=()=>({from:()=>builder,rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:{id:'setlist',revision:2},error:null}}});
`)
const { calls } = await import(coreUrl)
const { setlistService } = await import(moduleUrl(compile('../src/lib/services/setlists.ts').replace("from './core'", `from '${coreUrl}'`).replace("from '../setlists'", `from '${helpersUrl}'`)))
test('service saves UUID song references atomically with expected revision and duplicate consent', async () => {
  await setlistService.save('workspace', 'legacy-show', ' Set A ', [row('uuid-song')], 1, false)
  assert.deepEqual(calls.at(-1), ['rpc', 'save_show_setlist', {p_show_id:'db-show',p_name:'Set A',p_expected_revision:1,p_allow_duplicates:false,p_items:[{id:'row-uuid-song',song_id:'uuid-song',notes:'cue uuid-song'}]}])
  assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='legacy_id'&&call[2]==='legacy-show'))
  await setlistService.resolveShow('workspace', '10000000-0000-4000-8000-000000000001')
  assert.ok(calls.some(call=>call[0]==='or'&&call[1].includes('legacy_id.eq.')))
  const before=calls.length
  await assert.rejects(setlistService.save('workspace','show','Set A',[row('A'),{...row('A'),id:'encore'}],1,false),/repeated songs/)
  assert.equal(calls.length,before)
})
