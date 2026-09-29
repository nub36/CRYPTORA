/**
 * CRYPTORA — Profile Page
 *
 * Protected route: requires authentication.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useAuthProviders } from '@/hooks/useAuthProviders';
import { User, Mail, Calendar, Shield, BadgeCheck, Link2, Unlink } from 'lucide-react';

/* ── Connected accounts ──────────────────────────────────────────────── */

interface IdentityInfo {
  provider: string;
  providerEmail: string | null;
  createdAt: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  telegram: 'Telegram',
  yandex: 'Yandex',
  vk: 'VK ID',
};

const LINK_ERROR_MESSAGES: Record<string, string> = {
  identity_in_use: 'Этот аккаунт провайдера уже привязан к другому пользователю CRYPTORA.',
  reauth_required: 'Войдите заново, чтобы изменять привязанные аккаунты.',
  intent_required: 'Нажмите «Подключить» в профиле, чтобы привязать Telegram.',
  cancelled: 'Подключение отменено.',
  exchange_failed: 'Не удалось подключить провайдера. Попробуйте ещё раз.',
  state_mismatch: 'Сессия подключения устарела. Попробуйте ещё раз.',
  state_expired: 'Сессия подключения устарела. Попробуйте ещё раз.',
};

/** Telegram Login Widget for LINKING (rendered after an explicit intent). */
const TelegramLinkWidget: React.FC<{ botName: string }> = ({ botName }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return undefined;
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botName);
    script.setAttribute('data-size', 'medium');
    script.setAttribute('data-radius', '6');
    script.setAttribute('data-auth-url', `${window.location.origin}/api/auth/oauth/telegram/callback`);
    container.appendChild(script);
    return () => {
      container.innerHTML = '';
    };
  }, [botName]);
  return <div ref={ref} data-testid="telegram-link-widget" />;
};

