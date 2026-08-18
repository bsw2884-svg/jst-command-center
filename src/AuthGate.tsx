import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { Cloud, LogOut, UserRound } from 'lucide-react'
import jstLogo from './Assets/Branding/jst-logo.png.png'
import { JST_BAND_MEMBERS, type JstBandMemberId } from './lib/bandMembers'
import { isSupabaseConfigured } from './lib/supabase'
import { authService, workspaceService, type MemberContext } from './lib/services'
import './auth.css'

const messageOf = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message
    : typeof cause === 'object' && cause !== null && 'message' in cause && typeof cause.message === 'string' ? cause.message
      : fallback

const JstMemberContext = createContext<MemberContext | null>(null)
export const useJstMemberContext = () => useContext(JstMemberContext)

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [context, setContext] = useState<MemberContext | null>(null)
  const [verifiedUser, setVerifiedUser] = useState<User | null>(null)
  const [hasEmailIdentity, setHasEmailIdentity] = useState(false)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [showEmailLogin, setShowEmailLogin] = useState(false)
  const [error, setError] = useState('')
  const [syncStatus, setSyncStatus] = useState({ phase: 'local', message: 'LOCAL DATA · CLOUD MIGRATION NOT STARTED' })

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    authService.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = authService.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) { setContext(null); setVerifiedUser(null); setHasEmailIdentity(false); setShowEmailLogin(false) }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!session) return
    setLoading(true)
    Promise.all([workspaceService.getMemberContext(), authService.getUser(), authService.getUserIdentities()])
      .then(([memberContext, userResult, identityResult]) => {
        if (userResult.error) throw userResult.error
        if (identityResult.error) throw identityResult.error
        setContext(memberContext)
        setVerifiedUser(userResult.data.user)
        setHasEmailIdentity(identityResult.data.identities.some(identity => identity.provider === 'email'))
      })
      .catch(cause => setError(messageOf(cause, 'Could not load your JST member profile.')))
      .finally(() => setLoading(false))
  }, [session])

  useEffect(() => {
    document.title = context
      ? `JST Command Center · ${context.member.display_name} (${context.membership.role})`
      : 'JST Command Center'
  }, [context])

  useEffect(() => {
    const update = (event: Event) => setSyncStatus((event as CustomEvent<{ phase: string; message: string }>).detail)
    window.addEventListener('jst-sync-status', update)
    return () => window.removeEventListener('jst-sync-status', update)
  }, [])

  const signOut = async () => {
    workspaceService.clearSelectedBandMember()
    const { error: signOutError } = await authService.signOut()
    if (signOutError) setError(signOutError.message)
  }

  if (!isSupabaseConfigured) return <JstMemberContext.Provider value={null}>{children}</JstMemberContext.Provider>
  if (loading) return <AuthFrame><div className="authLoading"><Cloud/><b>CONNECTING COMMAND CENTER</b></div></AuthFrame>
  if (showEmailLogin && !session) return <EmailAuthScreen initialError={error} onBack={() => { setShowEmailLogin(false); setError('') }}/>
  if (!session || !context) return <MemberPicker error={error} onError={setError} onConnected={setContext}/>

  const currentUser = verifiedUser ?? session.user
  const isAnonymous = currentUser.is_anonymous === true

  return <JstMemberContext.Provider value={context}><div className="cloudSession" data-member={context.member.slug} data-workspace-role={context.membership.role} data-session-kind={isAnonymous ? 'anonymous' : 'permanent'} data-auth-user-id={currentUser.id} data-membership-user-id={context.membership.user_id} data-email-identity={hasEmailIdentity ? 'linked' : 'none'}>
    <div className="cloudBar">
      <span><Cloud/> {context.member.display_name} · {context.membership.workspace.name}</span>
      <em className={`cloudSyncStatus ${syncStatus.phase}`}>{syncStatus.message}</em>
      <button onClick={signOut}><LogOut/> Switch Member / Sign Out</button>
    </div>
    {children}
  </div></JstMemberContext.Provider>
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="authPage"><section className="authCard memberAuthCard">
    <img src={jstLogo} alt="JumpStart Tomorrow"/>
    <span className="authKicker">JST · COMMAND CENTER</span>
    {children}
  </section></main>
}

function MemberPicker({ error, onError, onConnected }: {
  error: string
  onError: (message: string) => void
  onConnected: (context: MemberContext) => void
}) {
  const [busyMember, setBusyMember] = useState<JstBandMemberId | null>(null)

  const choose = async (memberId: JstBandMemberId) => {
    setBusyMember(memberId); onError('')
    try {
      const { data: { session: activeSession }, error: sessionError } = await authService.getSession()
      if (sessionError) throw sessionError
      if (!activeSession) {
        const { error: signInError } = await authService.signInAnonymously()
        if (signInError) throw signInError
      }
      onConnected(await workspaceService.selectBandMember(memberId))
    } catch (cause) {
      onError(messageOf(cause, 'Could not enter the JST workspace.'))
      setBusyMember(null)
    }
  }

  return <AuthFrame>
    <div className="memberIntro"><h1>WHO ARE YOU?</h1><p>Pick your name to enter the band's private command center.</p></div>
    <div className="memberGrid">{JST_BAND_MEMBERS.map(member => <button key={member.id} disabled={busyMember !== null} onClick={() => choose(member.id)}><UserRound/><b>{member.name.toUpperCase()}</b><span>{busyMember === member.id ? 'GETTING YOU IN…' : 'ENTER COMMAND CENTER'}</span></button>)}</div>
    {error && <p className="authError">{error}</p>}
    <p className="anonymousNote">This device stays signed in. If browser data is cleared, simply choose your name again.</p>
  </AuthFrame>
}

function EmailAuthScreen({ initialError, onBack }: { initialError: string; onBack: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const result = mode === 'login'
      ? await authService.signIn(email, password)
      : await authService.signUp(email, password, displayName)
    setBusy(false)
    if (result.error) return setError(result.error.message)
    if (mode === 'signup' && !result.data.session) setNotice('Check your email to confirm your account, then come back and log in.')
  }

  return <AuthFrame>
    <button className="backToMembers" onClick={onBack}>← BACK TO MEMBER PICKER</button>
    <div className="authTabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>LOG IN</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>SIGN UP</button></div>
    <div className="authIntro"><h1>{mode === 'login' ? 'SECURED LOGIN' : 'LINK AN ACCOUNT'}</h1><p>Email access is available for account recovery and future permanent identities.</p></div>
    <form className="authForm" onSubmit={submit}>
      {mode === 'signup' && <label>DISPLAY NAME<input required value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name"/></label>}
      <label>EMAIL<input required type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email"/></label>
      <label>PASSWORD<input required minLength={6} type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>
      {error && <p className="authError">{error}</p>}{notice && <p className="authNotice">{notice}</p>}
      <button className="authSubmit" disabled={busy}>{busy ? 'HOLD TIGHT…' : mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT'}</button>
    </form>
  </AuthFrame>
}
