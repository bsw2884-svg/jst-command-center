import { requireSupabase } from './core'
import { resolveCatalogSong, validateSetlist, type SetlistData, type SetlistHeader, type SetlistRow, type SetlistSong, type PreviousSetlist } from '../setlists'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const songColumns = 'id,legacy_id,title,tuning,length'
export const setlistService = {
  async resolveShow(workspaceId: string, identifier: string) {
    let query = requireSupabase().from('shows').select('id,show_date,setlist,show_mode_state').eq('workspace_id', workspaceId)
    query = uuid.test(identifier) ? query.or(`id.eq.${identifier},legacy_id.eq.${identifier}`) : query.eq('legacy_id', identifier)
    const { data, error } = await query.limit(2)
    if (error) throw error
    if (!data?.length) throw new Error('This show must finish syncing before you can save a setlist.')
    if (data.length !== 1) throw new Error('More than one show matched this ID.')
    return data[0]
  },
  async rows(workspaceId: string, setlistId: string): Promise<SetlistRow[]> {
    const { data, error } = await requireSupabase().from('show_setlist_items')
      .select(`id,song_id,notes,song:songs!show_setlist_items_song_fkey(${songColumns})`)
      .eq('workspace_id', workspaceId).eq('setlist_id', setlistId).order('position')
    if (error) throw error
    return (data ?? []) as unknown as SetlistRow[]
  },
  async load(workspaceId: string, identifier: string): Promise<SetlistData> {
    const show = await this.resolveShow(workspaceId, identifier)
    const [headerResult, songsResult] = await Promise.all([
      requireSupabase().from('show_setlists').select('*').eq('workspace_id', workspaceId).eq('show_id', show.id).maybeSingle(),
      requireSupabase().from('songs').select(songColumns).eq('workspace_id', workspaceId).order('title'),
    ])
    if (headerResult.error) throw headerResult.error
    if (songsResult.error) throw songsResult.error
    const header = headerResult.data as SetlistHeader | null
    const catalog = (songsResult.data ?? []) as SetlistSong[]
    const legacyIds: string[] = Array.isArray(show.setlist) ? show.setlist : []
    const rows = header ? await this.rows(workspaceId, header.id) : legacyIds.map(identifier => {
      const song = resolveCatalogSong(catalog, identifier)
      const meta = show.show_mode_state?.setMeta?.[identifier]
      return { id: crypto.randomUUID(), song_id: song?.id ?? identifier, song,
        notes: [meta?.transition, meta?.cue, meta?.guitarNote, meta?.backing ? 'Backing track' : ''].filter(Boolean).join(' · ') }
    })
    return { showId: show.id, showDate: show.show_date, header, catalog, rows, legacy: !header && rows.length > 0 }
  },
  async previous(workspaceId: string, showId: string, showDate: string | null): Promise<PreviousSetlist[]> {
    const { data, error } = await requireSupabase().from('show_setlists')
      .select('*,show:shows!show_setlists_show_fkey(name,show_date)').eq('workspace_id', workspaceId).neq('show_id', showId)
    if (error) throw error
    return ((data ?? []) as unknown as PreviousSetlist[])
      .filter(item => !showDate || Boolean(item.show.show_date && item.show.show_date <= showDate))
      .sort((a, b) => (b.show.show_date ?? '').localeCompare(a.show.show_date ?? '') || b.updated_at.localeCompare(a.updated_at))
  },
  async save(workspaceId: string, showIdentifier: string, name: string, rows: SetlistRow[], revision: number, allowDuplicates: boolean) {
    validateSetlist(rows, allowDuplicates)
    if (!name.trim() || name.trim().length > 120) throw new Error('Enter a setlist name (1–120 characters).')
    const show = await this.resolveShow(workspaceId, showIdentifier)
    const { data, error } = await requireSupabase().rpc('save_show_setlist', {
      p_show_id: show.id, p_name: name.trim(), p_expected_revision: revision, p_allow_duplicates: allowDuplicates,
      p_items: rows.map(row => ({ id: row.id, song_id: row.song_id, notes: row.notes.trim() })),
    })
    if (error) throw error
    if (!data) throw new Error('Supabase did not confirm the setlist save.')
    return data as SetlistHeader
  },
  subscribe(workspaceId: string, onChange: () => void) {
    const channel = requireSupabase().channel(`setlists:${workspaceId}:${crypto.randomUUID()}`)
    for (const table of ['show_setlists', 'show_setlist_items', 'songs']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `workspace_id=eq.${workspaceId}` }, onChange)
    }
    return channel.subscribe()
  },
}
