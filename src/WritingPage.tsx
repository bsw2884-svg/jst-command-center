import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, Circle, FileAudio, Mic, Music2, Pencil, Plus, RotateCcw, Square, Trash2, Upload, X } from 'lucide-react'
import { AUDIO_ACCEPT, writingService, type AudioClipRecord, type MemberContext, type WritingSongRecord, type WritingStage } from './lib/services'
import './writing.css'

const STAGES: WritingStage[] = ['Idea', 'Writing', 'Demo', 'Arrangement', 'Ready to Record']
type StageFilter = 'All' | WritingStage
const blankDraft = { title: '', stage: 'Idea' as WritingStage, progress: 10, musical_key: '', tuning: 'Standard', next_step: '', notes: '' }
type Draft = typeof blankDraft

const messageOf = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === 'object' && cause && 'message' in cause ? String(cause.message) : 'Something went wrong.'
const setupMissing = (message: string) => /writing_songs|song_audio_clips|song-audio|schema cache|relation/i.test(message)
const dateLabel = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

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
  const [stageFilter, setStageFilter] = useState<StageFilter>('All')
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
  const filteredSongs = stageFilter === 'All' ? songs : songs.filter(song => song.stage === stageFilter)
  if (loading) return <div className="writingState"><Music2/><b>OPENING THE WRITING ROOM…</b></div>
  if (error && setupMissing(error)) return <SetupRequired detail={error}/>
  if (selected) return <WritingDetail context={context} song={selected} clips={clips.filter(clip => clip.writing_song_id === selected.id)} onBack={() => setSelectedId(null)} onChanged={load} onEdit={() => { setEditing(selected); setSelectedId(null) }} onDeleted={() => setSelectedId(null)} onCatalogChanged={onCatalogChanged}/>

  return <section className="writingPage">
    {error && <div className="writingError">{error}<button onClick={() => void load()}>TRY AGAIN</button></div>}
    <div className="writingIntro"><div><span className="eyebrow">JST SONG LAB</span><h2>IN THE WORKS</h2><p>Ideas, demos, voice memos, and everything becoming a song.</p></div></div>
    <div className="writingStageKey" role="group" aria-label="Filter Writing songs by stage">{(['All', ...STAGES] as StageFilter[]).map(stage => <button type="button" className={`writingFilter stage-${stage.toLowerCase().replaceAll(' ', '-')} ${stageFilter === stage ? 'active' : ''}`} aria-pressed={stageFilter === stage} onClick={() => setStageFilter(stage)} key={stage}>{stage}</button>)}</div>
    {filteredSongs.length ? <div className="writingGrid">{filteredSongs.map(song => {
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
    })}</div> : songs.length ? <div className="writingFilterEmpty"><Music2/><b>NO SONGS IN THIS STAGE YET.</b><span>Pick another stage or switch back to All.</span></div> : <div className="writingEmpty"><Music2/><h3>THE PAGE IS BLANK. GOOD.</h3><p>Start a song and give the first idea somewhere to live.</p><button className="primary" onClick={() => setCreating(true)}><Plus/> Start a Song</button></div>}
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
  const [recordOpen, setRecordOpen] = useState(false)
  const [error, setError] = useState('')
  const [moving, setMoving] = useState(false)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const registerPreviewAudio = useCallback((audio: HTMLAudioElement | null) => { previewAudioRef.current = audio }, [])

  useEffect(() => {
    let active = true
    Promise.all(clips.map(async clip => [clip.id, await writingService.signedUrl(clip.storage_path)] as const))
      .then(entries => { if (active) setUrls(Object.fromEntries(entries)) })
      .catch(cause => setError(messageOf(cause)))
    return () => { active = false }
  }, [clips])

  const pauseExistingAudio = () => Object.values(audioRefs.current).forEach(audio => audio?.pause())
  const oneAtATime = (id: string) => { previewAudioRef.current?.pause(); Object.entries(audioRefs.current).forEach(([key, audio]) => { if (key !== id) audio?.pause() }) }
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
    <div className="clipSectionHead"><div><span className="eyebrow">AUDIO BOARD</span><h3>{clips.length} CLIP{clips.length === 1 ? '' : 'S'}</h3></div><div className="clipSectionActions"><button className="primary recordIdeaButton" onClick={() => { pauseExistingAudio(); setRecordOpen(true) }}><Mic/> Record Idea</button><button className="ghost" onClick={() => setUploadOpen(true)} disabled={uploading}><Upload/> Upload Clip</button></div></div>
    {recordOpen && <RecordIdea context={context} songId={song.id} clips={clips} registerPreview={registerPreviewAudio} pauseExistingAudio={pauseExistingAudio} onClose={() => setRecordOpen(false)} onSaved={onChanged}/>} {/* Native microphone recorder */}
    <div className="clipList">{clips.length ? clips.map((clip, index) => <AudioClip key={clip.id} index={clips.length - index} clip={clip} url={urls[clip.id]} register={audio => { audioRefs.current[clip.id] = audio }} onPlay={() => oneAtATime(clip.id)} onChanged={onChanged} context={context}/>) : <div className="clipEmpty"><FileAudio/><b>NO AUDIO YET</b><span>Upload a voice memo, riff, demo, or mix.</span></div>}</div>
    {uploadOpen && <UploadModal busy={uploading} onClose={() => !uploading && setUploadOpen(false)} onUpload={async values => {
      setUploading(true); setError('')
      try { await writingService.upload(context, song.id, values.file, values.name, values.notes, values.duration); setUploadOpen(false); await onChanged() }
      catch (cause) { setError(messageOf(cause)) }
      finally { setUploading(false) }
    }}/>} {/* Audio upload sheet */}
  </section>
}

