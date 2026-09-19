import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  BarChart3, AlertOctagon, CheckCircle2, Shield, Lock, Filter, Check, Radio, Activity, RefreshCw, History,
} from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { Collapsible } from '@/components/common/Collapsible';
import { sideLabel } from '@/utils/labels';
import { useMarketData } from '@/context/MarketDataContext';
import {
  SignalsAuditLedger, CLOSED_STATUSES, type AnalyticalSetup, type SetupStatus,
} from '@/services/signals/SignalsAuditLedger';
import { LiveSignalEngine, type EngineStatus } from '@/services/signals/live/LiveSignalEngine';
import type { ReplayRecord } from '@/services/signals/live/replays/types';

type StatusFilter = 'ALL' | 'OPEN' | 'TARGET_REACHED' | 'INVALIDATED' | 'CLOSED' | 'NO_TRADE';

const STRATEGY_LABELS: Record<string, string> = {
  V3_0_HTF_LIQUIDATION_TRAP: 'V3.0 · HTF Liquidation Trap',
  V3_3_HTF_ZONE_MITIGATION: 'V3.3 · HTF Zone Mitigation',
  V2_8_ZERO_FEE_SNIPER_TRAILING: 'V2.8 · Sniper + Trailing (gross-only)',
};

const STRATEGY_SHORT: Record<string, string> = {
  V3_0_HTF_LIQUIDATION_TRAP: 'V3.0',
  V3_3_HTF_ZONE_MITIGATION: 'V3.3',
  V2_8_ZERO_FEE_SNIPER_TRAILING: 'V2.8',
};

const STRATEGY_VERDICT: Record<string, { label: string; variant: 'green' | 'amber' | 'purple' }> = {
  V3_0_HTF_LIQUIDATION_TRAP: { label: 'VALIDATED (3 из 6 символов)', variant: 'green' },
  V3_3_HTF_ZONE_MITIGATION: { label: 'TRAIN-ONLY, не валидировано', variant: 'amber' },
  V2_8_ZERO_FEE_SNIPER_TRAILING: { label: 'GROSS-ONLY, net-отрицательна', variant: 'purple' },
};

function statusLabel(status: SetupStatus): string {
  switch (status) {
    case 'ACTIVE': return 'ОЖИДАЕТ ВХОДА';
    case 'FILLED': return 'В ПОЗИЦИИ';
    case 'TARGET_REACHED': return 'ЦЕЛЬ ДОСТИГНУТА (TP2)';
    case 'INVALIDATED': return 'ИНВАЛИДИРОВАН (СТОП)';
    case 'CLOSED': return 'ЗАКРЫТ ПО ПРАВИЛУ';
    case 'EXPIRED': return 'КОРИДОР ИСТЁК';
    case 'CANCELLED': return 'ОТМЕНЁН ДО ВХОДА';
    case 'UNRESOLVED': return 'ИСХОД НЕ ОТСЛЕЖЕН';
    default: return status;
  }
}

function statusVariant(status: SetupStatus): 'green' | 'red' | 'cyan' | 'amber' | 'neutral' {
  switch (status) {
    case 'TARGET_REACHED': return 'green';
    case 'INVALIDATED': return 'red';
    case 'CLOSED': return 'amber';
    case 'FILLED': return 'cyan';
    case 'ACTIVE': return 'cyan';
    default: return 'neutral';
  }
}

function exitReasonLabel(reason: string | undefined): string {
  switch (reason) {
    case 'SL': return 'стоп';
    case 'TP2': return 'TP2';
    case 'TP1_THEN_BE': return 'TP1 → безубыток';
    case 'TP1_THEN_SL': return 'TP1 → стоп';
    case 'TP1_THEN_TIMEOUT': return 'TP1 → таймаут';
    case 'TIMEOUT': return 'таймаут';
    case 'TRAIL': return 'трейлинг-стоп';
    case 'BE': return 'безубыток';
    case 'EXPIRED': return 'коридор истёк';
    case 'CANCELLED': return 'стоп задет до входа';
    case 'REJECTED_GEOMETRY': return 'геометрия отклонена при исполнении';
    case 'NO_CONTIGUOUS_NEXT_BAR': return 'нет примыкающего бара N+1';
    case 'LADDER_INVALID_AT_FILL': return 'лестница целей невалидна при исполнении';
    case 'OUT_OF_DATA_WINDOW': return 'бар сетапа вышел за окно данных';
    default: return reason ?? '—';
  }
}

