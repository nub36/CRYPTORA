/**
 * SignalsCoinSelector — выбор инструмента для экрана сигналов (§4).
 *
 * Источник списка — ПОЛНЫЙ активный universe Spot USDT, который подгружает сам
 * `SymbolPickerModal` лениво и кэширует на всё приложение. Здесь мы НЕ грузим
 * свечи и не строим список по админ-вселенной скана: пользователь выбирает из
 * всех активных инструментов, а данные после выбора запрашиваются только для
 * выбранного символа.
 *
 * Дополнительно — компактные «чипы» монет, по которым в ЗАГРУЖЕННОЙ ленте уже
 * есть сигналы (`distinct` по `signals[].symbol`). Это не отдельный запрос по
 * всей вселенной: источники — уже полученная страница ленты.
 */

import React, { useCallback, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { SymbolPickerModal } from '@/components/common/SymbolPickerModal';
import { CoinIcon } from '@/components/common/CoinIcon';

interface SignalsCoinSelectorProps {
  /** BASE-тикер выбранного инструмента, напр. 'BTC'. */
  symbol: string;
  /** Пара для отображения, напр. 'BTC/USDT'. */
  pair: string;
  /** Пары, по которым в загруженной ленте есть сигналы. */
  signalPairs: string[];
  onSelect: (baseSymbol: string) => void;
}

export const SignalsCoinSelector: React.FC<SignalsCoinSelectorProps> = ({
  symbol,
  pair,
  signalPairs,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);

  /**
   * BUG A. `onClose` обязан быть СТАБИЛЬНЫМ: `SymbolPickerModal` сбрасывает
   * строку поиска на переходе open false→true, но если сюда передавать
   * инлайн-стрелку, родительские ререндеры (опрос статуса движка, журнала,
   * ленты сигналов) создают новую ссылку — и запрос в модалке стирался посреди
   * набора. `useCallback` убирает этот класс регрессии для всех родителей
   * этого компонента, а не только для текущего экрана.
   */
  const closePicker = useCallback(() => setOpen(false), []);

  return (
    <section
      data-qa="signals-coin-selector"
      className="rounded-lg border border-surface-border bg-surface p-3"
      aria-label="Выбор монеты для сигналов"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-qa="signals-coin-picker-open"
          aria-haspopup="dialog"
          aria-label={`Выбрать монету. Сейчас ${pair}`}
          className="flex min-h-[48px] flex-1 items-center gap-3 rounded-md border border-surface-border bg-surface-elevated px-3 py-2 text-left transition-colors hover:border-surface-border-active"
        >
          <span aria-hidden="true" className="shrink-0"><CoinIcon symbol={symbol} size={28} /></span>
          <span className="min-w-0 flex-1">
            <span className="ui-h2 block truncate">{pair}</span>
            <span className="ui-helper block truncate">Все активные Spot USDT · поиск по тикеру</span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
      </div>

      {signalPairs.length > 0 && (
        <div
          className="mt-2 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
          data-qa="signals-coin-chips"
          role="list"
          aria-label="Монеты с сигналами"
        >
          {signalPairs.map((p) => {
            const base = p.split('/')[0] ?? p;
            const active = base.toUpperCase() === symbol.toUpperCase();
            return (
              <button
                key={p}
                type="button"
                role="listitem"
                onClick={() => onSelect(base)}
                aria-pressed={active}
                className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors ${
                  active
                    ? 'border-surface-border-active bg-brand-cyan/10 text-brand-cyan font-semibold'
                    : 'border-surface-border bg-surface text-slate-300 hover:text-white'
                }`}
              >
                <span aria-hidden="true" className="contents"><CoinIcon symbol={base} size={16} /></span>
                <span className="ui-num">{base}</span>
              </button>
            );
          })}
        </div>
      )}

      <SymbolPickerModal
        open={open}
        onClose={closePicker}
        onSelect={onSelect}
        current={symbol}
        title="Выбор монеты для сигналов"
      />
    </section>
  );
};

export default SignalsCoinSelector;
