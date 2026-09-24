/**
 * SignalSummaryCard — главная карточка выбранного/последнего сигнала (§9, §11).
 *
 * Компактный «что я вижу» ответ человеческим языком: монета, направление,
 * стратегия·таймфрейм, вход, стоп, цели и статус. Все значения берутся из
 * серверного DTO как есть — ничего не досчитывается на клиенте.
 *
 * Таймфрейм здесь — таймфрейм СИГНАЛА (исполнения), а не графика: у всех трёх
 * стратегий это '1h' (V2.8 — тоже '1h', никакой «15m»).
 */

import React from 'react';
import type { SignalUiModel } from '@/services/signals/ui/signalUiModel';
import { formatSignalTime } from '@/utils/serverSignalText';
import { Badge } from '@/components/common/Badge';
import { SignalStatusChip } from './SignalStatusChip';

interface SignalSummaryCardProps {
  model: SignalUiModel | null;
}

const LevelValue: React.FC<{ label: string; value: string; tone?: 'red' | 'green' | 'cyan' }> = ({
  label,
  value,
  tone,
}) => (
  <div className="min-w-0 rounded border border-surface-border bg-surface-elevated/60 px-2.5 py-2">
    <div className="ui-label truncate">{label}</div>
    <div
      className={`ui-num mt-0.5 truncate text-sm font-semibold ${
        tone === 'red' ? 'text-rose-400' : tone === 'green' ? 'text-emerald-400' : tone === 'cyan' ? 'text-cyan-300' : 'text-white'
      }`}
    >
      {value}
    </div>
  </div>
);

export const SignalSummaryCard: React.FC<SignalSummaryCardProps> = ({ model }) => {
  // BUG B: пустое состояние здесь БОЛЬШЕ НЕ ДУБЛИРУЕТСЯ. Раньше карточка
  // выводила свой текст «Сигналов по этому инструменту пока нет», а страница —
  // ещё один такой же блок: два разных блока про одно и то же состояние, из-за
  // которых непонятно, сколько причин и какая из них главная. Единственный
  // блок с причинами (сканер выключен / лента пуста / запрос упал / рынок
  // недоступен) живёт на странице — `signals-empty[data-state]`. Без сигнала
  // карточка просто не рисуется.
  if (!model) return null;

  const targets = model.targets;

  return (
    <section
      data-qa="signals-summary"
      data-signal-id={model.id}
      data-status={model.status}
      data-direction={model.direction}
      className="rounded-lg border border-surface-border bg-surface p-3"
      aria-label={`Текущий сигнал ${model.pair}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-h2">{model.pair}</span>
          <Badge variant={model.direction === 'LONG' ? 'green' : 'red'} size="sm">
            {model.direction === 'LONG' ? '▲' : '▼'} {model.directionText}
          </Badge>
          <Badge variant="neutral" size="sm">{model.strategyText}</Badge>
          <span className="rounded border border-surface-border bg-surface-elevated px-2 py-0.5 text-xs font-mono text-slate-300">
            {model.timeframe}
          </span>
        </div>
        <SignalStatusChip status={model.status} size="sm" />
      </div>

      <p className="ui-helper mt-1.5" title={model.statusHint}>
        {model.directionHint}. Сигнал {formatSignalTime(model.signalCandleTs)}
        {model.strategyShort ? ` · ${model.strategyShort}` : ''}
      </p>

      {/*
        §10: результат — если он достоверно известен. Значение приходит из
        сервера (`resultR` / `netResultR`), здесь только подпись: R на клиенте
        НЕ пересчитывается. Статусы без сделки (истечение, отмена, не
        отслежено) строку не получают — «результата нет» != «результат 0».
      */}
      {model.hasTrade && (
        <p className="ui-helper mt-1.5" data-qa="signals-summary-result">
          Результат: {model.outcome.gross} (gross) · {model.outcome.net} (net)
        </p>
      )}

      {/* Вход / стоп / цели. Целей может быть 0, 1, 3, 5 — рисуем фактический массив. */}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <LevelValue label={model.entry.max !== null && model.entry.min !== null && model.entry.min !== model.entry.max ? 'Вход (зона)' : 'Вход'} value={model.entry.text} tone="cyan" />
        <LevelValue label="Стоп" value={model.stop.text} tone="red" />
        {targets.slice(0, 3).map((t) => (
          <LevelValue key={t.index} label={t.label} value={t.text} tone="green" />
        ))}
        {targets.length > 3 && (
          <LevelValue label={`Ещё целей: ${targets.length - 3}`} value="в деталях" tone="green" />
        )}
      </div>

      {targets.length === 0 && (
        <p className="ui-helper mt-2 text-amber-300" data-qa="signals-summary-no-targets">
          Сервер не передал целей для этого сигнала — уровни не достраиваются.
        </p>
      )}
    </section>
  );
};

export default SignalSummaryCard;
