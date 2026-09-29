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
  /** May be null for social-only accounts (Telegram gives no email). */
  email: string | null;
  displayName: string;
  role: 'user' | 'admin';
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
}

/**
 * Raised by login() when the password was CORRECT but the address is not yet
 * verified. LoginPage uses this to show a friendly resend flow instead of a
 * technical error — the password check always happens first server-side.
 */
export class EmailNotVerifiedError extends Error {
  constructor(public readonly email: string) {
    super('EMAIL_NOT_VERIFIED');
    this.name = 'EmailNotVerifiedError';
  }
}

/** Local mask for "Проверьте почту" — never shows the full address. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  const first = name.charAt(0);
  return `${first}${'*'.repeat(Math.max(1, name.length - 1))}@${domain}`;
}

/**
 * Raised by verifyEmailCode() with a machine-readable code so the UI can
 * render precise states: invalid / expired / too many attempts / throttled.
 */
export class VerifyCodeError extends Error {
  constructor(
    public readonly code: 'INVALID' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'RATE_LIMITED' | 'UNKNOWN',
    message: string
  ) {
    super(message);
    this.name = 'VerifyCodeError';
  }
}

/** Which login providers the backend actually has configured. */
export interface AuthProvidersConfig {
  emailPassword: boolean;
  emailVerification: boolean;
  google: boolean;
  telegram: boolean;
  yandex: boolean;
  vk: boolean;
  telegramBotName: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  /**
   * Resolves once the account is created. Does NOT log the user in.
   * displayName is optional: the server derives one from the email if empty.
   */
  register: (email: string, displayName: string, password: string) => Promise<void>;
  /** Confirms a 6-digit code. Throws VerifyCodeError on failure. */
  verifyEmailCode: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
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
      if (data.error === 'EMAIL_NOT_VERIFIED') {
        throw new EmailNotVerifiedError(email);
      }
      throw new Error(data.message || 'Ошибка входа');
    }

    if (data.user) {
      setUser(data.user);
      setError(null);
    }
  }, []);

  const register = useCallback(async (email: string, displayName: string, password: string) => {
    const body: Record<string, string> = { email, password };
    if (displayName) body.displayName = displayName;

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || data.message || 'Ошибка регистрации');
    }

    // Registration never creates a session: the address must be verified
    // first. So we deliberately do NOT setUser() here.
    setError(null);
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, code }),
    });

    if (res.ok) return;

    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    const apiError = typeof data.error === 'string' ? data.error : '';
    const message = typeof data.message === 'string' ? data.message : 'Неверный код';

    if (apiError === 'EXPIRED') throw new VerifyCodeError('EXPIRED', message);
    if (apiError === 'TOO_MANY_ATTEMPTS') throw new VerifyCodeError('TOO_MANY_ATTEMPTS', message);
    if (res.status === 429) throw new VerifyCodeError('RATE_LIMITED', message);
    if (apiError === 'INVALID') throw new VerifyCodeError('INVALID', message);
    throw new VerifyCodeError('UNKNOWN', message);
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    const res = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || 'Не удалось отправить ссылку');
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
    verifyEmailCode,
    resendVerification,
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