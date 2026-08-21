import type { RealtimeChannel } from '@supabase/supabase-js'
import { requireSupabase } from './core'
import type { AudioClipRecord, MemberContext, SongRecord, WritingSongRecord } from './types'

export const SONG_AUDIO_BUCKET = 'song-audio'
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024
export const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac'

type WritingInput = Pick<WritingSongRecord, 'title' | 'stage' | 'progress' | 'musical_key' | 'tuning' | 'next_step' | 'notes'>

const safeName = (name: string) => name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-100)
const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
const allowedExtensions = new Set(['mp3', 'wav', 'm4a', 'aac'])

export function validateAudioFile(file: File) {
  if (!allowedExtensions.has(ext(file.name))) throw new Error('Choose an MP3, WAV, M4A, or AAC audio file.')
  if (file.size > MAX_AUDIO_BYTES) throw new Error('Audio clips must be 50 MB or smaller.')
}

const attribution = (context: MemberContext) => ({
  last_edited_by_member_id: context.member.id,
  last_edited_by_name: context.member.display_name,
})

export const writingService = {
  async list(workspaceId: string) {
    const { data, error } = await requireSupabase().from('writing_songs').select('*').eq('workspace_id', workspaceId).order('updated_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as WritingSongRecord[]
  },

  async create(context: MemberContext, input: WritingInput) {
    const workspaceId = context.membership.workspace_id
    const { data, error } = await requireSupabase().from('writing_songs').insert({
      ...input,
      workspace_id: workspaceId,
      created_by_member_id: context.member.id,
      created_by_name: context.member.display_name,
      ...attribution(context),
    }).select().single()
    if (error) throw error
    return data as WritingSongRecord
  },

  async update(context: MemberContext, id: string, patch: Partial<WritingInput>) {
    const { data, error } = await requireSupabase().from('writing_songs').update({ ...patch, ...attribution(context) })
      .eq('workspace_id', context.membership.workspace_id).eq('id', id).select().single()
    if (error) throw error
    return data as WritingSongRecord
  },

  async remove(context: MemberContext, id: string) {
    const clips = await this.listClips(context.membership.workspace_id, id)
    if (clips.length) {
      const { error: storageError } = await requireSupabase().storage.from(SONG_AUDIO_BUCKET).remove(clips.map(clip => clip.storage_path))
      if (storageError) throw storageError
    }
    const { error } = await requireSupabase().from('writing_songs').delete().eq('workspace_id', context.membership.workspace_id).eq('id', id)
    if (error) throw error
  },

  async listClips(workspaceId: string, writingSongId?: string) {
    let query = requireSupabase().from('song_audio_clips').select('*').eq('workspace_id', workspaceId)
    if (writingSongId) query = query.eq('writing_song_id', writingSongId)
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as AudioClipRecord[]
  },

  async signedUrl(storagePath: string) {
    const { data, error } = await requireSupabase().storage.from(SONG_AUDIO_BUCKET).createSignedUrl(storagePath, 60 * 60)
    if (error) throw error
    return data.signedUrl
  },

  async upload(context: MemberContext, writingSongId: string, file: File, displayName: string, notes: string, durationSeconds: number | null) {
    validateAudioFile(file)
    const client = requireSupabase()
    const clipId = crypto.randomUUID()
    const workspaceId = context.membership.workspace_id
    const storagePath = `${workspaceId}/${writingSongId}/${clipId}-${safeName(file.name)}`
    const { error: uploadError } = await client.storage.from(SONG_AUDIO_BUCKET).upload(storagePath, file, { contentType: file.type || undefined, upsert: false })
    if (uploadError) throw uploadError
    const user = await client.auth.getUser()
    if (user.error || !user.data.user) {
      await client.storage.from(SONG_AUDIO_BUCKET).remove([storagePath])
      throw user.error ?? new Error('Your authenticated session is unavailable.')
    }
    const { data, error } = await client.from('song_audio_clips').insert({
      id: clipId,
      workspace_id: workspaceId,
      writing_song_id: writingSongId,
      storage_path: storagePath,
      display_name: displayName.trim() || file.name.replace(/\.[^.]+$/, ''),
      mime_type: file.type || `audio/${ext(file.name)}`,
      size_bytes: file.size,
      duration_seconds: durationSeconds,
      notes: notes.trim(),
      uploaded_by: user.data.user.id,
      uploaded_by_member_id: context.member.id,
      uploaded_by_name: context.member.display_name,
    }).select().single()
    if (error) {
      await client.storage.from(SONG_AUDIO_BUCKET).remove([storagePath])
      throw error
    }
    return data as AudioClipRecord
  },

  async updateClip(context: MemberContext, id: string, patch: Pick<Partial<AudioClipRecord>, 'display_name' | 'notes'>) {
    const { data, error } = await requireSupabase().from('song_audio_clips').update(patch)
      .eq('workspace_id', context.membership.workspace_id).eq('id', id).select().single()
    if (error) throw error
    return data as AudioClipRecord
  },

  async removeClip(context: MemberContext, clip: AudioClipRecord) {
    const client = requireSupabase()
    const { error: storageError } = await client.storage.from(SONG_AUDIO_BUCKET).remove([clip.storage_path])
    if (storageError) throw storageError
    const { error } = await client.from('song_audio_clips').delete().eq('workspace_id', context.membership.workspace_id).eq('id', clip.id)
    if (error) throw error
  },

  async moveToCatalog(id: string) {
    const { data, error } = await requireSupabase().rpc('move_writing_song_to_catalog', { target_writing_song_id: id })
    if (error) throw error
    return data as SongRecord
  },

  subscribe(workspaceId: string, onChange: () => void): RealtimeChannel {
    return requireSupabase().channel(`writing:${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'writing_songs', filter: `workspace_id=eq.${workspaceId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'song_audio_clips', filter: `workspace_id=eq.${workspaceId}` }, onChange)
      .subscribe()
  },
}
