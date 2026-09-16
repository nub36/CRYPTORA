import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { useMarketData } from '@/context/MarketDataContext';
import { DEMO_ASSETS } from '@/services/data/DemoMarketDataProvider';
import {
  Search,
  Star,
  Bell,
  AlertTriangle,
  Menu,
  X,
  Compass,
  LineChart,
  Layers,
  Flame,
  Radio,
  Sliders,
  Cpu,
  BarChart3,
  Wrench,
  Grid3X3,
  Network,
  Grid,
  BookOpen,
  Calendar,
  PieChart,
  ChevronDown,
} from 'lucide-react';

interface SubNavItem {
  label: string;
  sublabel: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const Header: React.FC = () => {
  const {
    watchlist,
    alerts,
    openDemoModal,
    openWatchlist,
    openAlertsModal,
    dataMode,
    realtimeStatus,
    userPlan,
    openPlanModal,
  } = useMarketData();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<'analytics' | 'tools' | null>(null);

  const analyticsDropdownRef = useRef<HTMLDivElement>(null);
  const toolsDropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Close dropdowns on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        analyticsDropdownRef.current &&
        !analyticsDropdownRef.current.contains(target) &&
        toolsDropdownRef.current &&
        !toolsDropdownRef.current.contains(target)
      ) {
        setActiveDropdown(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveDropdown(null);
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Close dropdown when route changes
  useEffect(() => {
    setActiveDropdown(null);
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const searchResults = searchQuery.trim()
    ? DEMO_ASSETS.filter(
        (a) =>
          a.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.name.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 6)
    : [];

  const handleSelectAsset = (symbol: string) => {
    setSearchQuery('');
    setIsSearchFocused(false);
    navigate(`/coin/${symbol}`);
  };

  // Primary visible navigation items (no wrapping)
  const primaryNavItems = [
    { label: 'Обзор', path: '/', icon: Compass },
    { label: 'Рынок', path: '/market', icon: LineChart },
    { label: 'Фьючерсы', path: '/futures', icon: Layers },
    { label: 'Ликвидации', path: '/liquidations', icon: Flame },
    { label: 'Скринер', path: '/screener', icon: Sliders },
    { label: 'Радар', path: '/radar', icon: Radio },
  ];

  // Grouped Analytics items for Dropdown 1
  const analyticsItems: SubNavItem[] = [
    { label: 'Карта рынка', sublabel: 'Визуализация секторов и доходностей', path: '/heatmaps', icon: Grid3X3 },
    { label: 'Корреляции', sublabel: 'Матрица Пирсона и Beta к BTC', path: '/correlations', icon: Grid },
    { label: 'Он-чейн', sublabel: 'MVRV Z-Score, NUPL и биржевые потоки', path: '/onchain', icon: Network },
    { label: 'Экосистемы', sublabel: 'DeFi TVL, комиссии и TPS сетей', path: '/ecosystem', icon: Layers },
    { label: 'Календарь', sublabel: 'FOMC, отчеты CPI и cliff-разблокировки', path: '/calendar', icon: Calendar },
  ];

  // Grouped Tools items for Dropdown 2
  const toolsItems: SubNavItem[] = [
    { label: 'Инструменты', sublabel: 'Калькуляторы размера позиции и PnL', path: '/tools', icon: Wrench },
    { label: 'Портфель', sublabel: 'Value at Risk (VaR) и стресс-тесты', path: '/portfolio', icon: PieChart },
    { label: 'Журнал', sublabel: 'Ручной дневник сделок и самодисциплина', path: '/journal', icon: BookOpen },
    { label: 'Стратегии', sublabel: 'Лаборатория формализованных правил', path: '/strategies', icon: Cpu },
    { label: 'Сигналы', sublabel: 'Неизменяемый криптографический аудит', path: '/signals', icon: BarChart3 },
  ];

  const isAnalyticsActive = analyticsItems.some((item) => location.pathname === item.path);
  const isToolsActive = toolsItems.some((item) => location.pathname === item.path);

  return (
    <header className="sticky top-0 z-40 bg-[#070b14]/90 backdrop-blur-xl border-b border-white/[0.08] shadow-panel">
      <div className="max-w-[1920px] mx-auto px-3 sm:px-4 flex items-center justify-between h-14">
        {/* Brand & Wordmark */}
        <div className="flex items-center space-x-3 flex-shrink-0">
          <Link
            to="/"
            className="flex items-center space-x-2.5 group focus:outline-none"
            aria-label="CRYPTORA Главная"
          >
            {/* Technological Brand Mark */}
            <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 via-blue-500 to-violet-600 p-[1px] shadow-sm shadow-cyan-500/20 group-hover:shadow-cyan-400/30 transition-all duration-300">
              <div className="w-full h-full bg-[#0a0f1d] rounded-[7px] flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/15 via-transparent to-violet-500/10 opacity-70 group-hover:opacity-100 transition-opacity" />
                <svg
                  className="w-4 h-4 text-cyan-400 group-hover:text-white transition-colors relative z-10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </div>
            </div>

            <div className="flex flex-col">
              <div className="flex items-center space-x-1.5">
                <span className="font-mono font-black text-sm sm:text-base tracking-[0.16em] text-white group-hover:text-cyan-300 transition-colors">
                  CRYPTORA
                </span>
                <span className="text-[9px] bg-cyan-950/80 text-cyan-400 border border-cyan-500/30 px-1.5 py-0.2 rounded font-mono font-semibold tracking-normal">
                  v0.8
                </span>
              </div>
              <span className="hidden 2xl:block text-[10px] text-slate-400 font-sans tracking-tight -mt-0.5 whitespace-nowrap">
                Рынок. Данные. Решения.
              </span>
            </div>
          </Link>

          {/* Plan Tier Badge */}
          <button
            onClick={openPlanModal}
            className="hidden xl:inline-flex items-center space-x-1 text-[10px] font-mono px-2 py-0.5 rounded bg-violet-950/40 text-violet-300 border border-violet-500/30 font-bold hover:bg-violet-900/40 hover:border-violet-400/50 transition-all cursor-pointer whitespace-nowrap"
            title="Тарифные планы и права доступа"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400"></span>
            <span>{userPlan === 'FREE' ? 'FREE' : userPlan === 'PRO' ? 'PRO' : 'ENTERPRISE'}</span>
          </button>
        </div>

        {/* Desktop Primary Navigation Bar (>= 1024px) */}
        <nav
          className="hidden lg:flex items-center space-x-1 font-medium text-xs whitespace-nowrap"
          aria-label="Главная навигация"
        >
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `relative flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md transition-all duration-150 whitespace-nowrap ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-300 font-semibold border border-cyan-500/35 shadow-sm shadow-cyan-950/40'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.05] border border-transparent'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                    {isActive && (
                      <span className="absolute -bottom-1 left-2.5 right-2.5 h-[2px] bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full" />
                    )}
                  </>
                )}
              </NavLink>
            );
          })}

          {/* Grouped Dropdown 1: Аналитика ▾ */}
          <div className="relative" ref={analyticsDropdownRef}>
            <button
              onClick={() => setActiveDropdown(activeDropdown === 'analytics' ? null : 'analytics')}
              aria-expanded={activeDropdown === 'analytics'}
              aria-haspopup="true"
              className={`relative flex items-center space-x-1 px-2.5 py-1.5 rounded-md transition-all duration-150 whitespace-nowrap ${
                isAnalyticsActive
                  ? 'bg-violet-500/15 text-violet-300 font-semibold border border-violet-500/35 shadow-sm shadow-violet-950/40'
                  : activeDropdown === 'analytics'
                  ? 'bg-white/[0.08] text-white border border-white/20'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.05] border border-transparent'
              }`}
            >
              <Grid className={`w-3.5 h-3.5 ${isAnalyticsActive ? 'text-violet-400' : 'text-slate-400'}`} />
              <span>Аналитика</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-200 ${
                  activeDropdown === 'analytics' ? 'rotate-180 text-violet-400' : 'text-slate-400'
                }`}
              />
              {isAnalyticsActive && (
                <span className="absolute -bottom-1 left-2.5 right-2.5 h-[2px] bg-gradient-to-r from-violet-400 to-cyan-400 rounded-full" />
              )}
            </button>

            {activeDropdown === 'analytics' && (
              <div
                role="menu"
                className="absolute left-0 mt-1.5 w-72 bg-[#0a0f1d]/95 backdrop-blur-2xl border border-white/[0.12] rounded-lg shadow-2xl shadow-black/80 py-1.5 z-50 text-xs font-sans divide-y divide-white/[0.05]"
              >
                <div className="px-3 py-1 text-[10px] uppercase font-mono tracking-wider text-slate-400 font-bold">
                  Аналитические модули
                </div>
                <div className="py-1">
                  {analyticsItems.map((sub) => {
                    const SubIcon = sub.icon;
                    const isSubActive = location.pathname === sub.path;
                    return (
                      <NavLink
                        key={sub.path}
                        to={sub.path}
                        role="menuitem"
                        className={`flex items-start space-x-2.5 px-3 py-2 transition-colors ${
                          isSubActive
                            ? 'bg-cyan-500/15 text-cyan-300'
                            : 'text-slate-200 hover:bg-white/[0.06] hover:text-white'
                        }`}
                      >
                        <SubIcon
                          className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                            isSubActive ? 'text-cyan-400' : 'text-slate-400'
                          }`}
                        />
                        <div className="flex flex-col">
                          <span className="font-medium whitespace-nowrap">{sub.label}</span>
                          <span className="text-[10px] text-slate-400 leading-tight">
                            {sub.sublabel}
                          </span>
                        </div>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Grouped Dropdown 2: Инструменты ▾ */}
          <div className="relative" ref={toolsDropdownRef}>
            <button
              onClick={() => setActiveDropdown(activeDropdown === 'tools' ? null : 'tools')}
              aria-expanded={activeDropdown === 'tools'}
              aria-haspopup="true"
              className={`relative flex items-center space-x-1 px-2.5 py-1.5 rounded-md transition-all duration-150 whitespace-nowrap ${
                isToolsActive
                  ? 'bg-blue-500/15 text-blue-300 font-semibold border border-blue-500/35 shadow-sm shadow-blue-950/40'
                  : activeDropdown === 'tools'
                  ? 'bg-white/[0.08] text-white border border-white/20'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.05] border border-transparent'
              }`}
            >
              <Wrench className={`w-3.5 h-3.5 ${isToolsActive ? 'text-blue-400' : 'text-slate-400'}`} />
              <span>Инструменты</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-200 ${
                  activeDropdown === 'tools' ? 'rotate-180 text-blue-400' : 'text-slate-400'
                }`}
              />
              {isToolsActive && (
                <span className="absolute -bottom-1 left-2.5 right-2.5 h-[2px] bg-gradient-to-r from-blue-400 to-cyan-400 rounded-full" />
              )}
            </button>

            {activeDropdown === 'tools' && (
              <div
                role="menu"
                className="absolute left-0 mt-1.5 w-72 bg-[#0a0f1d]/95 backdrop-blur-2xl border border-white/[0.12] rounded-lg shadow-2xl shadow-black/80 py-1.5 z-50 text-xs font-sans divide-y divide-white/[0.05]"
              >
                <div className="px-3 py-1 text-[10px] uppercase font-mono tracking-wider text-slate-400 font-bold">
                  Инструменты терминала
                </div>
                <div className="py-1">
                  {toolsItems.map((sub) => {
                    const SubIcon = sub.icon;
                    const isSubActive = location.pathname === sub.path;
                    return (
                      <NavLink
                        key={sub.path}
                        to={sub.path}
                        role="menuitem"
                        className={`flex items-start space-x-2.5 px-3 py-2 transition-colors ${
                          isSubActive
                            ? 'bg-blue-500/15 text-blue-300'
                            : 'text-slate-200 hover:bg-white/[0.06] hover:text-white'
                        }`}
                      >
                        <SubIcon
                          className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                            isSubActive ? 'text-blue-400' : 'text-slate-400'
                          }`}
                        />
                        <div className="flex flex-col">
                          <span className="font-medium whitespace-nowrap">{sub.label}</span>
                          <span className="text-[10px] text-slate-400 leading-tight">
                            {sub.sublabel}
                          </span>
                        </div>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </nav>

        {/* Right Section: Mode Chip, Search, Watchlist, Alerts */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Refined Mode Chip (DEMO vs LIVE) */}
          {dataMode === 'live' ? (
            <button
              onClick={openDemoModal}
              className="hidden sm:inline-flex items-center space-x-1.5 text-[11px] font-mono px-2.5 py-1 rounded-md bg-emerald-950/40 text-emerald-400 border border-emerald-500/35 hover:bg-emerald-900/40 transition-all cursor-pointer whitespace-nowrap"
              title={`Режим LIVE Spot: Binance/KuCoin. Статус WebSocket: ${realtimeStatus}`}
            >
              <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
              <span className="font-bold">LIVE SPOT</span>
              <span
                className={`text-[9px] px-1 py-0.2 rounded font-mono ml-0.5 font-bold ${
                  realtimeStatus === 'connected'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {realtimeStatus === 'connected' ? 'WS ●' : 'WS ⟳'}
              </span>
            </button>
          ) : (
            <button
              onClick={openDemoModal}
              className="hidden sm:inline-flex items-center space-x-1.5 text-[11px] font-mono px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition-all cursor-pointer whitespace-nowrap"
              title="Нажмите для просмотра информации о демо-режиме"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold">ДЕМО-ДАННЫЕ</span>
            </button>
          )}

          {/* Quick Search */}
          <div className="relative">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Поиск монеты..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                className="w-28 sm:w-44 lg:w-40 xl:w-52 pl-8 pr-2.5 py-1 bg-[#0e1526]/80 border border-white/[0.08] rounded-md text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400/60 focus:bg-[#111a30] transition-all font-mono"
              />
            </div>

            {/* Autocomplete Dropdown */}
            {isSearchFocused && searchResults.length > 0 && (
              <div className="absolute right-0 mt-1.5 w-64 bg-[#0a0f1d]/95 backdrop-blur-2xl border border-white/[0.12] rounded-lg shadow-2xl py-1 z-50">
                <div className="px-3 py-1 text-[10px] uppercase font-mono text-slate-400 font-bold border-b border-white/[0.06]">
                  Результаты поиска
                </div>
                {searchResults.map((asset) => (
                  <button
                    key={asset.id}
                    onMouseDown={() => handleSelectAsset(asset.symbol)}
                    className="w-full px-3 py-2 text-left hover:bg-white/[0.06] flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold font-mono text-white mr-1.5">
                        {asset.symbol}
                      </span>
                      <span className="text-slate-400 text-[11px]">{asset.name}</span>
                    </div>
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        asset.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {asset.change24h >= 0 ? '+' : ''}
                      {asset.change24h}%
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Watchlist Drawer Button */}
          <button
            onClick={openWatchlist}
            className="relative p-2 rounded-md hover:bg-white/[0.06] text-slate-300 hover:text-white transition-colors border border-transparent hover:border-white/[0.08]"
            title="Открыть Watchlist"
            aria-label="Открыть Watchlist"
          >
            <Star className="w-4 h-4 text-amber-400" />
            {watchlist.length > 0 && (
              <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-amber-500 text-[9px] font-bold text-slate-950 flex items-center justify-center font-mono">
                {watchlist.length}
              </span>
            )}
          </button>

          {/* Alerts Modal Button */}
          <button
            onClick={openAlertsModal}
            className="relative p-2 rounded-md hover:bg-white/[0.06] text-slate-300 hover:text-white transition-colors border border-transparent hover:border-white/[0.08]"
            title="Открыть алерты"
            aria-label="Открыть алерты"
          >
            <Bell className="w-4 h-4 text-cyan-400" />
            {alerts.length > 0 && (
              <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-cyan-400 text-[9px] font-bold text-slate-950 flex items-center justify-center font-mono">
                {alerts.length}
              </span>
            )}
          </button>

          {/* Mobile Menu Hamburger (< 1024px) */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-md hover:bg-white/[0.06] text-slate-300 hover:text-white transition-colors"
            aria-label="Меню"
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay & Drawer (< 1024px) */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-[#070b14]/98 backdrop-blur-2xl border-b border-white/[0.1] px-4 py-4 space-y-3 max-h-[85vh] overflow-y-auto">
          {/* Mobile Top Bar */}
          <div className="pb-2 border-b border-white/[0.08] flex items-center justify-between">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                openDemoModal();
              }}
              className="text-xs font-mono text-amber-300 flex items-center space-x-1.5 bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/30"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>ДЕМОНСТРАЦИОННЫЙ РЕЖИМ</span>
            </button>
            <span className="text-[10px] font-mono text-slate-400">CRYPTORA v0.8</span>
          </div>

          {/* Primary Navigation Grid */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-1.5">
              Основные разделы
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {primaryNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center space-x-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                          : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 text-cyan-400 opacity-90" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>

          {/* Analytics Group */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-1.5">
              Аналитика
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {analyticsItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center space-x-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-violet-500/20 text-violet-300 font-bold border border-violet-500/40'
                          : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 text-violet-400 opacity-90" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>

          {/* Tools Group */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-1.5">
              Инструменты
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {toolsItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center space-x-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-500/20 text-blue-300 font-bold border border-blue-500/40'
                          : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 text-blue-400 opacity-90" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
