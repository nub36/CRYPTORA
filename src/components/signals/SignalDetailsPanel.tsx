/**
 * SignalDetailsPanel — уровни выбранного сигнала + раскрываемые детали (§4, §5).
 *
 * Блок «Уровни» показывает ту же лестницу, что рисуется линиями на графике:
 * вход, стоп и ВСЕ цели из `targets[]` (0/1/3/5 — фактический массив, без
 * захардкоженных «ровно TP1/TP2»). Если сервер отдал эффективные уровни после
 * исполнения (`fillPrice`/`fillStop`/`fillTargets`), они идут отдельным набором —
 * публикационные и эффективные уровни не подменяют друг друга.
 *
 * Детали (исход, R, аналитика, целостность) — в коллапсах, второстепенно (§12, §7).
 * Никаких уровней и статусов здесь не досчитывается: всё из серверного DTO.
 */

import React from 'react';
import type { SignalUiModel } from '@/services/signals/ui/signalUiModel';
import {
  R_HELP_TEXT,
  V28_GROSS_ONLY_NOTE,
  formatSignalPrice,
  STATUS_SOURCE_NOTE,
} from '@/utils/serverSignalText';
import { Collapsible } from '@/components/common/Collapsible';
import { Badge } from '@/components/common/Badge';
import { SignalStatusChip } from './SignalStatusChip';

interface SignalDetailsPanelProps {
  model: SignalUiModel | null;
  /** Inspector mode used by the compact disclosure: levels only, no outcome/audit duplication. */
  levelsOnly?: boolean;
}

const ROW_TONE: Record<string, string> = {
  cyan: 'text-cyan-300',
  red: 'text-rose-400',
  green: 'text-emerald-400',
};

