import { useRef, useState, type PointerEvent } from 'react'
import { ArrowDown, ArrowUp, Copy, GripVertical, Music2, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import type { MemberContext } from './lib/services'
import { setlistService } from './lib/services/setlists'
import { copySetlistRows, durationSeconds, formatRuntime, moveSetlistRow, runtimeSummary, tuningChanges, type PreviousSetlist, type SetlistRow } from './lib/setlists'
import { setlistError, useShowSetlist } from './useShowSetlist'
import { SetlistStageOverlay } from './SetlistStage'
import './setlists.css'

type Draft = { name: string; revision: number; rows: SetlistRow[] }
export function ShowSetlist({ context, show, onSaved }: { context: MemberContext | null; show: { id: string; name: string }; onSaved: () => void }) {
  const workspaceId = context?.membership.workspace_id
  const { data, loading, error: loadError, reload } = useShowSetlist(workspaceId, show.id)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [allowDuplicates, setAllowDuplicates] = useState(false)
  const [songId, setSongId] = useState('')
  const [previous, setPrevious] = useState<PreviousSetlist[] | null>(null)
  const [previousId, setPreviousId] = useState('')
  const [stageRows, setStageRows] = useState<SetlistRow[] | null>(null)
  const [dropTarget, setDropTarget] = useState('')
  const dragId = useRef('')
  const root = useRef<HTMLElement>(null)
  const rows = draft?.rows ?? data?.rows ?? []
  const changeRows = (next: SetlistRow[]) => setDraft(current => current ? { ...current, rows: next } : current)
  const begin = () => {
    if (!data) return
    setDraft({ name: data.header?.name ?? 'Setlist', revision: data.header?.revision ?? 0, rows: data.rows.map(row => ({ ...row })) })
    setAllowDuplicates(false); setExpanded(true); setError('')
  }
  const save = async () => {
    if (!draft || !workspaceId) return
    setBusy(true); setError('')
    try {
      await setlistService.save(workspaceId, show.id, draft.name, draft.rows, draft.revision, allowDuplicates)
      setDraft(null); setPrevious(null); await reload(); onSaved()
    } catch (reason) { setError(setlistError(reason)) }
    finally { setBusy(false) }
  }
  const add = () => {
    const song = data?.catalog.find(song => song.id === songId)
    if (!song || !draft) return
    if (!allowDuplicates && rows.some(row => row.song_id === song.id)) { setError('This song is already in the setlist. Enable Allow repeated songs to add it again.'); return }
    changeRows([...rows, { id: crypto.randomUUID(), song_id: song.id, notes: '', song }]); setSongId(''); setError('')
  }
  const showPrevious = async () => {
    if (!data || !workspaceId) return
    setBusy(true); setError('')
    try { setPrevious(await setlistService.previous(workspaceId, data.showId, data.showDate)); setPreviousId(''); setExpanded(true) }
    catch (reason) { setError(setlistError(reason)) }
    finally { setBusy(false) }
  }
  const copyPrevious = async () => {
    if (!previousId || !data || !workspaceId) return
    if (rows.length && !window.confirm('Replace this show’s draft with the chosen setlist? Nothing is saved until you choose Save Setlist.')) return
    setBusy(true); setError('')
    try {
      const copied = copySetlistRows(await setlistService.rows(workspaceId, previousId))
      setDraft({ name: data.header?.name ?? 'Setlist', revision: draft?.revision ?? data.header?.revision ?? 0, rows: copied })
      setAllowDuplicates(false); setPrevious(null)
    } catch (reason) { setError(setlistError(reason)) }
    finally { setBusy(false) }
  }
  const moveTo = (source: string, target: string) => {
    if (draft && !busy) changeRows(moveSetlistRow(rows, rows.findIndex(row => row.id === source), rows.findIndex(row => row.id === target)))
    dragId.current = ''; setDropTarget('')
  }
  // Only the grip captures touch; the row and the page keep normal document scrolling.
  const pointerStart = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.pointerType === 'mouse' || busy) return
    dragId.current = id; setDropTarget(id); event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' || !dragId.current) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-setlist-row]')
    if (target && root.current?.contains(target)) setDropTarget(target.dataset.setlistRow ?? '')
  }
  const pointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse') return
    if (dragId.current && dropTarget) moveTo(dragId.current, dropTarget)
    dragId.current = ''; setDropTarget('')
  }
  return <section ref={root} className="showSetlist" aria-label={`Setlist for ${show.name}`}>
    <div className="setlistHeading"><div><span className="eyebrow">SETLIST</span>{data && (data.header || rows.length > 0) ? <strong>{draft ? `DRAFT · ${runtimeSummary(rows)}` : runtimeSummary(data.rows)}</strong> : <p>No setlist yet.</p>}</div>
      <div className="setlistActions"><button className="ghost" disabled={loading || busy || !data || Boolean(draft)} onClick={begin}><Pencil /> {data?.header || data?.rows.length ? 'Edit Setlist' : 'Build Setlist'}</button><button className="ghost" disabled={loading || busy || !data} onClick={() => void showPrevious()}><Copy /> Copy Previous Setlist</button>{Boolean(data?.rows.length) && <button className="primary" disabled={Boolean(draft)} onClick={() => setStageRows(data!.rows.map(row => ({ ...row })))}><Music2 /> Show Mode</button>}</div>
    </div>
    {loading && <p role="status">Loading setlist…</p>}
    {(error || loadError) && <div className="setlistError" role="alert"><p>{error || loadError}</p><button className="ghost" onClick={() => { if (!draft || window.confirm('Discard your unsaved changes and reload the saved setlist?')) { setDraft(null); setError(''); void reload() } }}>Reload saved setlist</button></div>}
    {data?.legacy && <p className="setlistHint">Existing show run order. Save it here to enable copying and per-song performance notes.</p>}
    {!draft && rows.length > 0 && <button className="textBtn" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide setlist' : 'View setlist'}</button>}
    {previous && <div className="setlistCopy"><label>Previous show<select value={previousId} onChange={event => setPreviousId(event.target.value)}><option value="">Choose a saved setlist</option>{previous.map(item => <option key={item.id} value={item.id}>{item.show.name} · {item.show.show_date ?? 'Date not set'} · {item.name}</option>)}</select></label>{!previous.length && <p>No previous shows with saved setlists yet.</p>}<div className="setlistActions"><button className="primary" disabled={!previousId || busy} onClick={() => void copyPrevious()}>Copy into draft</button><button className="ghost" onClick={() => setPrevious(null)}>Cancel copy</button></div><small>Song order and notes are copied independently. Save to keep the new setlist.</small></div>}
    {draft && <div className="setlistEditor">
      <label>Setlist name<input value={draft.name} maxLength={120} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <div className="setlistAdd"><label>Add a catalog song<select value={songId} disabled={busy} onChange={event => setSongId(event.target.value)}><option value="">Choose a song</option>{data?.catalog.map(song => <option key={song.id} value={song.id}>{song.title} · {song.tuning || 'Tuning not set'}{rows.some(row => row.song_id === song.id) ? ' · already added' : ''}</option>)}</select></label><button className="primary" disabled={!songId || busy} onClick={add}><Plus /> Add song</button></div>
      <label className="setlistDuplicate"><input type="checkbox" checked={allowDuplicates} disabled={busy} onChange={event => setAllowDuplicates(event.target.checked)} /> Allow repeated songs</label>
      <p className="setlistHint">Drag the grip to reorder, or use Move up / Move down. Changes stay in this draft until saved.</p>
    </div>}
    {expanded && <><ol className="setlistRows">{rows.map((row, index) => {
      const seconds = durationSeconds(row.song?.length)
      return <li data-setlist-row={row.id} key={row.id} className={dropTarget === row.id ? 'setlistDropTarget' : ''} onDragOver={event => { if (draft && dragId.current) { event.preventDefault(); setDropTarget(row.id) } }} onDrop={event => { event.preventDefault(); if (dragId.current) moveTo(dragId.current, row.id) }}>
        {tuningChanges(rows[index - 1]?.song, row.song) && <span className="setlistTuningChange">↓ TUNING CHANGE</span>}
        <div className="setlistSongRow"><span className="setlistOrder">{index + 1}.</span><div className="setlistSongCopy"><b>{row.song?.title || 'Song no longer in catalog'}</b><span>{row.song?.tuning || 'Tuning not set'} · {seconds === null ? 'Duration not set' : formatRuntime(seconds)}</span></div>
          {draft && <button className="setlistGrip" type="button" draggable={!busy} disabled={busy} aria-label={`Drag ${row.song?.title || 'song'} to reorder`} onDragStart={event => { dragId.current = row.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', row.id) }} onDragEnd={() => { dragId.current = ''; setDropTarget('') }} onPointerDown={event => pointerStart(event, row.id)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={() => { dragId.current = ''; setDropTarget('') }}><GripVertical /></button>}
        </div>
        {draft ? <><label className="setlistNoteLabel">Performance note<input value={row.notes} maxLength={2000} disabled={busy} placeholder="Capo 2, extended intro, no gap…" onChange={event => changeRows(rows.map(item => item.id === row.id ? { ...item, notes: event.target.value } : item))} /></label><div className="setlistRowActions"><button disabled={busy || index === 0} aria-label={`Move ${row.song?.title || 'song'} up`} onClick={() => changeRows(moveSetlistRow(rows, index, index - 1))}><ArrowUp /> Up</button><button disabled={busy || index === rows.length - 1} aria-label={`Move ${row.song?.title || 'song'} down`} onClick={() => changeRows(moveSetlistRow(rows, index, index + 1))}><ArrowDown /> Down</button><button className="danger" disabled={busy} aria-label={`Remove ${row.song?.title || 'song'} from setlist`} onClick={() => changeRows(rows.filter(item => item.id !== row.id))}><Trash2 /> Remove</button></div></> : row.notes && <p className="setlistPerformanceNote">{row.notes}</p>}
      </li>
    })}</ol>{!rows.length && !previous && <p className="setlistEmpty">{draft ? 'Choose songs from your catalog to build the run order.' : 'No setlist yet.'}</p>}</>}
    {draft && <div className="setlistSave"><strong aria-live="polite">{runtimeSummary(rows)}</strong><div className="setlistActions"><button className="primary" disabled={busy} onClick={() => void save()}><Save /> {busy ? 'Saving…' : 'Save Setlist'}</button><button className="ghost" disabled={busy} onClick={() => { if (window.confirm('Discard this setlist draft?')) { setDraft(null); setError(''); setPrevious(null) } }}>Cancel</button></div><small>Save before opening Show Mode. Previous / Next never changes the saved setlist.</small></div>}
    {stageRows && <SetlistStageOverlay showName={show.name} rows={stageRows} onClose={() => setStageRows(null)} />}
  </section>
}
