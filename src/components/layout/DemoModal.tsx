import React from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { AlertTriangle, ShieldCheck, X, Layers, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

export const DemoModal: React.FC = () => {
  const { isDemoModalOpen, closeDemoModal } = useMarketData();

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
              Этап 1: Visual Foundation & Typed Demo Data Layer
            </p>
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
              <strong className="text-white">Не является финансовым советом:</strong> Цифры предназначены для визуальной оценки плотности терминала, UX, навигации, фильтрации и калькуляторов. Не используйте их для реальных торговых сделок.
            </p>
          </div>

          <div className="flex items-start space-x-2">
            <Layers className="w-4 h-4 text-brand-cyan mt-0.5 flex-shrink-0" />
            <p>
              <strong className="text-white">Архитектурная готовность к Этапу 2+:</strong> Все страницы построены поверх интерфейса <code className="bg-slate-800 px-1 py-0.5 rounded text-brand-cyan font-mono text-xs">MarketDataProvider</code>. На следующем этапе локальный провайдер будет заменен на живые биржевые сокеты (Binance, Bybit) без переписывания интерфейса.
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