function fmtPrice(p: number): string {
  const abs = Math.abs(p);
  const digits = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 6;
  return p.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtR(r: number | null | undefined): string {
  if (typeof r !== 'number') return '—';
  return `${r > 0 ? '+' : ''}${r.toFixed(2)} R`;
}

function fmtUtc(ms: number | string | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function matchesFilter(s: AnalyticalSetup, f: StatusFilter): boolean {
  switch (f) {
    case 'ALL': return true;
    case 'OPEN': return s.status === 'ACTIVE' || s.status === 'FILLED';
    case 'TARGET_REACHED': return s.status === 'TARGET_REACHED';
    case 'INVALIDATED': return s.status === 'INVALIDATED';
    case 'CLOSED': return s.status === 'CLOSED';
    case 'NO_TRADE': return s.status === 'EXPIRED' || s.status === 'CANCELLED' || s.status === 'UNRESOLVED';
    default: return true;
  }
}

export const SignalsPage: React.FC = () => {
  const { dataMode } = useMarketData();
  const ledger = useMemo(() => SignalsAuditLedger.getInstance(), []);
  const [tick, setTick] = useState(0);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(() => LiveSignalEngine.getInstance()?.getStatus() ?? null);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  // Журнал: подписка на изменения + страховочный опрос (другая вкладка могла дописать хранилище).
  useEffect(() => {
    const unsubscribe = ledger.subscribe(bump);
    const interval = setInterval(() => {
      ledger.reload();
      bump();
    }, 5_000);
    return () => { unsubscribe(); clearInterval(interval); };
  }, [ledger, bump]);

  // Движок: статус скана.
  useEffect(() => {
    const engine = LiveSignalEngine.getInstance();
    if (!engine) { setEngineStatus(null); return; }
    const refresh = () => setEngineStatus(engine.getStatus());
    refresh();
    const unsubscribe = engine.subscribe(refresh);
    const interval = setInterval(refresh, 5_000);
    return () => { unsubscribe(); clearInterval(interval); };
  }, [dataMode, tick]);

  const summary = useMemo(() => ledger.getSummary(), [ledger, tick]);
  const isIntegrityVerified = useMemo(() => ledger.verifyIntegrity(), [ledger, tick]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [strategyFilter, setStrategyFilter] = useState<string>('ALL');
  const [scanRequested, setScanRequested] = useState(false);

  const allSetups = useMemo(() => [...ledger.getSetups()].reverse(), [ledger, tick]);
  const setups = useMemo(
    () => allSetups.filter((s) => matchesFilter(s, statusFilter) && (strategyFilter === 'ALL' || s.strategyId === strategyFilter)),
    [allSetups, statusFilter, strategyFilter],
  );

  const retrospective: ReplayRecord[] = useMemo(() => {
    const engine = LiveSignalEngine.getInstance();
    if (!engine) return [];
    return engine.getRetrospective(strategyFilter === 'ALL' ? undefined : { strategyId: strategyFilter }).slice(0, 60);
  }, [engineStatus, strategyFilter]);

  const engineRunning = engineStatus?.running ?? false;
  const perSymbol = engineStatus ? Object.values(engineStatus.perSymbol) : [];
  const symbolsWithData = perSymbol.filter((s) => s.lastScanAt !== null && s.lastError === null).length;
  const symbolsWithError = perSymbol.filter((s) => s.lastError !== null).length;

  const onScanNow = useCallback(() => {
    const engine = LiveSignalEngine.getInstance();
    if (!engine) return;
    setScanRequested(true);
    void engine.scanNow().finally(() => setScanRequested(false));
  }, []);

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
            Аналитические сетапы трёх архивных стратегий на фактических закрытых свечах биржи, с журналом аудита и исходами по правилам стратегий.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            data-qa="signals-engine-status"
            data-state={engineRunning ? (engineStatus?.scanning ? 'scanning' : 'running') : 'stopped'}
            className={`flex items-center space-x-1.5 text-[11px] font-mono ${engineRunning ? 'text-emerald-400' : 'text-slate-500'}`}
          >
            <Radio className={`w-3 h-3 ${engineRunning ? 'animate-pulse' : ''}`} />
            <span>
              {engineRunning
                ? `LIVE-скан ${engineStatus?.symbols.length ?? 0} инструментов · каждые ${Math.round((engineStatus?.scanIntervalMs ?? 60_000) / 1000)}с`
                : dataMode === 'live' ? 'Движок запускается…' : 'LIVE-движок не запущен (не LIVE-режим)'}
            </span>
          </div>
          <div className="text-xs font-mono text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded border border-rose-500/30">
            Не является финансовой рекомендацией
          </div>
        </div>
      </div>

      {/* Статус движка */}
      {engineStatus && (
        <div data-qa="signals-scan-status" className="rounded-lg border border-surface-border bg-surface p-3 text-xs font-sans">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3 text-brand-cyan" />
                Сканов: <span className="font-mono text-slate-200">{engineStatus.scanCount}</span>
              </span>
              <span>Последний: <span className="font-mono text-slate-200">{fmtUtc(engineStatus.lastScanFinishedAt)}</span></span>
              <span>Следующий: <span className="font-mono text-slate-200">{fmtUtc(engineStatus.nextScanAt)}</span></span>
              <span>Данные получены: <span className="font-mono text-slate-200">{symbolsWithData}/{engineStatus.symbols.length}</span></span>
              {symbolsWithError > 0 && (
                <span className="text-rose-300">Ошибок источника: <span className="font-mono">{symbolsWithError}</span></span>
              )}
            </div>
            <button
              type="button"
              onClick={onScanNow}
              disabled={!engineRunning || engineStatus.scanning || scanRequested}
              className="inline-flex min-h-[32px] items-center gap-1 rounded border border-surface-border bg-surface-elevated px-2.5 text-[11px] text-slate-200 transition-colors hover:border-brand-cyan/40 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${engineStatus.scanning || scanRequested ? 'animate-spin' : ''}`} />
              Проверить сейчас
            </button>
          </div>
          {engineStatus.lastError && (
            <div data-qa="signals-scan-error" className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
              Источник данных недоступен: {engineStatus.lastError}. Сетапы не подменяются — журнал ждёт фактических свечей.
            </div>
          )}
          <Collapsible
            testId="signals-scan-details"
            tone="muted"
            label="Покрытие по инструментам и стратегиям"
            hint="закрытые свечи, оценённые бары, найденные сетапы в окне"
            className="mt-2"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1 pr-3 font-normal">Инструмент</th>
                    <th className="py-1 pr-3 font-normal">Закрытых 1h / 4h / 1d</th>
                    <th className="py-1 pr-3 font-normal">Последний бар</th>
                    <th className="py-1 pr-3 font-normal">V3.0 окно</th>
                    <th className="py-1 pr-3 font-normal">V3.3 окно</th>
                    <th className="py-1 pr-3 font-normal">V2.8 окно</th>
                    <th className="py-1 pr-3 font-normal">В журнал</th>
                    <th className="py-1 font-normal">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {perSymbol.map((s) => {
                    const cell = (id: string) => {
                      const r = s.replays[id];
                      if (!r) return <span className="text-slate-600">—</span>;
                      return (
                        <span className="font-mono text-slate-300" title={r.notes.join('\n')}>
                          {r.records} сет. · {r.closed} исх. · {fmtR(r.netRSum)} net
                        </span>
                      );
                    };
                    return (
                      <tr key={s.symbol} className="border-t border-surface-border/60">
                        <td className="py-1 pr-3 font-mono text-slate-200">{s.pair}</td>
                        <td className="py-1 pr-3 font-mono text-slate-300">{s.closedBars['1h']} / {s.closedBars['4h']} / {s.closedBars['1d']}{s.gaps1h > 0 ? ` · пропусков ${s.gaps1h}` : ''}</td>
                        <td className="py-1 pr-3 font-mono text-slate-300">{fmtUtc(s.lastEvaluatedBarOpenTime)}</td>
                        <td className="py-1 pr-3">{cell('V3_0_HTF_LIQUIDATION_TRAP')}</td>
                        <td className="py-1 pr-3">{cell('V3_3_HTF_ZONE_MITIGATION')}</td>
                        <td className="py-1 pr-3">{cell('V2_8_ZERO_FEE_SNIPER_TRAILING')}</td>
                        <td className="py-1 pr-3 font-mono text-slate-300">{s.publishedTotal}</td>
                        <td className="py-1">
                          {s.lastError
                            ? <span className="text-rose-300">{s.lastError}</span>
                            : s.lastScanAt ? <span className="text-emerald-400">ок</span> : <span className="text-slate-500">ожидание</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="ui-helper mt-2">
              «Окно» — сколько сетапов стратегия нашла бы на последних закрытых барах (реплей архивного раннера) и их исходы по правилам
              стратегии, net R по модели 2/5 bps. Это диагностика того, что стратегии считаются на фактических данных, а не трек-рекорд:
              в журнал попадают только сетапы, сформированные после запуска движка.
            </p>
          </Collapsible>
        </div>
      )}

      {summary.totalSetups === 0 && (
        <div
          data-qa="signals-empty"
          className="p-4 bg-surface border border-amber-500/30 rounded-lg text-xs font-sans text-slate-300 space-y-1"
        >
          <div className="text-white font-bold">Журнал пуст: после запуска движка сетапы ещё не формировались</div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Запись появляется только когда закрывается 1h-бар, на котором одна из стратегий (V3.0 / V3.3 / V2.8) даёт сетап по своим
            правилам на фактических свечах биржи. Это редкие события: в исследовании V3.0 давала порядка одного сетапа на инструмент в
            несколько дней. Никаких иллюстративных или демонстрационных записей в журнал не подставляется; трек-рекорда у CRYPTORA нет.
          </p>
        </div>
      )}

      {/* Метрики */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-sans text-slate-400">Всего сетапов в журнале</div>
          <div className="text-lg font-bold font-mono text-white mt-1">{summary.totalSetups}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">100 % зафиксировано хэшем</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-sans text-slate-400">Открытые наблюдения</div>
          <div className="text-lg font-bold font-mono text-brand-cyan mt-1">{summary.activeCount + summary.filledCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{summary.activeCount} ждут входа · {summary.filledCount} в позиции</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-sans text-slate-400">Сделок с исходом</div>
          <div className="text-lg font-bold font-mono text-white mt-1">{summary.tradesClosed}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">TP2 {summary.targetReachedCount} · стоп {summary.invalidatedCount} · по правилу {summary.closedCount}</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-sans text-slate-400">Без сделки</div>
          <div className="text-lg font-bold font-mono text-slate-300 mt-1">{summary.expiredCount + summary.cancelledCount + summary.unresolvedCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">истёк {summary.expiredCount} · отменён {summary.cancelledCount}</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-sans text-slate-400">Доля сделок с R &gt; 0</div>
          <div className="text-lg font-bold font-mono text-amber-400 mt-1">{summary.tradesClosed === 0 ? '—' : `${summary.accuracyRatePct}%`}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {summary.tradesClosed === 0 ? 'нет закрытых сделок' : `средний net R ${fmtR(summary.averageNetResultR)} · Σ ${fmtR(summary.totalNetResultR)}`}
          </div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="ui-label">Целостность журнала</div>
          <div className="text-sm font-bold font-sans text-brand-green mt-1.5 flex items-center space-x-1">
            {isIntegrityVerified ? (
              <>
                <Check className="w-4 h-4 text-brand-green" />
                <span>SHA-256 OK</span>
              </>
            ) : (
              <span className="text-rose-400">Ошибка хэша</span>
            )}
          </div>
          <div className="ui-helper mt-0.5">Публикация и исход хэшируются раздельно</div>
        </div>
      </div>

      {/* Кодекс прозрачности */}
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
              Публикация сетапа фиксируется цепочным SHA-256 в момент закрытия бара; исход дописывается один раз и хэшируется отдельно.
              Ни один сигнал нельзя удалить или отредактировать задним числом. Журнал хранится в этом браузере — это не серверный трек-рекорд.
            </p>
          </div>
          <div>
            <div className="ui-card-title mb-0.5">Честная статистика</div>
            <p className="ui-helper">
              Исходы считаются по закрытым свечам по правилам самой стратегии (коридор, стоп, TP1 → безубыток, таймаут, трейлинг) и
              включают убыточные сделки и отмены. Net R учитывает комиссии 2/5 bps. Заявлений вида «98 % точности» здесь нет.
            </p>
          </div>
          <div>
            <div className="ui-card-title mb-0.5">Опровергающие аргументы</div>
            <p className="ui-helper">
              Каждый сетап содержит не только подтверждающие факты, но и условия отмены, риски и исследовательский вердикт стратегии
              (V3.0 валидирована на 3 из 6 символов; V3.3 только TRAIN; V2.8 — gross-only, net-отрицательна).
            </p>
          </div>
        </div>
      </Collapsible>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div className="flex flex-wrap items-center gap-2 font-sans text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400 text-xs">Статус:</span>
          {(['ALL', 'OPEN', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'NO_TRADE'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1 rounded border transition-all ${
                statusFilter === tab
                  ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/40 font-bold'
                  : 'bg-surface text-slate-400 border-surface-border hover:text-white'
              }`}
            >
              {tab === 'ALL' && 'Все'}
              {tab === 'OPEN' && 'Открытые'}
              {tab === 'TARGET_REACHED' && 'Цель достигнута'}
              {tab === 'INVALIDATED' && 'Инвалидированы'}
              {tab === 'CLOSED' && 'Закрыты по правилу'}
              {tab === 'NO_TRADE' && 'Без сделки'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 font-sans text-xs">
          <span className="text-slate-400 text-xs">Стратегия:</span>
          {(['ALL', 'V3_0_HTF_LIQUIDATION_TRAP', 'V3_3_HTF_ZONE_MITIGATION', 'V2_8_ZERO_FEE_SNIPER_TRAILING'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setStrategyFilter(id)}
              className={`px-3 py-1 rounded border transition-all ${
                strategyFilter === id
                  ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/40 font-bold'
                  : 'bg-surface text-slate-400 border-surface-border hover:text-white'
              }`}
            >
              {id === 'ALL' ? 'Все' : STRATEGY_SHORT[id]}
            </button>
          ))}
        </div>
        <div className="text-[11px] font-sans text-slate-500">
          Найдено: {setups.length} из {summary.totalSetups}
        </div>
      </div>

      {/* Карточки журнала */}
      <div className="space-y-4">
        {setups.length === 0 && (
          <div className="py-8 text-center text-slate-500 text-xs font-sans">Записей нет.</div>
        )}
        {setups.map((setup: AnalyticalSetup) => {
          const verdict = STRATEGY_VERDICT[setup.strategyId];
          const isClosed = CLOSED_STATUSES.includes(setup.status);
          const hadTrade = setup.fill !== undefined;
          return (
            <div
              key={setup.id}
              data-qa="signal-card"
              data-strategy={setup.strategyId}
              data-status={setup.status}
              className="rounded-lg border border-surface-border bg-surface p-3.5 font-sans text-xs shadow-lg transition-all hover:border-slate-700 sm:p-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold text-white">{setup.symbol}</span>
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                    {setup.timeframe}
                  </span>
                  <Badge variant="neutral" size="sm">{STRATEGY_LABELS[setup.strategyId] ?? setup.strategyId}</Badge>
                  <Badge variant={setup.direction === 'LONG' ? 'green' : 'red'} size="sm">
                    ИДЕЯ: {sideLabel(setup.direction).toUpperCase()}
                  </Badge>
                  <Badge variant={statusVariant(setup.status)} size="sm">{statusLabel(setup.status)}</Badge>
                  {verdict && <Badge variant={verdict.variant} size="sm">{verdict.label}</Badge>}
                </div>

                <div className="flex shrink-0 items-center gap-2 text-[11px] text-slate-500">
                  <Lock className="h-3 w-3 shrink-0 text-brand-green" aria-hidden />
                  <span className="ui-label">бар {fmtUtc(setup.setupOpenTime)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3">
                <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                  <div className="ui-label">{setup.entryType === 'LIMIT_CORRIDOR' ? 'Лимитный коридор' : 'Вход по open N+1'}</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {setup.entryType === 'LIMIT_CORRIDOR'
                      ? `${fmtPrice(setup.entryZone[0])} – ${fmtPrice(setup.entryZone[1])}`
                      : `≈ ${fmtPrice(setup.entryZone[0])}`}
                  </div>
                  {setup.validForBars !== null && setup.entryType === 'LIMIT_CORRIDOR' && (
                    <div className="ui-helper mt-0.5">действует {setup.validForBars} бара</div>
                  )}
                </div>
                <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                  <div className="ui-label">Стоп (инвалидация)</div>
                  <div className="text-sm font-bold text-rose-400 mt-0.5">
                    {setup.direction === 'LONG' ? '<' : '>'} {fmtPrice(setup.fill?.stop ?? setup.invalidationLevel)}
                  </div>
                </div>
                <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                  <div className="ui-label">Цели</div>
                  <div className="text-sm font-bold text-brand-green mt-0.5">
                    {(setup.fill?.targets ?? setup.targets).map((t) => fmtPrice(t)).join(' / ')}
                  </div>
                </div>
                <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                  <div className="ui-label">R:R до финальной цели</div>
                  <div className="text-sm font-bold text-amber-400 mt-0.5">1 : {setup.riskRewardRatio}</div>
                </div>
                <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                  <div className="ui-label">{isClosed ? 'Исход' : hadTrade ? 'Исполнение' : 'Статус'}</div>
                  {isClosed ? (
                    <div className="mt-0.5">
                      <div className={`text-sm font-bold ${typeof setup.resultR === 'number' ? (setup.resultR > 0 ? 'text-brand-green' : 'text-rose-400') : 'text-slate-300'}`}>
                        {hadTrade ? `${fmtR(setup.resultR)} gross · ${fmtR(setup.netResultR)} net` : 'сделки не было'}
                      </div>
                      <div className="ui-helper mt-0.5">{exitReasonLabel(setup.exitReason)} · {fmtUtc(setup.closedAt)}</div>
                    </div>
                  ) : hadTrade ? (
                    <div className="mt-0.5">
                      <div className="text-sm font-bold text-white">{fmtPrice(setup.fill!.price)}</div>
                      <div className="ui-helper mt-0.5">исполнен {fmtUtc(setup.fill!.barOpenTime)}</div>
                    </div>
                  ) : (
                    <div className="text-sm font-bold text-slate-300 mt-0.5">ждёт исполнения</div>
                  )}
                </div>
              </div>

              <div className="space-y-2 pt-3">
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
                  label="Правило выхода и технические сведения"
                >
                  <dl className="space-y-1">
                    <div>
                      <dt className="ui-label inline">Правило выхода: </dt>
                      <dd className="inline text-slate-300">{setup.exitRule}</dd>
                    </div>
                    <div>
                      <dt className="ui-label inline">Опубликован: </dt>
                      <dd className="inline font-mono text-slate-300">{fmtUtc(setup.createdAt)} (задержка {setup.latencyBars} бар.)</dd>
                    </div>
                    <div>
                      <dt className="ui-label inline">Audit hash: </dt>
                      <dd className="ui-hash inline">{setup.auditHash}</dd>
                    </div>
                    {setup.outcomeHash && (
                      <div>
                        <dt className="ui-label inline">Outcome hash: </dt>
                        <dd className="ui-hash inline">{setup.outcomeHash}</dd>
                      </div>
                    )}
                    <div className="ui-helper">
                      Запись append-only: удалить или отредактировать сетап задним числом нельзя. Исход записан один раз.
                    </div>
                  </dl>
                </Collapsible>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ретроспектива окна */}
      {engineStatus && (
        <Collapsible
          testId="signals-retrospective"
          tone="muted"
          icon={<History className="h-4 w-4 text-slate-400" />}
          label="Ретроспектива окна: что стратегии нашли на последних закрытых барах"
          hint={`${retrospective.length} записей · диагностика, не журнал`}
          mountOnOpen
        >
          <p className="ui-helper mb-2">
            Реплей архивного раннера каждой стратегии на окне последних закрытых свечей (до 1000 баров 1h). Показывает, что правила
            стратегий действительно срабатывают на фактических данных, и как эти сетапы завершились бы по правилам стратегии.
            Эти записи не хэшируются, не входят в журнал и не являются трек-рекордом: они пересчитываются на каждом новом баре и
            зависят от границ окна (прогрев, усечение истории).
          </p>
          {retrospective.length === 0 ? (
            <div className="py-4 text-center text-slate-500 text-xs">Пока нет данных реплея — дождитесь первого скана.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1 pr-3 font-normal">Бар сетапа</th>
                    <th className="py-1 pr-3 font-normal">Инструмент</th>
                    <th className="py-1 pr-3 font-normal">Стратегия</th>
                    <th className="py-1 pr-3 font-normal">Идея</th>
                    <th className="py-1 pr-3 font-normal">Вход</th>
                    <th className="py-1 pr-3 font-normal">Стоп</th>
                    <th className="py-1 pr-3 font-normal">Цели</th>
                    <th className="py-1 pr-3 font-normal">Исполнение</th>
                    <th className="py-1 font-normal">Исход</th>
                  </tr>
                </thead>
                <tbody>
                  {retrospective.map((r) => (
                    <tr key={`${r.strategyId}-${r.symbol}-${r.setupOpenTime}`} data-qa="signal-retro-row" className="border-t border-surface-border/60">
                      <td className="py-1 pr-3 font-mono text-slate-300">{fmtUtc(r.setupOpenTime)}</td>
                      <td className="py-1 pr-3 font-mono text-slate-200">{r.symbol}/USDT</td>
                      <td className="py-1 pr-3 text-slate-300">{STRATEGY_SHORT[r.strategyId] ?? r.strategyId}</td>
                      <td className={`py-1 pr-3 font-mono ${r.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>{sideLabel(r.direction).toUpperCase()}</td>
                      <td className="py-1 pr-3 font-mono text-slate-300">
                        {r.entryType === 'LIMIT_CORRIDOR' ? `${fmtPrice(r.entryZone[0])}–${fmtPrice(r.entryZone[1])}` : `open N+1 (≈${fmtPrice(r.entryZone[0])})`}
                      </td>
                      <td className="py-1 pr-3 font-mono text-rose-300">{fmtPrice(r.fill?.stop ?? r.stop)}</td>
                      <td className="py-1 pr-3 font-mono text-emerald-300">{(r.fill?.targets ?? r.targets).map(fmtPrice).join(' / ')}</td>
                      <td className="py-1 pr-3 font-mono text-slate-300">{r.fill ? `${fmtPrice(r.fill.price)} · ${fmtUtc(r.fill.barOpenTime)}` : r.outcome ? '—' : 'ожидает'}</td>
                      <td className="py-1 font-mono">
                        {r.outcome ? (
                          <span className={typeof r.outcome.grossR === 'number' ? (r.outcome.grossR > 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-400'}>
                            {exitReasonLabel(r.outcome.exitReason)}
                            {typeof r.outcome.grossR === 'number' ? ` · ${fmtR(r.outcome.grossR)} gross / ${fmtR(r.outcome.netR)} net` : ''}
                          </span>
                        ) : r.fill ? <span className="text-brand-cyan">в позиции</span> : <span className="text-slate-400">ждёт входа</span>}
                        {!r.publishable && (
                          <span className="ml-1 text-slate-500" title={r.publishNote ?? undefined}>· не публикуется (геометрия)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Collapsible>
      )}
    </div>
  );
};