export const SignalDetailsPanel: React.FC<SignalDetailsPanelProps> = ({ model, levelsOnly = false }) => {
  if (!model) {
    return (
      <section data-qa="signals-details-empty" className="rounded-lg border border-surface-border bg-surface p-4">
        <p className="ui-helper text-center">Выберите сигнал в истории или на графике, чтобы увидеть уровни и детали.</p>
      </section>
    );
  }

  return (
    <section
      data-qa="signals-details"
      data-signal-id={model.id}
      className="space-y-3 rounded-lg border border-surface-border bg-surface p-3"
      aria-label={`Детали сигнала ${model.pair}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-card-title">Уровни сигнала</span>
          <Badge variant={model.direction === 'LONG' ? 'green' : 'red'} size="xs">
            {model.direction === 'LONG' ? '▲' : '▼'} {model.directionText}
          </Badge>
          <Badge variant="neutral" size="xs">{model.strategyText}</Badge>
          <span className="rounded border border-surface-border bg-surface-elevated px-1.5 py-0.5 text-[11px] font-mono text-slate-300">
            {model.timeframe}
          </span>
        </div>
        <SignalStatusChip status={model.status} size="xs" />
      </div>

      {/* Публикационные уровни — ровно то, что сохранил сервер. */}
      <ul className="space-y-1.5" data-qa="signals-level-list">
        {model.levels.map((row) => (
          <li
            key={row.id}
            data-qa={`signals-level-${row.id}`}
            data-kind={row.kind}
            className="flex items-center justify-between gap-3 rounded border border-surface-border/60 bg-surface-elevated/40 px-2.5 py-1.5"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  row.kind === 'stop' ? 'bg-rose-400' : row.kind === 'target' ? 'bg-emerald-400' : 'bg-cyan-300'
                }`}
              />
              <span className="ui-label">{row.label}{row.comparator ? ` (${row.comparator})` : ''}</span>
            </span>
            <span className={`ui-num text-sm font-semibold ${ROW_TONE[row.tone] ?? 'text-white'}`}>
              {formatSignalPrice(row.price)}
            </span>
          </li>
        ))}
        {model.levels.length === 0 && (
          <li className="ui-helper text-center">Сервер не передал уровней для этого сигнала.</li>
        )}
      </ul>

      {/* Эффективные уровни после исполнения — отдельный честный набор. */}
      {model.effectiveLevels.length > 0 && (
        <div>
          <div className="ui-label mb-1.5">После исполнения (эффективные)</div>
          <ul className="space-y-1.5" data-qa="signals-effective-level-list">
            {model.effectiveLevels.map((row) => (
              <li
                key={row.id}
                data-qa={`signals-level-${row.id}`}
                className="flex items-center justify-between gap-3 rounded border border-dashed border-surface-border/60 bg-surface-elevated/30 px-2.5 py-1.5"
              >
                <span className="ui-label">{row.label}</span>
                <span className={`ui-num text-sm font-semibold ${ROW_TONE[row.tone] ?? 'text-white'}`}>
                  {formatSignalPrice(row.price)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="ui-helper">{model.entry.typeText} · {STATUS_SOURCE_NOTE}</p>

      {!levelsOnly && (
        <>
      {/* Исход и R — второстепенно (§12). Формулы не пересчитываются. */}
      <Collapsible testId="signals-outcome" tone="muted" label="Исход и результат (R)" hint="gross / net">
        <div className="space-y-2">
          <p className="ui-secondary">{model.outcome.summaryLine}</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border border-surface-border/60 bg-surface-elevated/40 p-2">
              <div className="ui-label">Gross R</div>
              <div className="ui-num mt-0.5 text-sm font-semibold text-white">{model.outcome.gross}</div>
            </div>
            <div className="rounded border border-surface-border/60 bg-surface-elevated/40 p-2">
              <div className="ui-label">Net R</div>
              <div className="ui-num mt-0.5 text-sm font-semibold text-white">{model.outcome.net}</div>
            </div>
            <div className="rounded border border-surface-border/60 bg-surface-elevated/40 p-2">
              <div className="ui-label">Результат, %</div>
              <div className="ui-num mt-0.5 text-sm font-semibold text-white">{model.outcome.pnlPct}</div>
            </div>
          </div>
          {model.outcome.closeReasonText && (
            <p className="ui-helper">Причина выхода: {model.outcome.closeReasonText}.</p>
          )}
          {model.outcome.barsHeld !== null && (
            <p className="ui-helper">В позиции: {model.outcome.barsHeld} бар(ов).</p>
          )}
          <p className="ui-helper">{R_HELP_TEXT}</p>
          {model.strategyId === 'V2_8_ZERO_FEE_SNIPER_TRAILING' && (
            <p className="ui-helper text-amber-300">{V28_GROSS_ONLY_NOTE}</p>
          )}
        </div>
      </Collapsible>

      {/* Аналитика сетапа — из metadata, без домысливания. */}
      <Collapsible
        testId="signals-analytics"
        tone="muted"
        label="Аналитика сетапа"
        hint={model.analytics.exitRule ? 'правило выхода и факторы' : 'метаданные'}
      >
        <dl className="space-y-1.5">
          {model.analytics.exitRule && (
            <div>
              <dt className="ui-label inline">Правило выхода: </dt>
              <dd className="ui-secondary inline">{model.analytics.exitRule}</dd>
            </div>
          )}
          {model.analytics.riskRewardRatio !== null && (
            <div>
              <dt className="ui-label inline">R:R до финальной цели: </dt>
              <dd className="ui-num inline text-slate-200">1 : {model.analytics.riskRewardRatio}</dd>
            </div>
          )}
          {model.analytics.latencyBars !== null && (
            <div>
              <dt className="ui-label inline">Задержка публикации: </dt>
              <dd className="ui-secondary inline">{model.analytics.latencyBars} бар(ов)</dd>
            </div>
          )}
          {model.analytics.engineVersion && (
            <div>
              <dt className="ui-label inline">Версия движка: </dt>
              <dd className="ui-secondary inline">{model.analytics.engineVersion}</dd>
            </div>
          )}
        </dl>
        {model.analytics.confirmingFactors.length > 0 && (
          <div className="mt-2">
            <div className="ui-label mb-1">Подтверждающие наблюдения</div>
            <ul className="ui-helper list-disc space-y-0.5 pl-4">
              {model.analytics.confirmingFactors.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}
        {model.analytics.invalidationFactors.length > 0 && (
          <div className="mt-2">
            <div className="ui-label mb-1 text-amber-300">Опровергающие факторы и риски</div>
            <ul className="ui-helper list-disc space-y-0.5 pl-4">
              {model.analytics.invalidationFactors.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}
      </Collapsible>

      {/* Целостность — компактно (§7): хэши не доминируют на мобильном. */}
      <Collapsible testId="signals-integrity" tone="muted" label="Целостность (SHA-256)" hint={`цепочка v${model.integrity.chainVersion}`}>
        <div className="space-y-1.5">
          <p className="ui-helper">
            Публикация сигнала неизменяема (связка `hash` → `previousHash`); исполнение и исход хэшируются
            отдельно (`outcomeHash`). Цепочка версии {model.integrity.chainVersion}.
          </p>
          <div>
            <dt className="ui-label">Hash</dt>
            <dd className="ui-hash mt-0.5 text-slate-300">{model.integrity.hash}</dd>
          </div>
          <div>
            <dt className="ui-label">Previous hash</dt>
            <dd className="ui-hash mt-0.5 text-slate-300">{model.integrity.previousHash}</dd>
          </div>
          {model.integrity.outcomeHash && (
            <div>
              <dt className="ui-label">Outcome hash</dt>
              <dd className="ui-hash mt-0.5 text-slate-300">{model.integrity.outcomeHash}</dd>
            </div>
          )}
          <p className="ui-helper mt-1">
            Полная проверка цепочки выполняется на сервере (`verifyChain()`); этот экран показывает сохранённые
            значения, ничего не пересчитывая.
          </p>
        </div>
      </Collapsible>
        </>
      )}
    </section>
  );
};

export default SignalDetailsPanel;
