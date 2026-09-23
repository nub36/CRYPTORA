/**
 * ScanUniverseManager — Admin → Монеты.
 *
 * - Все активные Binance Spot USDT инструменты доступны на сайте АВТОМАТИЧЕСКИ
 *   (exchangeInfo). Админ не разрешает монеты для сайта.
 * - Админ управляет только SCAN UNIVERSE: какие инструменты сканирует движок.
 * - Хранение — PostgreSQL (scan_universe), общее для всех процессов и
 *   пользователей; не localStorage.
 * - Инструмент, переставший торговаться, не сканируется, даже если сохранён
 *   (показывается как «неактивен на бирже»).
 * - Правила стратегий не меняются: вселенная — только входной список.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { CoinIcon } from '@/components/common/CoinIcon';
import { getSpotUniverse } from '@/services/data/registry/exchangeUniverse';
import { getCoinNames } from '@/services/data/registry/coinLogoRegistry';
import {
  addScanSymbolRemote,
  fetchAdminScanUniverse,
  removeScanSymbolRemote,
  type AdminScanUniverseState,
} from '@/services/signals/scanUniverse';

/** DOM bound for search results (the market universe is 500+ instruments). */
export const SCAN_MANAGER_RENDER_LIMIT = 50;

export interface ScanCandidate {
  symbol: string;
  name: string;
  inScan: boolean;
}

/** Pure: search the FULL active universe by ticker or name. Unit-tested. */
export function searchScanCandidates(
  query: string,
  universe: readonly string[],
  names: ReadonlyMap<string, string>,
  scanSet: ReadonlySet<string>,
): ScanCandidate[] {
  const q = query.trim().toUpperCase();
  const rows = universe.map((symbol) => ({ symbol, name: names.get(symbol) ?? symbol, inScan: scanSet.has(symbol) }));
  if (!q) return rows.filter((r) => r.inScan);
  const rank = (r: ScanCandidate) => (r.symbol === q ? 0 : r.symbol.startsWith(q) ? 1 : r.symbol.includes(q) ? 2 : 3);
  return rows
    .filter((r) => r.symbol.includes(q) || r.name.toUpperCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));
}

export const ScanUniverseManager: React.FC = () => {
  const [state, setState] = useState<AdminScanUniverseState | null>(null);
  const [universe, setUniverse] = useState<string[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(() => new Map());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 3500);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchAdminScanUniverse().then((res) => {
      if (!active) return;
      if (res.ok) setState(res.state);
      else flash('err', `Не удалось загрузить вселенную скана: ${res.error}`);
    });
    void getSpotUniverse().then(async (u) => {
      if (!active || !u) return;
      const symbols = u.symbols.map((s) => s.symbol);
      setUniverse(symbols);
      const n = await getCoinNames(symbols);
      if (active) setNames(n);
    });
    return () => { active = false; };
  }, [flash]);

  const scanSet = useMemo(() => new Set(state?.saved ?? []), [state]);
  const inactiveSet = useMemo(() => new Set(state?.inactive ?? []), [state]);
  const results = useMemo(() => {
    const base = universe ?? [];
    // Saved-but-inactive symbols are still listed so the admin can remove them.
    const all = [...base, ...(state?.inactive ?? []).filter((s) => !base.includes(s))];
    return searchScanCandidates(query, all, names, scanSet);
  }, [query, universe, names, scanSet, state]);
  const visible = results.slice(0, SCAN_MANAGER_RENDER_LIMIT);

  const toggle = async (symbol: string, add: boolean) => {
    setBusy(symbol);
    const res = add ? await addScanSymbolRemote(symbol) : await removeScanSymbolRemote(symbol);
    setBusy(null);
    if (res.ok) {
      setState(res.state);
      flash('ok', add ? `${symbol} добавлен в скан.` : `${symbol} убран из скана.`);
    } else {
      flash('err', res.error);
    }
  };

  const available = universe?.length ?? state?.activeCount ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h3 className="text-sm font-semibold text-white">
            Доступно на рынке: <span data-qa="universe-available-count" className="font-mono text-brand-cyan">{available ?? '—'}</span>
          </h3>
          <h3 className="text-sm font-semibold text-white">
            В скане: <span data-qa="universe-count" className="font-mono text-brand-cyan">{state ? state.effective.length : '—'}</span>
            {state && state.saved.length !== state.effective.length && (
              <span className="ml-2 text-xs font-normal text-amber-300">(сохранено {state.saved.length}, неактивны на бирже: {state.inactive.length})</span>
            )}
          </h3>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Все активные Spot USDT инструменты Binance доступны на сайте автоматически. Здесь выбирается только, какие из
          них сканирует движок сигналов. Настройка хранится на сервере и действует для всех пользователей. Инструмент,
          переставший торговаться, не сканируется. Правила стратегий не меняются. Лимит — {state?.max ?? 100}.
        </p>
        {state && !state.activeKnown && (
          <p className="mt-2 text-xs text-amber-300">Список активных инструментов биржи сейчас недоступен — скан приостановлен до его получения.</p>
        )}

        {notice && (
          <div
            className={`mt-3 rounded border px-3 py-2 text-xs ${
              notice.kind === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
            }`}
            data-qa="universe-notice"
          >
            {notice.text}
          </div>
        )}

        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти любую активную монету: LTC, PEPE, Litecoin…"
            aria-label="Поиск монеты для скана"
            data-qa="universe-search"
            className="w-full rounded-md border border-white/[0.1] bg-surface-2 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {query.trim() ? `Найдено: ${results.length}` : 'Пустой поиск показывает монеты в скане.'}
          {results.length > visible.length && ` · показано ${visible.length}, уточните запрос`}
        </p>

        <ul className="mt-3 divide-y divide-white/[0.05]" data-qa="universe-results">
          {visible.map((r) => {
            const inactive = inactiveSet.has(r.symbol);
            return (
              <li key={r.symbol} className="flex items-center justify-between gap-3 py-2" data-qa={`universe-row-${r.symbol}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <CoinIcon symbol={r.symbol} size={20} />
                  <span className="font-mono text-sm font-bold text-white">{r.symbol}</span>
                  <span className="truncate text-xs text-slate-400">{r.name}</span>
                  {r.inScan && !inactive && <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[11px] text-cyan-300">в скане</span>}
                  {inactive && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300">неактивен на бирже</span>}
                </span>
                {r.inScan ? (
                  <button
                    type="button"
                    disabled={busy === r.symbol}
                    onClick={() => void toggle(r.symbol, false)}
                    data-qa={`universe-remove-${r.symbol}`}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-rose-500/30 px-3 py-1 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Убрать из скана
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy === r.symbol || inactive}
                    onClick={() => void toggle(r.symbol, true)}
                    data-qa={`universe-add-${r.symbol}`}
                    className="flex shrink-0 items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-500 disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" /> Добавить в скан
                  </button>
                )}
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="py-4 text-center text-xs text-slate-500">
              {universe === null && query.trim() ? 'Загрузка списка инструментов…' : 'Ничего не найдено.'}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};
