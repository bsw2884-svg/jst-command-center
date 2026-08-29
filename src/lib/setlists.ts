export type SetlistSong = { id: string; legacy_id?: string | null; title: string; tuning: string; length: string }
export type SetlistRow = { id: string; song_id: string; notes: string; song: SetlistSong | null }
export type SetlistHeader = { id: string; workspace_id: string; show_id: string; name: string; revision: number; created_at: string; updated_at: string }
export type SetlistData = { showId: string; showDate: string | null; header: SetlistHeader | null; rows: SetlistRow[]; catalog: SetlistSong[]; legacy: boolean }
export type PreviousSetlist = SetlistHeader & { show: { name: string; show_date: string | null } }

export function durationSeconds(value?: string | null): number | null {
  const match = /^(\d+):([0-5]\d)$/.exec(value?.trim() ?? '')
  if (!match) return null
  const seconds = Number(match[1]) * 60 + Number(match[2])
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null
}
export function formatRuntime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
export function runtimeSummary(rows: SetlistRow[]) {
  const durations = rows.map(row => durationSeconds(row.song?.length))
  const known = durations.filter((value): value is number => value !== null)
  const incomplete = known.length < rows.length
  return `${rows.length} SONG${rows.length === 1 ? '' : 'S'} · ${known.length ? formatRuntime(known.reduce((sum, n) => sum + n, 0)) + (incomplete ? ' KNOWN · INCOMPLETE' : ' EST.') : 'RUNTIME NOT SET'}`
}
export function tuningChanges(previous?: SetlistSong | null, next?: SetlistSong | null) {
  const a = previous?.tuning.trim().toLowerCase(), b = next?.tuning.trim().toLowerCase()
  return Boolean(a && b && a !== b)
}
export function moveSetlistRow(rows: SetlistRow[], from: number, to: number): SetlistRow[] {
  if (from < 0 || to < 0 || from >= rows.length || to >= rows.length || from === to) return rows
  const result = [...rows]; const [row] = result.splice(from, 1); result.splice(to, 0, row); return result
}
export function resolveCatalogSong(catalog: SetlistSong[], identifier: string) {
  const matches = catalog.filter(song => song.id === identifier || song.legacy_id === identifier)
  if (matches.length > 1) throw new Error('More than one catalog song matched this ID. Resolve the duplicate IDs first.')
  return matches[0] ?? null
}
export function copySetlistRows(rows: SetlistRow[]): SetlistRow[] {
  return rows.map(row => ({ ...row, id: crypto.randomUUID(), song: row.song ? { ...row.song } : null }))
}
export function validateSetlist(rows: SetlistRow[], allowDuplicates: boolean) {
  if (rows.length > 200) throw new Error('A setlist can contain up to 200 songs.')
  if (rows.some(row => !row.song)) throw new Error('Remove unavailable songs before saving.')
  if (rows.some(row => row.notes.length > 2000)) throw new Error('Performance notes must be 2,000 characters or fewer.')
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Setlist row IDs must be unique.')
  if (!allowDuplicates && new Set(rows.map(row => row.song_id)).size !== rows.length) throw new Error('Enable Allow repeated songs to save duplicate songs.')
}
