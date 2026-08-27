import type { NotificationRecord } from './services'

export type NotificationDestination = { page: 'Writing' | 'Releases' | 'Tasks' | 'Songs'; entityId: string | null }

export const destinationForNotification = (notification: Pick<NotificationRecord, 'entity_type' | 'entity_id'>): NotificationDestination => ({
  page: notification.entity_type === 'writing_song' ? 'Writing'
    : notification.entity_type === 'release' ? 'Releases'
      : notification.entity_type === 'task' ? 'Tasks' : 'Songs',
  entityId: notification.entity_id,
})

export const urlForNotification = (notification: Pick<NotificationRecord, 'id' | 'entity_type' | 'entity_id'>) => {
  const destination = destinationForNotification(notification)
  const params = new URLSearchParams({ open: destination.page.toLowerCase(), entity: notification.entity_id, notification: notification.id })
  return `/?${params.toString()}`
}

const destinationFromUrl = (value: string): NotificationDestination | null => {
  const url = new URL(value, window.location.origin)
  const key = url.searchParams.get('open')?.toLowerCase() as 'writing' | 'releases' | 'tasks' | 'songs' | undefined
  const page = key ? ({ writing: 'Writing', releases: 'Releases', tasks: 'Tasks', songs: 'Songs' } as const)[key] : undefined
  return page ? { page, entityId: url.searchParams.get('entity') } : null
}

export const navigateToNotificationDestination = (destination: NotificationDestination) => {
  window.dispatchEvent(new CustomEvent('jst-navigate', { detail: destination.page }))
  if (destination.page === 'Writing' && destination.entityId) {
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('jst-open-writing-song', { detail: destination.entityId })), 150)
  }
}

export const installPushNavigation = () => {
  const initial = destinationFromUrl(window.location.href)
  if (initial) queueMicrotask(() => navigateToNotificationDestination(initial))
  const receive = (event: MessageEvent<{ type?: string; url?: string }>) => {
    if (event.data?.type !== 'JST_PUSH_NAVIGATE' || !event.data.url) return
    const destination = destinationFromUrl(event.data.url)
    if (destination) navigateToNotificationDestination(destination)
  }
  navigator.serviceWorker?.addEventListener('message', receive)
  return () => navigator.serviceWorker?.removeEventListener('message', receive)
}
