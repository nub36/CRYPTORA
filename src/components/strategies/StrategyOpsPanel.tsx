import React, { useCallback, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { setStrategyEnabled, type StrategyStateDto } from '@/services/strategyOps';

/**
 * Операционная панель стратегии: реальный переключатель ВКЛ/ВЫКЛ и реальное
 * состояние серверного движка.
 *
 * Принципы:
 *  • Источник истины — PostgreSQL через GET /api/strategies. localStorage не
 *    участвует: состояние переживает F5 и рестарт VPS.
 *  • Переключатель интерактивен только для администратора. Защита — это
 *    requireAdmin на сервере; роль здесь влияет лишь на то, можно ли нажать.
 *  • Оптимистичный UI с откатом: если API вернул ошибку, значение возвращается
 *    к серверному, а не остаётся «красивым».
 *  • Никаких выдуманных значений: если скана ещё не было — прочерк.
 */

const STATUS_LABEL: Record<StrategyStateDto['status'], string> = {
  ON: 'Работает',
  OFF: 'Выключена',
  ERROR: 'Ошибка',
};

const STATUS_TONE: Record<StrategyStateDto['status'], string> = {
  ON: 'text-brand-green',
  OFF: 'text-text-muted',
  ERROR: 'text-rose-400',
};

/** «—» вместо выдуманного нуля или эпохи. */
export function formatTimestamp(iso: string | null): string {
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

interface Props {
  state: StrategyStateDto;
  /** Колбэк после успешного переключения — родитель обновляет общее состояние. */
  onChanged: (strategyId: string, enabled: boolean) => void;
}

export const StrategyOpsPanel: React.FC<Props> = ({ state, onChanged }) => {
  const { isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (!isAdmin || busy) return;
    const next = !state.enabled;
    setError(null);
    // Оптимистично показываем новое состояние, но помним серверное для отката.
    onChanged(state.strategyId, next);
    setBusy(true);
    try {
      const res = await setStrategyEnabled(state.strategyId, next);
      onChanged(state.strategyId, res.enabled);
    } catch (e) {
      // Откат к реальному серверному состоянию.
      onChanged(state.strategyId, state.enabled);
      setError(e instanceof Error ? e.message : 'Не удалось изменить состояние');
    } finally {
      setBusy(false);
    }
  }, [isAdmin, busy, state.enabled, state.strategyId, onChanged]);

  return (
    <div className="ui-ops mt-3 space-y-2 border-t border-surface-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            data-testid={`ops-status-${state.strategyId}`}
            className={`ui-label shrink-0 ${STATUS_TONE[state.status]}`}
          >
            {STATUS_LABEL[state.status]}
          </span>
          <span
            data-testid={`ops-active-${state.strategyId}`}
            className="ui-label shrink-0 text-text-muted"
            title="Активных сигналов (реальный SELECT COUNT)"
          >
            активных: {state.activeSignalCount}
          </span>
        </div>

        {/* Переключатель: админу — кнопка, остальным — неактивное состояние. */}
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-label={`Включить стратегию ${state.name}`}
          data-testid={`ops-toggle-${state.strategyId}`}
          disabled={!isAdmin || busy}
          onClick={toggle}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors
            ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}
            ${state.enabled
              ? 'border-brand-green/50 bg-brand-green/25'
              : 'border-surface-border bg-surface-raised'}`}
        >
          <span
            className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all
              ${state.enabled
                ? 'left-[calc(100%-1.375rem)] bg-brand-green'
                : 'left-0.5 bg-text-muted'}`}
            style={{ height: '1.125rem', width: '1.125rem' }}
          />
        </button>
      </div>

      <dl className="ui-ops-grid grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div className="min-w-0">
          <dt className="ui-label text-text-muted">Последний скан</dt>
          <dd
            data-testid={`ops-lastscan-${state.strategyId}`}
            className="ui-value truncate text-text-secondary"
          >
            {formatTimestamp(state.lastScanAt)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="ui-label text-text-muted">Последний сигнал</dt>
          <dd
            data-testid={`ops-lastsignal-${state.strategyId}`}
            className="ui-value truncate text-text-secondary"
          >
            {formatTimestamp(state.lastSignalAt)}
          </dd>
        </div>
      </dl>

      {!isAdmin && (
        <p className="text-xs text-text-muted">
          Переключение доступно администратору. Состояние отображается только для чтения.
        </p>
      )}

      {state.status === 'ERROR' && state.lastError && (
        <p
          data-testid={`ops-error-${state.strategyId}`}
          className="break-words text-xs text-rose-400"
        >
          {state.lastError}
        </p>
      )}

      {error && (
        <p data-testid={`ops-toggle-error-${state.strategyId}`} className="break-words text-xs text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
};
