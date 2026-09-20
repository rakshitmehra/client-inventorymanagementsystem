'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  // A 401 from anywhere in the app clears the session.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken();
      setUser(null);
    });
  }, []);

  // Restore the session on a hard refresh.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!getToken()) {
        setReady(true);
        return;
      }
      try {
        const { user: me } = await api.get('/auth/me');
        if (!cancelled) setUser(me);
      } catch {
        clearToken();
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (username, password) => {
    const result = await api.post(
      '/auth/login',
      { username, password },
      { skipAuthRedirect: true },
    );
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const signOut = useCallback(
    (silent = false) => {
      if (!silent && getToken()) {
        api.post('/auth/logout', {}, { skipAuthRedirect: true }).catch(() => {});
      }
      clearToken();
      setUser(null);
      router.push('/login');
    },
    [router],
  );

  const refresh = useCallback(async () => {
    const { user: me } = await api.get('/auth/me');
    setUser(me);
    return me;
  }, []);

  const isAdmin = user?.role_code === 'ADMIN';
  const kitchens = user?.kitchens ?? [];

  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        signIn,
        signOut,
        refresh,
        isAdmin,
        kitchens,
        // The kitchen a manager works in; admins pick one per screen instead.
        primaryKitchenId: kitchens[0]?.id ?? null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
};
