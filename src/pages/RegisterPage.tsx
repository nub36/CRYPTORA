/**
 * CRYPTORA — Register Page
 *
 * After a successful registration the user is NOT logged in: the address must
 * be verified first. We switch to a "Проверьте почту" screen with the masked
 * address and a resend button on a cooldown.
 */

import React, { useState, useEffect, useCallback, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, maskEmail } from '@/context/AuthContext';
import { UserPlus, Mail, RefreshCw } from 'lucide-react';

const RESEND_COOLDOWN_SECONDS = 60;

export const RegisterPage: React.FC = () => {
  const { register, resendVerification } = useAuth();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // "Check your mail" screen state.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);

    try {
      await register(email, displayName, password);
      // No session was created — show the verification screen instead.
      setSentTo(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setNotice('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = useCallback(async () => {
    if (!sentTo || cooldown > 0) return;
    setError('');
    setNotice('');
    try {
      await resendVerification(sentTo);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setNotice('Новая ссылка отправлена');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить ссылку');
    }
  }, [sentTo, cooldown, resendVerification]);

  // ── Verification screen ─────────────────────────────────────────────
  if (sentTo) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-8 text-center shadow-2xl backdrop-blur-xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500">
              <Mail className="h-6 w-6 text-white" />
            </div>

            <h1 className="text-xl font-bold text-white">Проверьте почту</h1>
            <p className="mt-2 text-sm text-slate-400">
              Мы отправили ссылку подтверждения на{' '}
              <span className="font-mono text-slate-200">{maskEmail(sentTo)}</span>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Перейдите по ссылке из письма, чтобы активировать аккаунт. Ссылка действительна 60 минут.
            </p>

            {notice && (
              <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
                {notice}
              </div>
            )}
            {error && (
              <div className="mt-4 rounded-md border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0}
              className="mt-6 inline-flex items-center gap-2 rounded-md border border-white/10 bg-surface-2 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              {cooldown > 0 ? `Отправить снова через ${cooldown} с` : 'Отправить ссылку ещё раз'}
            </button>

            <div className="mt-6 text-sm text-slate-400">
              Уже подтвердили?{' '}
              <Link to="/login" className="font-medium text-cyan-400 hover:text-cyan-300">
                Войти
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Registration form ───────────────────────────────────────────────
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500">
              <UserPlus className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white">Регистрация</h1>
            <p className="mt-1 text-sm text-slate-400">Создайте аккаунт CRYPTORA</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
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
              <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-slate-300">
                Имя
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                minLength={2}
                maxLength={50}
                autoComplete="name"
                className="w-full rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
                placeholder="Ваше имя"
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
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
                placeholder="Минимум 8 символов"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-slate-300">
                Повторите пароль
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-cyan-400 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Создание...' : 'Зарегистрироваться'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-400">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="font-medium text-cyan-400 hover:text-cyan-300">
              Войти
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
