/**
 * CRYPTORA — Register Page (2-step flow)
 *
 * Step 1: email + password + password confirmation → POST /api/auth/register.
 * Step 2: a 6-digit code is sent to the mailbox; the user types (or pastes)
 *         it → POST /api/auth/verify-code → redirect to /login?verified=1.
 *
 * No session is created before the mailbox is confirmed, and the password
 * only ever lives in React state — never in localStorage/sessionStorage.
 */

import React, { useState, useEffect, useCallback, FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, maskEmail, VerifyCodeError } from '@/context/AuthContext';
import { CodeInput, CODE_LENGTH } from '@/components/auth/CodeInput';
import { UserPlus, Mail, Lock, ArrowLeft } from 'lucide-react';

const RESEND_COOLDOWN_SECONDS = 60;
const PASSWORD_MIN_LENGTH = 8;

function formatCooldown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const RegisterPage: React.FC = () => {
  const { register, verifyEmailCode, resendVerification } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ── Step 1 state ────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Step 2 state ────────────────────────────────────────────────────
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeExhausted, setCodeExhausted] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState('');

  /**
   * Статус регистрации, запрошенный у backend. `null` — статус неизвестен;
   * форма показывается как обычно. Закрытое состояние рендерится только при
   * явном `false` от сервера.
   */
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/registration-status', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (active && body && typeof body.registrationOpen === 'boolean') {
          setRegistrationOpen(body.registrationOpen);
        }
      })
      .catch(() => {
        /* backend недоступен — оставляем null, форму не блокируем */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Deep link from the login page: /register?verify=<email> jumps straight
  // to the code step for an existing unverified account.
  useEffect(() => {
    const verify = searchParams.get('verify');
    if (verify && !sentTo) {
      setEmail(verify);
      setSentTo(verify);
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 1: create the account ──────────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Пароль не короче ${PASSWORD_MIN_LENGTH} символов`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      await register(email, '', password);
      // No session was created — show the code screen instead.
      setSentTo(email);
      setCode('');
      setCodeError('');
      setCodeExhausted(false);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setNotice('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: verify the code ─────────────────────────────────────────
  const handleVerify = useCallback(
    async (submitted?: string) => {
      const value = submitted ?? code;
      if (!sentTo || value.length !== CODE_LENGTH || verifying) return;
      setVerifying(true);
      setCodeError('');
      setNotice('');
      try {
        await verifyEmailCode(sentTo, value);
        navigate('/login?verified=1');
      } catch (err) {
        if (err instanceof VerifyCodeError) {
          switch (err.code) {
            case 'EXPIRED':
              setCodeError('Срок действия кода истёк. Запросите новый код.');
              setCodeExhausted(true);
              break;
            case 'TOO_MANY_ATTEMPTS':
              setCodeError('Слишком много попыток. Запросите новый код.');
              setCodeExhausted(true);
              break;
            case 'RATE_LIMITED':
              setCodeError('Слишком много попыток. Подождите и попробуйте снова.');
              break;
            default:
              setCodeError('Неверный код. Проверьте письмо и попробуйте ещё раз.');
          }
        } else {
          setCodeError('Не удалось проверить код — попробуйте позже.');
        }
        setCode('');
      } finally {
        setVerifying(false);
      }
    },
    [code, sentTo, verifying, verifyEmailCode, navigate]
  );

  const handleResend = useCallback(async () => {
    if (!sentTo || cooldown > 0) return;
    setCodeError('');
    setNotice('');
    try {
      await resendVerification(sentTo);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setCode('');
      setCodeExhausted(false);
      setNotice('Новый код отправлен');
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : 'Не удалось отправить код');
    }
  }, [sentTo, cooldown, resendVerification]);

  const handleEditEmail = useCallback(() => {
    // Back to step 1 with the email prefilled; password must be re-entered.
    setSentTo(null);
    setCode('');
    setCodeError('');
    setCodeExhausted(false);
    setNotice('');
    setPassword('');
    setConfirmPassword('');
  }, []);

  // ── Registration closed ─────────────────────────────────────────────
  if (registrationOpen === false) {
    return (
      <div className="route-shell flex min-h-[70vh] items-center justify-center px-4" data-route="auth" data-layout="auth">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-8 text-center shadow-2xl backdrop-blur-xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-slate-700">
              <Lock className="h-6 w-6 text-white" />
            </div>

            <h1 className="text-xl font-bold text-white">Регистрация временно закрыта</h1>
            <p className="mt-2 text-sm text-slate-400">
              Сейчас мы не создаём новые аккаунты. Уже зарегистрированные пользователи
              могут войти как обычно.
            </p>

            <div className="mt-6 flex items-center justify-center gap-3">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-md border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20"
              >
                Войти
              </Link>
              <Link
                to="/"
                className="inline-flex items-center rounded-md border border-white/10 bg-surface-2 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400/40"
              >
                На главную
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: code entry ──────────────────────────────────────────────
  if (sentTo) {
    return (
      <div className="route-shell flex min-h-[70vh] items-center justify-center px-4" data-route="auth">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 text-center shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500">
              <Mail className="h-6 w-6 text-white" />
            </div>

            <h1 className="text-xl font-bold text-white">Подтвердите email</h1>
            <p className="mt-2 text-sm text-slate-400">
              Мы отправили код на{' '}
              <span className="font-mono text-slate-200">{maskEmail(sentTo)}</span>
            </p>

            <form
              className="mt-6"
              onSubmit={(e) => {
                e.preventDefault();
                void handleVerify();
              }}
            >
              <CodeInput
                value={code}
                onChange={(next) => {
                  setCode(next);
                  if (codeError && !codeExhausted) setCodeError('');
                }}
                onComplete={(full) => void handleVerify(full)}
                disabled={verifying || codeExhausted}
                invalid={Boolean(codeError)}
              />

              {notice && (
                <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300" role="status">
                  {notice}
                </div>
              )}
              {codeError && (
                <div className="mt-4 rounded-md border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-sm text-rose-300" role="alert">
                  {codeError}
                </div>
              )}

              <button
                type="submit"
                disabled={verifying || codeExhausted || code.length !== CODE_LENGTH}
                className="mt-5 w-full rounded-md bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-cyan-400 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifying ? 'Проверка…' : 'Подтвердить'}
              </button>
            </form>

            <div className="mt-5 text-sm text-slate-400" data-testid="resend-block">
              {cooldown > 0 ? (
                <span>Отправить код повторно через {formatCooldown(cooldown)}</span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  className="font-medium text-cyan-400 hover:text-cyan-300"
                >
                  Отправить новый код
                </button>
              )}
            </div>

            <div className="mt-6 border-t border-white/[0.06] pt-4 text-sm text-slate-400">
              <button
                type="button"
                onClick={handleEditEmail}
                className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Изменить email
              </button>
              <span className="mx-3 text-slate-600">·</span>
              <Link to="/login" className="font-medium text-cyan-400 hover:text-cyan-300">
                Войти
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 1: registration form ───────────────────────────────────────
  return (
    <div className="route-shell flex min-h-[70vh] items-center justify-center px-4" data-route="auth">
      <div className="w-full max-w-md">
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500">
              <UserPlus className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white">Регистрация</h1>
            <p className="mt-1 text-sm text-slate-400">Создайте аккаунт CRYPTORA</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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
                autoFocus
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
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                className="w-full rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
                placeholder={`Минимум ${PASSWORD_MIN_LENGTH} символов`}
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
                minLength={PASSWORD_MIN_LENGTH}
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
              {loading ? 'Создание…' : 'Создать аккаунт'}
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
