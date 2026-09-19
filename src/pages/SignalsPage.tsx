import React, { useState, useMemo, useEffect } from 'react';
import { BarChart3, AlertOctagon, CheckCircle2, Shield, Lock, Filter, Check, Radio } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { Collapsible } from '@/components/common/Collapsible';
import { sideLabel, pairLabel, stopComparator } from '@/utils/labels';
import { SignalsAuditLedger, AnalyticalSetup } from '@/services/signals/SignalsAuditLedger';

export const SignalsPage: React.FC = () => {
  const ledger = useMemo(() => SignalsAuditLedger.getInstance(), []);
  const [tick, setTick] = useState(0); // Trigger re-render on new signals

  // Poll for new signals every 5s (engine appends asynchronously)
  useEffect(() => {
    const interval = setInterval(() => {
      ledger.expireStale(); // Expire signals older than 4h
      setTick((t) => t + 1);
    }, 5_000);
    return () => clearInterval(interval);
  }, [ledger]);

  const summary = useMemo(() => ledger.getSummary(), [ledger, tick]);
  const isIntegrityVerified = useMemo(() => ledger.verifyIntegrity(), [ledger, tick]);

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'TARGET_REACHED' | 'INVALIDATED' | 'EXPIRED'>('ALL');

  const setups = useMemo(() => {
    const list = ledger.getSetups();
    if (statusFilter === 'ALL') return list;
    return list.filter((s) => s.status === statusFilter);
  }, [ledger, statusFilter, tick]);

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
          <div className="flex items-center space-x-1.5 text-[11px] font-mono text-emerald-400">
            <Radio className="w-3 h-3 animate-pulse" />
            <span>Сканирование 6 символов · 60с</span>
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
          <div className="text-lg font-bold font-mono text-amber-400 mt-1">{summary.totalSetups === 0 ? "—" : `${summary.accuracyRatePct}%`}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Без ошибки выжившего</div>
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
          <div className="ui-helper mt-0.5">Append-only</div>
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
        {setups.map((setup: AnalyticalSetup) => (
          <div
            key={setup.id}
            className="rounded-lg border border-surface-border bg-surface p-3.5 font-sans text-xs shadow-lg transition-all hover:border-slate-700 sm:p-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
              <div className="flex items-center space-x-3">
                <span className="ui-value break-words">{pairLabel(setup.symbol)}</span>
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
                  ${setup.entryZone[0].toLocaleString()} – ${setup.entryZone[1].toLocaleString()}
                </div>
              </div>
              <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                <div className="ui-label">Stop Loss</div>
                <div className="ui-num mt-0.5 text-sm font-bold text-rose-400">
                  {stopComparator(setup.direction)} ${setup.invalidationLevel.toLocaleString()}
                </div>
              </div>
              <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                <div className="ui-label">Take Profit</div>
                <div className="ui-num mt-0.5 text-sm font-bold text-brand-green">
                  {setup.targets.map((t, i) => `TP${i + 1} $${t.toLocaleString()}`).join('  ·  ')}
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
