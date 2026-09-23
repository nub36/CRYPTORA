/**
 * SymbolPickerModal — выбор монеты попапом: поиск + список реестра.
 * Используется на графике монеты (/coin) и на ликвидациях.
 *
 * Если введённый текст — валидный тикер, но его нет в реестре, предлагается
 * выбрать его как есть (свечи для него берутся напрямую с Binance spot, а
 * карточка /coin для неизвестного тикера честно покажет «Актив не найден»).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';

export interface PickerEntry {
  symbol: string;
  name: string;
  custom: boolean;
}

const TICKER_RE = /^[A-Z0-9]{2,20}$/;

/** Чистая фильтрация для списка + опция «свой тикер». Покрыта юнит-тестами. */
export function filterPickerSymbols(
  query: string,
  availableAssets: readonly { symbol: string; name: string }[] = [],
): PickerEntry[] {
  const q = query.trim().toUpperCase();
  const universe = new Map<string, { symbol: string; name: string }>();
  for (const asset of CANONICAL_ASSETS) universe.set(asset.symbol, { symbol: asset.symbol, name: asset.name });
  for (const asset of availableAssets) {
    const symbol = asset.symbol.toUpperCase().split('/')[0]!.replace(/USDT$/, '');
    if (TICKER_RE.test(symbol) && !universe.has(symbol)) universe.set(symbol, { symbol, name: asset.name });
  }
  const matches: PickerEntry[] = [...universe.values()]
    .filter((a) => !q || a.symbol.includes(q) || a.name.toUpperCase().includes(q))
    .map((a) => ({ symbol: a.symbol, name: a.name, custom: false }));
  if (q) {
    const base = (q.includes('/') ? q.split('/')[0]! : q).trim().replace(/USDT$/, '');
    if (TICKER_RE.test(base) && !universe.has(base)) {
      matches.push({ symbol: base, name: 'Тикер вне реестра (свечи — Binance spot)', custom: true });
    }
  }
  return matches;
}

interface SymbolPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (baseSymbol: string) => void;
  title?: string;
  /** Подсказка-текущий выбор (подсвечивается в списке). */
  current?: string;
  /** Extra assets from the active provider, merged with the canonical spot catalog. */
  availableAssets?: readonly { symbol: string; name: string }[];
}

export const SymbolPickerModal: React.FC<SymbolPickerModalProps> = ({
  open,
  onClose,
  onSelect,
  title = 'Выбор монеты',
  current,
  availableAssets = [],
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const currentUpper = (current ?? '').toUpperCase();

  useEffect(() => {
    if (open) {
      setQuery('');
      // Фокус после монтирования попапа.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKey);
      return () => {
        clearTimeout(t);
        window.removeEventListener('keydown', onKey);
      };
    }
    return undefined;
  }, [open, onClose]);

  const entries = useMemo(() => filterPickerSymbols(query, availableAssets), [query, availableAssets]);

  if (!open) return null;

  const choose = (symbol: string) => {
    onSelect(symbol);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-qa="symbol-picker"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg border border-surface-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <span className="font-sans text-sm font-bold text-white">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть выбор монеты"
            className="rounded p-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-surface-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              type="text"
              aria-label="Поиск монеты по тикеру или названию"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="BTC, Solana, PEPE…"
              data-qa="symbol-picker-search"
              className="w-full rounded border border-surface-border bg-surface-elevated py-2 pl-9 pr-3 font-mono text-sm text-white placeholder:text-slate-500 focus:border-brand-cyan/60 focus:outline-none"
            />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto p-2" data-qa="symbol-picker-list">
          {entries.length === 0 && (
            <div className="px-3 py-6 text-center font-sans text-xs text-slate-500">
              Ничего не найдено. Введите тикер вида BTC или PEPE.
            </div>
          )}
          {entries.map((e) => (
            <button
              key={`${e.symbol}-${e.custom ? 'custom' : 'reg'}`}
              type="button"
              onClick={() => choose(e.symbol)}
              data-qa={`symbol-picker-option-${e.symbol}`}
              className={`flex w-full items-center justify-between rounded px-3 py-2 text-left transition-colors hover:bg-white/[0.05] ${
                e.symbol === currentUpper ? 'bg-brand-cyan/10' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-white">{e.symbol}</span>
                {e.symbol === currentUpper && (
                  <span className="font-sans text-[11px] text-brand-cyan">· текущая</span>
                )}
              </span>
              <span className="font-sans text-[11px] text-slate-400">{e.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
