import type { RealtimeChannel } from '@supabase/supabase-js'
import { requireSupabase } from './core'
import type { MemberContext, NotificationRecord } from './types'

export const notificationService = {
  async registerMember(context: MemberContext) {
    const { error } = await requireSupabase().rpc('set_notification_member', { target_member_id: context.member.id })
    if (error) throw error
  },

  async list(workspaceId: string): Promise<NotificationRecord[]> {
    const { data, error } = await requireSupabase().from('notifications').select('*')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(100)
    if (error) throw error
    return (data ?? []) as NotificationRecord[]
  },

  async markRead(workspaceId: string, id: string): Promise<void> {
    const { data, error } = await requireSupabase().from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).eq('is_read', false).select('id')
    if (error) throw error
    if ((data?.length ?? 0) > 1) throw new Error('More than one notification matched this update.')
  },

  async markAllRead(workspaceId: string): Promise<void> {
    const { error } = await requireSupabase().from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('is_read', false)
    if (error) throw error
  },

  subscribe(workspaceId: string, onChange: () => void): RealtimeChannel {
    return requireSupabase().channel(`notifications:${workspaceId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `workspace_id=eq.${workspaceId}` }, onChange)
      .subscribe()
  },
}
