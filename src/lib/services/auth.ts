import { requireSupabase } from './core'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

export const authService = {
  getSession: () => requireSupabase().auth.getSession(),
  onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) =>
    requireSupabase().auth.onAuthStateChange(callback),
  signUp: (email: string, password: string, displayName: string) =>
    requireSupabase().auth.signUp({ email, password, options: { data: { display_name: displayName } } }),
  signIn: (email: string, password: string) =>
    requireSupabase().auth.signInWithPassword({ email, password }),
  signOut: () => requireSupabase().auth.signOut(),
  signInAnonymously: () => requireSupabase().auth.signInAnonymously(),
  getUser: () => requireSupabase().auth.getUser(),
  getUserIdentities: () => requireSupabase().auth.getUserIdentities(),
  attachEmail: (email: string) => requireSupabase().auth.updateUser(
    { email },
    { emailRedirectTo: window.location.origin },
  ),
  setPassword: (password: string) => requireSupabase().auth.updateUser({ password }),
}
