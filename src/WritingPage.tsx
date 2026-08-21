import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, FileAudio, Music2, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { AUDIO_ACCEPT, writingService, type AudioClipRecord, type MemberContext, type WritingSongRecord, type WritingStage } from './lib/services'
import './writing.css'

const STAGES: WritingStage[] = ['Idea', 'Writing', 'Demo', 'Arrangement', 'Ready to Record']
const blankDraft = { title: '', stage: 'Idea' as WritingStage, progress: 10, musical_key: '', tuning: 'Standard', next_step: '', notes: '' }
type Draft = typeof blankDraft

const messageOf = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === 'object' && cause && 'message' in cause ? String(cause.message) : 'Something went wrong.'
const setupMissing = (message: string) => /writing_songs|song_audio_clips|song-audio|schema cache|relation/i.test(message)
const dateLabel = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export default function WritingPage({ context, onCatalogChanged }: { context: MemberContext | null; onCatalogChanged: () => void }) {
  if (!context) return <section className="writingSetup"><FileAudio/><span className="eyebrow">SUPABASE REQUIRED</span><h2>THE WRITING ROOM NEEDS CLOUD ACCESS.</h2><p>Add the public Supabase URL and publishable key to <code>.env.local</code>. Audio is never stored in localStorage.</p></section>
  return <WritingCloudPage context={context} onCatalogChanged={onCatalogChanged}/>
}

function WritingCloudPage({ context, onCatalogChanged }: { context: MemberContext; onCatalogChanged: () => void }) {
  const workspaceId = context.membership.workspace_id
  const [songs, setSongs] = useState<WritingSongRecord[]>([])
  const [clips, setClips] = useState<AudioClipRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<WritingSongRecord | null>(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [nextSongs, nextClips] = await Promise.all([writingService.list(workspaceId), writingService.listClips(workspaceId)])
      setSongs(nextSongs)
      setClips(nextClips)
      setError('')
    } catch (cause) { setError(messageOf(cause)) }
    finally { setLoading(false) }
  }, [workspaceId])

  useEffect(() => { void load(); const channel = writingService.subscribe(workspaceId, () => void load()); return () => { void channel.unsubscribe() } }, [load, workspaceId])
  useEffect(() => { const open = () => setCreating(true); window.addEventListener('jst-new-writing-song', open); return () => window.removeEventListener('jst-new-writing-song', open) }, [])

  const selected = songs.find(song => song.id === selectedId) ?? null
  if (loading) return <div className="writingState"><Music2/><b>OPENING THE WRITING ROOM…</b></div>
  if (error && setupMissing(error)) return <SetupRequired detail={error}/>
  if (selected) return <WritingDetail context={context} song={selected} clips={clips.filter(clip => clip.writing_song_id === selected.id)} onBack={() => setSelectedId(null)} onChanged={load} onEdit={() => { setEditing(selected); setSelectedId(null) }} onDeleted={() => setSelectedId(null)} onCatalogChanged={onCatalogChanged}/>

  return <section className="writingPage">
    {error && <div className="writingError">{error}<button onClick={() => void load()}>TRY AGAIN</button></div>}
    <div className="writingIntro"><div><span className="eyebrow">JST SONG LAB</span><h2>IN THE WORKS</h2><p>Ideas, demos, voice memos, and everything becoming a song.</p></div><button className="primary writingNew" onClick={() => setCreating(true)}><Plus/> New Writing Song</button></div>
    <div className="writingStageKey">{STAGES.map(stage => <span key={stage}>{stage}</span>)}</div>
    {songs.length ? <div className="writingGrid">{songs.map(song => {
      const songClips = clips.filter(clip => clip.writing_song_id === song.id)
      return <article className="writingCard" key={song.id} onClick={() => setSelectedId(song.id)}>
        <div className={`writingStage stage-${song.stage.toLowerCase().replaceAll(' ', '-')}`}>{song.stage}</div>
        <h3>{song.title}</h3>
        <p>{song.next_step || 'Next step not set yet.'}</p>
        <div className="writingProgress"><i style={{ width: `${song.progress}%` }}/></div>
        <div className="writingCardMeta"><span><b>{song.progress}%</b> BUILT</span><span><FileAudio/><b>{songClips.length}</b> CLIP{songClips.length === 1 ? '' : 'S'}</span></div>
        {songClips[0] && <div className="writingLatestClip"><FileAudio/><span><small>LATEST CLIP</small><b>{songClips[0].display_name}</b></span></div>}
        <small>EDITED {dateLabel(song.updated_at)} · {song.last_edited_by_name || 'JST'}</small>
      </article>
    })}</div> : <div className="writingEmpty"><Music2/><h3>THE PAGE IS BLANK. GOOD.</h3><p>Start a song and give the first idea somewhere to live.</p><button className="primary" onClick={() => setCreating(true)}><Plus/> Start a Song</button></div>}
    {(creating || editing) && <WritingSongModal initial={editing ? toDraft(editing) : blankDraft} title={editing ? 'EDIT WRITING SONG' : 'NEW WRITING SONG'} onClose={() => { setCreating(false); setEditing(null) }} onSave={async draft => {
      if (editing) await writingService.update(context, editing.id, draft)
      else await writingService.create(context, draft)
      setCreating(false); setEditing(null); await load()
    }}/>} {/* Writing-song editor */}
  </section>
}

