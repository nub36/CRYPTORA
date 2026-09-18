/**
 * CRYPTORA — Auth Context
 *
 * Provides auth state to the entire app.
 * Fetches session on mount. Does NOT block app rendering.
 * If backend is unavailable, public analytics pages continue to work.
 */

import React, { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, displayName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', {
        credentials: 'include',
      });

      if (res.status === 401) {
        // Not authenticated — this is normal for guests
        setUser(null);
        setError(null);
        return;
      }

      if (!res.ok) {
        // Backend error — don't crash the app
        setError('Авторизация временно недоступна');
        return;
      }

      const data = await res.json();
      if (data.user) {
        setUser(data.user);
        setError(null);
      }
    } catch {
      // Network error — backend down
      // Don't block the app — public pages still work
      setError('Сервер авторизации недоступен');
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchSession();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchSession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Ошибка входа');
    }

    if (data.user) {
      setUser(data.user);
      setError(null);
    }
  }, []);

  const register = useCallback(async (email: string, displayName: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, displayName, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Ошибка регистрации');
    }

    if (data.user) {
      setUser(data.user);
      setError(null);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      setUser(null);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    error,
    login,
    register,
    logout,
    refreshSession: fetchSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}