type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'preview' | 'saving'

const recordingMimeCandidates = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

const recordingExtension = (mime: string) => mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'

function RecordIdea({ context, songId, clips, registerPreview, pauseExistingAudio, onClose, onSaved }: { context: MemberContext; songId: string; clips: AudioClipRecord[]; registerPreview: (audio: HTMLAudioElement | null) => void; pauseExistingAudio: () => void; onClose: () => void; onSaved: () => Promise<void> }) {
  const nextIdea = Math.max(0, ...clips.map(clip => Number(/^Idea\s+(\d+)$/i.exec(clip.display_name)?.[1] ?? 0))) + 1
  const [phase, setPhase] = useState<RecorderPhase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [name, setName] = useState(`Idea ${nextIdea}`)
  const [notes, setNotes] = useState('')
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const previewUrlRef = useRef('')
  const startedAtRef = useRef(0)
  const discardOnStopRef = useRef(false)
  const requestIdRef = useRef(0)
  const mountedRef = useRef(true)

  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
  const clearStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }, [])
  const clearPreview = useCallback(() => {
    registerPreview(null)
    setBlob(null)
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = ''
    setPreviewUrl('')
  }, [registerPreview])

  useEffect(() => () => {
    mountedRef.current = false
    requestIdRef.current += 1
    discardOnStopRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    clearStream()
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    registerPreview(null)
  }, [clearStream, registerPreview])

  useEffect(() => {
    if (phase !== 'recording' && phase !== 'preview') return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    if (phase === 'preview') return () => window.removeEventListener('beforeunload', warn)
    const update = () => setElapsed((performance.now() - startedAtRef.current) / 1000)
    update()
    const timer = window.setInterval(update, 200)
    return () => { window.clearInterval(timer); window.removeEventListener('beforeunload', warn) }
  }, [phase])

  const start = async () => {
    if (!supported || phase === 'requesting' || phase === 'recording' || phase === 'saving') return
    clearPreview(); pauseExistingAudio(); setError(''); setElapsed(0); setPhase('requesting')
    const requestId = ++requestIdRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mountedRef.current || requestId !== requestIdRef.current) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      const mimeType = recordingMimeCandidates.find(candidate => MediaRecorder.isTypeSupported(candidate))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []
      discardOnStopRef.current = false
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onerror = () => { discardOnStopRef.current = true; setError('Recording was interrupted. Check the microphone and try again.'); setPhase('idle'); clearStream() }
      recorder.onstop = () => {
        const recordedDuration = Math.max(0, (performance.now() - startedAtRef.current) / 1000)
        clearStream()
        if (discardOnStopRef.current || !mountedRef.current) { chunksRef.current = []; if (mountedRef.current) setPhase('idle'); return }
        const baseMime = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0]
        const nextBlob = new Blob(chunksRef.current, { type: baseMime })
        chunksRef.current = []
        if (!nextBlob.size) { setError('No audio was captured. Check the microphone and try again.'); setPhase('idle'); return }
        const url = URL.createObjectURL(nextBlob)
        previewUrlRef.current = url
        setBlob(nextBlob); setDuration(recordedDuration); setElapsed(recordedDuration); setPreviewUrl(url); setPhase('preview')
      }
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (recorder.state === 'recording') recorder.stop()
      }, { once: true }))
      startedAtRef.current = performance.now()
      recorder.start(250)
      setPhase('recording')
    } catch (cause) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      clearStream(); setPhase('idle')
      const named = cause as DOMException
      setError(named?.name === 'NotAllowedError' || named?.name === 'SecurityError'
        ? 'Microphone access was blocked. Allow microphone access in your browser settings, then try again.'
        : named?.name === 'NotFoundError'
          ? 'No microphone was found on this device.'
          : `Could not start the microphone. ${messageOf(cause)}`)
    }
  }

  const stop = () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() }
  const cancel = () => {
    requestIdRef.current += 1
    discardOnStopRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    clearStream(); clearPreview(); setPhase('idle'); setError(''); onClose()
  }
  const retake = async () => { clearPreview(); setPhase('idle'); setError(''); await start() }
  const save = async () => {
    if (!blob || phase !== 'preview') return
    setPhase('saving'); setError('')
    try {
      const mime = blob.type || 'audio/webm'
      const file = new File([blob], `${name.trim() || `Idea ${nextIdea}`}.${recordingExtension(mime)}`, { type: mime })
      await writingService.upload(context, songId, file, name, notes, duration)
      clearPreview(); await onSaved(); onClose()
    } catch (cause) { setError(messageOf(cause)); setPhase('preview') }
  }

  return <section className="recordIdeaPanel" aria-live="polite">
    <div className="recordIdeaHead"><div><span className="eyebrow">QUICK CAPTURE</span><h4>RECORD IDEA</h4></div><button className="icon" aria-label="Close recorder" disabled={phase === 'saving'} onClick={cancel}><X/></button></div>
    {!supported ? <div className="recorderNotice">This browser cannot record audio. You can still use Upload Clip.</div> : phase === 'idle' ? <div className="recordIdle"><Mic/><div><b>CAPTURE IT BEFORE IT'S GONE.</b><span>Your recording stays on this device until you press Save.</span></div><button className="primary" onClick={() => void start()}><Circle/> Start Recording</button></div> : phase === 'requesting' ? <div className="recordIdle"><Mic/><div><b>WAITING FOR MICROPHONE…</b><span>Choose Allow when your browser asks.</span></div></div> : phase === 'recording' ? <div className="recordingLive"><span className="recBadge"><i/> REC</span><strong>{timeLabel(elapsed)}</strong><div><button className="ghost" onClick={cancel}>Cancel</button><button className="primary recorderStop" onClick={stop}><Square/> Stop</button></div></div> : <div className="recordPreview">
      <div className="recordPreviewPlayer"><span><b>PREVIEW</b><small>{timeLabel(duration)} · not uploaded yet</small></span><audio ref={registerPreview} controls src={previewUrl} onPlay={pauseExistingAudio}/></div>
      <div className="recordPreviewFields"><label><span>CLIP NAME</span><input value={name} onChange={event => setName(event.target.value)}/></label><label><span>NOTES</span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Riff, melody, lyric, arrangement idea…"/></label></div>
      <div className="recordPreviewActions"><button className="ghost" disabled={phase === 'saving'} onClick={() => void retake()}><RotateCcw/> Retake</button><button className="ghost" disabled={phase === 'saving'} onClick={cancel}>Cancel</button><button className="primary" disabled={phase === 'saving' || !name.trim()} onClick={() => void save()}>{phase === 'saving' ? 'SAVING…' : <><Check/> Save to Song</>}</button></div>
    </div>}
    {error && <div className="recorderError">{error}</div>}
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
  return <div className="scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="modal uploadModal" onSubmit={event => { event.preventDefault(); if (file && !busy) void onUpload({ file, name, notes, duration }) }}><div className="modalHead"><div><span className="eyebrow">ADD TO THE AUDIO BOARD</span><h2>UPLOAD CLIP</h2></div><button className="icon" type="button" onClick={onClose}><X/></button></div><label className="audioDrop"><Upload/><b>{file ? file.name : 'CHOOSE AUDIO'}</b><span>MP3, WAV, M4A, AAC, WebM, or Ogg · up to 50 MB</span><input required type="file" accept={AUDIO_ACCEPT} onChange={event => choose(event.target.files?.[0] ?? null)}/></label><div className="formGrid"><label><span>CLIP NAME</span><input required value={name} onChange={event => setName(event.target.value)}/></label><label className="wide"><span>NOTES</span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="What are we listening for?"/></label></div><div className="modalActions"><button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={!file || busy}>{busy ? 'UPLOADING AUDIO…' : <><Upload/> Upload Clip</>}</button></div></form></div>
}

