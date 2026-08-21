import { supabase } from '../supabase'
import type { CloudRecord } from './types'

type TableName = 'songs' | 'shows' | 'rehearsals' | 'releases' | 'content_items' | 'tasks'
type NewRecord<T extends CloudRecord> = Omit<T, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>
type RecordPatch<T extends CloudRecord> = Partial<NewRecord<T>>
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const requireSupabase = () => {
  if (!supabase) throw new Error('Supabase is not configured. Add the Vite Supabase variables to .env.local.')
  return supabase
}

export const createWorkspaceRecordService = <T extends CloudRecord>(table: TableName) => ({
  async list(workspaceId: string): Promise<T[]> {
    const { data, error } = await requireSupabase().from(table).select('*').eq('workspace_id', workspaceId).order('created_at')
    if (error) throw error
    return (data ?? []) as T[]
  },

  async get(workspaceId: string, id: string): Promise<T | null> {
    const { data, error } = await requireSupabase().from(table).select('*').eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
    if (error) throw error
    return data as T | null
  },

  async create(workspaceId: string, record: NewRecord<T>): Promise<T> {
    const { data, error } = await requireSupabase().from(table).insert({ ...record, workspace_id: workspaceId }).select().single()
    if (error) throw error
    return data as T
  },

  async update(workspaceId: string, id: string, patch: RecordPatch<T>): Promise<T> {
    const { data, error } = await requireSupabase().from(table).update(patch as Record<string, unknown>).eq('workspace_id', workspaceId).eq('id', id).select().single()
    if (error) throw error
    return data as T
  },

  async remove(workspaceId: string, id: string): Promise<void> {
    const { error } = await requireSupabase().from(table).delete().eq('workspace_id', workspaceId).eq('id', id)
    if (error) throw error
  },

  async upsertByLegacyId(workspaceId: string, record: Record<string, unknown>): Promise<T> {
    const { data, error } = await requireSupabase().from(table)
      .upsert({ ...record, workspace_id: workspaceId }, { onConflict: 'workspace_id,legacy_id' })
      .select().single()
    if (error) throw error
    return data as T
  },

  async removeByIdentifier(workspaceId: string, identifier: string): Promise<void> {
    const client = requireSupabase()
    let lookup = client.from(table).select('id').eq('workspace_id', workspaceId)
    lookup = UUID_PATTERN.test(identifier)
      ? lookup.or(`id.eq.${identifier},legacy_id.eq.${identifier}`)
      : lookup.eq('legacy_id', identifier)

    const { data: matches, error: lookupError } = await lookup.limit(2)
    if (lookupError) throw lookupError
    if (!matches?.length) throw new Error(`No ${table} record matched “${identifier}”.`)
    if (matches.length > 1) throw new Error(`More than one ${table} record matched “${identifier}”; nothing was deleted.`)

    if (table === 'songs') {
      const { error: detachError } = await client.from('writing_songs').update({ converted_song_id: null })
        .eq('workspace_id', workspaceId).eq('converted_song_id', matches[0].id)
      if (detachError) throw detachError
    }

    const { data: deleted, error: deleteError } = await client.from(table).delete()
      .eq('workspace_id', workspaceId).eq('id', matches[0].id).select('id')
    if (deleteError) throw deleteError
    if (deleted?.length !== 1) throw new Error(`The ${table} record could not be deleted because it no longer exists or access was denied.`)
  },
})
