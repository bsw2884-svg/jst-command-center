import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { runtimeSummary, tuningChanges, type SetlistRow } from './lib/setlists'
import { useShowSetlist } from './useShowSetlist'
import './setlists.css'

export function StageRun({ rows }: { rows: SetlistRow[] }) {
  const [currentId, setCurrentId] = useState(rows[0]?.id ?? '')
  const index = Math.max(0, rows.findIndex(row => row.id === currentId))
  const current = rows[index], next = rows[index + 1]
  if (!current) return <p className="setlistEmpty">No setlist yet. Build one from this show’s Setlist section.</p>
  return <div className="setlistStageRun">
    <p className="setlistPosition" aria-live="polite">{index + 1} of {rows.length}</p>
    <div className="setlistNow" aria-live="polite" aria-atomic="true"><span>NOW</span><h2>{current.song?.title || 'Song unavailable'}</h2><strong>{current.song?.tuning || 'Tuning not set'}</strong>{current.notes && <p>{current.notes}</p>}</div>
    <div className="setlistNext" aria-live="polite" aria-atomic="true"><span>NEXT</span><h3>{next ? next.song?.title || 'Song unavailable' : 'End of set'}</h3>{next && <strong>{next.song?.tuning || 'Tuning not set'}</strong>}{tuningChanges(current.song, next?.song) && <b className="setlistTuningAlert">TUNING CHANGE</b>}</div>
    <div className="setlistStageControls"><button type="button" disabled={index === 0} onClick={() => setCurrentId(rows[index - 1].id)}><ArrowLeft /> Previous</button><button type="button" disabled={index === rows.length - 1} onClick={() => setCurrentId(rows[index + 1].id)}>Next <ArrowRight /></button></div>
  </div>
}

export function SetlistStageOverlay({ showName, rows, onClose }: { showName: string; rows: SetlistRow[]; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { previous?.focus() }
  }, [])
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (event.key !== 'Tab') return
    const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const first = buttons[0], last = buttons.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return createPortal(<div ref={dialog} className="setlistStageOverlay" role="dialog" aria-modal="true" aria-label={`Show Mode: ${showName}`} onKeyDown={keyboard}>
    <div className="setlistStageShell"><div className="setlistStageHeading"><div><span className="eyebrow">JST · SHOW MODE</span><h1>{showName}</h1><p>{runtimeSummary(rows)}</p></div><button type="button" aria-label="Exit setlist Show Mode" onClick={onClose}><X /></button></div><StageRun rows={rows} /></div>
  </div>, document.body)
}

/** The existing show-day tools use the same saved setlist and read-only stage controls. */
export function SavedSetlistStage({ workspaceId, showId }: { workspaceId?: string; showId: string }) {
  const { data, loading, error, reload } = useShowSetlist(workspaceId, showId)
  return <section id="setlist" className="smSection setSection setlistStageEmbedded" aria-label="Show Mode setlist"><span className="smKicker">ON DECK</span><h2>SETLIST</h2>
    {loading ? <p>Loading setlist…</p> : error ? <div role="alert"><p>{error}</p><button onClick={() => void reload()}>Retry</button></div> : data && <><p>{runtimeSummary(data.rows)}</p><StageRun rows={data.rows} /></>}
  </section>
}
