import React, { useState } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { Bell, X, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';

export const AlertsModal: React.FC = () => {
  const { isAlertsModalOpen, closeAlertsModal, alerts, addAlert, removeAlert } = useMarketData();
  const [symbol, setSymbol] = useState('BTC');
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW' | 'OI_SPIKE' | 'FUNDING_EXTREME'>('ABOVE');
  const [targetValue, setTargetValue] = useState('67000');
  const [createdNotice, setCreatedNotice] = useState(false);

  if (!isAlertsModalOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetValue) return;

    addAlert({
      symbol,
      condition,
      targetValue,
    });

    setCreatedNotice(true);
    setTimeout(() => setCreatedNotice(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-surface border border-surface-border rounded-lg shadow-2xl p-6 text-slate-200">
        <button
          onClick={closeAlertsModal}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2 rounded-full bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Система алертов (Alerts Preview)
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Локальная демонстрация триггеров терминала
            </p>
          </div>
        </div>

        {createdNotice && (
          <div className="mb-4 p-2.5 bg-emerald-950/70 border border-emerald-500/40 rounded flex items-center space-x-2 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>Демо-алерт успешно добавлен в локальную очередь!</span>
          </div>
        )}

        {/* Create Form */}
        <form onSubmit={handleSubmit} className="p-3.5 bg-surface-elevated/70 rounded-md border border-surface-border mb-4 space-y-3">
          <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Создать новое условие
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-400 font-mono block mb-1">Инструмент</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-surface border border-surface-border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-brand-cyan font-mono"
              >
                {CANONICAL_ASSETS.map((a) => (
                  <option key={a.symbol} value={a.symbol}>
                    {a.symbol} ({a.name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 font-mono block mb-1">Триггер</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as any)}
                className="w-full bg-surface border border-surface-border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-brand-cyan font-mono"
              >
                <option value="ABOVE">Цена выше (&gt;=)</option>
                <option value="BELOW">Цена ниже (&lt;=)</option>
                <option value="OI_SPIKE">Всплеск OI (&gt; 5%)</option>
                <option value="FUNDING_EXTREME">Фандинг экстремум</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 font-mono block mb-1">
              Целевое значение / порог
            </label>
            <input
              type="text"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              placeholder="e.g. 66500"
              className="w-full bg-surface border border-surface-border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-brand-cyan font-mono"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2 bg-brand-cyan hover:bg-sky-500 text-slate-950 font-semibold text-xs rounded flex items-center justify-center space-x-1 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Добавить алерт</span>
          </button>
        </form>

        {/* Existing Alerts List */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Активные демо-алерты ({alerts.length})</span>
            <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
              Demo Queue
            </span>
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {alerts.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-xs">
                Нет активных алертов.
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between p-2 rounded bg-surface border border-surface-border text-xs font-mono"
                >
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white">{alert.symbol}</span>
                    <span className="text-slate-400 text-[11px]">
                      {alert.condition === 'ABOVE' && '>= '}
                      {alert.condition === 'BELOW' && '<= '}
                      {alert.condition === 'OI_SPIKE' && 'OI Surge '}
                      {alert.condition === 'FUNDING_EXTREME' && 'Funding '}
                      {alert.targetValue}
                    </span>
                  </div>
                  <button
                    onClick={() => removeAlert(alert.id)}
                    className="text-slate-500 hover:text-rose-400 transition-colors p-1"
                    title="Удалить"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-surface-border text-right">
          <button
            onClick={closeAlertsModal}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
