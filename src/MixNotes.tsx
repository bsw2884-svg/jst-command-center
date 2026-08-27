import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronDown, ChevronUp, Clock3, ExternalLink, Layers3, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { releaseMixService } from './lib/services'
import { mixLinkDetails, normalizeMixUrl } from './lib/mixLink'
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

const timestampLabel = (value: number | null) => {
  if (value === null) return ''
  const seconds = Math.max(0, Math.round(Number(value) || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const parseTimestamp = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\d+(?::[0-5]\d)?$/.test(trimmed)) throw new Error('Enter the optional timestamp as seconds or M:SS.')
  const parts = trimmed.split(':').map(Number)
  return parts.length === 1 ? parts[0] : parts[0] * 60 + parts[1]
}

type NoteDraft = {
  id?: string
  timestamp: string
  category: MixNoteCategory
  note: string
}

type VersionDraft = { id?: string; name: string; description: string; mixUrl: string }

export function ReleaseMixNotes({ context, releaseId, releaseName }: { context: MemberContext | null; releaseId: string; releaseName: string }) {
  const [expanded, setExpanded] = useState(false)
  const [versions, setVersions] = useState<ReleaseMixVersionRecord[]>([])
  const [notes, setNotes] = useState<ReleaseMixNoteRecord[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [filter, setFilter] = useState<'All' | MixNoteStatus>('All')
  const [versionForm, setVersionForm] = useState<VersionDraft | null>(null)
  const [mixLinkError, setMixLinkError] = useState('')
  const mixLinkErrorId = useId()
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const initializedExpansionForRelease = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!context) return
    try {
      const result = await releaseMixService.listVersions(context.membership.workspace_id, releaseId)
      const nextNotes = await releaseMixService.listNotes(context.membership.workspace_id, result.releaseId)
      setVersions(result.versions)
      setNotes(nextNotes)
      setSelectedVersionId(current => result.versions.some(version => version.id === current) ? current : result.versions[0]?.id ?? '')
      if (initializedExpansionForRelease.current !== releaseId) {
        initializedExpansionForRelease.current = releaseId
        setExpanded(result.versions.length > 0)
      }
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
  const selectedMixLink = mixLinkDetails(selectedVersion?.mix_url)
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
      timestamp: timestampLabel(note.timestamp_seconds),
      category: note.category,
      note: note.note,
    } : { timestamp: '', category: 'Overall', note: '' })
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

  const beginVersion = (version?: ReleaseMixVersionRecord) => {
    setExpanded(true)
    setMixLinkError('')
    setVersionForm(version
      ? { id: version.id, name: version.display_name, description: version.description, mixUrl: version.mix_url ?? '' }
      : { name: '', description: '', mixUrl: '' })
  }

  const saveVersion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!context || !versionForm) return
    let mixUrl: string | null
    try {
      mixUrl = normalizeMixUrl(versionForm.mixUrl)
      setMixLinkError('')
    } catch (reason) {
      setMixLinkError(errorMessage(reason, 'Enter a valid http:// or https:// URL.'))
      return
    }
    await run(async () => {
      const saved = versionForm.id
        ? await releaseMixService.updateVersion(context, versionForm.id, { display_name: versionForm.name.trim(), description: versionForm.description.trim(), mix_url: mixUrl })
        : await releaseMixService.createVersion(context, releaseId, versionForm.name, versionForm.description, mixUrl)
      setSelectedVersionId(saved.id)
      setVersionForm(null)
    })
  }

  const toggleApproval = async () => {
    if (!context || !selectedVersion) return
    const approving = selectedVersion.approval_status !== 'Approved'
    if (approving && openCount && !window.confirm(`This mix still has ${openCount} open note${openCount === 1 ? '' : 's'}. Approve it anyway?`)) return
    await run(() => releaseMixService.updateVersion(context, selectedVersion.id, { approval_status: approving ? 'Approved' : 'In Review' }))
  }

  if (!context) return null

  return <section className="mixNotesShell" aria-label={`Mix Notes for ${releaseName}`}>
    <div className="mixNotesSummary">
      <div>
        <span className="eyebrow">MIX NOTES</span>
        {selectedVersion?.approval_status === 'Approved'
          ? <strong className="mixApproved"><Check /> MIX APPROVED</strong>
          : <strong>{selectedVersion ? `${selectedVersion.display_name.toUpperCase()} · ${openCount} OPEN${openCount === 1 ? ' NOTE' : ' NOTES'}` : 'No mix versions yet'}</strong>}
      </div>
      <div className="mixSummaryActions">
        <button className="ghost" onClick={() => beginVersion()}><Plus /> Add Mix Version</button>
        <button className="ghost" disabled={!selectedVersion} onClick={() => beginNote()}><Plus /> Add Note</button>
        <button className="ghost" onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronUp /> : <ChevronDown />} {expanded ? 'Hide' : 'View'} All Notes</button>
      </div>
    </div>

    {expanded && <div className="mixNotesPanel">
      {error && <p className="mixError" role="alert">{error}</p>}
      {versionForm && <form className="mixVersionForm" onSubmit={saveVersion}>
        <div className="mixFormHeading"><div><span className="eyebrow">{versionForm.id ? 'EDIT MIX VERSION' : 'NEW MIX VERSION'}</span><h3>{versionForm.id ? 'Update this pass' : 'Add a new pass'}</h3></div><button type="button" className="icon" onClick={() => setVersionForm(null)} disabled={busy} aria-label="Close version form"><X /></button></div>
        <label>Version name<input name="name" required placeholder="Mix 3" value={versionForm.name} onChange={event => setVersionForm({ ...versionForm, name: event.target.value })} /></label>
        <label>Description / what changed<textarea name="description" placeholder="Fixed the ride bell and tom flam…" value={versionForm.description} onChange={event => setVersionForm({ ...versionForm, description: event.target.value })} /></label>
        <label>Mix Link (optional)<input name="mix_url" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="https://…" value={versionForm.mixUrl} onChange={event => { setVersionForm({ ...versionForm, mixUrl: event.target.value }); setMixLinkError('') }} aria-invalid={Boolean(mixLinkError)} aria-describedby={mixLinkError ? mixLinkErrorId : undefined} />{mixLinkError && <span id={mixLinkErrorId} className="mixLinkError" role="alert">{mixLinkError}</span>}</label>
        <button className="primary" disabled={busy}><Layers3 /> {busy ? 'Saving…' : versionForm.id ? 'Save Mix Version' : 'Create Mix Version'}</button>
      </form>}

      {!versions.length && !versionForm && !error && <div className="mixEmpty"><Layers3 /><h3>No mix versions yet</h3><p>Create the first mix version to start tracking feedback.</p><button className="primary" onClick={() => beginVersion()}><Plus /> Add Mix Version</button></div>}

      {!!versions.length && <>
        <div className="mixVersionTabs" role="tablist" aria-label="Mix versions">
          {versions.map(version => {
            const versionNotes = notes.filter(note => note.mix_version_id === version.id)
            const versionOpen = versionNotes.filter(note => note.status === 'Open').length
            return <button key={version.id} className={version.id === selectedVersionId ? 'active' : ''} onClick={() => { setSelectedVersionId(version.id); setNoteDraft(null) }}>
              <b>{version.display_name}</b><span>{version.approval_status === 'Approved' ? 'Approved' : `${versionOpen} open note${versionOpen === 1 ? '' : 's'}`}</span>
            </button>
          })}
        </div>

        {selectedVersion && <div className="mixVersionDetail">
          <div className="mixVersionHeader">
            <div><span className="eyebrow">CURRENT MIX</span><h3>{selectedVersion.display_name}</h3><p>{selectedVersion.description || 'No version description yet.'}</p><small>Created by {selectedVersion.uploaded_by_name || 'JST member'} · {new Date(selectedVersion.created_at).toLocaleDateString()}</small></div>
            <div className="mixVersionActions"><button className="ghost" onClick={() => beginVersion(selectedVersion)} disabled={busy}><Pencil /> Edit Mix Version</button>
            <button className={selectedVersion.approval_status === 'Approved' ? 'ghost' : 'primary'} onClick={toggleApproval} disabled={busy}>
              {selectedVersion.approval_status === 'Approved' ? <><RotateCcw /> Reopen Review</> : <><Check /> Approve Mix</>}
            </button></div>
          </div>

          {selectedMixLink && <div className="mixExternalLink"><a className="primary mixOpenLink" href={selectedMixLink.url} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open Mix</a><small>{selectedMixLink.hostname}</small></div>}

          <div className="mixNotesToolbar">
            <div className="mixFilters" aria-label="Mix note filters">{filters.map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div>
            <button className="primary" onClick={() => beginNote()}><Plus /> Add Note</button>
          </div>

          {noteDraft && <form className="mixNoteForm" onSubmit={saveNote}>
            <label>Timestamp (optional)<input value={noteDraft.timestamp} onChange={event => setNoteDraft({ ...noteDraft, timestamp: event.target.value })} placeholder="1:17" inputMode="numeric" /></label>
            <label>Category<select value={noteDraft.category} onChange={event => setNoteDraft({ ...noteDraft, category: event.target.value as MixNoteCategory })}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
            <label className="grow">Note<textarea required value={noteDraft.note} onChange={event => setNoteDraft({ ...noteDraft, note: event.target.value })} placeholder="What should change?" /></label>
            <div className="mixNoteFormActions"><button type="button" className="ghost" onClick={() => setNoteDraft(null)}>Cancel</button><button className="primary" disabled={busy}>{noteDraft.id ? 'Save Note' : 'Add Note'}</button></div>
          </form>}

          <div className="mixNoteList">
            {!visibleNotes.length && <p className="mixEmptyMessage">{filter === 'All' ? 'No notes on this mix yet.' : `No ${filter.toLowerCase()} notes on this mix.`}</p>}
            {visibleNotes.map(note => <article className={`mixNote ${note.status.toLowerCase()} ${note.timestamp_seconds === null ? 'noTimestamp' : ''}`} key={note.id}>
              {note.timestamp_seconds !== null && <span className="mixTimestamp"><Clock3 /> {timestampLabel(note.timestamp_seconds)}</span>}
              <div className="mixNoteCopy"><div><span className="mixCategory">{note.category}</span><span className={`mixStatus ${note.status.toLowerCase()}`}>{note.status}</span></div><p>{note.note}</p><small>{note.author_name || 'JST member'} · Created {new Date(note.created_at).toLocaleString()}{note.updated_at !== note.created_at && ` · Updated ${new Date(note.updated_at).toLocaleString()}`}</small></div>
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
