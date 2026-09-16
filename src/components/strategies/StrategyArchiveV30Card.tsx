import React from 'react';
import { Archive, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import {
  V30_DEFINITION, V30_SOURCE_RESULTS, V30_REPRODUCTION_EVIDENCE, V30_CAVEATS_RU, V30_RULES_RU, V30_DISCREPANCIES, V30_COMMITS,
  STRATEGY_ARCHIVE_PLANNED,
} from '@/services/strategyArchive';

/**
 * Minimal read-only card for the imported V3.0 archive entry (step 1).
 * Historical research only — no signals, no execution, no forecast.
 */
export const StrategyArchiveV30Card: React.FC = () => {
  const t = V30_SOURCE_RESULTS.train;
  const v = V30_SOURCE_RESULTS.validation;
  const fmtR = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(4)}`;

  return (
    <section
      data-testid="strategy-archive-v30"
      className="bg-surface border border-surface-border rounded-lg p-4 space-y-4 font-sans text-xs text-slate-300"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <Archive className="w-4 h-4 text-brand-cyan" />
          <h2 className="text-sm font-semibold text-white">
            Архив стратегий · V{V30_DEFINITION.version} — {V30_DEFINITION.name}
          </h2>
          <Badge variant="cyan" size="xs">Историческое исследование</Badge>
        </div>
        <div className="text-[11px] text-slate-400">
          Исследование: <span className="font-mono text-emerald-300">ВАЛИДИРОВАНО ИСТОЧНИКОМ (для исследования)</span>
          {' · '}Воспроизводимость: <span className="font-mono text-cyan-300">ВОСПРОИЗВЕДЕНО В CRYPTORA</span>
        </div>
      </div>

      <p className="text-slate-400 leading-relaxed">
        {V30_DEFINITION.nameRu}. Импортировано из архива исследований без изменения правил. Числа ниже —{' '}
        <span className="font-mono text-slate-300">SOURCE_REPORTED</span> (артефакты источника); реальный прогон
        TRAIN и VALIDATION на датасете {V30_COMMITS.dataset.slice(0, 7)} внутри CRYPTORA{' '}
        <span className="font-mono text-slate-300">(DERIVED_BY_CRYPTORA)</span> совпал по всем полям —{' '}
        {V30_REPRODUCTION_EVIDENCE.map((e) => `${e.slice}: n=${e.tradeCount}, digest ${e.deterministicDigest}`).join('; ')}.
        «Воспроизведено» означает повторяемость чисел, а не успешность стратегии. Это не сигнал, не прогноз и не
        обещание будущей доходности.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-surface-2 border border-surface-border rounded p-3 space-y-1">
          <div className="text-[11px] text-slate-500">Происхождение</div>
          <div className="font-mono text-[11px] break-all">source {V30_COMMITS.sourceHead.slice(0, 12)}</div>
          <div className="font-mono text-[11px] break-all">dataset {V30_COMMITS.dataset.slice(0, 12)} · Binance Spot klines</div>
          <div className="text-[11px] text-slate-500">1h исполнение · 4h уровни · 6 пар · R-метрики, без капитала</div>
        </div>
        <div className="bg-surface-2 border border-surface-border rounded p-3 space-y-1">
          <div className="text-[11px] text-slate-500">TRAIN 2022-01-01 → 2024-05-26</div>
          <div className="font-mono tabular-nums">n = {t.n}</div>
          <div className="font-mono tabular-nums">net R/сделку @2/5 bps = {fmtR(t.netRPerTrade.FUT_4)}</div>
          <div className="font-mono tabular-nums">gross {fmtR(t.grossRPerTrade)} · PF {t.profitFactor} · maxDD {t.maxDrawdownR} R</div>
        </div>
        <div className="bg-surface-2 border border-surface-border rounded p-3 space-y-1">
          <div className="text-[11px] text-slate-500">VALIDATION 2024-05-26 → 2025-03-14 (один прогон)</div>
          <div className="font-mono tabular-nums">n = {v.n}</div>
          <div className="font-mono tabular-nums">net R/сделку @2/5 bps = {fmtR(v.netRPerTrade.FUT_4)}</div>
          <div className="font-mono tabular-nums">gross {fmtR(v.grossRPerTrade)} · PF {v.profitFactor} · maxDD {v.maxDrawdownR} R</div>
        </div>
      </div>

      <details className="text-[11px]">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Правила (замороженные, без изменений)</summary>
        <ul className="mt-2 space-y-1 text-slate-400 list-disc pl-4">
          <li><span className="text-slate-300">Вход:</span> {V30_RULES_RU.entry}</li>
          <li><span className="text-slate-300">Стоп:</span> {V30_RULES_RU.stop}</li>
          <li><span className="text-slate-300">Цели:</span> {V30_RULES_RU.targets}</li>
          <li><span className="text-slate-300">Таймаут:</span> {V30_RULES_RU.timeout}</li>
          <li><span className="text-slate-300">Внутрибарные правила:</span> {V30_RULES_RU.intrabar}</li>
          <li><span className="text-slate-300">Комиссии:</span> {V30_RULES_RU.fees}</li>
        </ul>
      </details>

      <div className="border border-amber-500/30 bg-amber-500/5 rounded p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-amber-300 font-medium">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Обязательные оговорки</span>
        </div>
        <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-300">
          {V30_CAVEATS_RU.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>

      <div className="text-[11px] text-slate-400 space-y-1">
        <div className="text-slate-300 font-medium">Расхождения спецификация ↔ исследовательский код</div>
        {V30_DISCREPANCIES.map((d) => (
          <div key={d.id} className="border-l-2 border-surface-border pl-2">
            <span className="font-mono text-slate-300">{d.id}</span> · Спецификация: {d.specStatement}{' '}
            <span className="text-slate-500">→</span> Фактическое поведение исследования: {d.researchBehaviour}{' '}
            <span className="text-slate-500">Политика воспроизведения: сохранить поведение исследования.</span>
          </div>
        ))}
      </div>

      <div className="text-[11px] text-slate-500">
        Остальные версии архива ({STRATEGY_ARCHIVE_PLANNED.length} запланировано, включая отклонённые и
        фальсифицированные; V3.1 уже импортирована как ФАЛЬСИФИЦИРОВАННАЯ) переносятся поэтапно; версии не ранжируются напрямую из-за
        несопоставимых допущений валидации.
      </div>
    </section>
  );
};
