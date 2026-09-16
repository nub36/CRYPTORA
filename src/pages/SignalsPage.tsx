import React, { useState, useMemo } from 'react';
import { BarChart3, AlertOctagon, CheckCircle2, Shield, Lock, Filter, Check } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { SignalsAuditLedger, AnalyticalSetup } from '@/services/signals/SignalsAuditLedger';

export const SignalsPage: React.FC = () => {
  const ledger = useMemo(() => SignalsAuditLedger.getInstance(), []);
  const summary = useMemo(() => ledger.getSummary(), [ledger]);
  const isIntegrityVerified = useMemo(() => ledger.verifyIntegrity(), [ledger]);

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'TARGET_REACHED' | 'INVALIDATED'>('ALL');

  const setups = useMemo(() => {
    const list = ledger.getSetups();
    if (statusFilter === 'ALL') return list;
    return list.filter((s) => s.status === statusFilter);
  }, [ledger, statusFilter]);

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
              АНАЛИТИЧЕСКИЕ СЕТАПЫ И СИГНАЛЫ (SIGNALS)
            </h1>
            <Badge variant="amber" size="sm">
              ПРОТОТИП МЕТОДОЛОГИИ
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Прозрачные алгоритмические структуры с неизменяемым журналом аудита (SHA-256) и фиксацией факторов отмены.
          </p>
        </div>

        <div className="text-xs font-mono text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded border border-rose-500/30">
          НЕ ЯВЛЯЕТСЯ ФИНАНСОВОЙ РЕКОМЕНДАЦИЕЙ
        </div>
      </div>

      {/* Transparent Performance Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-mono text-slate-400">Всего сетапов в реестре</div>
          <div className="text-lg font-bold font-mono text-white mt-1">{summary.totalSetups}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">100% зафиксировано</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-mono text-slate-400">Активные наблюдения</div>
          <div className="text-lg font-bold font-mono text-brand-cyan mt-1">{summary.activeCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">В процессе отработки</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-mono text-slate-400">Достигли целей (TP)</div>
          <div className="text-lg font-bold font-mono text-brand-green mt-1">{summary.targetReachedCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Полное исполнение</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-mono text-slate-400">Инвалидация (Stop Loss)</div>
          <div className="text-lg font-bold font-mono text-rose-400 mt-1">{summary.invalidatedCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Отмена гипотезы</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-mono text-slate-400">Прозрачный Win Rate</div>
          <div className="text-lg font-bold font-mono text-amber-400 mt-1">{summary.accuracyRatePct}%</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Без ошибки выжившего</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] font-mono text-slate-400">Целостность реестра</div>
          <div className="text-sm font-bold font-mono text-brand-green mt-1.5 flex items-center space-x-1">
            {isIntegrityVerified ? (
              <>
                <Check className="w-4 h-4 text-brand-green" />
                <span>SHA-256 OK</span>
              </>
            ) : (
              <span className="text-rose-400">ОШИБКА ХЭША</span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Append-only ledger</div>
        </div>
      </div>

      {/* Ethical Code Banner */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-mono font-bold">
          <Shield className="w-4 h-4 text-brand-green" />
          <span>Кодекс прозрачности сигналов CRYPTORA</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-[11px] text-slate-400">
          <div>
            <strong className="text-white block mb-0.5 font-mono">1. Неизменяемый журнал:</strong>
            Выпущенный сетап фиксируется криптографическим хэшем в неизменяемом логе. Ни один сигнал нельзя удалить или отредактировать задним числом.
          </div>
          <div>
            <strong className="text-white block mb-0.5 font-mono">2. Честная статистика:</strong>
            Убыточные сделки и ложные срабатывания учитываются в расчете винрейта на 100%. Мы никогда не заявляем нереалистичные «98% точности».
          </div>
          <div>
            <strong className="text-white block mb-0.5 font-mono">3. Опровергающие аргументы:</strong>
            Каждый сетап обязан содержать не только подтверждающие факты, но и риски/опровергающие сигналы других индикаторов.
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div className="flex items-center space-x-2 font-mono text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400 text-xs">Статус:</span>
          {(['ALL', 'ACTIVE', 'TARGET_REACHED', 'INVALIDATED'] as const).map((tab) => (
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
            </button>
          ))}
        </div>

        <div className="text-[11px] font-mono text-slate-500">
          Найдено: {setups.length} из {summary.totalSetups}
        </div>
      </div>

      {/* Setups Cards */}
      <div className="space-y-4">
        {setups.map((setup: AnalyticalSetup) => (
          <div
            key={setup.id}
            className="bg-surface border border-surface-border rounded-lg p-5 font-mono text-xs space-y-4 shadow-lg hover:border-slate-700 transition-all"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
              <div className="flex items-center space-x-3">
                <span className="text-base font-bold text-white">{setup.symbol}/USDT</span>
                <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                  {setup.timeframe} Timeframe
                </span>
                <Badge
                  variant={
                    setup.status === 'TARGET_REACHED'
                      ? 'green'
                      : setup.status === 'INVALIDATED'
                      ? 'red'
                      : 'cyan'
                  }
                  size="sm"
                >
                  {setup.status === 'TARGET_REACHED'
                    ? 'TARGET REACHED (+TP)'
                    : setup.status === 'INVALIDATED'
                    ? 'INVALIDATED (STOP)'
                    : `${setup.direction} IDEA`}
                </Badge>
              </div>

              <div className="flex items-center space-x-2 text-[10px] text-slate-500">
                <Lock className="w-3 h-3 text-brand-green" />
                <span className="font-mono bg-surface-elevated px-2 py-0.5 rounded border border-surface-border">
                  {setup.auditHash}
                </span>
                <span>{new Date(setup.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Price Targets Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                <div className="text-[11px] text-slate-400">Диапазон входа</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  ${setup.entryZone[0].toLocaleString()} – ${setup.entryZone[1].toLocaleString()}
                </div>
              </div>
              <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                <div className="text-[11px] text-slate-400">Уровень отмены (Stop)</div>
                <div className="text-sm font-bold text-rose-400 mt-0.5">
                  &lt; ${setup.invalidationLevel.toLocaleString()}
                </div>
              </div>
              <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                <div className="text-[11px] text-slate-400">Целевые ориентиры</div>
                <div className="text-sm font-bold text-brand-green mt-0.5">
                  {setup.targets.map((t) => `$${t.toLocaleString()}`).join(' / ')}
                </div>
              </div>
              <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
                <div className="text-[11px] text-slate-400">Risk/Reward (R:R)</div>
                <div className="text-sm font-bold text-amber-400 mt-0.5">
                  1 : {setup.riskRewardRatio}
                </div>
              </div>
            </div>

            {/* Evidence & Invalidation Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 font-sans text-xs">
              <div className="p-3 rounded bg-emerald-950/20 border border-emerald-500/20 space-y-1.5">
                <div className="font-bold text-emerald-400 font-mono flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Подтверждающие наблюдения (Supporting Evidence)</span>
                </div>
                <ul className="list-disc list-inside text-slate-300 text-[11px] space-y-0.5">
                  {setup.confirmingFactors.map((factor, idx) => (
                    <li key={idx}>{factor}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3 rounded bg-rose-950/20 border border-rose-500/20 space-y-1.5">
                <div className="font-bold text-rose-400 font-mono flex items-center space-x-1.5">
                  <AlertOctagon className="w-3.5 h-3.5" />
                  <span>Опровергающие факторы (Opposing Evidence / Risk)</span>
                </div>
                <ul className="list-disc list-inside text-slate-300 text-[11px] space-y-0.5">
                  {setup.invalidationFactors.map((factor, idx) => (
                    <li key={idx}>{factor}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
