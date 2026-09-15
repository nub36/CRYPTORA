import React from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { AlertTriangle, ShieldCheck, X, Layers, ExternalLink, Radio } from 'lucide-react';
import { Link } from 'react-router-dom';

export const DemoModal: React.FC = () => {
  const { isDemoModalOpen, closeDemoModal, dataMode, setDataMode } = useMarketData();

  if (!isDemoModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-xl bg-surface border border-surface-border rounded-lg shadow-2xl p-6 text-slate-200">
        <button
          onClick={closeDemoModal}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">
              Статус данных: Демонстрационный режим
            </h3>
            <p className="text-xs text-amber-400/90 font-mono">
              Этап 1-2: Visual Foundation & Spot Market Data (Binance & KuCoin)
            </p>
          </div>
        </div>

        {/* Data Mode Switcher */}
        <div className="bg-surface-elevated border border-surface-border rounded p-3 mb-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-white block">Режим источника данных:</span>
            <span className="text-[11px] text-slate-400 font-mono">
              {dataMode === 'live' ? 'LIVE (Binance Primary / KuCoin Fallback)' : 'DEMO (Детерминированный датасет)'}
            </span>
          </div>
          <div className="flex items-center space-x-1.5 bg-surface border border-surface-border rounded p-0.5">
            <button
              onClick={() => setDataMode('demo')}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                dataMode === 'demo'
                  ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              DEMO
            </button>
            <button
              onClick={() => setDataMode('live')}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors flex items-center space-x-1 ${
                dataMode === 'live'
                  ? 'bg-brand-green/20 text-brand-green font-bold border border-brand-green/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Radio className="w-3 h-3" />
              <span>LIVE</span>
            </button>
          </div>
        </div>

        <div className="space-y-3 text-sm text-slate-300 leading-relaxed border-t border-b border-surface-border py-4 my-4">
          <div className="flex items-start space-x-2">
            <ShieldCheck className="w-4 h-4 text-brand-green mt-0.5 flex-shrink-0" />
            <p>
              <strong className="text-white">Контролируемый детерминированный датасет:</strong>{' '}
              Все котировки, объемы, свечи, открытый интерес и события радара зафиксированы в типизированном контракте. Мы не генерируем случайные скачущие числа через <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-300 font-mono text-xs">Math.random()</code>.
            </p>
          </div>

          <div className="flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <p>
              <strong className="text-white">CRYPTORA — только аналитика (No Trade Execution):</strong> Терминал не является биржей или брокером, не исполняет сделки, не выставляет ордера и не принимает торговые API-ключи.
            </p>
          </div>

          <div className="flex items-start space-x-2">
            <Layers className="w-4 h-4 text-brand-cyan mt-0.5 flex-shrink-0" />
            <p>
              <strong className="text-white">Публичные спотовые данные (Этап 2):</strong> Подключены публичные REST API Binance (основной) и KuCoin (резервный) для 25 канонических криптоактивов с отслеживанием источника (provenance).
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <Link
            to="/market"
            onClick={closeDemoModal}
            className="text-xs text-brand-sky hover:underline flex items-center space-x-1 font-mono"
          >
            <span>Перейти к таблице активов</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>

          <button
            onClick={closeDemoModal}
            className="px-4 py-2 bg-brand-cyan hover:bg-sky-500 text-slate-950 font-semibold text-xs rounded transition-colors"
          >
            Понятно, продолжить
          </button>
        </div>
      </div>
    </div>
  );
};
