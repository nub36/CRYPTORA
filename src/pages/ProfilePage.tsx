/**
 * CRYPTORA — Profile Page
 *
 * Protected route: requires authentication.
 */

import React, { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { User, Mail, Calendar, Shield, BadgeCheck } from 'lucide-react';

export const ProfilePage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

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
                  <span>{user.email}</span>
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