function WritingSongModal({ initial, title, onClose, onSave }: { initial: Draft; title: string; onClose: () => void; onSave: (draft: Draft) => Promise<void> }) {
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await onSave({ ...draft, title: draft.title.trim() }) } catch (cause) { setError(messageOf(cause)); setBusy(false) } }
  return <div className="scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="modal writingModal" onSubmit={submit}><div className="modalHead"><div><span className="eyebrow">JST WRITING ROOM</span><h2>{title}</h2></div><button className="icon" type="button" onClick={onClose}><X/></button></div>{error && <div className="writingError">{error}</div>}<div className="formGrid"><label className="wide"><span>SONG TITLE</span><input autoFocus required value={draft.title} onChange={event => set('title', event.target.value)}/></label><label><span>STAGE</span><select value={draft.stage} onChange={event => set('stage', event.target.value as WritingStage)}>{STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></label><label><span>PROGRESS · {draft.progress}%</span><div className="writingProgressInput"><input type="range" min="0" max="100" step="5" value={draft.progress} onChange={event => set('progress', Number(event.target.value))}/><input aria-label="Progress percent" type="number" min="0" max="100" step="5" value={draft.progress} onChange={event => set('progress', Math.min(100, Math.max(0, Number(event.target.value))))}/><b>%</b></div></label><label><span>KEY</span><input value={draft.musical_key} onChange={event => set('musical_key', event.target.value)} placeholder="A Major"/></label><label><span>TUNING</span><input value={draft.tuning} onChange={event => set('tuning', event.target.value)} placeholder="Standard"/></label><label className="wide"><span>NEXT STEP</span><input value={draft.next_step} onChange={event => set('next_step', event.target.value)} placeholder="Finish the second verse…"/></label><label className="wide"><span>SONG NOTES</span><textarea value={draft.notes} onChange={event => set('notes', event.target.value)} placeholder="Lyrics, arrangement ideas, references…"/></label></div><div className="modalActions"><button className="ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'SAVING…' : 'Save Writing Song'}</button></div></form></div>
}

function SetupRequired({ detail }: { detail: string }) { return <section className="writingSetup"><FileAudio/><span className="eyebrow">ONE-TIME SUPABASE SETUP</span><h2>THE WRITING ROOM NEEDS ITS BACKSTAGE PASS.</h2><p>Apply <code>20260821000100_writing_audio.sql</code> in the Supabase SQL Editor, then reload this page. No app data needs to be replaced.</p><details><summary>Technical detail</summary><pre>{detail}</pre></details></section> }

const toDraft = (song: WritingSongRecord): Draft => ({ title: song.title, stage: song.stage, progress: song.progress, musical_key: song.musical_key, tuning: song.tuning, next_step: song.next_step, notes: song.notes })
