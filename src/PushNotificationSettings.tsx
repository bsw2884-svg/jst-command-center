import { useCallback, useEffect, useState } from 'react'
import { BellRing, BellOff, CheckCircle2, LoaderCircle, Smartphone } from 'lucide-react'
import type { MemberContext } from './lib/services'
import { disablePushNotifications, enablePushNotifications, getPushStatus, type PushStatus } from './lib/pushNotifications'
import './push-notifications.css'

const copy: Record<PushStatus, { label: string; detail: string }> = {
  unsupported: { label: 'NOT SUPPORTED', detail: 'This browser cannot use web push, or push has not been configured for this environment.' },
  'install-required': { label: 'APP MUST BE INSTALLED', detail: 'Add JST Command Center to your Home Screen to enable push notifications.' },
  off: { label: 'OFF', detail: 'Enable push on this device to receive JST activity when the app is closed.' },
  blocked: { label: 'PERMISSION BLOCKED', detail: 'Notifications are blocked. Allow them in your browser or device settings first.' },
  enabled: { label: 'ENABLED', detail: 'This device is subscribed for the currently selected band member.' },
}

export default function PushNotificationSettings({ context }: { context: MemberContext }) {
  const [status, setStatus] = useState<PushStatus>('off')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try { setStatus(await getPushStatus(context)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Push notification status could not be checked.') }
    finally { setBusy(false) }
  }, [context])
  useEffect(() => { void refresh() }, [refresh, context.member.id])
  const enable = async () => { setBusy(true); setError(''); try { await enablePushNotifications(context); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Push notifications could not be enabled.'); await refresh() } finally { setBusy(false) } }
  const disable = async () => { setBusy(true); setError(''); try { await disablePushNotifications(context); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Push notifications could not be disabled.') } finally { setBusy(false) } }
  const state = copy[status]
  return <section className="pushSettings record">
    <div className="pushSettingsHead"><span className="pushSettingsIcon">{status === 'enabled' ? <BellRing/> : <Smartphone/>}</span><div><span className="eyebrow">THIS DEVICE</span><h3>PUSH NOTIFICATIONS</h3></div><b className={`pushState ${status}`}>{busy ? <><LoaderCircle className="pushSpinner"/> CHECKING</> : state.label}</b></div>
    <p>{state.detail}</p><p className="pushIdentity">DELIVERY IDENTITY · <b>{context.member.display_name}</b> · {context.membership.workspace.name}</p>
    {error && <p className="pushError">{error}</p>}
    <div className="pushActions">{status === 'enabled' ? <button className="ghost" disabled={busy} onClick={() => void disable()}><BellOff/> Disable Push Notifications</button> : <button className="primary" disabled={busy || status === 'unsupported' || status === 'install-required' || status === 'blocked'} onClick={() => void enable()}><CheckCircle2/> Enable Push Notifications</button>}</div>
    <small>Permission is requested only when you tap Enable. In-app notifications remain available either way.</small>
  </section>
}
