import React, { useMemo, useState } from 'react';
import { Archive, AlertTriangle, GitCompare, ShieldCheck, X } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import {
  buildArchiveCards, filterCounts, filterMatches, comparabilityWarnings, fmtSigned,
  ARCHIVE_FILTERS, COMPARABILITY_GROUP_RU, STRATEGY_ARCHIVE_TOTAL_ROWS,
  type ArchiveCardModel, type ArchiveFilterId,
} from '@/services/strategyArchive';

/**
 * Архив исследований стратегий — read-only витрина реестра `strategyArchive`.
 *
 * ⚠️ CRYPTORA DOES NOT EXECUTE TRADES. Здесь нет сигналов, кнопок покупки/продажи, ботов и ключей.
 * Карточки идут в хронологическом порядке программы; сортировки по доходности нет намеренно.
 * RESEARCH VERDICT и REPRODUCTION STATUS — два независимых поля, всегда показываются раздельно.
 */

const toneBadge = { positive: 'green', neutral: 'amber', negative: 'red' } as const;
const reproBadge = (s: ArchiveCardModel['reproducibility']) => (s === 'REPRODUCED' ? 'cyan' : s === 'SOURCE_CHAIN_VERIFIED_NOT_RERUN' ? 'neutral' : 'amber');
const fmtN = (n: number) => n.toLocaleString('ru-RU');

const RULE_LABELS: Record<string, string> = {
  entry: 'Вход', confirm: 'Подтверждение', fill: 'Исполнение лимита', stop: 'Стоп', targets: 'Цели', exit: 'Выход',
  exitTrail: 'Выход (трейлинг)', exitOthers: 'Выход (прочие ветки)', timeout: 'Таймаут', intrabar: 'Внутрибарные правила',
  fees: 'Комиссии', scope: 'Охват', zones: 'Зоны', mitigation: 'Митигация',
};

interface StrategyArchivePanelProps {
  /** Show only these strategy IDs (from registry). If omitted, shows all. */
  strategyIds?: string[];
}

