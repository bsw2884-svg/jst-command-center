import { requireSupabase } from './core'
import type { CloudMigrationRecord, Json } from './types'

export const CLOUD_DATA_MIGRATION_KEY = 'operational-data-v1'

export const cloudMigrationService = {
  async get(workspaceId: string): Promise<CloudMigrationRecord | null> {
    const { data, error } = await requireSupabase().from('cloud_migrations').select('*')
      .eq('workspace_id', workspaceId).eq('migration_key', CLOUD_DATA_MIGRATION_KEY).maybeSingle()
    if (error) throw error
    return data as CloudMigrationRecord | null
  },

  async complete(workspaceId: string, counts: Json): Promise<CloudMigrationRecord> {
    const { data: { user } } = await requireSupabase().auth.getUser()
    if (!user) throw new Error('Authentication is required to complete cloud migration.')
    const { data, error } = await requireSupabase().from('cloud_migrations').upsert({
      workspace_id: workspaceId,
      migration_key: CLOUD_DATA_MIGRATION_KEY,
      completed_by: user.id,
      completed_at: new Date().toISOString(),
      counts,
    }, { onConflict: 'workspace_id,migration_key' }).select().single()
    if (error) throw error
    return data as CloudMigrationRecord
  },
}
