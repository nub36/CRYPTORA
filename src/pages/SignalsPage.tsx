import React, { useState, useMemo, useEffect } from 'react';
import { BarChart3, AlertOctagon, CheckCircle2, Shield, Lock, Filter, Radio } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { Collapsible } from '@/components/common/Collapsible';
import { sideLabel, pairLabel, stopComparator } from '@/utils/labels';
import { fetchSignals, type SignalDto } from '@/services/strategyOps';

type StatusFilter = 'ALL' | 'ACTIVE' | 'TARGET_REACHED' | 'INVALIDATED' | 'EXPIRED';

/**
 * Карточка сигнала в терминах серверной БД.
 *
 * Поля соответствуют AnalyticalSetup, чтобы остальная разметка не менялась,
 * но источник — PostgreSQL (миграция 007) через GET /api/signals, а не
 * localStorage браузера.
 */
interface SignalCard {
  id: string;
  strategyId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  entryZone: [number | null, number | null];
  invalidationLevel: number | null;
  targets: number[];
  riskRewardRatio: number | null;
  confirmingFactors: string[];
  invalidationFactors: string[];
  createdAt: string;
  status: 'ACTIVE' | 'TARGET_REACHED' | 'INVALIDATED' | 'EXPIRED';
  auditHash: string;
}

/** Цена или прочерк. 0 вместо «нет данных» показывать нельзя. */
function fmtPrice(v: number | null): string {
  return v === null || Number.isNaN(v) ? '—' : `$${v.toLocaleString()}`;
}

/** Короткая подпись версии по registry id (требование: каждый сигнал несёт strategy_id). */
export function strategyVersionLabel(strategyId: string): string {
  const map: Record<string, string> = {
    V3_0_HTF_LIQUIDATION_TRAP: 'V3.0',
    V3_3_HTF_ZONE_MITIGATION: 'V3.3',
    V2_8_ZERO_FEE_SNIPER_TRAILING: 'V2.8',
  };
  return map[strategyId] ?? strategyId;
}

function toCard(s: SignalDto): SignalCard {
  const targets = [s.tp1, s.tp2].filter((t): t is number => typeof t === 'number');
  return {
    id: s.id,
    strategyId: s.strategyId,
    symbol: s.symbol,
    timeframe: s.timeframe,
    direction: s.direction,
    entryZone: [s.entryMin, s.entryMax],
    invalidationLevel: s.stopLoss,
    targets,
    riskRewardRatio: s.metadata?.riskRewardRatio ?? null,
    confirmingFactors: s.metadata?.confirmingFactors ?? [],
    invalidationFactors: s.metadata?.invalidationFactors ?? [],
    createdAt: s.createdAt,
    status: s.status,
    auditHash: s.hash,
  };
}

