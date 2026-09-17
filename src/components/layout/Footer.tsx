import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useMarketData } from '@/context/MarketDataContext';

export const Footer: React.FC = () => {
  const { dataMode } = useMarketData();
  const [utcNow, setUtcNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setUtcNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const utcClock = utcNow.toISOString().slice(11, 19);


  return (
    <footer className="mt-6 border-t border-white/[0.08] bg-[#070b14]/90 px-4 py-6 font-sans text-xs text-slate-400 backdrop-blur-md">
      <div className="mx-auto max-w-[1920px] space-y-5">
        {/* Top Disclaimer Banner */}
        <div className="p-3.5 bg-amber-500/[0.06] border border-amber-500/25 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center space-x-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <span className="text-slate-300 text-xs">
              <strong className="text-amber-300">Отказ от ответственности (Этап 1-2):</strong>{' '}
              CRYPTORA не является биржей или брокером. Мы не принимаем клиентские средства, не управляем
              активами и не запрашиваем торговые ключи API. Все значения поступают из фактических источников
              и могут быть неполными или временно недоступными.
            </span>
          </div>
        </div>

        {/* Footer Navigation & Columns */}
        <div className="grid grid-cols-2 gap-6 border-t border-white/[0.05] pt-4 text-xs md:grid-cols-4">
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
                <Link to="/" className="hover:text-cyan-400 transition-colors">Обзор рынка</Link>
              </li>
              <li>
                <Link to="/market" className="hover:text-cyan-400 transition-colors">Таблица активов</Link>
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
                <Link to="/radar" className="hover:text-cyan-400 transition-colors">Рыночный радар</Link>
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
                <Link to="/strategies" className="hover:text-cyan-400 transition-colors">Лаборатория стратегий (превью)</Link>
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
            © 2026 CRYPTORA Terminal. Все права защищены. Рабочая версия v0.8.17.
          </div>
          <div className="mt-2 sm:mt-0 flex items-center space-x-3">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>{dataMode === 'live' ? 'Слой данных: LIVE (Binance / KuCoin)' : 'Слой данных: QA-датасет'}</span>
            <span>•</span>
            <span>UTC {utcClock}</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
