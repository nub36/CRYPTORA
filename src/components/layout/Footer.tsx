import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import { useMarketData } from '@/context/MarketDataContext';

export const Footer: React.FC = () => {
  const { openDemoModal } = useMarketData();

  return (
    <footer className="mt-14 bg-[#070b14]/90 border-t border-white/[0.08] text-xs text-slate-400 py-8 px-4 font-sans backdrop-blur-md">
      <div className="max-w-[1920px] mx-auto space-y-6">
        {/* Top Disclaimer Banner */}
        <div className="p-3.5 bg-amber-500/[0.06] border border-amber-500/25 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center space-x-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <span className="text-slate-300 text-xs">
              <strong className="text-amber-300">Отказ от ответственности (Этап 1-2):</strong>{' '}
              CRYPTORA не является биржей или брокером. Мы не принимаем клиентские средства, не управляем активами и не запрашиваем торговые ключи API. Все цифры в демонстрационном режиме зафиксированы для оценки интерфейса.
            </span>
          </div>

          <button
            onClick={openDemoModal}
            className="text-xs font-mono text-amber-300 hover:underline flex items-center space-x-1 flex-shrink-0 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/30"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Подробнее о Demo-режиме</span>
          </button>
        </div>

        {/* Footer Navigation & Columns */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-4 border-t border-white/[0.05] text-xs">
          <div>
            <div className="font-bold text-white font-mono tracking-wider mb-2 flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              <span>CRYPTORA</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Crypto Market Intelligence Terminal. Профессиональная платформа наблюдения за рыночной структурой, открытым интересом, ставками фандинга и аномалиями.
            </p>
            <div className="mt-3 text-[11px] font-mono text-slate-400">
              «Рынок. Данные. Решения.»
            </div>
          </div>

          <div>
            <div className="font-semibold text-slate-200 mb-2 font-mono uppercase text-[11px]">
              Разделы терминала
            </div>
            <ul className="space-y-1.5 text-slate-400">
              <li>
                <Link to="/" className="hover:text-cyan-400 transition-colors">Обзор рынка (Overview)</Link>
              </li>
              <li>
                <Link to="/market" className="hover:text-cyan-400 transition-colors">Таблица активов (Market)</Link>
              </li>
              <li>
                <Link to="/futures" className="hover:text-cyan-400 transition-colors">Деривативы и фьючерсы</Link>
              </li>
              <li>
                <Link to="/liquidations" className="hover:text-cyan-400 transition-colors">Аналитика ликвидаций</Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-slate-200 mb-2 font-mono uppercase text-[11px]">
              Инструменты и аналитика
            </div>
            <ul className="space-y-1.5 text-slate-400">
              <li>
                <Link to="/screener" className="hover:text-cyan-400 transition-colors">Крипто-скринер</Link>
              </li>
              <li>
                <Link to="/radar" className="hover:text-cyan-400 transition-colors">Market Radar</Link>
              </li>
              <li>
                <Link to="/heatmaps" className="hover:text-cyan-400 transition-colors">Тепловая карта рынка</Link>
              </li>
              <li>
                <Link to="/portfolio" className="hover:text-cyan-400 transition-colors">Портфельный риск & VaR</Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-slate-200 mb-2 font-mono uppercase text-[11px]">
              Архитектура и развитие
            </div>
            <ul className="space-y-1.5 text-slate-400">
              <li>
                <Link to="/strategies" className="hover:text-cyan-400 transition-colors">Strategy Lab (Превью)</Link>
              </li>
              <li>
                <Link to="/signals" className="hover:text-cyan-400 transition-colors">Аудит сетапов</Link>
              </li>
              <li>
                <Link to="/correlations" className="hover:text-cyan-400 transition-colors">Матрица корреляций</Link>
              </li>
              <li>
                <Link to="/onchain" className="hover:text-cyan-400 transition-colors">Он-чейн метрики</Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-4 border-t border-white/[0.05] flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-400 font-mono">
          <div>
            © 2026 CRYPTORA Terminal. Все права защищены. Рабочая версия v0.8.0.
          </div>
          <div className="mt-2 sm:mt-0 flex items-center space-x-3">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Слой данных: Active Market Data Gateway</span>
            <span>•</span>
            <span>UTC 12:00:00</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
