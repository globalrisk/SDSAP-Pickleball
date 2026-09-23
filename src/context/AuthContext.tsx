import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthContextValue {
  user: User | null
  isAdmin: boolean
  isLoading: boolean
  signIn: (identifier: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function hasAdminRole(user: User | null): boolean {
  return user?.app_metadata?.role === 'admin'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setUser(data.session?.user ?? null)
      setIsLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setIsLoading(false)
    })
    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (identifier: string, password: string) => {
    const trimmed = identifier.trim()
    let signedInUser: User | null = null
    if (trimmed.includes('@')) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: trimmed, password })
      if (error) throw error
      signedInUser = data.user
    } else {
      const { data, error } = await supabase.functions.invoke('admin-username-login', {
        body: { username: trimmed.toLowerCase(), password },
      })
      if (error) throw new Error('Invalid username or password.')
      const tokens = data as { access_token?: string; refresh_token?: string } | null
      if (!tokens?.access_token || !tokens.refresh_token) {
        throw new Error('Invalid username or password.')
      }
      const { data: session, error: sessionError } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      })
      if (sessionError) throw sessionError
      signedInUser = session.user
    }
    if (!hasAdminRole(signedInUser)) {
      await supabase.auth.signOut()
      throw new Error('This account does not have administrator access.')
    }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAdmin: hasAdminRole(user), isLoading, signIn, signOut }),
    [user, isLoading, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