function WritingDetail({ context, song, clips, onBack, onChanged, onEdit, onDeleted, onCatalogChanged }: { context: MemberContext; song: WritingSongRecord; clips: AudioClipRecord[]; onBack: () => void; onChanged: () => Promise<void>; onEdit: () => void; onDeleted: () => void; onCatalogChanged: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [error, setError] = useState('')
  const [moving, setMoving] = useState(false)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  useEffect(() => {
    let active = true
    Promise.all(clips.map(async clip => [clip.id, await writingService.signedUrl(clip.storage_path)] as const))
      .then(entries => { if (active) setUrls(Object.fromEntries(entries)) })
      .catch(cause => setError(messageOf(cause)))
    return () => { active = false }
  }, [clips])

  const oneAtATime = (id: string) => Object.entries(audioRefs.current).forEach(([key, audio]) => { if (key !== id) audio?.pause() })
  const move = async () => {
    if (!confirm(`Move “${song.title}” into the Songs catalog? Its Writing history and audio clips will stay here.`)) return
    setMoving(true); setError('')
    try { await writingService.moveToCatalog(song.id); await onChanged(); onCatalogChanged() }
    catch (cause) { setError(messageOf(cause)) }
    finally { setMoving(false) }
  }

  return <section className="writingDetail">
    <button className="writingBack" onClick={onBack}><ArrowLeft/> All Writing Songs</button>
    {error && <div className="writingError">{error}</div>}
    <header className="writingDetailHead"><div><span className={`writingStage stage-${song.stage.toLowerCase().replaceAll(' ', '-')}`}>{song.stage}</span><h2>{song.title}</h2><p>{song.next_step || 'Next step not set yet.'}</p></div><div className="writingDetailActions"><button className="ghost" onClick={onEdit}><Pencil/> Edit</button><button className="ghost danger" aria-label="Delete writing song" onClick={async () => { if (!confirm(`Delete “${song.title}” and all of its audio clips?`)) return; try { await writingService.remove(context, song.id); onDeleted() } catch (cause) { setError(messageOf(cause)) } }}><Trash2/></button>{(song.stage === 'Ready to Record' || song.converted_song_id) && <button className="primary" disabled={moving || Boolean(song.converted_song_id)} onClick={() => void move()}>{song.converted_song_id ? <><Check/> In Songs</> : moving ? 'MOVING…' : <><Music2/> Move to Songs</>}</button>}</div></header>
    <div className="writingFacts"><div><span>PROGRESS</span><b>{song.progress}%</b><div className="writingProgress"><i style={{ width: `${song.progress}%` }}/></div></div><div><span>KEY</span><b>{song.musical_key || 'Not set'}</b></div><div><span>TUNING</span><b>{song.tuning || 'Not set'}</b></div></div>
    {song.notes && <article className="writingNotes"><span className="eyebrow">SONG NOTES</span><p>{song.notes}</p></article>}
    <div className="clipSectionHead"><div><span className="eyebrow">AUDIO BOARD</span><h3>{clips.length} CLIP{clips.length === 1 ? '' : 'S'}</h3></div><button className="primary" onClick={() => setUploadOpen(true)} disabled={uploading}><Upload/> Upload Clip</button></div>
    <div className="clipList">{clips.length ? clips.map((clip, index) => <AudioClip key={clip.id} index={clips.length - index} clip={clip} url={urls[clip.id]} register={audio => { audioRefs.current[clip.id] = audio }} onPlay={() => oneAtATime(clip.id)} onChanged={onChanged} context={context}/>) : <div className="clipEmpty"><FileAudio/><b>NO AUDIO YET</b><span>Upload a voice memo, riff, demo, or mix.</span></div>}</div>
    {uploadOpen && <UploadModal busy={uploading} onClose={() => !uploading && setUploadOpen(false)} onUpload={async values => {
      setUploading(true); setError('')
      try { await writingService.upload(context, song.id, values.file, values.name, values.notes, values.duration); setUploadOpen(false); await onChanged() }
      catch (cause) { setError(messageOf(cause)) }
      finally { setUploading(false) }
    }}/>} {/* Audio upload sheet */}
  </section>
}

function AudioClip({ clip, url, index, register, onPlay, onChanged, context }: { clip: AudioClipRecord; url?: string; index: number; register: (audio: HTMLAudioElement | null) => void; onPlay: () => void; onChanged: () => Promise<void>; context: MemberContext }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(clip.display_name)
  const [notes, setNotes] = useState(clip.notes)
  const [busy, setBusy] = useState(false)
  return <article className="audioClip">
    <div className="clipNumber">TAKE {String(index).padStart(2, '0')}</div>
    <div className="clipInfo">{editing ? <><input aria-label="Clip name" value={name} onChange={event => setName(event.target.value)}/><textarea aria-label="Clip notes" value={notes} onChange={event => setNotes(event.target.value)}/></> : <><h4>{clip.display_name}</h4><p>{clip.notes || 'No clip notes.'}</p></>}</div>
    <div className="clipMeta"><span>{sizeLabel(clip.size_bytes)}</span><span>{clip.uploaded_by_name || 'JST'}</span><time>{dateLabel(clip.created_at)}</time></div>
    <audio ref={register} controls preload="metadata" src={url} onPlay={onPlay}/>
    <div className="clipActions">{editing ? <><button className="icon" aria-label="Save clip" disabled={busy} onClick={async () => { setBusy(true); await writingService.updateClip(context, clip.id, { display_name: name.trim() || clip.display_name, notes }); await onChanged(); setEditing(false); setBusy(false) }}><Check/></button><button className="icon" aria-label="Cancel edit" onClick={() => setEditing(false)}><X/></button></> : <><button className="icon" aria-label="Edit clip" onClick={() => setEditing(true)}><Pencil/></button><button className="icon danger" aria-label="Delete clip" disabled={busy} onClick={async () => { if (!confirm(`Delete “${clip.display_name}”? This removes the audio file permanently.`)) return; setBusy(true); await writingService.removeClip(context, clip); await onChanged() }}><Trash2/></button></>}</div>
  </article>
}

function UploadModal({ busy, onClose, onUpload }: { busy: boolean; onClose: () => void; onUpload: (values: { file: File; name: string; notes: string; duration: number | null }) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null), [name, setName] = useState(''), [notes, setNotes] = useState(''), [duration, setDuration] = useState<number | null>(null)
  const choose = (next: File | null) => { setFile(next); setName(next?.name.replace(/\.[^.]+$/, '') ?? ''); setDuration(null); if (next) { const audio = new Audio(URL.createObjectURL(next)); audio.onloadedmetadata = () => { if (Number.isFinite(audio.duration)) setDuration(audio.duration); URL.revokeObjectURL(audio.src) } } }
  return <div className="scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="modal uploadModal" onSubmit={event => { event.preventDefault(); if (file && !busy) void onUpload({ file, name, notes, duration }) }}><div className="modalHead"><div><span className="eyebrow">ADD TO THE AUDIO BOARD</span><h2>UPLOAD CLIP</h2></div><button className="icon" type="button" onClick={onClose}><X/></button></div><label className="audioDrop"><Upload/><b>{file ? file.name : 'CHOOSE AUDIO'}</b><span>MP3, WAV, M4A, or AAC · up to 50 MB</span><input required type="file" accept={AUDIO_ACCEPT} onChange={event => choose(event.target.files?.[0] ?? null)}/></label><div className="formGrid"><label><span>CLIP NAME</span><input required value={name} onChange={event => setName(event.target.value)}/></label><label className="wide"><span>NOTES</span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="What are we listening for?"/></label></div><div className="modalActions"><button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={!file || busy}>{busy ? 'UPLOADING AUDIO…' : <><Upload/> Upload Clip</>}</button></div></form></div>
}

function WritingSongModal({ initial, title, onClose, onSave }: { initial: Draft; title: string; onClose: () => void; onSave: (draft: Draft) => Promise<void> }) {
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await onSave({ ...draft, title: draft.title.trim() }) } catch (cause) { setError(messageOf(cause)); setBusy(false) } }
  return <div className="scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="modal writingModal" onSubmit={submit}><div className="modalHead"><div><span className="eyebrow">JST WRITING ROOM</span><h2>{title}</h2></div><button className="icon" type="button" onClick={onClose}><X/></button></div>{error && <div className="writingError">{error}</div>}<div className="formGrid"><label className="wide"><span>SONG TITLE</span><input autoFocus required value={draft.title} onChange={event => set('title', event.target.value)}/></label><label><span>STAGE</span><select value={draft.stage} onChange={event => set('stage', event.target.value as WritingStage)}>{STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></label><label><span>PROGRESS · {draft.progress}%</span><input type="range" min="0" max="100" step="5" value={draft.progress} onChange={event => set('progress', Number(event.target.value))}/></label><label><span>KEY</span><input value={draft.musical_key} onChange={event => set('musical_key', event.target.value)} placeholder="A Major"/></label><label><span>TUNING</span><input value={draft.tuning} onChange={event => set('tuning', event.target.value)} placeholder="Standard"/></label><label className="wide"><span>NEXT STEP</span><input value={draft.next_step} onChange={event => set('next_step', event.target.value)} placeholder="Finish the second verse…"/></label><label className="wide"><span>SONG NOTES</span><textarea value={draft.notes} onChange={event => set('notes', event.target.value)} placeholder="Lyrics, arrangement ideas, references…"/></label></div><div className="modalActions"><button className="ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'SAVING…' : 'Save Writing Song'}</button></div></form></div>
}

function SetupRequired({ detail }: { detail: string }) { return <section className="writingSetup"><FileAudio/><span className="eyebrow">ONE-TIME SUPABASE SETUP</span><h2>THE WRITING ROOM NEEDS ITS BACKSTAGE PASS.</h2><p>Apply <code>20260821000100_writing_audio.sql</code> in the Supabase SQL Editor, then reload this page. No app data needs to be replaced.</p><details><summary>Technical detail</summary><pre>{detail}</pre></details></section> }

const toDraft = (song: WritingSongRecord): Draft => ({ title: song.title, stage: song.stage, progress: song.progress, musical_key: song.musical_key, tuning: song.tuning, next_step: song.next_step, notes: song.notes })
