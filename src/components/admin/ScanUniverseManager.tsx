/**
 * ScanUniverseManager — админка монет для LIVE-скана сигналов (вкладка
 * «Монеты»): какие инструменты сканирует движок.
 *
 * - По умолчанию — весь канонический реестр (все монеты терминала).
 * - Монету можно исключить из скана и вернуть обратно; можно добавить свой
 *   тикер (свечи для него берутся напрямую с Binance spot).
 * - Настройка действует в этом браузере (движок и журнал — client-side) и
 *   применяется движком сразу, без перезапуска.
 * - Правила стратегий не меняются: вселенная — только входной список.
 */

import React, { useEffect, useState } from 'react';
import { Plus, RotateCcw, Trash2, Search } from 'lucide-react';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';
import {
  addScanSymbol,
  defaultScanUniverse,
  getScanUniverse,
  isDefaultUniverse,
  removeScanSymbol,
  resetScanUniverse,
  subscribeScanUniverse,
} from '@/services/signals/scanUniverse';

const REGISTRY_SET = new Set(CANONICAL_ASSETS.map((a) => a.symbol.toUpperCase()));

export const ScanUniverseManager: React.FC = () => {
  const [symbols, setSymbols] = useState<string[]>(() => getScanUniverse());
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => subscribeScanUniverse(() => setSymbols(getScanUniverse())), []);

  const flash = (kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 3500);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const res = addScanSymbol(draft);
    setSymbols(res.symbols);
    if (res.ok) {
      flash('ok', `${draft.trim().toUpperCase()} добавлен в скан.`);
      setDraft('');
    } else {
      flash('err', res.error ?? 'Не удалось добавить');
    }
  };

  const handleRemove = (symbol: string) => {
    const res = removeScanSymbol(symbol);
    setSymbols(res.symbols);
    if (!res.ok) flash('err', res.error ?? 'Не удалось удалить');
  };

  const handleReset = () => {
    const next = resetScanUniverse();
    setSymbols(next);
    flash('ok', 'Вселенная сброшена к реестру по умолчанию.');
  };

  const q = filter.trim().toUpperCase();
  const visible = symbols.filter((s) => !q || s.includes(q));
  const defaults = defaultScanUniverse();
  const missing = defaults.filter((d) => !symbols.includes(d) && (!q || d.includes(q)));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Монеты в скане: <span data-qa="universe-count" className="font-mono text-brand-cyan">{symbols.length}</span>
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Движок проверяет эти инструменты каждую минуту (сетап — только на закрытом 1h-баре).
              Действует в этом браузере, применяется сразу. Правила стратегий не меняются.
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            disabled={isDefaultUniverse(symbols)}
            data-qa="universe-reset"
            className="flex items-center gap-1.5 rounded-md border border-white/[0.1] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Сбросить к реестру
          </button>
        </div>

        {notice && (
          <div
            className={`mt-3 rounded border px-3 py-2 text-xs ${
              notice.kind === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
            }`}
          >
            {notice.text}
          </div>
        )}

        <form onSubmit={handleAdd} className="mt-4 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Тикер: PEPE, WIF, BTC…"
            data-qa="universe-add-input"
            className="w-full rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
          />
          <button
            type="submit"
            data-qa="universe-add-btn"
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить
          </button>
        </form>

        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Фильтр списка…"
            className="w-full rounded-md border border-white/[0.1] bg-surface-2 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
          />
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
        <h3 className="mb-3 text-sm font-semibold text-white">Сканируются ({visible.length})</h3>
        {visible.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-500">Ничего не найдено.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visible.map((s) => (
              <span
                key={s}
                className="flex items-center gap-1.5 rounded border border-white/[0.1] bg-surface-2 px-2.5 py-1 font-mono text-xs text-white"
              >
                {s}
                {!REGISTRY_SET.has(s) && (
                  <span className="rounded bg-amber-500/15 px-1 font-sans text-[11px] text-amber-300" title="Тикер вне реестра: свечи только с Binance spot">
                    custom
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(s)}
                  data-qa={`universe-remove-${s}`}
                  aria-label={`Исключить ${s} из скана`}
                  title={`Исключить ${s} из скана`}
                  className="text-slate-500 transition-colors hover:text-rose-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div className="rounded-lg border border-white/[0.08] bg-surface/60 p-6 backdrop-blur-xl">
          <h3 className="mb-1 text-sm font-semibold text-white">Исключены из скана ({missing.length})</h3>
          <p className="mb-3 text-xs text-slate-400">Нажмите, чтобы вернуть монету в скан.</p>
          <div className="flex flex-wrap gap-2">
            {missing.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  const res = addScanSymbol(s);
                  setSymbols(res.symbols);
                }}
                data-qa={`universe-restore-${s}`}
                className="rounded border border-dashed border-white/[0.15] px-2.5 py-1 font-mono text-xs text-slate-400 transition-colors hover:border-cyan-400/50 hover:text-white"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