export const SignalsPage: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [rows, setRows] = useState<SignalDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Источник данных — серверный API. Обновляем периодически: движок работает
   * на VPS независимо от того, открыта ли вкладка.
   */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Фильтр применяется на сервере — не тянем лишнего.
        const list = await fetchSignals(
          statusFilter === 'ALL' ? { limit: 100 } : { status: statusFilter, limit: 100 },
        );
        if (cancelled) return;
        setRows(list);
        setLoadError(null);
      } catch (e) {
        if (cancelled) return;
        // Молчаливой подмены на пустой список нет: показываем ошибку.
        setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить сигналы');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [statusFilter]);

  const setups = useMemo<SignalCard[]>(() => rows.map(toCard), [rows]);

  /**
   * Счётчики считаются по загруженным строкам. «Доля успешных» — только по
   * реально закрытым сетапам; если закрытых нет, показываем прочерк, а не 0 %
   * и не выдуманный winrate.
   */
  const summary = useMemo(() => {
    const totalSetups = rows.length;
    const activeCount = rows.filter((r) => r.status === 'ACTIVE').length;
    const targetReachedCount = rows.filter((r) => r.status === 'TARGET_REACHED').length;
    const invalidatedCount = rows.filter((r) => r.status === 'INVALIDATED').length;
    const closed = targetReachedCount + invalidatedCount;
    return {
      totalSetups,
      activeCount,
      targetReachedCount,
      invalidatedCount,
      accuracyRatePct: closed > 0 ? Math.round((targetReachedCount / closed) * 100) : null,
      closed,
    };
  }, [rows]);

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-brand-cyan" />
            <h1 className="ui-h1">Сигналы</h1>
          </div>
          <p className="ui-helper mt-1">
            Алгоритмические сетапы с журналом аудита и фиксацией факторов отмены.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 text-[11px] font-mono text-brand-cyan">
            <Radio className="w-3 h-3" />
            {/*
              Прежняя подпись «Сканирование 6 символов · 60с» описывала
              браузерный движок, который больше не генерирует сигналы.
              Число символов и интервал задаются в strategy_settings, поэтому
              здесь они не захардкожены.
            */}
            <span>Источник: серверный движок</span>
          </div>
          <div className="text-xs font-mono text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded border border-rose-500/30">
            Не является финансовой рекомендацией
          </div>
        </div>
      </div>

      {summary.totalSetups === 0 && (
        <div
          data-qa="signals-empty"
          className="p-4 bg-surface border border-amber-500/30 rounded-lg text-xs font-sans text-slate-300 space-y-1"
        >
          <div className="text-white font-bold">Реестр пуст: фактических сетапов нет</div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            CRYPTORA не публикует аналитические сетапы и не имеет трек-рекорда. Здесь показана только методология журнала (append-only,
            цепочка SHA-256). Никаких иллюстративных или демонстрационных записей в реестр не подставляется.
          </p>
        </div>
      )}

      {loadError && (
        <div
          data-testid="signals-load-error"
          className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300"
        >
          Не удалось загрузить сигналы с сервера: {loadError}
        </div>
      )}

      {loading && rows.length === 0 && !loadError && (
        <div data-testid="signals-loading" className="py-6 text-center text-xs text-slate-500">
          Загрузка сигналов с сервера…
        </div>
      )}

      {/* Transparent Performance Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-sans text-slate-400">Всего сетапов в реестре</div>
          <div className="text-lg font-bold font-mono text-white mt-1">{summary.totalSetups}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">100% зафиксировано</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-sans text-slate-400">Активные наблюдения</div>
          <div className="text-lg font-bold font-mono text-brand-cyan mt-1">{summary.activeCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">В процессе отработки</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-sans text-slate-400">Достигли целей (TP)</div>
          <div className="text-lg font-bold font-mono text-brand-green mt-1">{summary.targetReachedCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Полное исполнение</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-sans text-slate-400">Инвалидация (стоп)</div>
          <div className="text-lg font-bold font-mono text-rose-400 mt-1">{summary.invalidatedCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Отмена гипотезы</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-sans text-slate-400">Прозрачная доля успешных</div>
          <div className="text-lg font-bold font-mono text-amber-400 mt-1">{summary.accuracyRatePct === null ? "—" : `${summary.accuracyRatePct}%`}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {summary.closed > 0 ? `по ${summary.closed} закрытым` : 'закрытых сетапов ещё нет'}
          </div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="ui-label">Источник данных</div>
          <div
            data-testid="signals-source"
            className="text-sm font-bold font-sans text-brand-cyan mt-1.5 flex items-center space-x-1"
          >
            <span>Сервер · PostgreSQL</span>
          </div>
          {/*
            Утверждение «SHA-256 OK» убрано: цепочка теперь живёт в БД, а её
            верификация — серверная операция. Писать «OK» на клиенте, не
            проверяя, значило бы показывать выдуманное значение.
          */}
          <div className="ui-helper mt-0.5">Append-only, дедупликация по свече</div>
        </div>
      </div>

      {/* Кодекс прозрачности: вторично, свёрнуто по умолчанию */}
      <Collapsible
        testId="signals-code-of-transparency"
        tone="muted"
        icon={<Shield className="h-4 w-4 text-brand-green" />}
        label="Кодекс прозрачности сигналов"
        hint="журнал, статистика, опровергающие факторы"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <div className="ui-card-title mb-0.5">Неизменяемый журнал</div>
            <p className="ui-helper">
              Выпущенный сетап фиксируется криптографическим хэшем в неизменяемом логе.
              Ни один сигнал нельзя удалить или отредактировать задним числом.
            </p>
          </div>
          <div>
            <div className="ui-card-title mb-0.5">Честная статистика</div>
            <p className="ui-helper">
              Убыточные сделки и ложные срабатывания учитываются в расчёте win rate на 100%.
              Заявлений вида «98% точности» здесь нет.
            </p>
          </div>
          <div>
            <div className="ui-card-title mb-0.5">Опровергающие аргументы</div>
            <p className="ui-helper">
              Каждый сетап содержит не только подтверждающие факты, но и риски
              и опровергающие сигналы других индикаторов.
            </p>
          </div>
        </div>
      </Collapsible>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div className="flex flex-wrap items-center gap-2 font-sans text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400 text-xs">Статус:</span>
          {(['ALL', 'ACTIVE', 'TARGET_REACHED', 'INVALIDATED', 'EXPIRED'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1 rounded border transition-all ${
                statusFilter === tab
                  ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/40 font-bold'
                  : 'bg-surface text-slate-400 border-surface-border hover:text-white'
              }`}
            >
              {tab === 'ALL' && 'Все сетапы'}
              {tab === 'ACTIVE' && 'Активные'}
              {tab === 'TARGET_REACHED' && 'Цель достигнута'}
              {tab === 'INVALIDATED' && 'Инвалидированы'}
              {tab === 'EXPIRED' && 'Истекшие'}
            </button>
          ))}
        </div>

        <div className="text-[11px] font-sans text-slate-500">
          Найдено: {setups.length} из {summary.totalSetups}
        </div>
      </div>

      {/* Setups Cards */}
      <div className="space-y-4">
        {setups.length === 0 && (
          <div className="py-8 text-center text-slate-500 text-xs font-sans">Записей нет.</div>
        )}
        {setups.map((setup: SignalCard) => (
          <div
            key={setup.id}
            className="rounded-lg border border-surface-border bg-surface p-3.5 font-sans text-xs shadow-lg transition-all hover:border-slate-700 sm:p-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
              <div className="flex items-center space-x-3">
                <span className="ui-value break-words">{pairLabel(setup.symbol)}</span>
                <span
                  data-testid={`signal-strategy-${setup.id}`}
                  className="shrink-0 rounded bg-brand-cyan/15 px-2 py-0.5 font-mono text-xs text-brand-cyan"
                  title={setup.strategyId}
                >
                  {strategyVersionLabel(setup.strategyId)}
                </span>
                <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                  Timeframe {setup.timeframe}
                </span>
                <Badge
                  variant={
                    setup.status === 'TARGET_REACHED'
                      ? 'green'
                      : setup.status === 'INVALIDATED' || setup.status === 'EXPIRED'
                      ? 'red'
                      : 'cyan'
                  }
                  size="sm"
                >
                  {setup.status === 'TARGET_REACHED'
                    ? 'ЦЕЛЬ ДОСТИГНУТА'
                    : setup.status === 'INVALIDATED'
                    ? 'ИНВАЛИДИРОВАН (СТОП)'
                    : setup.status === 'EXPIRED'
                    ? 'ИСТЕК (4ч)'
                    : `ИДЕЯ: ${sideLabel(setup.direction).toUpperCase()}`}
                </Badge>
              </div>

              <div className="flex shrink-0 items-center gap-2 text-[11px] text-slate-500">
                <Lock className="h-3 w-3 shrink-0 text-brand-green" aria-hidden />
                <span className="ui-label">
                  {new Date(setup.createdAt).toLocaleDateString('ru-RU')}
                </span>
              </div>
            </div>

            {/* Price Targets Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                <div className="ui-label">Entry</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {fmtPrice(setup.entryZone[0])} – {fmtPrice(setup.entryZone[1])}
                </div>
              </div>
              <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                <div className="ui-label">Stop Loss</div>
                <div className="ui-num mt-0.5 text-sm font-bold text-rose-400">
                  {setup.invalidationLevel === null
                    ? '—'
                    : `${stopComparator(setup.direction)} ${fmtPrice(setup.invalidationLevel)}`}
                </div>
              </div>
              <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                <div className="ui-label">Take Profit</div>
                <div className="ui-num mt-0.5 text-sm font-bold text-brand-green">
                  {setup.targets.length > 0
                    ? setup.targets.map((t, i) => `TP${i + 1} ${fmtPrice(t)}`).join('  ·  ')
                    : '—'}
                </div>
              </div>
              <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                <div className="ui-label">Risk/Reward (R:R)</div>
                <div className="text-sm font-bold text-amber-400 mt-0.5">
                  1 : {setup.riskRewardRatio}
                </div>
              </div>
            </div>

            {/* Подтверждения, риски и хеш — вторично, свёрнуто по умолчанию */}
            <div className="space-y-2 pt-1">
              <Collapsible
                testId={`signal-confirming-${setup.id}`}
                icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                label="Подтверждающие наблюдения"
                count={setup.confirmingFactors.length}
              >
                <ul className="list-disc space-y-0.5 pl-4">
                  {setup.confirmingFactors.map((factor, idx) => (
                    <li key={idx}>{factor}</li>
                  ))}
                </ul>
              </Collapsible>

              <Collapsible
                testId={`signal-risks-${setup.id}`}
                tone="warning"
                icon={<AlertOctagon className="h-3.5 w-3.5" />}
                label="Опровергающие факторы и риски"
                count={setup.invalidationFactors.length}
              >
                <ul className="list-disc space-y-0.5 pl-4">
                  {setup.invalidationFactors.map((factor, idx) => (
                    <li key={idx}>{factor}</li>
                  ))}
                </ul>
              </Collapsible>

              <Collapsible
                testId={`signal-technical-${setup.id}`}
                tone="muted"
                icon={<Lock className="h-3.5 w-3.5" />}
                label="Технические сведения"
              >
                <dl className="space-y-1">
                  <div>
                    <dt className="ui-label inline">Audit hash: </dt>
                    <dd className="ui-hash inline">{setup.auditHash}</dd>
                  </div>
                  <div className="ui-helper">
                    Запись append-only: удалить или отредактировать сетап задним числом нельзя.
                  </div>
                </dl>
              </Collapsible>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
