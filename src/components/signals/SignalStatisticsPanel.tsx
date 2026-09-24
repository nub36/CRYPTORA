/**
 * SignalStatisticsPanel — СЕРВЕРНАЯ статистика сигналов.
 *
 * Источник — `GET /api/signals/statistics` (агрегаты по PostgreSQL), а не
 * браузерный `SignalsAuditLedger`. Поэтому числа одинаковы для всех
 * пользователей и переживают рестарт сервера.
 *
 * ИЕРАРХИЯ (требование задачи): сначала plain-language счётчики — сколько
 * сигналов, сколько дошло до входа, сколько завершилось, сколько прибыльных и
 * убыточных, win % и средний результат. R / netR / ΣR — под «Подробнее»:
 * это производные метрики, и вести ими первый экран нельзя.
 *
 * ГЛАВНОЕ ПРАВИЛО ЧЕСТНОСТИ: «опубликовано» ≠ «совершилась сделка». Сигнал,
 * который так и не дождался входа, идёт отдельной строкой и НЕ попадает в
 * знаменатель win rate. Если завершённых сделок нет, win rate и средний R
 * показываются как «—», а не как 0 %.
 *
 * ВТОРОЕ ПРАВИЛО: сделка «в ноль» (0 R) — это НЕ убыток. Убыток требует
 * строго отрицательного результата; ноль идёт своей строкой «В ноль», а
 * завершённая сделка без результата R — строкой «Без оценки R». Знаменатель
 * доли успешных — завершённые сделки с известным результатом.
 */

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import {
  fetchSignalStatistics,
  type SignalStatisticsDto,
  type SignalStatisticsFilters,
} from '@/services/strategyOps';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { formatSignedR } from '@/utils/signalText';

export interface SignalStatisticsPanelProps {
  /** null — без фильтра (вся история); иначе BASE-тикер выбранной монеты. */
  symbol?: string | null;
  pollMs?: number;
  /** Инъекция для тестов. */
  fetchStats?: typeof fetchSignalStatistics;
}

type Phase = 'loading' | 'ready' | 'error';

