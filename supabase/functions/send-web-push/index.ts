import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

type NotificationRow = {
  id: string
  workspace_id: string
  recipient_member_id: string
  title: string
  message: string
  entity_type: 'writing_song' | 'release' | 'task' | 'song'
  entity_id: string
}

type SubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

type DeliveryRow = {
  id: string
  notification_id: string
  subscription_id: string
  attempt_count: number
  notification: NotificationRow
  subscription: SubscriptionRow
}

const required = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`${name} is not configured.`)
  return value
}

const destinationFor = (notification: NotificationRow) => {
  const open = notification.entity_type === 'writing_song' ? 'writing'
    : notification.entity_type === 'release' ? 'releases'
      : notification.entity_type === 'task' ? 'tasks' : 'songs'
  const query = new URLSearchParams({ open, entity: notification.entity_id, notification: notification.id })
  return `/?${query.toString()}`
}

const errorStatus = (cause: unknown) => {
  if (typeof cause === 'object' && cause !== null && 'statusCode' in cause) {
    const value = Number((cause as { statusCode?: unknown }).statusCode)
    return Number.isFinite(value) ? value : null
  }
  return null
}

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)

Deno.serve(async request => {
  try {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    const webhookSecret = required('PUSH_WEBHOOK_SECRET')
    if (request.headers.get('x-jst-push-secret') !== webhookSecret) {
      return new Response('Unauthorized', { status: 401 })
    }

    const supabaseUrl = required('SUPABASE_URL')
    const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
    webpush.setVapidDetails(required('VAPID_SUBJECT'), required('VAPID_PUBLIC_KEY'), required('VAPID_PRIVATE_KEY'))
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const payload = await request.json().catch(() => ({})) as { record?: { id?: string }; notification_id?: string }
    const notificationId = payload.record?.id ?? payload.notification_id

    if (notificationId) {
      const { data: notification, error: notificationError } = await admin.from('notifications').select('*').eq('id', notificationId).single()
      if (notificationError) throw notificationError
      const { data: subscriptions, error: subscriptionError } = await admin.from('push_subscriptions').select('id')
        .eq('workspace_id', notification.workspace_id)
        .eq('selected_member_id', notification.recipient_member_id)
        .eq('enabled', true)
      if (subscriptionError) throw subscriptionError
      if (subscriptions?.length) {
        const { error: deliveryError } = await admin.from('push_deliveries').upsert(
          subscriptions.map(subscription => ({ notification_id: notification.id, subscription_id: subscription.id })),
          { onConflict: 'notification_id,subscription_id', ignoreDuplicates: true },
        )
        if (deliveryError) throw deliveryError
      }
    }

    const { data, error } = await admin.from('push_deliveries')
      .select('id,notification_id,subscription_id,attempt_count,notification:notifications!inner(id,workspace_id,recipient_member_id,title,message,entity_type,entity_id),subscription:push_subscriptions!inner(id,endpoint,p256dh,auth)')
      .in('status', ['pending', 'failed']).lt('attempt_count', 5).order('created_at').limit(100)
    if (error) throw error

    let delivered = 0
    let failed = 0
    for (const raw of data ?? []) {
      const delivery = raw as unknown as DeliveryRow
      const attempt = delivery.attempt_count + 1
      await admin.from('push_deliveries').update({ status: 'sending', attempt_count: attempt, last_attempt_at: new Date().toISOString(), last_error: null }).eq('id', delivery.id)
      const body = JSON.stringify({
        title: delivery.notification.title,
        body: delivery.notification.message,
        url: destinationFor(delivery.notification),
        notificationId: delivery.notification.id,
      })
      try {
        const response = await webpush.sendNotification({
          endpoint: delivery.subscription.endpoint,
          keys: { p256dh: delivery.subscription.p256dh, auth: delivery.subscription.auth },
        }, body, { TTL: 60 * 60 * 24, urgency: 'normal' })
        await admin.from('push_deliveries').update({ status: 'delivered', response_status: response.statusCode, delivered_at: new Date().toISOString(), last_error: null }).eq('id', delivery.id)
        delivered++
      } catch (cause) {
        const status = errorStatus(cause)
        const stale = status === 404 || status === 410
        if (stale) await admin.from('push_subscriptions').update({ enabled: false }).eq('id', delivery.subscription.id)
        await admin.from('push_deliveries').update({ status: 'failed', response_status: status, last_error: stale ? 'Push endpoint expired and was disabled.' : errorMessage(cause).slice(0, 1000) }).eq('id', delivery.id)
        failed++
      }
    }

    return Response.json({ processed: (data ?? []).length, delivered, failed })
  } catch (cause) {
    console.error(cause)
    return Response.json({ error: errorMessage(cause) }, { status: 500 })
  }
})
