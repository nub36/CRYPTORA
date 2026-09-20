/**
 * CRYPTORA — Email verification landing page.
 *
 * Reads `?token=`, POSTs it once, then STRIPS the token from the address bar
 * so it cannot leak through history, referer or the browser autocomplete.
 * The token is never written to console, state logs, or analytics.
 */

import React, { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle, ShieldAlert, Send } from 'lucide-react';
import { apiUrl, isStaticHostingWithoutApi } from '@/config/api';

type Status = 'checking' | 'ok' | 'invalid' | 'error';

export const VerifyEmailPage: React.FC = () => {
  const [status, setStatus] = useState<Status>('checking');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') ?? '';

    // Remove the token from the URL immediately (replace, not push).
    if (params.has('token')) {
      params.delete('token');
      const rest = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
      );
    }

    if (!token) {
      setStatus('invalid');
      setMessage('Ссылка недействительна или истекла');
      return;
    }

    (async () => {
      if (isStaticHostingWithoutApi) {
        setStatus('error');
        setMessage('Подтверждение email недоступно в статической сборке (GitHub Pages). Требуется бэкенд.');
        return;
      }
      try {
        const res = await fetch(apiUrl('/api/auth/verify-email'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token }),
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          setStatus('ok');
          setMessage('Email подтверждён');
        } else if (res.status === 410 || data.error === 'EXPIRED') {
          setStatus('invalid');
          setMessage('Ссылка недействительна или истекла');
        } else {
          setStatus('invalid');
          setMessage('Ссылка недействительна или истекла');
        }
      } catch {
        setStatus('error');
        setMessage('Сервер недоступен — попробуйте позже');
      }
    })();
  }, []);

  const handleResend = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setMessage('');
    try {
      await fetch(apiUrl('/api/auth/resend-verification'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      // Generic by design — do not reveal whether the account exists.
      setMessage('Если аккаунт существует, новая ссылка отправлена');
    } catch {
      setMessage('Не удалось отправить ссылку');
    } finally {
      setSending(false);
    }
  }, [email]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div
            className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg ${
              status === 'ok'
                ? 'bg-gradient-to-br from-emerald-400 to-teal-500'
                : status === 'checking'
                  ? 'bg-gradient-to-br from-slate-500 to-slate-600'
                  : 'bg-gradient-to-br from-rose-500 to-orange-500'
            }`}
          >
            {status === 'ok' ? (
              <CheckCircle2 className="h-6 w-6 text-white" />
            ) : status === 'checking' ? (
              <ShieldAlert className="h-6 w-6 text-white animate-pulse" />
            ) : (
              <XCircle className="h-6 w-6 text-white" />
            )}
          </div>

          <h1 className="text-xl font-bold text-white">
            {status === 'checking' ? 'Проверяем ссылку…' : message}
          </h1>

          {status === 'ok' && (
            <p className="mt-2 text-sm text-slate-400">
              Адрес подтверждён. Теперь вы можете войти в CRYPTORA.
            </p>
          )}

          {status === 'invalid' && (
            <div className="mt-6 space-y-3 text-left">
              <p className="text-center text-sm text-slate-400">
                Запросите новую ссылку подтверждения.
              </p>
              <form onSubmit={handleResend} className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="Ваш email"
                  className="w-full rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {sending ? 'Отправка…' : 'Отправить новую ссылку'}
                </button>
              </form>
            </div>
          )}

          {status === 'error' && (
            <p className="mt-2 text-sm text-slate-400">
              Проверьте соединение и обновите страницу.
            </p>
          )}

          <div className="mt-6 text-sm text-slate-400">
            {status === 'ok' ? (
              <Link to="/login" className="font-medium text-cyan-400 hover:text-cyan-300">
                Войти
              </Link>
            ) : (
              <Link to="/login" className="font-medium text-slate-300 hover:text-white">
                На страницу входа
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmailPage;
