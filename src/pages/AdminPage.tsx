/**
 * CRYPTORA — Admin Panel
 *
 * Protected route: requires admin role.
 * Tabs: Dashboard, Users, System
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiUrl, isStaticHostingWithoutApi } from '@/config/api';
import {
  LayoutDashboard,
  Users,
  Server,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

type Tab = 'dashboard' | 'users' | 'system';

interface DashboardData {
  health: {
    status: string;
    database: string;
    version: string;
    nodeVersion: string;
    environment: string;
    uptimeSeconds: number;
    registrationEnabled: boolean;
  };
  users: {
    total: number;
    admins: number;
    users: number;
    active: number;
    blocked: number;
  };
  recentAudit: Array<{
    action: string;
    target_type: string;
    target_id: string;
    created_at: string;
    actor_name: string;
  }>;
}

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  emailVerified: boolean;
}

interface SystemInfo {
  version: string;
  nodeVersion: string;
  environment: string;
  uptimeSeconds: number;
  database: string;
  /** Открыта ли публичная регистрация (REGISTRATION_ENABLED на сервере). */
  registrationEnabled: boolean;
  memoryUsage: { rss: string; heapUsed: string };
}

export const AdminPage: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = useCallback(async () => {
    if (isStaticHostingWithoutApi) return;
    try {
      const res = await fetch(apiUrl('/api/admin/dashboard'), { credentials: 'include' });
      if (res.ok) {
        setDashboard(await res.json());
      }
    } catch {
      // silent
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: page.toString(), pageSize: '20' });
      if (search) params.set('search', search);

      const res = await fetch(apiUrl(`/api/admin/users?${params}`), { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setTotalPages(data.pagination.totalPages);
      }
    } catch {
      // silent
    }
  }, [page, search]);

  const fetchSystem = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/admin/system'), { credentials: 'include' });
      if (res.ok) {
        setSystem(await res.json());
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    setLoading(true);
    setError('');

    Promise.all([fetchDashboard(), fetchUsers(), fetchSystem()])
      .catch(() => setError('Ошибка загрузки данных'))
      .finally(() => setLoading(false));
  }, [isAdmin, fetchDashboard, fetchUsers, fetchSystem]);

  const handleBlock = async (userId: string) => {
    if (!confirm('Заблокировать пользователя?')) return;

    try {
      const res = await fetch(apiUrl(`/api/admin/users/${userId}/block`), {
        method: 'PATCH',
        credentials: 'include',
      });

      if (res.ok) {
        fetchUsers();
        fetchDashboard();
      } else {
        const data = await res.json();
        alert(data.error || 'Ошибка блокировки');
      }
    } catch {
      alert('Ошибка сети');
    }
  };

  const handleUnblock = async (userId: string) => {
    if (!confirm('Разблокировать пользователя?')) return;

    try {
      const res = await fetch(apiUrl(`/api/admin/users/${userId}/unblock`), {
        method: 'PATCH',
        credentials: 'include',
      });

      if (res.ok) {
        fetchUsers();
        fetchDashboard();
      } else {
        const data = await res.json();
        alert(data.error || 'Ошибка разблокировки');
      }
    } catch {
      alert('Ошибка сети');
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <p className="text-slate-400">Доступ запрещён</p>
      </div>
    );
  }

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}ч ${m}м ${s}с`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Админ-панель</h1>
          <p className="mt-1 text-sm text-slate-400">Управление CRYPTORA</p>
        </div>
        <button
          onClick={() => {
            fetchDashboard();
            fetchUsers();
            fetchSystem();
          }}
          className="flex items-center gap-2 rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-sm text-slate-300 hover:bg-surface-elevated"
        >
          <RefreshCw className="h-4 w-4" />
          Обновить
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-white/[0.08] pb-2">
        {[
          { id: 'dashboard' as Tab, label: 'Обзор', icon: LayoutDashboard },
          { id: 'users' as Tab, label: 'Пользователи', icon: Users },
          { id: 'system' as Tab, label: 'Система', icon: Server },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-cyan-500/15 text-cyan-300'
                : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-cyan-400" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Dashboard Tab */}
      {tab === 'dashboard' && dashboard && (
        <div className="space-y-6">
          {/* Health Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-4 backdrop-blur-xl">
              <div className="text-xs text-slate-400">Статус</div>
              <div className={`mt-1 text-lg font-bold ${dashboard.health.status === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {dashboard.health.status === 'ok' ? 'OK' : 'DEGRADED'}
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-4 backdrop-blur-xl">
              <div className="text-xs text-slate-400">База данных</div>
              <div className={`mt-1 text-lg font-bold ${dashboard.health.database === 'connected' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {dashboard.health.database === 'connected' ? 'Подключена' : 'Отключена'}
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-4 backdrop-blur-xl">
              <div className="text-xs text-slate-400">Аптайм</div>
              <div className="mt-1 text-lg font-bold text-white">{formatUptime(dashboard.health.uptimeSeconds)}</div>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-4 backdrop-blur-xl">
              <div className="text-xs text-slate-400">Версия</div>
              <div className="mt-1 text-lg font-bold text-white">{dashboard.health.version}</div>
            </div>
          </div>

          {/* User Stats */}
          <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
            <h3 className="mb-4 text-sm font-semibold text-white">Пользователи</h3>
            <div className="grid gap-4 sm:grid-cols-5">
              <div>
                <div className="text-2xl font-bold text-white">{dashboard.users.total}</div>
                <div className="text-xs text-slate-400">Всего</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-cyan-400">{dashboard.users.admins}</div>
                <div className="text-xs text-slate-400">Админы</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-400">{dashboard.users.users}</div>
                <div className="text-xs text-slate-400">Юзеры</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-400">{dashboard.users.active}</div>
                <div className="text-xs text-slate-400">Активные</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-rose-400">{dashboard.users.blocked}</div>
                <div className="text-xs text-slate-400">Заблокированы</div>
              </div>
            </div>
          </div>

          {/* Recent Audit */}
          {dashboard.recentAudit.length > 0 && (
            <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
              <h3 className="mb-4 text-sm font-semibold text-white">Последние действия</h3>
              <div className="space-y-2">
                {dashboard.recentAudit.map((audit, i) => (
                  <div key={i} className="flex items-center justify-between rounded bg-surface-2/50 px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-white">{audit.actor_name}</span>
                      <span className="text-slate-400"> — {audit.action}</span>
                      {audit.target_type && (
                        <span className="text-slate-500"> ({audit.target_type})</span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">{formatDate(audit.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Users Tab */}
      {tab === 'users' && (
        <div className="space-y-4">
          {/* Search */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Поиск по email или имени..."
                className="w-full rounded-md border border-white/[0.1] bg-surface-2 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
              />
            </div>
          </div>

          {/* Users Table */}
          <div className="overflow-x-auto rounded-lg border border-white/[0.08] bg-surface/60 backdrop-blur-xl">
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.08] bg-surface-2/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Пользователь</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Роль</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Статус</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Регистрация</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Последний вход</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-400">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{u.displayName}</div>
                      <div className="text-xs text-slate-400">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                        u.role === 'admin' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-slate-700/50 text-slate-300'
                      }`}>
                        {u.role === 'admin' ? 'Администратор' : 'Пользователь'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                        u.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                      }`}>
                        {u.isActive ? 'Активен' : 'Заблокирован'}
                      </span>
                    </td>
                    {/* Read-only: verification must prove mailbox ownership, so there
                        is deliberately NO manual "confirm email" action here. */}
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                        u.emailVerified ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                      }`}>
                        {u.emailVerified ? 'Подтверждён' : 'Не подтверждён'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.id !== user?.id && (
                        <button
                          onClick={() => u.isActive ? handleBlock(u.id) : handleUnblock(u.id)}
                          className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                            u.isActive
                              ? 'text-rose-400 hover:bg-rose-500/10'
                              : 'text-emerald-400 hover:bg-emerald-500/10'
                          }`}
                        >
                          {u.isActive ? (
                            <>
                              <ShieldX className="h-3.5 w-3.5" />
                              Заблокировать
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Разблокировать
                            </>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 rounded border border-white/[0.1] px-3 py-1.5 text-sm text-slate-300 hover:bg-surface-2 disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Назад
              </button>
              <span className="text-sm text-slate-400">
                Страница {page} из {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1 rounded border border-white/[0.1] px-3 py-1.5 text-sm text-slate-300 hover:bg-surface-2 disabled:opacity-50"
              >
                Вперёд
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* System Tab */}
      {tab === 'system' && system && (
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
          <h3 className="mb-4 text-sm font-semibold text-white">Системная информация</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-white/[0.05] pb-2">
              <span className="text-slate-400">Версия приложения</span>
              <span className="font-medium text-white">{system.version}</span>
            </div>
            <div className="flex justify-between border-b border-white/[0.05] pb-2">
              <span className="text-slate-400">Node.js</span>
              <span className="font-medium text-white">{system.nodeVersion}</span>
            </div>
            <div className="flex justify-between border-b border-white/[0.05] pb-2">
              <span className="text-slate-400">Окружение</span>
              <span className="font-medium text-white">{system.environment}</span>
            </div>
            <div className="flex justify-between border-b border-white/[0.05] pb-2">
              <span className="text-slate-400">Аптайм</span>
              <span className="font-medium text-white">{formatUptime(system.uptimeSeconds)}</span>
            </div>
            <div className="flex justify-between border-b border-white/[0.05] pb-2">
              <span className="text-slate-400">База данных</span>
              <span className={`font-medium ${system.database === 'connected' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {system.database === 'connected' ? 'Подключена' : 'Отключена'}
              </span>
            </div>
            <div className="flex justify-between border-b border-white/[0.05] pb-2">
              <span className="text-slate-400">Регистрация</span>
              <span
                className={`font-medium ${system.registrationEnabled ? 'text-emerald-400' : 'text-amber-400'}`}
                title="REGISTRATION_ENABLED — управляется переменной окружения сервера, не админ-панелью"
              >
                {system.registrationEnabled ? 'Включена' : 'Выключена'}
              </span>
            </div>
            <div className="flex justify-between border-b border-white/[0.05] pb-2">
              <span className="text-slate-400">Память (RSS)</span>
              <span className="font-medium text-white">{system.memoryUsage.rss}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Память (Heap)</span>
              <span className="font-medium text-white">{system.memoryUsage.heapUsed}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};