import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi } from '../api'
import { setUnauthorizedHandler, tokenStore } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // True until we know whether a stored token is still valid.
  const [initializing, setInitializing] = useState(() => Boolean(tokenStore.get()))

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    return () => setUnauthorizedHandler(null)
  }, [logout])

  useEffect(() => {
    if (!tokenStore.get()) return
    let active = true
    authApi
      .me()
      .then((me) => active && setUser(me))
      // A 401 already cleared the session via the interceptor; keep the token on network errors.
      .catch(() => {})
      .finally(() => active && setInitializing(false))
    return () => {
      active = false
    }
  }, [])

  const startSession = useCallback((response) => {
    tokenStore.set(response.access_token)
    setUser(response.user)
  }, [])

  const login = useCallback(async (credentials) => startSession(await authApi.login(credentials)), [startSession])
  const register = useCallback(async (payload) => startSession(await authApi.register(payload)), [startSession])

  const value = useMemo(
    () => ({ user, initializing, login, register, logout }),
    [user, initializing, login, register, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
