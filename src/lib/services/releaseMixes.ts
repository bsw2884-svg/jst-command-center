import type { RealtimeChannel } from '@supabase/supabase-js'
import { requireSupabase } from './core'
import { SONG_AUDIO_BUCKET, validateAudioFile } from './writing'
import type {
  MemberContext,
  MixApprovalStatus,
  MixNoteCategory,
  MixNoteStatus,
  ReleaseMixNoteRecord,
  ReleaseMixVersionRecord,
} from './types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const safeName = (name: string) => name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-100)
const extension = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

async function currentUserId() {
  const { data, error } = await requireSupabase().auth.getUser()
  if (error || !data.user) throw error ?? new Error('Your authenticated session is unavailable.')
  return data.user.id
}

async function resolveReleaseId(workspaceId: string, identifier: string) {
  let query = requireSupabase().from('releases').select('id').eq('workspace_id', workspaceId)
  query = UUID_PATTERN.test(identifier)
    ? query.or(`id.eq.${identifier},legacy_id.eq.${identifier}`)
    : query.eq('legacy_id', identifier)
  const { data, error } = await query.limit(2)
  if (error) throw error
  if (!data?.length) throw new Error('This release has not synced to Supabase yet.')
  if (data.length > 1) throw new Error('More than one cloud release matched this release.')
  return data[0].id as string
}

export const releaseMixService = {
  resolveReleaseId,

  async listVersions(workspaceId: string, releaseIdentifier: string) {
    const releaseId = await resolveReleaseId(workspaceId, releaseIdentifier)
    const { data, error } = await requireSupabase().from('release_mix_versions').select('*')
      .eq('workspace_id', workspaceId).eq('release_id', releaseId).order('created_at', { ascending: false })
    if (error) throw error
    return { releaseId, versions: (data ?? []) as ReleaseMixVersionRecord[] }
  },

  async listNotes(workspaceId: string, releaseId: string) {
    const { data, error } = await requireSupabase().from('release_mix_notes').select('*')
      .eq('workspace_id', workspaceId).eq('release_id', releaseId).order('timestamp_seconds').order('created_at')
    if (error) throw error
    return (data ?? []) as ReleaseMixNoteRecord[]
  },

  async signedUrl(storagePath: string) {
    const { data, error } = await requireSupabase().storage.from(SONG_AUDIO_BUCKET).createSignedUrl(storagePath, 60 * 60)
    if (error) throw error
    return data.signedUrl
  },

  async uploadVersion(context: MemberContext, releaseIdentifier: string, file: File, displayName: string, description: string, durationSeconds: number | null) {
    validateAudioFile(file)
    const client = requireSupabase()
    const workspaceId = context.membership.workspace_id
    const releaseId = await resolveReleaseId(workspaceId, releaseIdentifier)
    const versionId = crypto.randomUUID()
    const storagePath = `${workspaceId}/releases/${releaseId}/${versionId}-${safeName(file.name)}`
    const { error: uploadError } = await client.storage.from(SONG_AUDIO_BUCKET).upload(storagePath, file, { contentType: file.type || undefined, upsert: false })
    if (uploadError) throw uploadError
    try {
      const userId = await currentUserId()
      const { data, error } = await client.from('release_mix_versions').insert({
        id: versionId,
        workspace_id: workspaceId,
        release_id: releaseId,
        storage_path: storagePath,
        display_name: displayName.trim() || file.name.replace(/\.[^.]+$/, ''),
        description: description.trim(),
        mime_type: file.type || `audio/${extension(file.name)}`,
        size_bytes: file.size,
        duration_seconds: durationSeconds,
        approval_status: 'In Review',
        uploaded_by: userId,
        uploaded_by_member_id: context.member.id,
        uploaded_by_name: context.member.display_name,
      }).select().single()
      if (error) throw error
      return data as ReleaseMixVersionRecord
    } catch (error) {
      await client.storage.from(SONG_AUDIO_BUCKET).remove([storagePath])
      throw error
    }
  },

  async updateVersion(context: MemberContext, id: string, patch: { display_name?: string; description?: string; approval_status?: MixApprovalStatus }) {
    const { data, error } = await requireSupabase().from('release_mix_versions').update(patch)
      .eq('workspace_id', context.membership.workspace_id).eq('id', id).select().single()
    if (error) throw error
    return data as ReleaseMixVersionRecord
  },

  async addNote(context: MemberContext, releaseId: string, mixVersionId: string, input: { timestamp_seconds: number; category: MixNoteCategory; note: string }) {
    const userId = await currentUserId()
    const { data, error } = await requireSupabase().from('release_mix_notes').insert({
      workspace_id: context.membership.workspace_id,
      release_id: releaseId,
      mix_version_id: mixVersionId,
      timestamp_seconds: Math.max(0, input.timestamp_seconds),
      category: input.category,
      note: input.note.trim(),
      status: 'Open',
      author_user_id: userId,
      author_member_id: context.member.id,
      author_name: context.member.display_name,
    }).select().single()
    if (error) throw error
    return data as ReleaseMixNoteRecord
  },

  async updateNote(context: MemberContext, id: string, patch: { timestamp_seconds?: number; category?: MixNoteCategory; note?: string; status?: MixNoteStatus }) {
    const { data, error } = await requireSupabase().from('release_mix_notes').update(patch)
      .eq('workspace_id', context.membership.workspace_id).eq('id', id).select().single()
    if (error) throw error
    return data as ReleaseMixNoteRecord
  },

  async removeNote(context: MemberContext, id: string) {
    const { data, error } = await requireSupabase().from('release_mix_notes').delete()
      .eq('workspace_id', context.membership.workspace_id).eq('id', id).select('id')
    if (error) throw error
    if (data?.length !== 1) throw new Error('The mix note could not be deleted because it no longer exists or access was denied.')
  },

  subscribe(workspaceId: string, onChange: () => void): RealtimeChannel {
    return requireSupabase().channel(`release-mixes:${workspaceId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'release_mix_versions', filter: `workspace_id=eq.${workspaceId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'release_mix_notes', filter: `workspace_id=eq.${workspaceId}` }, onChange)
      .subscribe()
  },
}
