import { supabase } from '../supabase'
import type { CloudRecord } from './types'

type TableName = 'songs' | 'shows' | 'rehearsals' | 'releases' | 'content_items' | 'tasks'
type NewRecord<T extends CloudRecord> = Omit<T, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>
type RecordPatch<T extends CloudRecord> = Partial<NewRecord<T>>

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

  async removeByLegacyId(workspaceId: string, legacyId: string): Promise<void> {
    const { error } = await requireSupabase().from(table).delete()
      .eq('workspace_id', workspaceId).eq('legacy_id', legacyId)
    if (error) throw error
  },
})
