import React, { useState, useMemo } from 'react';
import { JournalService, JournalEntry } from '@/services/journal/JournalService';
import { BookOpen, Plus, Trash2, Award, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { sideLabel } from '@/utils/labels';

export const JournalPage: React.FC = () => {
  const journal = useMemo(() => JournalService.getInstance(), []);
  const [entries, setEntries] = useState<JournalEntry[]>(() => journal.getEntries());
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Form State
  const [symbol, setSymbol] = useState('BTC');
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [entryPrice, setEntryPrice] = useState('64500');
  const [exitPrice, setExitPrice] = useState('66200');
  const [sizeUsd, setSizeUsd] = useState('2000');
  const [disciplineScore, setDisciplineScore] = useState(5);
  const [setupReason, setSetupReason] = useState('');
  const [reflection, setReflection] = useState('');

  const summary = useMemo(() => journal.getSummary(), [entries, journal]);

  const handleAddTrade = (e: React.FormEvent) => {
    e.preventDefault();
    const entryNum = Number(entryPrice) || 1;
    const exitNum = Number(exitPrice) || 1;
    const sizeNum = Number(sizeUsd) || 1000;

    let pnlPct: number;
    let pnlUsd: number;

    if (direction === 'LONG') {
      pnlPct = ((exitNum - entryNum) / entryNum) * 100;
      pnlUsd = (pnlPct / 100) * sizeNum;
    } else {
      pnlPct = ((entryNum - exitNum) / entryNum) * 100;
      pnlUsd = (pnlPct / 100) * sizeNum;
    }

    journal.addEntry({
      date: new Date().toISOString(),
      symbol: symbol.toUpperCase(),
      direction,
      entryPrice: entryNum,
      exitPrice: exitNum,
      positionSizeUsd: sizeNum,
      pnlUsd: Number(pnlUsd.toFixed(2)),
      pnlPct: Number(pnlPct.toFixed(2)),
      setupReason: setupReason || 'Аналитический сетап по уровням поддержки и объемам.',
      reflection: reflection || 'Торговый план выполнен в соответствии с правилами риск-менеджмента.',
      disciplineScore,
      tags: ['Manual Log', direction],
    });

    setEntries(journal.getEntries());
    setIsFormOpen(false);
    setSetupReason('');
    setReflection('');
  };

  const handleDelete = (id: string) => {
    journal.deleteEntry(id);
    setEntries(journal.getEntries());
  };

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-brand-purple" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Журнал сделок и рефлексии
            </h1>
            <Badge variant="purple" size="sm">
              Исследования и дисциплина
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Ручной журнал аналитических сделок, трекинг соблюдения торговой дисциплины и рефлексия ошибок.
          </p>
        </div>

        <button
          onClick={() => setIsFormOpen(!isFormOpen)}
          className="px-3.5 py-1.5 bg-brand-cyan hover:bg-sky-500 text-slate-950 font-sans font-bold text-xs rounded flex items-center space-x-1.5 transition-colors self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{isFormOpen ? 'Скрыть форму' : 'Записать сделку в журнал'}</span>
        </button>
      </div>

      {/* Non-Execution Transparency Banner */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-sans font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>Принцип ручного журнала самодисциплины</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Журнал CRYPTORA является автономной исследовательской тетрадью трейдера. Платформа <strong>не подключается к биржам для чтения балансов и не размещает ордера</strong>. Все записи хранятся локально для выявления повторяющихся паттернов и психологических ошибок.
        </p>
      </div>

      {/* Performance Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
          <div className="text-[11px] text-slate-400">Всего сделок в журнале</div>
          <div className="text-2xl font-bold text-white mt-1">{summary.totalTrades}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {summary.profitableTrades} прибыльных / {summary.losingTrades} убыточных
          </div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
          <div className="text-[11px] text-slate-400">Доля прибыльных</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{summary.winRatePct}%</div>
          <div className="text-[11px] text-slate-500 mt-0.5">По закрытым сделкам</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
          <div className="text-[11px] text-slate-400">Совокупный результат (PnL)</div>
          <div
            className={`text-2xl font-bold mt-1 ${
              summary.netPnlUsd >= 0 ? 'text-brand-green' : 'text-rose-400'
            }`}
          >
            {summary.netPnlUsd >= 0 ? '+' : ''}${summary.netPnlUsd.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Сумма всех записей</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
          <div className="text-[11px] text-slate-400">Средняя оценка дисциплины</div>
          <div className="text-2xl font-bold text-brand-cyan mt-1 flex items-center space-x-1">
            <Award className="w-5 h-5 text-brand-cyan" />
            <span>{summary.avgDisciplineScore} / 5.0</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Контроль эмоций и правил</div>
        </div>
      </div>

      {/* New Entry Form */}
      {isFormOpen && (
        <form
          onSubmit={handleAddTrade}
          className="bg-surface border border-brand-cyan/40 rounded-lg p-5 font-sans text-xs space-y-4 shadow-xl"
        >
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <span className="font-bold text-white tracking-wide">
              Новая запись в аналитический журнал
            </span>
            <span className="text-[11px] text-slate-500">Локальное хранилище журнала</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">Символ</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
                required
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Сторона</label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as any)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
              >
                <option value="LONG">ЛОНГ</option>
                <option value="SHORT">ШОРТ</option>
              </select>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Цена входа ($)</label>
              <input
                type="number"
                step="any"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
                required
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Цена выхода ($)</label>
              <input
                type="number"
                step="any"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
                required
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Объем ($)</label>
              <input
                type="number"
                value={sizeUsd}
                onChange={(e) => setSizeUsd(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
                required
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Дисциплина (1-5)</label>
              <select
                value={disciplineScore}
                onChange={(e) => setDisciplineScore(Number(e.target.value))}
                className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
              >
                <option value={5}>5 — Идеально по плану</option>
                <option value={4}>4 — Незначительное отклонение</option>
                <option value={3}>3 — Эмоциональный выход</option>
                <option value={2}>2 — FOMO / Нарушение риска</option>
                <option value={1}>1 — Грубое нарушение плана</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">Логика входа / Сетап</label>
              <textarea
                value={setupReason}
                onChange={(e) => setSetupReason(e.target.value)}
                placeholder="Почему был совершен вход? Подтверждающие индикаторы..."
                className="w-full bg-surface-elevated border border-surface-border rounded p-2 text-white h-20 text-[11px]"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Рефлексия и выводы</label>
              <textarea
                value={reflection}
                onChange={(e) => setReflection(e.target.value)}
                placeholder="Что можно было сделать лучше? Соблюден ли риск-менеджмент?"
                className="w-full bg-surface-elevated border border-surface-border rounded p-2 text-white h-20 text-[11px]"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-2 bg-brand-cyan hover:bg-sky-500 text-slate-950 font-bold rounded transition-colors"
          >
            Сохранить сделку в журнал
          </button>
        </form>
      )}

      {/* Entries List */}
      <div className="space-y-4">
        {entries.length === 0 && (
          <div data-qa="journal-empty" className="py-8 text-center text-slate-500 text-xs font-sans">
            Журнал пуст. Записи хранятся только в этом браузере (localStorage) и добавляются вручную.
          </div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="bg-surface border border-surface-border rounded-lg p-5 font-sans text-xs space-y-3 hover:border-slate-700 transition-all shadow-md"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-surface-border gap-2">
              <div className="flex items-center space-x-3">
                <span className="font-bold text-base text-white">{entry.symbol}</span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    entry.direction === 'LONG'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {sideLabel(entry.direction)}
                </span>
                <span className="text-slate-400 text-[11px]">
                  Вход: ${entry.entryPrice.toLocaleString()} → Выход: ${entry.exitPrice.toLocaleString()}
                </span>
              </div>

              <div className="flex items-center space-x-3">
                <div
                  className={`font-black text-sm ${
                    entry.pnlUsd >= 0 ? 'text-brand-green' : 'text-rose-400'
                  }`}
                >
                  {entry.pnlUsd >= 0 ? '+' : ''}${entry.pnlUsd.toFixed(2)} ({entry.pnlPct >= 0 ? '+' : ''}{entry.pnlPct.toFixed(2)}%)
                </div>

                <div className="flex items-center text-amber-400 text-xs">
                  {'★'.repeat(entry.disciplineScore)}
                  {'☆'.repeat(5 - entry.disciplineScore)}
                </div>

                <button
                  onClick={() => handleDelete(entry.id)}
                  className="text-slate-500 hover:text-rose-400 transition-colors p-1"
                  title="Удалить запись"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-sans">
              <div className="p-3 bg-surface-elevated/60 rounded border border-surface-border/50">
                <span className="text-slate-400 font-mono block mb-1">Причина входа (Сетап):</span>
                <p className="text-slate-300">{entry.setupReason}</p>
              </div>

              <div className="p-3 bg-surface-elevated/60 rounded border border-surface-border/50">
                <span className="text-slate-400 font-mono block mb-1">Рефлексия и выводы:</span>
                <p className="text-slate-300">{entry.reflection}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
