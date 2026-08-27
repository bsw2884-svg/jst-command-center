import type { MemberContext } from './services'
import { notificationService } from './services'
import { requireSupabase } from './services/core'
import { getActiveServiceWorkerRegistration } from './serviceWorker'

export type PushStatus = 'unsupported' | 'install-required' | 'off' | 'blocked' | 'enabled'

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim() ?? ''

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true
const supported = () => window.isSecureContext
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window
  && Boolean(vapidPublicKey)

const decodeVapidKey = (value: string) => {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(character => character.charCodeAt(0)))
}

const platformLabel = () => isIos() ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop'

const saveSubscription = async (context: MemberContext, subscription: PushSubscription) => {
  await notificationService.registerMember(context)
  const userResult = await requireSupabase().auth.getUser()
  if (userResult.error) throw userResult.error
  if (!userResult.data.user) throw new Error('Authentication is required to save this device.')
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The browser returned an incomplete push subscription.')
  const { error } = await requireSupabase().from('push_subscriptions').upsert({
    workspace_id: context.membership.workspace_id,
    auth_user_id: userResult.data.user.id,
    selected_member_id: context.member.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    platform: platformLabel(),
    user_agent: navigator.userAgent,
    enabled: true,
    last_used_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' })
  if (error) throw error
}

export const getPushStatus = async (context: MemberContext): Promise<PushStatus> => {
  if (isIos() && !isStandalone()) return 'install-required'
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const registration = await getActiveServiceWorkerRegistration()
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return 'off'
  await notificationService.registerMember(context)
  const { data, error } = await requireSupabase().from('push_subscriptions').select('id')
    .eq('endpoint', subscription.endpoint).eq('enabled', true).maybeSingle()
  if (error) throw error
  return data ? 'enabled' : 'off'
}

export const enablePushNotifications = async (context: MemberContext) => {
  if (isIos() && !isStandalone()) throw new Error('Add JST Command Center to your Home Screen to enable push notifications.')
  if (!supported()) throw new Error('Push notifications are not supported or the VAPID public key is not configured.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notification permission is blocked in browser settings.' : 'Notification permission was not granted.')
  const registration = await getActiveServiceWorkerRegistration()
  const existing = await registration.pushManager.getSubscription()
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(vapidPublicKey) })
  try { await saveSubscription(context, subscription) }
  catch (cause) { if (!existing) await subscription.unsubscribe().catch(() => false); throw cause }
}

export const disablePushNotifications = async (context: MemberContext) => {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  await notificationService.registerMember(context)
  const { error } = await requireSupabase().from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  if (error) throw error
  await subscription.unsubscribe()
}

export const syncPushSubscriptionIdentity = async (context: MemberContext) => {
  if (!supported() || Notification.permission !== 'granted') return
  const registration = await getActiveServiceWorkerRegistration()
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) await saveSubscription(context, subscription)
}
