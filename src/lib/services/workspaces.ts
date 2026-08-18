import { requireSupabase } from './core'
import type { BandMember, MemberContext, Workspace, WorkspaceMembership } from './types'

type MembershipQueryRow = Omit<WorkspaceMembership, 'workspace'> & { workspaces: Workspace }
const SELECTED_MEMBER_KEY = 'jst-selected-band-member-v1'

export const workspaceService = {
  async listMine(): Promise<WorkspaceMembership[]> {
    const { data: { user } } = await requireSupabase().auth.getUser()
    if (!user) return []
    const { data, error } = await requireSupabase()
      .from('workspace_members')
      .select('workspace_id,user_id,role,created_at,workspaces!inner(id,name,created_by,created_at,updated_at)')
      .eq('user_id', user.id)
    if (error) throw error
    return ((data ?? []) as unknown as MembershipQueryRow[]).map(({ workspaces, ...membership }) => ({
      ...membership,
      workspace: workspaces,
    }))
  },

  async create(name = 'JumpStart Tomorrow'): Promise<WorkspaceMembership> {
    const existing = await this.listMine()
    if (existing.length) return existing[0]
    const { data: { user } } = await requireSupabase().auth.getUser()
    if (!user) throw new Error('You must be signed in to create a workspace.')
    const { error } = await requireSupabase().from('workspaces').insert({ name, created_by: user.id })
    if (error) throw error
    const memberships = await this.listMine()
    if (!memberships.length) throw new Error('The workspace was created, but its admin membership could not be loaded.')
    return memberships[0]
  },

  async getMemberContext(): Promise<MemberContext | null> {
    const { data: { user } } = await requireSupabase().auth.getUser()
    if (!user) return null
    const { data: profile, error: profileError } = await requireSupabase()
      .from('profiles').select('band_member_id').eq('id', user.id).maybeSingle()
    if (profileError) throw profileError
    const selectedMemberId = localStorage.getItem(SELECTED_MEMBER_KEY) || profile?.band_member_id
    if (!selectedMemberId) return null
    const [{ data: member, error: memberError }, memberships] = await Promise.all([
      requireSupabase().from('band_members').select('*').eq('id', selectedMemberId).single(),
      this.listMine(),
    ])
    if (memberError) throw memberError
    const membership = memberships.find(item => item.workspace_id === member.workspace_id)
    if (!membership) throw new Error('Your band profile is not connected to its workspace.')
    return { member: member as BandMember, membership }
  },

  async selectBandMember(memberId: string): Promise<MemberContext> {
    const { error } = await requireSupabase().rpc('enter_jst_workspace', { target_member_id: memberId })
    if (error) throw error
    localStorage.setItem(SELECTED_MEMBER_KEY, memberId)
    const context = await this.getMemberContext()
    if (!context) throw new Error('The member was selected, but the workspace could not be loaded.')
    return context
  },

  clearSelectedBandMember() {
    localStorage.removeItem(SELECTED_MEMBER_KEY)
  },
}
