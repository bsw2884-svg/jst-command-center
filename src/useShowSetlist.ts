import { useCallback, useEffect, useRef, useState } from 'react'
import { setlistService } from './lib/services/setlists'
import type { SetlistData } from './lib/setlists'

export function setlistError(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Setlist could not load.'
  return /schema cache|does not exist|could not find .*show_setlist/i.test(message)
    ? 'Setlists are not available yet. Apply the show_setlists migration, then retry.' : message
}
export function useShowSetlist(workspaceId: string | undefined, showId: string) {
  const [data, setData] = useState<SetlistData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  const reload = useCallback(async () => {
    const request = ++generation.current
    if (!workspaceId) { setLoading(false); setError('Connect to your workspace to use setlists.'); return }
    try {
      const result = await setlistService.load(workspaceId, showId)
      if (request === generation.current) { setData(result); setError('') }
    } catch (reason) { if (request === generation.current) setError(setlistError(reason)) }
    finally { if (request === generation.current) setLoading(false) }
  }, [workspaceId, showId])
  useEffect(() => {
    setData(null); setLoading(true); void reload()
    const channel = workspaceId ? setlistService.subscribe(workspaceId, () => { void reload() }) : null
    return () => { generation.current++; void channel?.unsubscribe() }
  }, [workspaceId, reload])
  return { data, error, loading, reload }
}
