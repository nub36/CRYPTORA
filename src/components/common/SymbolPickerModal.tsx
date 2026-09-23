/**
 * SymbolPickerModal — выбор монеты попапом: поиск по тикеру и названию.
 * Используется на графике монеты (/coin) и на ликвидациях.
 *
 * Вселенная — ПОЛНЫЙ список активных Binance Spot USDT инструментов
 * (exchangeInfo через сервер), а не canonical 25. Для каждого из них реально
 * поддерживаются свечи (Binance Spot klines BASEUSDT), поэтому тот же список
 * годится и для /liquidations.
 *
 * Производительность: список рендерит не более PICKER_RENDER_LIMIT строк —
 * поиск сужает выдачу; тяжёлая аналитика для результатов не загружается,
 * логотипы — ленивые <img> из общего кэша метаданных (один запрос на всё).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';
import { getSelectableSpotSymbols } from '@/services/data/registry/exchangeUniverse';
import { getCoinNames } from '@/services/data/registry/coinLogoRegistry';
import { CoinIcon } from './CoinIcon';

export interface PickerEntry {
  symbol: string;
  name: string;
  custom: boolean;
}

const TICKER_RE = /^[A-Z0-9]{2,20}$/;
/** DOM bound for the result list (search narrows it; no 500-row render). */
export const PICKER_RENDER_LIMIT = 60;

/**
 * Чистая фильтрация для списка. Покрыта юнит-тестами.
 * @param availableAssets полный активный universe (symbol + name)
 * @param authoritative true — universe из exchangeInfo: «свой тикер» не предлагается,
 *   т.к. неактивный инструмент выбрать нельзя; false — деградированный режим.
 */
export function filterPickerSymbols(
  query: string,
  availableAssets: readonly { symbol: string; name: string }[] = [],
  authoritative = false,
): PickerEntry[] {
  const q = query.trim().toUpperCase();
  const universe = new Map<string, { symbol: string; name: string }>();
  if (!authoritative) {
    for (const asset of CANONICAL_ASSETS) universe.set(asset.symbol, { symbol: asset.symbol, name: asset.name });
  }
  for (const asset of availableAssets) {
    const symbol = asset.symbol.toUpperCase().split('/')[0]!.replace(/USDT$/, '');
    if (/^[A-Z0-9]{1,20}$/.test(symbol) && !universe.has(symbol)) universe.set(symbol, { symbol, name: asset.name || symbol });
  }
  const all = [...universe.values()];
  const matches: PickerEntry[] = (q
    ? all
      .filter((a) => a.symbol.includes(q) || a.name.toUpperCase().includes(q))
      // exact ticker → ticker prefix → name match
      .sort((a, b) => rankMatch(a, q) - rankMatch(b, q) || a.symbol.localeCompare(b.symbol))
    : all
  ).map((a) => ({ symbol: a.symbol, name: a.name, custom: false }));
  if (q && !authoritative) {
    const base = (q.includes('/') ? q.split('/')[0]! : q).trim().replace(/USDT$/, '');
    if (TICKER_RE.test(base) && !universe.has(base)) {
      matches.push({ symbol: base, name: 'Тикер вне реестра (свечи — Binance spot)', custom: true });
    }
  }
  return matches;
}

function rankMatch(a: { symbol: string; name: string }, q: string): number {
  if (a.symbol === q) return 0;
  if (a.symbol.startsWith(q)) return 1;
  if (a.symbol.includes(q)) return 2;
  return 3;
}

interface SymbolPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (baseSymbol: string) => void;
  title?: string;
  /** Подсказка-текущий выбор (подсвечивается в списке). */
  current?: string;
  /**
   * Optional explicit universe (tests / special pages). By default the picker
   * lazily loads the full active Spot universe when opened.
   */
  availableAssets?: readonly { symbol: string; name: string }[];
}

export const SymbolPickerModal: React.FC<SymbolPickerModalProps> = ({
  open,
  onClose,
  onSelect,
  title = 'Выбор монеты',
  current,
  availableAssets,
}) => {
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<{ assets: { symbol: string; name: string }[]; authoritative: boolean } | null>(null);

  // Lazy: universe + names are fetched only when the picker is opened (both cached app-wide).
  useEffect(() => {
    if (!open || availableAssets) return;
    let active = true;
    void getSelectableSpotSymbols().then(async ({ symbols, authoritative }) => {
      if (!active) return;
      setLoaded({ assets: symbols.map((symbol) => ({ symbol, name: symbol })), authoritative });
      const names = await getCoinNames(symbols);
      if (active) setLoaded({ assets: symbols.map((symbol) => ({ symbol, name: names.get(symbol) ?? symbol })), authoritative });
    });
    return () => { active = false; };
  }, [open, availableAssets]);
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

  const universeAssets = availableAssets ?? loaded?.assets ?? [];
  const authoritative = availableAssets ? false : Boolean(loaded?.authoritative);
  const entries = useMemo(
    () => filterPickerSymbols(query, universeAssets, authoritative),
    [query, universeAssets, authoritative],
  );
  const visibleEntries = entries.slice(0, PICKER_RENDER_LIMIT);

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
          <div className="mb-2 font-sans text-[11px] text-slate-500" data-qa="symbol-picker-universe">
            {availableAssets
              ? `Инструментов: ${universeAssets.length}`
              : loaded
                ? loaded.authoritative
                  ? `Активных Spot USDT на Binance: ${loaded.assets.length}`
                  : 'Список активных инструментов недоступен — показан базовый каталог'
                : 'Загрузка списка инструментов…'}
          </div>
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
          {visibleEntries.map((e) => (
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
                <span aria-hidden="true" className="contents"><CoinIcon symbol={e.symbol} size={20} /></span>
                <span className="font-mono text-sm font-bold text-white">{e.symbol}</span>
                {e.symbol === currentUpper && (
                  <span className="font-sans text-[11px] text-brand-cyan">· текущая</span>
                )}
              </span>
              <span className="ml-3 truncate font-sans text-[11px] text-slate-400">{e.name}</span>
            </button>
          ))}
          {entries.length > visibleEntries.length && (
            <div className="px-3 py-2 text-center font-sans text-[11px] text-slate-500" data-qa="symbol-picker-more">
              Показано {visibleEntries.length} из {entries.length} — уточните поиск
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
