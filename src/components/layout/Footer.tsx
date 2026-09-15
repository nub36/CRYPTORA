import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import { useMarketData } from '@/context/MarketDataContext';

export const Footer: React.FC = () => {
  const { openDemoModal } = useMarketData();

  return (
    <footer className="mt-12 bg-surface/80 border-t border-surface-border text-xs text-slate-400 py-8 px-4 font-sans">
      <div className="max-w-[1920px] mx-auto space-y-6">
        {/* Top Disclaimer Banner */}
        <div className="p-3.5 bg-amber-500/5 border border-amber-500/20 rounded-md flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <span className="text-slate-300 text-xs">
              <strong className="text-amber-300">Отказ от ответственности (Этап 1):</strong>{' '}
              CRYPTORA не является биржей или брокером. Мы не принимаем клиентские средства, не управляем активами и не запрашиваем торговые ключи API. Все цифры в интерфейсе строго демонстрационные.
            </span>
          </div>

          <button
            onClick={openDemoModal}
            className="text-xs font-mono text-amber-400 hover:underline flex items-center space-x-1 flex-shrink-0"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Подробнее о Demo-режиме</span>
          </button>
        </div>

        {/* Footer Navigation & Columns */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-4 border-t border-surface-border/50 text-xs">
          <div>
            <div className="font-bold text-white font-mono tracking-wider mb-2">CRYPTORA</div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Crypto Market Intelligence Terminal. Профессиональная платформа наблюдения за рыночной структурой, открытым интересом, ставками фандинга и аномалиями.
            </p>
            <div className="mt-3 text-[11px] font-mono text-slate-500">
              «Рынок. Данные. Решения.»
            </div>
          </div>

          <div>
            <div className="font-semibold text-slate-200 mb-2 font-mono uppercase text-[11px]">
              Разделы терминала
            </div>
            <ul className="space-y-1.5 text-slate-400">
              <li>
                <Link to="/" className="hover:text-brand-cyan transition-colors">Обзор рынка (Overview)</Link>
              </li>
              <li>
                <Link to="/market" className="hover:text-brand-cyan transition-colors">Таблица активов (Market)</Link>
              </li>
              <li>
                <Link to="/futures" className="hover:text-brand-cyan transition-colors">Деривативы и фьючерсы</Link>
              </li>
              <li>
                <Link to="/liquidations" className="hover:text-brand-cyan transition-colors">Аналитика ликвидаций</Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-slate-200 mb-2 font-mono uppercase text-[11px]">
              Инструменты и аналитика
            </div>
            <ul className="space-y-1.5 text-slate-400">
              <li>
                <Link to="/screener" className="hover:text-brand-cyan transition-colors">Крипто-скринер</Link>
              </li>
              <li>
                <Link to="/radar" className="hover:text-brand-cyan transition-colors">Market Radar</Link>
              </li>
              <li>
                <Link to="/heatmaps" className="hover:text-brand-cyan transition-colors">Тепловая карта рынка</Link>
              </li>
              <li>
                <Link to="/tools" className="hover:text-brand-cyan transition-colors">Калькуляторы риска</Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-slate-200 mb-2 font-mono uppercase text-[11px]">
              Архитектура и развитие
            </div>
            <ul className="space-y-1.5 text-slate-400">
              <li>
                <Link to="/strategies" className="hover:text-brand-cyan transition-colors">Strategy Lab (Превью)</Link>
              </li>
              <li>
                <Link to="/signals" className="hover:text-brand-cyan transition-colors">Методология сигналов</Link>
              </li>
              <li>
                <span className="text-slate-500 cursor-not-allowed">AI Analyst (Этап 15)</span>
              </li>
              <li>
                <span className="text-slate-500 cursor-not-allowed">API Доступ (Этап 4+)</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-4 border-t border-surface-border/50 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 font-mono">
          <div>
            © 2026 CRYPTORA Terminal. Все права защищены. Рабочая версия v0.1.0.
          </div>
          <div className="mt-2 sm:mt-0 flex items-center space-x-3">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Слой данных: Demo Data Engine v0.1</span>
            <span>•</span>
            <span>UTC 12:00:00</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
