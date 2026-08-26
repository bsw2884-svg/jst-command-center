import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Check, CheckCheck, CircleDot, Disc3, FileAudio, ListTodo, Mic, Music2, PenLine, SlidersHorizontal, X } from 'lucide-react'
import { notificationService, type MemberContext, type NotificationRecord, type NotificationType } from './lib/services'

const iconFor: Record<NotificationType, typeof Bell> = {
  writing_clip_added: FileAudio,
  record_idea_added: Mic,
  mix_note_added: PenLine,
  mix_version_added: Disc3,
  task_created: ListTodo,
  task_assigned: ListTodo,
  task_completed: Check,
  writing_moved_to_songs: Music2,
  release_stage_changed: SlidersHorizontal,
}

const relativeTime = (value: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const setupMissing = (message: string) => /notifications|set_notification_member|schema cache|relation/i.test(message)

export default function NotificationCenter({ context }: { context: MemberContext }) {
  const workspaceId = context.membership.workspace_id
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'All' | 'Unread'>('All')
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setNotifications(await notificationService.list(workspaceId))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notifications could not load.')
    }
  }, [workspaceId])

  useEffect(() => {
    let active = true
    let channel: ReturnType<typeof notificationService.subscribe> | null = null
    void notificationService.registerMember(context).then(async () => {
      if (!active) return
      await load()
      if (!active) return
      channel = notificationService.subscribe(workspaceId, () => void load())
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Notifications could not connect.')
    })
    return () => { active = false; if (channel) void channel.unsubscribe() }
  }, [context.member.id, workspaceId, load])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  const unreadCount = notifications.filter(notification => !notification.is_read).length
  const visible = useMemo(() => filter === 'Unread' ? notifications.filter(notification => !notification.is_read) : notifications, [filter, notifications])

  const markRead = async (notification: NotificationRecord) => {
    if (notification.is_read) return
    setNotifications(current => current.map(item => item.id === notification.id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item))
    try { await notificationService.markRead(workspaceId, notification.id) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The notification could not be marked read.'); await load() }
  }

  const navigate = async (notification: NotificationRecord) => {
    await markRead(notification)
    const page = notification.entity_type === 'writing_song' ? 'Writing'
      : notification.entity_type === 'release' ? 'Releases'
        : notification.entity_type === 'task' ? 'Tasks' : 'Songs'
    setOpen(false)
    window.dispatchEvent(new CustomEvent('jst-navigate', { detail: page }))
    if (notification.entity_type === 'writing_song') {
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('jst-open-writing-song', { detail: notification.entity_id })), 150)
    }
  }

  const markAll = async () => {
    if (!unreadCount || busy) return
    setBusy(true)
    try {
      await notificationService.markAllRead(workspaceId)
      const readAt = new Date().toISOString()
      setNotifications(current => current.map(item => ({ ...item, is_read: true, read_at: item.read_at ?? readAt })))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Notifications could not be marked read.') }
    finally { setBusy(false) }
  }

  return <div className="notificationCenter">
    <button className="notificationBell" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Bell />{unreadCount > 0 && <span className="notificationBadge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
    </button>
    {open && <section className="notificationPanel" role="dialog" aria-label="Notifications">
      <div className="notificationHandle" aria-hidden="true" />
      <header><div><span>JST ACTIVITY</span><h2>NOTIFICATIONS</h2></div><button className="icon" aria-label="Close notifications" onClick={() => setOpen(false)}><X /></button></header>
      <div className="notificationTools">
        <div role="group" aria-label="Notification filters"><button className={filter === 'All' ? 'active' : ''} onClick={() => setFilter('All')}>All</button><button className={filter === 'Unread' ? 'active' : ''} onClick={() => setFilter('Unread')}>Unread</button></div>
        <button className="markAllRead" disabled={!unreadCount || busy} onClick={() => void markAll()}><CheckCheck /> Mark All Read</button>
      </div>
      {error && <p className="notificationError">{setupMissing(error) ? 'Notification setup is waiting for the Supabase migration.' : error}</p>}
      <div className="notificationList">
        {visible.map(notification => {
          const Icon = iconFor[notification.type] ?? CircleDot
          return <article className={notification.is_read ? 'read' : 'unread'} key={notification.id}>
            <button className="notificationOpen" onClick={() => void navigate(notification)}>
              <span className="notificationTypeIcon"><Icon /></span>
              <span className="notificationCopy"><b>{notification.title}</b><span>{notification.message}</span><small>{notification.actor_name} · {relativeTime(notification.created_at)}</small></span>
              {!notification.is_read && <i aria-label="Unread" />}
            </button>
            {!notification.is_read && <button className="notificationRead" onClick={() => void markRead(notification)}><Check /> Mark read</button>}
          </article>
        })}
        {!visible.length && !error && <div className="notificationEmpty"><CheckCheck /><b>{filter === 'Unread' ? 'No unread notifications.' : "You're all caught up."}</b></div>}
      </div>
    </section>}
  </div>
}
