/**
 * StrategyTestRunsManager — Admin → Тестирование стратегий.
 *
 * «НАЧАТЬ НОВЫЙ ТЕСТОВЫЙ ПЕРИОД» — административная операция, после которой
 * статистика выбранной стратегии в Signals UI считается с нуля.
 *
 * Инварианты, которые держит этот компонент:
 *  • ЭТО НЕ ОЧИСТКА и НЕ ПЕРЕКЛЮЧАТЕЛЬ. Компонент НЕ вызывает
 *    setStrategyEnabled: включённость стратегии (V3.4 = выключена) не меняется
 *    от старта периода. Кнопка создаёт период; сигналы не удаляются.
 *  • Членство сигналов назначает сервер. UI никогда не отправляет run id
 *    сигналам — только strategyId операции «начать период».
 *  • Источник истины — PostgreSQL через admin API (requireAdmin на сервере).
 *    Роль на фронте влияет лишь на доступность кнопки, защитой не является.
 *  • Подтверждение — явный диалог с последствиями ДО отправки запроса:
 *    операция не разрушительна, но завершает предыдущий период.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, RefreshCw } from 'lucide-react';
import {
  fetchAdminStrategyTestRuns,
  fetchStrategies,
  startStrategyTestRun,
  type AdminStrategyTestRunsDto,
  type StrategyStateDto,
  type StrategyTestRunDto,
} from '@/services/strategyOps';

/** Формат подписи периода: «Run от 30.09.2026 14:30» (часовой пояс браузера). */
export function formatRunTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Человекочитаемая подпись периода: UUID наружу не обязателен. */
export function runLabel(run: Pick<StrategyTestRunDto, 'startedAt'>): string {
  return `Run от ${formatRunTimestamp(run.startedAt)}`;
}

/** Селектор стратегии: «V3.4 — HTF Zone Mitigation + Target Quality». */
export function strategyOptionLabel(s: Pick<StrategyStateDto, 'version' | 'name'>): string {
  return `V${s.version} — ${s.name}`;
}

interface Props {
  /** Инъекции для тестов: реальные API-функции по умолчанию. */
  fetchStrategiesList?: typeof fetchStrategies;
  fetchState?: typeof fetchAdminStrategyTestRuns;
  startRun?: typeof startStrategyTestRun;
}

