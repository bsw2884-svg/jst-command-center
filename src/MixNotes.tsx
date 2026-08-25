import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronDown, ChevronUp, Clock3, FileAudio, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { AUDIO_ACCEPT, releaseMixService } from './lib/services'
import type {
  MemberContext,
  MixNoteCategory,
  MixNoteStatus,
  ReleaseMixNoteRecord,
  ReleaseMixVersionRecord,
} from './lib/services'

const categories: MixNoteCategory[] = ['Overall', 'Vocals', 'Drums', 'Bass', 'Guitars', 'FX', 'Other']
const filters: Array<'All' | MixNoteStatus> = ['All', 'Open', 'Resolved']
const errorMessage = (reason: unknown, fallback: string) => {
  if (reason instanceof Error) return reason.message
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') return reason.message
  return fallback
}

const secondsLabel = (value: number) => {
  const seconds = Math.max(0, Math.round(Number(value) || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const parseTimestamp = (value: string) => {
  const parts = value.trim().split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  return parts.length === 1 ? Math.max(0, parts[0]) : Math.max(0, parts.at(-2)! * 60 + parts.at(-1)!)
}

const fileDuration = (file: File) => new Promise<number | null>(resolve => {
  const url = URL.createObjectURL(file)
  const audio = new Audio()
  const done = (duration: number | null) => {
    URL.revokeObjectURL(url)
    resolve(duration)
  }
  audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null)
  audio.onerror = () => done(null)
  audio.src = url
})

type NoteDraft = {
  id?: string
  timestamp: string
  category: MixNoteCategory
  note: string
}

export function ReleaseMixNotes({ context, releaseId, releaseName }: { context: MemberContext | null; releaseId: string; releaseName: string }) {
  const [expanded, setExpanded] = useState(false)
  const [versions, setVersions] = useState<ReleaseMixVersionRecord[]>([])
  const [notes, setNotes] = useState<ReleaseMixNoteRecord[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<'All' | MixNoteStatus>('All')
  const [versionForm, setVersionForm] = useState(false)
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const playerRef = useRef<HTMLAudioElement>(null)

  const load = useCallback(async () => {
    if (!context) return
    try {
      const result = await releaseMixService.listVersions(context.membership.workspace_id, releaseId)
      const nextNotes = await releaseMixService.listNotes(context.membership.workspace_id, result.releaseId)
      setVersions(result.versions)
      setNotes(nextNotes)
      setSelectedVersionId(current => result.versions.some(version => version.id === current) ? current : result.versions[0]?.id ?? '')
      const entries = await Promise.all(result.versions.map(async version => [version.id, await releaseMixService.signedUrl(version.storage_path)] as const))
      setSignedUrls(Object.fromEntries(entries))
      setError('')
    } catch (reason) {
      setError(errorMessage(reason, 'Mix Notes could not load.'))
    }
  }, [context, releaseId])

  useEffect(() => {
    void load()
    if (!context) return
    const channel = releaseMixService.subscribe(context.membership.workspace_id, () => void load())
    return () => { void channel.unsubscribe() }
  }, [context, load])

  const selectedVersion = versions.find(version => version.id === selectedVersionId) ?? null
  const selectedNotes = useMemo(() => notes.filter(note => note.mix_version_id === selectedVersionId), [notes, selectedVersionId])
  const openCount = selectedNotes.filter(note => note.status === 'Open').length
  const resolvedCount = selectedNotes.filter(note => note.status === 'Resolved').length
  const visibleNotes = selectedNotes.filter(note => filter === 'All' || note.status === filter)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
    } catch (reason) {
      setError(errorMessage(reason, 'That Mix Notes action did not finish.'))
    } finally {
      setBusy(false)
    }
  }

  const beginNote = (note?: ReleaseMixNoteRecord) => {
    if (!selectedVersion) return
    setExpanded(true)
    setNoteDraft(note ? {
      id: note.id,
      timestamp: secondsLabel(note.timestamp_seconds),
      category: note.category,
      note: note.note,
    } : {
      timestamp: secondsLabel(playerRef.current?.currentTime ?? 0),
      category: 'Overall',
      note: '',
    })
  }

  const saveNote = async (event: FormEvent) => {
    event.preventDefault()
    if (!context || !selectedVersion || !noteDraft?.note.trim()) return
    await run(async () => {
      const input = {
        timestamp_seconds: parseTimestamp(noteDraft.timestamp),
        category: noteDraft.category,
        note: noteDraft.note,
      }
      if (noteDraft.id) await releaseMixService.updateNote(context, noteDraft.id, input)
      else await releaseMixService.addNote(context, selectedVersion.release_id, selectedVersion.id, input)
      setNoteDraft(null)
    })
  }

  const uploadVersion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!context) return
    const form = new FormData(event.currentTarget)
    const file = form.get('audio')
    if (!(file instanceof File) || !file.size) {
      setError('Choose an audio file for this mix version.')
      return
    }
    await run(async () => {
      await releaseMixService.uploadVersion(
        context,
        releaseId,
        file,
        String(form.get('name') ?? ''),
        String(form.get('description') ?? ''),
        await fileDuration(file),
      )
      setVersionForm(false)
    })
  }

  const toggleApproval = async () => {
    if (!context || !selectedVersion) return
    const approving = selectedVersion.approval_status !== 'Approved'
    if (approving && openCount && !window.confirm(`This mix still has ${openCount} open note${openCount === 1 ? '' : 's'}. Approve it anyway?`)) return
    await run(() => releaseMixService.updateVersion(context, selectedVersion.id, { approval_status: approving ? 'Approved' : 'In Review' }))
  }

  const seekTo = (seconds: number) => {
    const player = playerRef.current
    if (!player) return
    player.currentTime = seconds
    void player.play()
  }

  if (!context) return null

  return <section className="mixNotesShell" aria-label={`Mix Notes for ${releaseName}`}>
    <div className="mixNotesSummary">
      <div>
        <span className="eyebrow">MIX NOTES</span>
        {selectedVersion?.approval_status === 'Approved'
          ? <strong className="mixApproved"><Check /> MIX APPROVED</strong>
          : <strong>{selectedVersion ? `${openCount} Open · ${resolvedCount} Resolved` : 'No mix versions yet'}</strong>}
      </div>
      <div className="mixSummaryActions">
        <button className="ghost" onClick={() => { setExpanded(true); setVersionForm(true) }}><Plus /> Add Mix Version</button>
        <button className="ghost" disabled={!selectedVersion} onClick={() => beginNote()}><Clock3 /> Add Note</button>
        <button className="ghost" onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronUp /> : <ChevronDown />} {expanded ? 'Hide' : 'View'} All Notes</button>
      </div>
    </div>

    {expanded && <div className="mixNotesPanel">
      {error && <p className="mixError" role="alert">{error}</p>}
      {versionForm && <form className="mixVersionForm" onSubmit={uploadVersion}>
        <div className="mixFormHeading"><div><span className="eyebrow">NEW MIX VERSION</span><h3>Upload a new pass</h3></div><button type="button" className="icon" onClick={() => setVersionForm(false)} aria-label="Close upload form"><X /></button></div>
        <label>Version name<input name="name" required placeholder="Mix 03 — Vocal Up" /></label>
        <label>Description<textarea name="description" placeholder="What changed in this version?" /></label>
        <label>Audio file<input name="audio" type="file" accept={AUDIO_ACCEPT} required /></label>
        <button className="primary" disabled={busy}><FileAudio /> {busy ? 'Uploading…' : 'Upload Mix'}</button>
      </form>}

      {!versions.length && !versionForm && !error && <div className="mixEmpty"><FileAudio /><h3>No mix versions yet</h3><p>Upload the first mix to start timestamped feedback.</p><button className="primary" onClick={() => setVersionForm(true)}><Plus /> Add Mix Version</button></div>}

      {!!versions.length && <>
        <div className="mixVersionTabs" role="tablist" aria-label="Mix versions">
          {versions.map(version => {
            const versionNotes = notes.filter(note => note.mix_version_id === version.id)
            const versionOpen = versionNotes.filter(note => note.status === 'Open').length
            return <button key={version.id} className={version.id === selectedVersionId ? 'active' : ''} onClick={() => { setSelectedVersionId(version.id); setNoteDraft(null) }}>
              <b>{version.display_name}</b><span>{version.approval_status}{versionOpen ? ` · ${versionOpen} open` : ''}</span>
            </button>
          })}
        </div>

        {selectedVersion && <div className="mixVersionDetail">
          <div className="mixVersionHeader">
            <div><span className="eyebrow">CURRENT MIX</span><h3>{selectedVersion.display_name}</h3><p>{selectedVersion.description || 'No version notes.'}</p><small>Uploaded by {selectedVersion.uploaded_by_name || 'JST member'} · {new Date(selectedVersion.created_at).toLocaleDateString()}</small></div>
            <button className={selectedVersion.approval_status === 'Approved' ? 'ghost' : 'primary'} onClick={toggleApproval} disabled={busy}>
              {selectedVersion.approval_status === 'Approved' ? <><RotateCcw /> Reopen Review</> : <><Check /> Approve Mix</>}
            </button>
          </div>
          {signedUrls[selectedVersion.id] && <audio
            ref={playerRef}
            className="mixPlayer"
            src={signedUrls[selectedVersion.id]}
            controls
            preload="metadata"
            onPlay={event => document.querySelectorAll('audio').forEach(audio => { if (audio !== event.currentTarget) audio.pause() })}
          />}

          <div className="mixNotesToolbar">
            <div className="mixFilters" aria-label="Mix note filters">{filters.map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div>
            <button className="primary" onClick={() => beginNote()}><Clock3 /> Add Note at {secondsLabel(playerRef.current?.currentTime ?? 0)}</button>
          </div>

          {noteDraft && <form className="mixNoteForm" onSubmit={saveNote}>
            <label>Timestamp<input value={noteDraft.timestamp} onChange={event => setNoteDraft({ ...noteDraft, timestamp: event.target.value })} placeholder="0:00" /></label>
            <label>Category<select value={noteDraft.category} onChange={event => setNoteDraft({ ...noteDraft, category: event.target.value as MixNoteCategory })}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
            <label className="grow">Note<textarea required value={noteDraft.note} onChange={event => setNoteDraft({ ...noteDraft, note: event.target.value })} placeholder="What should change?" /></label>
            <div className="mixNoteFormActions"><button type="button" className="ghost" onClick={() => setNoteDraft(null)}>Cancel</button><button className="primary" disabled={busy}>{noteDraft.id ? 'Save Note' : 'Add Note'}</button></div>
          </form>}

          <div className="mixNoteList">
            {!visibleNotes.length && <p className="mixEmptyMessage">{filter === 'All' ? 'No notes on this mix yet.' : `No ${filter.toLowerCase()} notes on this mix.`}</p>}
            {visibleNotes.map(note => <article className={`mixNote ${note.status.toLowerCase()}`} key={note.id}>
              <button className="mixTimestamp" onClick={() => seekTo(note.timestamp_seconds)}>{secondsLabel(note.timestamp_seconds)}</button>
              <div className="mixNoteCopy"><div><span className="mixCategory">{note.category}</span><span className={`mixStatus ${note.status.toLowerCase()}`}>{note.status}</span></div><p>{note.note}</p><small>{note.author_name || 'JST member'} · {new Date(note.created_at).toLocaleString()}</small></div>
              <div className="mixNoteActions">
                <button className="icon" onClick={() => beginNote(note)} aria-label="Edit note"><Pencil /></button>
                <button className="icon" onClick={() => context && run(() => releaseMixService.updateNote(context, note.id, { status: note.status === 'Open' ? 'Resolved' : 'Open' }))} aria-label={note.status === 'Open' ? 'Resolve note' : 'Reopen note'}>{note.status === 'Open' ? <Check /> : <RotateCcw />}</button>
                <button className="icon danger" onClick={() => context && window.confirm('Delete this mix note?') && run(() => releaseMixService.removeNote(context, note.id))} aria-label="Delete note"><Trash2 /></button>
              </div>
            </article>)}
          </div>
        </div>}
      </>}
    </div>}
  </section>
}
