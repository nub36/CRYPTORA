import React from 'react';
import { ChartTerminal, type ChartTerminalProps } from '@/components/common/ChartTerminal';
import { ChartDataState, type ChartDataStatus } from '@/components/common/ChartDataState';
import type { MarketType } from '@/types/market';
import { formatInstrumentPrice } from '@/utils/formatters';

/**
 * ОБЩАЯ карточка графика инструмента для Spot и Futures (задача §2, §10).
 *
 * До этой правки страница фьючерса собирала собственную обвязку графика
 * (свой заголовок, свой ряд кнопок таймфрейма вместо тулбара, никакого
 * контекста 24ч) — из-за этого /futures/:symbol выглядел беднее /coin/:symbol
 * и расходился с ним при каждой правке терминала. Теперь обе страницы
 * рендерят ЭТОТ компонент, а рынок влияет только на данные и подписи:
 *
 *  • `ChartTerminal` (единый тулбар + CandleChart) монтируется ВСЕГДА, в том
 *    числе во время загрузки и ошибки, поэтому таймфрейм/тип/индикаторы
 *    остаются доступными и не подменяются «аварийным» рядом кнопок;
 *  • состояние серии показывает общий `ChartDataState`
 *    (loading / no-data / unsupported / unavailable + «Повторить»);
 *  • 24ч максимум/минимум берутся из метрик ТОГО ЖЕ рынка (на фьючерсе —
 *    high/low перпетуала, не спота) и печатаются каноничной точностью.
 */
export interface InstrumentChartCardProps {
  market: MarketType;
  /** Отображаемая пара, например `MEW/USDT`. */
  displayPair: string;
  status: ChartDataStatus;
  onRetry: () => void;
  /** `spot-chart-state` | `futures-chart-state`. */
  stateQa: string;
  high24h?: number | null;
  low24h?: number | null;
  /** Заголовок слева (на Spot — кнопка выбора монеты). */
  titleSlot?: React.ReactNode;
  /** Правая подпись-контекст (источник/дисклеймер). */
  note?: React.ReactNode;
  /** Дополнительный баннер под состоянием (например, разрыв kline-потока). */
  notice?: React.ReactNode;
  terminal: ChartTerminalProps;
  qa?: string;
}

export const InstrumentChartCard: React.FC<InstrumentChartCardProps> = ({
  market,
  displayPair,
  status,
  onRetry,
  stateQa,
  high24h = null,
  low24h = null,
  titleSlot,
  note,
  notice,
  terminal,
  qa = 'instrument-chart-card',
}) => (
  /*
   * Компактный вертикальный стек карточки (UI-cleanup после PR #37, §2):
   *
   *  • карточка — ЯВНЫЙ flex-столбец `flex-col gap-2.5`: высота каждого
   *    ребёнка определяется только его содержимым, поэтому между заголовком
   *    и терминалом не может возникнуть «пустая полоса» — нет ни
   *    зарезервированных слотов под toolbar, ни растягиваемых детей
   *    (flex-grow), ни absolute-вставок, влияющих на поток;
   *  • заголовок — ОДНА строка нормальной минимальной высоты (контент +
   *    `pb-2` + divider). `min-height` не задаётся вовсе: лишнему воздуху
   *    взяться неоткуда;
   *  • состояния загрузки/ошибки (`ChartDataState`) и `notice` занимают
   *    место ТОЛЬКО когда реально отрендерены — в `ready` они не оставляют
   *    после себя пустых блоков;
   *  • карточку нельзя «растянуть» под высоту соседа по grid — страницы
   *    передают её в grid с `items-start` (см. CoinDetailPage /
   *    FuturesContractPage), поэтому внутри рамки не появляется мёртвого
   *    пространства снизу.
   */
  <div
    data-qa={qa}
    data-market={market}
    className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-surface-border bg-surface p-3 sm:p-4"
  >
    <div className="flex flex-col gap-2 border-b border-surface-border pb-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {titleSlot ?? (
          <span className="truncate font-sans text-sm font-bold text-white">{displayPair}</span>
        )}
        <div className="hidden shrink-0 items-center gap-2 font-sans text-xs text-slate-400 sm:flex">
          <span>
            Макс. 24ч:{' '}
            <strong data-qa="chart-high-24h" className="font-mono tabular-nums text-slate-200">
              {high24h != null ? formatInstrumentPrice(high24h) : 'Нет данных'}
            </strong>
          </span>
          <span>
            Мин. 24ч:{' '}
            <strong data-qa="chart-low-24h" className="font-mono tabular-nums text-slate-200">
              {low24h != null ? formatInstrumentPrice(low24h) : 'Нет данных'}
            </strong>
          </span>
        </div>
      </div>
      {note && <span className="shrink-0 font-sans text-[11px] tracking-[0.16em] text-slate-500">{note}</span>}
    </div>

    <ChartDataState
      status={status}
      symbol={displayPair}
      market={market}
      onRetry={onRetry}
      qa={stateQa}
    />
    {notice}

    <ChartTerminal {...terminal} />
  </div>
);