export const StrategyArchivePanel: React.FC<StrategyArchivePanelProps> = ({ strategyIds }) => {
  const allCards = useMemo(() => buildArchiveCards(), []);
  const cards = useMemo(
    () => (strategyIds ? allCards.filter((c) => strategyIds.includes(c.id)) : allCards),
    [allCards, strategyIds],
  );
  const counts = useMemo(() => filterCounts(cards), [cards]);
  const [filter, setFilter] = useState<ArchiveFilterId>('ALL');
  const [compare, setCompare] = useState<string[]>([]);

  const visible = cards.filter((c) => filterMatches(filter, c.verdict));
  const compared = compare.map((id) => cards.find((c) => c.id === id)!).filter(Boolean);
  const warnings = comparabilityWarnings(compared);

  const toggleCompare = (id: string) =>
    setCompare((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id]));

  return (
    <section data-testid="strategy-archive" className="bg-surface border border-surface-border rounded-lg p-4 space-y-4 font-sans text-xs text-slate-300">
      {/* header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 pb-2 border-b border-surface-border">
        <div className="flex flex-wrap items-center gap-2">
          <Archive className="w-4 h-4 text-brand-cyan" />
          <h2 className="text-sm font-semibold text-white">
            Архив исследований → <span data-testid="strategy-archive-count">{STRATEGY_ARCHIVE_TOTAL_ROWS} версий</span>
          </h2>
          <Badge variant="cyan" size="xs">Историческое исследование · read-only</Badge>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-brand-green" />
          Не сигнал, не прогноз, не исполнение. Порядок — хронология программы, не рейтинг.
        </div>
      </div>

      <p className="text-slate-400 leading-relaxed">
        Полный перенос архива исследований <span className="font-mono">svechnoy-suslik-v2</span> (13 версий, включая отклонённые и
        фальсифицированные). У каждой версии два независимых статуса: <span className="text-slate-200">вердикт исследования</span> (что
        показал источник) и <span className="text-slate-200">статус воспроизведения</span> (перезапускала ли CRYPTORA прогон на пинованном
        датасете). «Воспроизведено» означает повторяемость чисел, а не успешность стратегии. Все цифры — R-метрики без капитала;
        происхождение каждой — <span className="font-mono">SOURCE_REPORTED</span> (артефакты источника).
      </p>

      {/* filters */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Фильтр по вердикту исследования">
        {ARCHIVE_FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            data-testid={`archive-filter-${f.id}`}
            onClick={() => setFilter(f.id)}
            className={`px-2.5 py-1 rounded border text-[11px] font-mono transition-colors ${
              filter === f.id ? 'bg-brand-cyan/15 border-brand-cyan/50 text-cyan-200' : 'bg-surface-2 border-surface-border text-slate-400 hover:text-slate-200'
            }`}
          >
            {f.label} <span className="text-slate-500">({counts[f.id]})</span>
          </button>
        ))}
      </div>

      {/* comparison of assumptions */}
      {compared.length > 0 && (
        <div data-testid="archive-compare" className="border border-surface-border bg-surface-2 rounded p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-slate-200 font-medium">
              <GitCompare className="w-3.5 h-3.5 text-brand-cyan" />
              Сравнение допущений ({compared.length}/3)
            </div>
            <button onClick={() => setCompare([])} className="text-slate-500 hover:text-slate-200 flex items-center gap-1 text-[11px] min-h-[28px]">
              <X className="w-3 h-3" /> очистить
            </button>
          </div>
          {warnings.length > 0 ? (
            <div data-testid="archive-compare-warning" className="border border-rose-500/40 bg-rose-500/10 rounded p-2 space-y-1 text-[11px] text-rose-200">
              <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="w-3.5 h-3.5" /> Результаты этих версий напрямую несопоставимы</div>
              <ul className="list-disc pl-4 space-y-0.5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          ) : (
            <div className="text-[11px] text-emerald-300">Допущения одного семейства: {COMPARABILITY_GROUP_RU[compared[0]!.group]}.</div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-[11px] font-mono">
              <thead className="text-slate-500">
                <tr><th className="text-left pr-3 py-1 font-normal">Допущение</th>{compared.map((c) => <th key={c.id} className="text-left pr-3 py-1 font-normal text-slate-300">V{c.version}</th>)}</tr>
              </thead>
              <tbody className="text-slate-300">
                {([
                  ['Период', (c: ArchiveCardModel) => c.assumptions.period],
                  ['Тип проверки', (c: ArchiveCardModel) => c.assumptions.validationType],
                  ['ТФ исполнения', (c: ArchiveCardModel) => c.assumptions.execTimeframe],
                  ['ТФ структуры', (c: ArchiveCardModel) => c.assumptions.structuralTimeframe],
                  ['Пары', (c: ArchiveCardModel) => c.assumptions.symbols],
                  ['Комиссии', (c: ArchiveCardModel) => c.assumptions.feeModel],
                  ['Семантика цифр', (c: ArchiveCardModel) => c.assumptions.feeSemantics],
                  ['Знаменатель метрики', (c: ArchiveCardModel) => c.assumptions.metricDenominator],
                  ['Движок входов', (c: ArchiveCardModel) => c.assumptions.entryEngine],
                  ['Вердикт исследования', (c: ArchiveCardModel) => c.verdictLabelRu],
                  ['Статус воспроизведения', (c: ArchiveCardModel) => c.reproLabelRu],
                ] as const).map(([label, get]) => (
                  <tr key={label} className="border-t border-surface-border/60 align-top">
                    <td className="pr-3 py-1 text-slate-500 whitespace-nowrap">{label}</td>
                    {compared.map((c) => <td key={c.id} className="pr-3 py-1">{get(c)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-slate-500">Сравниваются только допущения. Таблица результатов «кто лучше» намеренно отсутствует.</div>
        </div>
      )}

      {/* cards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {visible.map((c) => (
          <ArchiveCard key={c.id} card={c} selected={compare.includes(c.id)} onToggleCompare={() => toggleCompare(c.id)} compareFull={compare.length >= 3} />
        ))}
        {visible.length === 0 && <div className="text-slate-500">Нет версий с таким вердиктом.</div>}
      </div>
    </section>
  );
};

const ArchiveCard: React.FC<{ card: ArchiveCardModel; selected: boolean; compareFull: boolean; onToggleCompare: () => void }> = ({ card: c, selected, compareFull, onToggleCompare }) => (
  <article data-testid={`archive-card-${c.id}`} className={`bg-surface-2 border rounded-lg p-3 space-y-3 ${selected ? 'border-brand-cyan/50' : 'border-surface-border'}`}>
    <header className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-white leading-tight">
          V{c.version} — {c.nameRu} <span className="text-slate-500 font-normal">({c.name})</span>
        </h3>
        <button
          onClick={onToggleCompare}
          disabled={!selected && compareFull}
          aria-pressed={selected}
          className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-surface-border text-slate-400 hover:text-slate-100 disabled:opacity-40"
        >
          {selected ? 'в сравнении ✓' : 'сравнить допущения'}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        <span className="text-slate-500">Исследование:</span>
        <Badge variant={toneBadge[c.verdictTone]} size="xs">{c.verdictLabelRu}</Badge>
        <span className="text-slate-500">Воспроизведение:</span>
        <Badge variant={reproBadge(c.reproducibility)} size="xs">{c.reproLabelRu}</Badge>
      </div>
    </header>

    {/* headline figures */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {c.headline.map((h) => (
        <div key={h.label + h.slice} className="bg-surface border border-surface-border rounded p-2 space-y-0.5">
          <div className="text-[11px] text-slate-500">{h.slice} · {h.label}</div>
          <div className="font-mono tabular-nums text-slate-200">n = {fmtN(h.n)}</div>
          <div className="font-mono tabular-nums">gross R/сделку {h.grossRPerTrade === null ? '—' : fmtSigned(h.grossRPerTrade)}</div>
          <div className="font-mono tabular-nums">
            net R/сделку {h.netRPerTrade === null ? <span className="text-amber-300">{h.netFeeModel}</span> : <>{fmtSigned(h.netRPerTrade)} <span className="text-slate-500">@{h.netFeeModel}</span></>}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">{h.origin}</div>
        </div>
      ))}
    </div>
    <p className="text-[11px] text-slate-400 leading-relaxed">{c.headlineNoteRu}</p>

    {/* provenance + assumptions */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
      <div className="space-y-0.5">
        <div className="text-slate-500">Происхождение</div>
        <div className="font-mono break-all">source pin {c.provenance.sourcePin} · dataset {c.provenance.dataset}</div>
        <div className="font-mono">{c.provenance.artifactCount} артефакт(ов) sha256 · {c.provenance.discrepancyCount} расхожд. · {c.variantCount} вариант(ов)</div>
        {c.provenance.frozenEngine && <div className="font-mono text-slate-400">входы: frozen V2 engine {c.provenance.frozenEngine} (только архив)</div>}
        {c.reproducedTradeCounts.length > 0 && (
          <div className="font-mono text-slate-400 break-all">
            перезапуск: {c.reproducedTradeCounts.slice(0, 3).map((e) => `${e.slice} n=${e.n}`).join('; ')}{c.reproducedTradeCounts.length > 3 ? ` … (+${c.reproducedTradeCounts.length - 3})` : ''}
          </div>
        )}
      </div>
      <div className="space-y-0.5">
        <div className="text-slate-500">Допущения</div>
        <div>{c.assumptions.period}</div>
        <div>{c.assumptions.execTimeframe} · структура {c.assumptions.structuralTimeframe}</div>
        <div>комиссии: {c.assumptions.feeModel}</div>
        <div className="text-slate-400">{COMPARABILITY_GROUP_RU[c.group]}</div>
      </div>
    </div>

    <p className="text-[11px] text-slate-400"><span className="text-slate-300">Воспроизведение:</span> {c.reproDetailRu}</p>

    <details className="text-[11px]">
      <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Правила (замороженные, без изменений)</summary>
      <ul className="mt-2 space-y-1 text-slate-400 list-disc pl-4">
        {Object.entries(c.rulesRu).map(([k, v]) => <li key={k}><span className="text-slate-300">{RULE_LABELS[k] ?? k}:</span> {v}</li>)}
      </ul>
    </details>

    <details className="text-[11px]" open={c.verdictTone !== 'negative'}>
      <summary className="cursor-pointer text-amber-300 hover:text-amber-200 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Обязательные оговорки ({c.caveatsRu.length})</summary>
      <ul className="mt-2 list-disc pl-4 space-y-1 text-slate-300 border border-amber-500/30 bg-amber-500/5 rounded p-2">
        {c.caveatsRu.map((x) => <li key={x}>{x}</li>)}
      </ul>
    </details>

    <details className="text-[11px]">
      <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Расхождения спецификация ↔ исследовательский код ({c.discrepancies.length})</summary>
      <div className="mt-2 space-y-1.5 text-slate-400">
        {c.discrepancies.map((d) => (
          <div key={d.id} className="border-l-2 border-surface-border pl-2">
            <span className="font-mono text-slate-300">{d.id}</span> · Спецификация: {d.specStatement} <span className="text-slate-500">→</span> Исследование: {d.researchBehaviour}{' '}
            <span className="text-slate-500">Политика: сохранить поведение исследования.</span>
          </div>
        ))}
      </div>
    </details>
  </article>
);
