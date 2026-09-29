/**
 * CRYPTORA — Login Page
 *
 * Email + password, plus social sign-in (Google / Telegram / Yandex / VK ID)
 * for the providers the backend reports as configured. OAuth errors come
 * back as ?oauth_error=<code> from the server-side callback redirect.
 */

import React, { useState, useCallback, useMemo, FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, EmailNotVerifiedError } from '@/context/AuthContext';
import { useAuthProviders } from '@/hooks/useAuthProviders';
import { SocialLoginButtons } from '@/components/auth/SocialLoginButtons';
import { LogIn, MailWarning } from 'lucide-react';

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  email_exists:
    'Аккаунт с таким email уже существует. Войдите по паролю, а затем подключите провайдера в профиле.',
  cancelled: 'Вход через провайдера отменён.',
  exchange_failed: 'Не удалось завершить вход через провайдера. Попробуйте ещё раз.',
  state_mismatch: 'Сессия входа устарела. Попробуйте ещё раз.',
  state_expired: 'Сессия входа устарела. Попробуйте ещё раз.',
  telegram_invalid: 'Не удалось проверить данные Telegram. Попробуйте ещё раз.',
  blocked: 'Аккаунт заблокирован.',
  registration_closed: 'Регистрация временно закрыта.',
  not_configured: 'Этот способ входа сейчас недоступен.',
  unknown_provider: 'Этот способ входа сейчас недоступен.',
  session_lost: 'Сессия истекла — войдите заново.',
};

export const LoginPage: React.FC = () => {
  const { login, resendVerification } = useAuth();
  const { providers } = useAuthProviders();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);

  const initialNotice = useMemo(
    () => (searchParams.get('verified') === '1' ? 'Email подтверждён — теперь войдите' : ''),
    [searchParams]
  );
  const oauthError = useMemo(() => {
    const code = searchParams.get('oauth_error');
    if (!code) return '';
    return OAUTH_ERROR_MESSAGES[code] ?? 'Не удалось войти через провайдера.';
  }, [searchParams]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setUnverified(false);
    setLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      if (err instanceof EmailNotVerifiedError) {
        // Password was correct; only verification is missing.
        setUnverified(true);
      } else {
        setError(err instanceof Error ? err.message : 'Ошибка входа');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = useCallback(async () => {
    if (!email) return;
    setSending(true);
    setNotice('');
    setError('');
    try {
      await resendVerification(email);
      // The code entry lives on the register page (step 2).
      navigate(`/register?verify=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить код');
    } finally {
      setSending(false);
    }
  }, [email, resendVerification, navigate]);

  const dismissOauthError = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('oauth_error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <div className="route-shell flex min-h-[70vh] items-center justify-center px-4" data-route="auth" data-layout="auth">
      <div className="w-full max-w-md">
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500">
              <LogIn className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white">Вход в CRYPTORA</h1>
            <p className="mt-1 text-sm text-slate-400">Введите свои данные</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {initialNotice && !notice && !error && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300" role="status">
                {initialNotice}
              </div>
            )}

            {oauthError && (
              <div className="rounded-md border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-sm text-amber-200" role="alert">
                {oauthError}
                <button
                  type="button"
                  onClick={dismissOauthError}
                  className="ml-2 text-xs text-amber-300 underline hover:text-amber-100"
                >
                  Скрыть
                </button>
              </div>
            )}

            {unverified && (
              <div className="rounded-md border border-amber-500/30 bg-amber-950/30 px-3 py-3 text-sm text-amber-200">
                <div className="flex items-center gap-2 font-medium">
                  <MailWarning className="h-4 w-4" />
                  Email ещё не подтверждён
                </div>
                <p className="mt-1 text-amber-200/80">
                  Мы можем отправить новый код подтверждения на вашу почту.
                </p>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={sending}
                  className="mt-2 rounded border border-amber-400/40 px-2.5 py-1 text-xs font-medium text-amber-100 hover:bg-amber-400/10 disabled:opacity-50"
                >
                  {sending ? 'Отправка…' : 'Отправить код'}
                </button>
              </div>
            )}

            {notice && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300" role="status">
                {notice}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-sm text-rose-300" role="alert">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-300">
                Пароль
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-cyan-400 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>

          <SocialLoginButtons providers={providers} returnTo="/" />

          <div className="mt-6 text-center text-sm text-slate-400">
            Нет аккаунта?{' '}
            <Link to="/register" className="font-medium text-cyan-400 hover:text-cyan-300">
              Регистрация
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