export const ProfilePage: React.FC = () => {
  const { user, logout } = useAuth();
  const { providers } = useAuthProviders();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Connected accounts state
  const [identities, setIdentities] = useState<IdentityInfo[] | null>(null);
  const [hasPassword, setHasPassword] = useState(true);
  const [linkMessage, setLinkMessage] = useState('');
  const [linkError, setLinkError] = useState('');
  const [telegramLinking, setTelegramLinking] = useState(false);
  const [busyProvider, setBusyProvider] = useState('');

  const loadIdentities = useCallback(async () => {
    try {
      const res = await fetch('/api/me/identities', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setIdentities(Array.isArray(data.identities) ? data.identities : []);
      setHasPassword(data.hasPassword !== false);
    } catch {
      /* identities are non-critical; the rest of the profile still works */
    }
  }, []);

  useEffect(() => {
    void loadIdentities();
  }, [loadIdentities]);

  // Server-side link redirects land here as ?linked=… / ?link_error=…
  useEffect(() => {
    const linked = searchParams.get('linked');
    const linkErr = searchParams.get('link_error');
    if (!linked && !linkErr) return;
    if (linked) setLinkMessage(`${PROVIDER_LABELS[linked] ?? linked} подключён`);
    if (linkErr) setLinkError(LINK_ERROR_MESSAGES[linkErr] ?? 'Не удалось подключить провайдера.');
    const next = new URLSearchParams(searchParams);
    next.delete('linked');
    next.delete('link_error');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const linkedProviders = useMemo(
    () => new Set((identities ?? []).map((i) => i.provider)),
    [identities]
  );
  const loginMethodCount = (hasPassword ? 1 : 0) + (identities?.length ?? 0);

  const handleUnlink = useCallback(
    async (provider: string) => {
      setLinkMessage('');
      setLinkError('');
      setBusyProvider(provider);
      try {
        const res = await fetch(`/api/me/identities/${provider}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        if (!res.ok) {
          if (data.error === 'REAUTH_REQUIRED') {
            setLinkError('Войдите заново, чтобы изменять привязанные аккаунты.');
          } else if (data.error === 'LAST_LOGIN_METHOD') {
            setLinkError('Нельзя отключить единственный способ входа.');
          } else {
            setLinkError(typeof data.message === 'string' ? data.message : 'Не удалось отключить провайдера.');
          }
          return;
        }
        setLinkMessage(`${PROVIDER_LABELS[provider] ?? provider} отключён`);
        await loadIdentities();
      } catch {
        setLinkError('Не удалось отключить провайдера.');
      } finally {
        setBusyProvider('');
      }
    },
    [loadIdentities]
  );

  const handleTelegramConnect = useCallback(async () => {
    setLinkMessage('');
    setLinkError('');
    try {
      const res = await fetch('/api/auth/oauth/telegram/link-intent', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        setLinkError(
          data.error === 'REAUTH_REQUIRED'
            ? 'Войдите заново, чтобы подключить Telegram.'
            : 'Не удалось начать подключение Telegram.'
        );
        return;
      }
      setTelegramLinking(true);
    } catch {
      setLinkError('Не удалось начать подключение Telegram.');
    }
  }, []);

  if (!user) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <p className="text-slate-400">Требуется авторизация</p>
      </div>
    );
  }

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка обновления');
      }

      setMessage('Профиль обновлён');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="route-shell mx-auto max-w-2xl px-4 py-8" data-route="profile" data-layout="account">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Профиль</h1>
        <p className="mt-1 text-sm text-slate-400">Управление вашим аккаунтом</p>
      </div>

      <div className="space-y-6">
        {/* User Info Card */}
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-500">
              <User className="h-8 w-8 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-white">{user.displayName}</h2>
              <div className="mt-2 space-y-1 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  <span>{user.email ?? 'Email не указан'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4" />
                  <span>
                    Статус email:{' '}
                    <span
                      className={`font-medium ${user.emailVerified ? 'text-emerald-400' : 'text-amber-400'}`}
                    >
                      {user.emailVerified ? 'Подтверждён' : 'Не подтверждён'}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>Регистрация: {formatDate(user.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  <span className={`font-medium ${user.role === 'admin' ? 'text-cyan-400' : 'text-slate-300'}`}>
                    {user.role === 'admin' ? 'Администратор' : 'Пользователь'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Edit Display Name */}
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
          <h3 className="mb-4 text-sm font-semibold text-white">Изменить имя</h3>

          <form onSubmit={handleUpdate} className="space-y-4">
            {message && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
                {message}
              </div>
            )}
            {error && (
              <div className="rounded-md border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-slate-300">
                Отображаемое имя
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                minLength={2}
                maxLength={50}
                className="w-full rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </form>
        </div>

        {/* Connected accounts */}
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl" data-testid="connected-accounts">
          <h3 className="mb-1 text-sm font-semibold text-white">Подключённые аккаунты</h3>
          <p className="mb-4 text-xs text-slate-500">
            Вход через социальные сети. Единственный способ входа отключить нельзя.
          </p>

          {linkMessage && (
            <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300" role="status">
              {linkMessage}
            </div>
          )}
          {linkError && (
            <div className="mb-3 rounded-md border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-sm text-rose-300" role="alert">
              {linkError}
            </div>
          )}

          <div className="divide-y divide-white/[0.06]">
            {(['google', 'telegram', 'yandex', 'vk'] as const).map((provider) => {
              const configured = providers[provider];
              const linked = linkedProviders.has(provider);
              const identity = (identities ?? []).find((i) => i.provider === provider);
              const canUnlink = linked && loginMethodCount > 1;

              return (
                <div key={provider} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">
                      {PROVIDER_LABELS[provider]}
                    </div>
                    <div className="text-xs text-slate-500">
                      {linked
                        ? `Подключён${identity?.providerEmail ? ` · ${identity.providerEmail}` : ''}`
                        : configured
                          ? 'Не подключён'
                          : 'Недоступен'}
                    </div>
                  </div>

                  {linked ? (
                    <button
                      type="button"
                      onClick={() => handleUnlink(provider)}
                      disabled={!canUnlink || busyProvider === provider}
                      title={!canUnlink ? 'Нельзя отключить единственный способ входа' : undefined}
                      className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-950/20 px-3 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Unlink className="h-3.5 w-3.5" />
                      {busyProvider === provider ? 'Отключение…' : 'Отключить'}
                    </button>
                  ) : configured ? (
                    provider === 'telegram' ? (
                      telegramLinking && providers.telegramBotName ? (
                        <TelegramLinkWidget botName={providers.telegramBotName} />
                      ) : (
                        <button
                          type="button"
                          onClick={handleTelegramConnect}
                          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Подключить
                        </button>
                      )
                    ) : (
                      <a
                        href={`/api/auth/oauth/${provider}/start?link=1&returnTo=%2Fprofile`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        Подключить
                      </a>
                    )
                  ) : (
                    <span className="text-xs text-slate-600">Не настроен</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Logout */}
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
          <h3 className="mb-4 text-sm font-semibold text-white">Сессия</h3>
          <button
            onClick={handleLogout}
            className="rounded-md border border-rose-500/30 bg-rose-950/30 px-4 py-2 text-sm font-medium text-rose-300 transition-colors hover:bg-rose-900/40"
          >
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
};