export const StrategyTestRunsManager: React.FC<Props> = ({
  fetchStrategiesList = fetchStrategies,
  fetchState = fetchAdminStrategyTestRuns,
  startRun = startStrategyTestRun,
}) => {
  const [strategies, setStrategies] = useState<StrategyStateDto[] | null>(null);
  const [strategyId, setStrategyId] = useState<string>('');
  const [state, setState] = useState<AdminStrategyTestRunsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 5000);
  }, []);

  // Каталог стратегий — публичный endpoint; порядок как на сервере.
  useEffect(() => {
    let active = true;
    void fetchStrategiesList().then((list) => {
      if (!active || list.length === 0) return;
      setStrategies(list);
      setStrategyId((current) => current || list[0].strategyId);
    }).catch(() => {
      if (active) flash('err', 'Не удалось загрузить список стратегий.');
    });
    return () => { active = false; };
  }, [fetchStrategiesList, flash]);

  // Состояние раздела — только admin API (requireAdmin на сервере).
  const loadState = useCallback(async (id: string) => {
    setLoading(true);
    try {
      setState(await fetchState(id));
    } catch (e) {
      setState(null);
      flash('err', e instanceof Error ? e.message : 'Не удалось загрузить состояние тестовых периодов.');
    } finally {
      setLoading(false);
    }
  }, [fetchState, flash]);

  useEffect(() => {
    if (strategyId) void loadState(strategyId);
  }, [strategyId, loadState]);

  const selected = useMemo(
    () => strategies?.find((s) => s.strategyId === strategyId) ?? null,
    [strategies, strategyId]
  );
  const versionLabel = selected ? `V${selected.version}` : '';

  const confirmStart = useCallback(async () => {
    if (!strategyId || busy) return;
    setBusy(true);
    try {
      const res = await startRun(strategyId);
      setConfirming(false);
      flash('ok', `${res.message} Период: ${formatRunTimestamp(res.startedAt)}.`);
      // Включённость стратегии операцией не меняется — состояние перечитывается
      // целиком, чтобы «Включена/Выключена» осталась серверной правдой.
      await loadState(strategyId);
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Не удалось начать тестовый период.');
    } finally {
      setBusy(false);
    }
  }, [strategyId, busy, startRun, flash, loadState]);

  return (
    <div className="space-y-4" data-qa="admin-test-runs">
      <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <FlaskConical className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              Тестирование стратегий
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Тестовый период ограничивает статистику стратегии в Signals UI: считаются только
              сигналы, созданные в периоде. Предыдущие сигналы и результаты остаются в «Все данные».
            </p>
          </div>
          {strategyId && (
            <button
              type="button"
              onClick={() => void loadState(strategyId)}
              className="flex shrink-0 items-center gap-1.5 rounded border border-white/[0.1] px-2.5 py-1.5 text-xs text-slate-300 hover:bg-surface-elevated"
              data-qa="test-runs-refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Обновить
            </button>
          )}
        </div>

        {/* Выбор стратегии */}
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-slate-400" htmlFor="test-runs-strategy">
            Стратегия
          </label>
          <select
            id="test-runs-strategy"
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            disabled={!strategies}
            data-qa="test-runs-strategy-select"
            className="w-full max-w-md rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-sm text-white focus:border-cyan-400/60 focus:outline-none disabled:opacity-50"
          >
            {(strategies ?? []).map((s) => (
              <option key={s.strategyId} value={s.strategyId}>
                {strategyOptionLabel(s)}
              </option>
            ))}
            {!strategies && <option value="">Загрузка…</option>}
          </select>
        </div>

        {notice && (
          <div
            className={`mt-3 rounded border px-3 py-2 text-xs ${
              notice.kind === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
            }`}
            data-qa="test-runs-notice"
          >
            {notice.text}
          </div>
        )}

        {/* Состояние выбранной стратегии */}
        {loading && !state && (
          <p className="mt-4 text-xs text-slate-400" data-qa="test-runs-loading">
            Загружаем состояние тестовых периодов…
          </p>
        )}
        {state && (
          <dl
            className="mt-4 grid grid-cols-1 gap-3 border-t border-white/[0.05] pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4"
            data-qa="test-runs-status"
          >
            <div>
              <dt className="text-xs text-slate-400">Статус стратегии</dt>
              <dd className="mt-1">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    state.enabled
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-700/50 text-slate-300'
                  }`}
                  data-qa="test-runs-strategy-enabled"
                  data-enabled={state.enabled ? 'true' : 'false'}
                >
                  {state.enabled ? 'Включена' : 'Выключена'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Текущий тест</dt>
              <dd className="mt-1 font-medium text-white" data-qa="test-runs-current">
                {state.currentRun ? runLabel(state.currentRun) : 'Нет'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Начало</dt>
              <dd className="mt-1 font-medium text-white" data-qa="test-runs-current-started">
                {state.currentRun ? formatRunTimestamp(state.currentRun.startedAt) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Сигналов в периоде</dt>
              <dd className="mt-1 font-mono font-medium text-white" data-qa="test-runs-current-signals">
                {state.currentRun ? state.currentRun.signalCount : 0}
              </dd>
            </div>
          </dl>
        )}

        {/* Основная кнопка + подсказка */}
        <div className="mt-4 flex flex-col gap-2 border-t border-white/[0.05] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs text-slate-400" data-qa="test-runs-hint">
            Предыдущие сигналы и результаты не удаляются. Статистика нового периода начнётся с нуля.
          </p>
          <button
            type="button"
            disabled={!strategyId || busy}
            onClick={() => setConfirming(true)}
            data-qa="test-runs-start"
            className="flex shrink-0 items-center justify-center gap-2 rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-500 disabled:opacity-40"
          >
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
            Начать новый тестовый период
          </button>
        </div>
      </div>

      {/* История периодов */}
      {state && (
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
          <h3 className="mb-1 text-sm font-semibold text-white">История тестовых периодов</h3>
          <p className="mb-4 text-xs text-slate-400">
            Периоды выбранной стратегии. Сигнал навсегда остаётся членом периода, в котором создан:
            исход, наступивший после смены периода, считается в периоде создания.
          </p>
          <div className="overflow-x-auto" data-qa="test-runs-history">
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.08] bg-surface-2/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Run</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Начало</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Конец</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Статус</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-400">Сигналов</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {state.runs.map((run, index) => (
                  <tr key={run.id} className="hover:bg-white/[0.02]" data-qa={`test-runs-run-${index}`}>
                    <td className="px-4 py-3 font-medium text-white">
                      {runLabel(run)}
                      {run.status === 'ACTIVE' && (
                        <span className="ml-2 rounded bg-cyan-500/15 px-1.5 py-0.5 text-[11px] text-cyan-300">
                          текущий
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{formatRunTimestamp(run.startedAt)}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{formatRunTimestamp(run.endedAt)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          run.status === 'ACTIVE'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-slate-700/50 text-slate-300'
                        }`}
                        data-qa={`test-runs-run-status-${index}`}
                      >
                        {run.status === 'ACTIVE' ? 'ACTIVE' : 'COMPLETED'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-200">{run.signalCount}</td>
                  </tr>
                ))}
                {state.runs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-xs text-slate-500" data-qa="test-runs-history-empty">
                      Тестовых периодов ещё не было. После «Начать новый тестовый период» статистика
                      стратегии будет считаться с нуля.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Подтверждение: операция завершает предыдущий период, но НЕ удаляет данные */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="test-runs-confirm-title"
          data-qa="test-runs-confirm"
        >
          <div className="w-full max-w-md rounded-lg border border-white/[0.1] bg-surface p-6">
            <h3 id="test-runs-confirm-title" className="text-base font-bold text-white">
              Начать новый тестовый период {versionLabel}?
            </h3>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-300">
              <li>Предыдущий период, если он существует, будет завершён.</li>
              <li>Исторические сигналы НЕ удаляются.</li>
              <li>Настройки стратегии НЕ изменяются.</li>
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                data-qa="test-runs-confirm-cancel"
                className="rounded-md border border-white/[0.1] px-4 py-2 text-sm text-slate-300 hover:bg-surface-2 disabled:opacity-40"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmStart()}
                data-qa="test-runs-confirm-start"
                className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-500 disabled:opacity-40"
              >
                {busy ? 'Начинаем…' : 'Начать новый период'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
