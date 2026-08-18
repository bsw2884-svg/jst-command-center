export type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined }

export type CloudRecord = {
  id: string
  workspace_id: string
  legacy_id: string | null
  created_at: string
  updated_at: string
  last_edited_by_member_id?: string | null
  last_edited_by_name?: string | null
}

export type SongRecord = CloudRecord & {
  title: string; bpm: number; musical_key: string; tuning: string; length: string; status: string; notes: string
}

export type ShowRecord = CloudRecord & {
  name: string; venue: string; location: string; show_date: string | null
  load_in: string | null; soundcheck: string | null; set_time: string | null
  ticket_goal: number; tickets_sold: number; ticket_price: number
  contact: string; promoter: string; sound_engineer: string; address: string
  ticket_notes: string; parking_notes: string; entrance_notes: string; wifi_notes: string
  green_room_notes: string; notes: string; quick_notes: string; poster_reference: string | null
  setlist: Json; checklist: Json; merch: Json; recap: Json | null; show_mode_state: Json
}

export type RehearsalRecord = CloudRecord & {
  rehearsal_date: string | null; start_time: string | null; end_time: string | null
  location: string; attendees: string; goals: Json; songs: Json; notes: string
  after_notes: Json; completed: boolean
}

export type ReleaseRecord = CloudRecord & {
  song_name: string; release_date: string | null
  artwork_status: string; recording_status: string; mixing_status: string
  mastering_status: string; distribution_status: string; promotion_status: string
  artwork_reference: string | null; promotion_information: Json; milestones: Json; notes: string
}

export type ContentItemRecord = CloudRecord & {
  title: string; content_type: string; platform: string; status: string
  song: string; show_name: string; planned_date: string | null; notes: string
}

export type TaskRecord = CloudRecord & {
  name: string; category: string; due_date: string | null; priority: string
  assigned: string; notes: string; complete: boolean
}

export type Workspace = {
  id: string; name: string; created_by: string; created_at: string; updated_at: string
}

export type WorkspaceMembership = {
  workspace_id: string
  user_id: string
  role: 'admin' | 'member'
  created_at: string
  workspace: Workspace
}

export type BandMember = {
  id: string
  workspace_id: string
  slug: string
  display_name: string
  default_role: 'admin' | 'member'
  created_at: string
}

export type MemberContext = {
  membership: WorkspaceMembership
  member: BandMember
}

export type CloudMigrationRecord = {
  workspace_id: string
  migration_key: string
  completed_at: string
  completed_by: string
  counts: Json
}