/** Число или прочерк: null означает «нет данных», а не ноль. */
function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value);
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value}%`;
}

/**
 * R — тем же форматом, что и в карточке сигнала: единый `formatSignedR`.
 * Иначе на одном экране «+1.67 R» и «+1.67R» выглядят как две разные величины.
 */
function r(value: number | null | undefined): string {
  return formatSignedR(value);
}

export const SignalStatisticsPanel: React.FC<SignalStatisticsPanelProps> = ({
  symbol = null,
  pollMs = 60_000,
  fetchStats = fetchSignalStatistics,
}) => {
  const [stats, setStats] = useState<SignalStatisticsDto | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const load = React.useCallback(async () => {
    const filters: SignalStatisticsFilters = symbol ? { symbol } : {};
    try {
      const s = await fetchStats(filters);
      // Ответ без агрегатов — это «недоступно», а не «нули»: иначе сломанный
      // контракт показывал бы «0 сигналов, 0 %» как будто это факт.
      if (!s || typeof s.totals?.published !== 'number' || !s.definitions) {
        throw new Error('сервер вернул неполную статистику');
      }
      setStats(s);
      setError(null);
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Статистика недоступна');
      setPhase('error');
    }
  }, [symbol, fetchStats]);

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(load, pollMs, { skipImmediate: true });

  if (phase === 'error') {
    return (
      <div className="rounded border border-amber-500/30 bg-surface-elevated/40 p-3" data-qa="signals-statistics-error">
        <div className="ui-card-title mb-1">Статистика сигналов</div>
        <p className="ui-helper">
          Серверная статистика недоступна: {error}. Это не значит, что сигналов нет — лента ниже
          показывает фактически сохранённые сигналы.
        </p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="rounded border border-surface-border/60 bg-surface-elevated/40 p-3" data-qa="signals-statistics-loading">
        <div className="ui-card-title mb-1">Статистика сигналов</div>
        <p className="ui-helper">Считаем по сохранённому жизненному циклу…</p>
      </div>
    );
  }

  const t = stats.totals;
  const hasTrades = t.completed > 0;

  return (
    <div className="rounded border border-surface-border/60 bg-surface-elevated/40 p-3" data-qa="signals-statistics">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="ui-card-title flex items-center gap-1.5">
          <BarChart3 className="h-4 w-4 text-brand-cyan" aria-hidden="true" />
          Статистика сигналов
        </div>
        <span className="ui-helper">
          {symbol ? `инструмент ${symbol}` : 'все инструменты'} · период {PERIOD_LABEL[stats.period]}
        </span>
      </div>

      {/* Первый экран — человеческие счётчики, без R. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        <Row label="Опубликовано сигналов" value={num(t.published)} qa="stat-published" />
        <Row label="Ожидают входа" value={num(t.waitingEntry)} qa="stat-waiting" />
        <Row label="Дошли до входа" value={num(t.filled + t.completed)} qa="stat-filled" />
        <Row label="Завершились сделкой" value={num(t.completed)} qa="stat-completed" />
        <Row label="Прибыльные" value={num(hasTrades ? t.wins : null)} qa="stat-wins" />
        <Row label="В ноль" value={num(hasTrades ? t.breakEven : null)} qa="stat-break-even" />
        <Row label="Убыточные" value={num(hasTrades ? t.losses : null)} qa="stat-losses" />
        <Row
          label="Без оценки R"
          value={num(hasTrades ? t.unrated : null)}
          qa="stat-unrated"
        />
        <Row label="Доля успешных" value={pct(t.winRatePct)} qa="stat-winrate" />
        <Row label="Средний результат" value={hasTrades ? r(t.avgNetR) : '—'} qa="stat-avg" />
        <Row
          label="Без сделки (отмены / истечения / не отслежено)"
          value={num(t.cancelled + t.expired + t.unresolved)}
          qa="stat-no-trade"
        />
      </dl>

      {t.published === 0 && (
        <p className="ui-helper mt-2">
          Сохранённых сигналов пока нет. Пока ни одна стратегия не включена, сервер не публикует новые
          сетапы — это нормальное состояние, а не сбой.
        </p>
      )}

      {/* «Подробнее» — производные метрики: R, netR, суммы, разрезы. */}
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-brand-cyan hover:text-white"
        data-qa="signals-statistics-details-toggle"
        aria-expanded={detailsOpen}
      >
        {detailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Подробнее
      </button>

      {detailsOpen && (
        <div className="mt-2 space-y-3" data-qa="signals-statistics-details">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
            <Row label="Средний gross R" value={r(t.avgGrossR)} qa="stat-avg-gross" />
            <Row label="Средний net R" value={r(t.avgNetR)} qa="stat-avg-net" />
            <Row label="Σ gross R" value={r(t.grossRSum)} qa="stat-sum-gross" />
            <Row label="Σ net R" value={r(t.netRSum)} qa="stat-sum-net" />
            <Row label="Дошли до входа, %" value={pct(t.fillRatePct)} qa="stat-fill-rate" />
            <Row label="Завершились сделкой, %" value={pct(t.completionRatePct)} qa="stat-completion-rate" />
            <Row
              label="Завершено с известным R"
              value={num(t.ratedCompleted)}
              qa="stat-rated-completed"
            />
            <Row label="Целей достигнуто" value={num(t.targetReached)} qa="stat-target" />
            <Row label="Остановов" value={num(t.invalidated)} qa="stat-invalidated" />
          </dl>

          {stats.byStrategy.length > 0 && (
            <Breakdown
              title="По стратегии"
              qa="stat-by-strategy"
              rows={stats.byStrategy.map((s) => ({
                key: s.strategyId,
                label: s.strategyId,
                published: s.published,
                completed: s.completed,
                wins: s.wins,
                breakEven: s.breakEven,
                losses: s.losses,
                winRatePct: s.winRatePct,
                netRSum: s.netRSum,
              }))}
            />
          )}

          {stats.bySymbol.length > 0 && (
            <Breakdown
              title="По инструменту"
              qa="stat-by-symbol"
              rows={stats.bySymbol.map((s) => ({
                key: s.symbol,
                label: s.symbol,
                published: s.published,
                completed: s.completed,
                wins: s.wins,
                breakEven: s.breakEven,
                losses: s.losses,
                winRatePct: s.winRatePct,
                netRSum: s.netRSum,
              }))}
            />
          )}

          <div className="ui-helper space-y-1 border-t border-surface-border/60 pt-2">
            <p>{stats.definitions.winRatePct}</p>
            <p>{stats.definitions.breakEven}</p>
            <p>{stats.definitions.unrated}</p>
            <p>{stats.definitions.avgGrossR}</p>
            <p>{stats.definitions.avgNetR}</p>
            <p>
              1R — первоначальный риск между ценой входа и стопом на момент публикации. Формулу считает
              сервер по закрытым свечам; интерфейс её не пересчитывает.
            </p>
            <p>
              Знаменатель доли успешных — завершённые сделки с известным результатом:{' '}
              {num(t.ratedCompleted)} из {num(t.published)} опубликованных. В него входят прибыльные (
              {num(t.wins)}), убыточные ({num(t.losses)}) и сделки в ноль ({num(t.breakEven)}).
            </p>
            <p>
              Отмены ({num(t.cancelled)}), истечения ({num(t.expired)}) и неотслеженные исходы (
              {num(t.unresolved)}) в знаменатель не входят: там сделки не было. Завершённые сделки без
              результата R ({num(t.unrated)}) тоже не входят — «результат неизвестен» не является ни
              победой, ни поражением, ни ничьей.
            </p>
            <p>
              Сделка в ноль (0 R) не является убыточной: убыток — это строго отрицательный результат.
              Именно поэтому «В ноль» показывается отдельной строкой.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const PERIOD_LABEL: Record<string, string> = {
  all: 'всё время',
  '24h': '24 часа',
  '7d': '7 дней',
  '30d': '30 дней',
  '90d': '90 дней',
};

const Row: React.FC<{ label: string; value: string; qa: string }> = ({ label, value, qa }) => (
  <div className="flex items-baseline justify-between gap-2 border-b border-surface-border/30 pb-1">
    <dt className="ui-label">{label}</dt>
    <dd className="ui-num font-semibold text-slate-200" data-qa={qa}>
      {value}
    </dd>
  </div>
);

interface BreakdownRow {
  key: string;
  label: string;
  published: number;
  completed: number;
  wins: number;
  breakEven: number;
  losses: number;
  winRatePct: number | null;
  netRSum: number | null;
}

const Breakdown: React.FC<{ title: string; qa: string; rows: BreakdownRow[] }> = ({ title, qa, rows }) => (
  <div data-qa={qa}>
    <div className="ui-label mb-1">{title}</div>
    <table className="w-full text-left text-[11px]">
      <thead className="ui-label">
        <tr>
          <th className="py-1 pr-2 font-normal">Название</th>
          <th className="py-1 pr-2 font-normal">Опубликовано</th>
          <th className="py-1 pr-2 font-normal">Завершено</th>
          <th className="py-1 pr-2 font-normal">Прибыльные</th>
          <th className="py-1 pr-2 font-normal">В ноль</th>
          <th className="py-1 pr-2 font-normal">Убыточные</th>
          <th className="py-1 pr-2 font-normal">Доля успешных</th>
          <th className="py-1 font-normal">Σ net R</th>
        </tr>
      </thead>
      <tbody className="font-mono text-slate-300">
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-surface-border/30">
            <td className="py-1 pr-2 font-sans text-slate-200">{row.label}</td>
            <td className="py-1 pr-2">{row.published}</td>
            <td className="py-1 pr-2">{row.completed}</td>
            <td className="py-1 pr-2">{row.wins}</td>
            <td className="py-1 pr-2">{row.breakEven}</td>
            <td className="py-1 pr-2">{row.losses}</td>
            <td className="py-1 pr-2">{pct(row.winRatePct)}</td>
            <td className="py-1">{r(row.netRSum)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default SignalStatisticsPanel;
