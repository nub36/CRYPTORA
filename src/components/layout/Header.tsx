import React, { useState } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
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
} from 'lucide-react';

export const Header: React.FC = () => {
  const { watchlist, alerts, openDemoModal, openWatchlist, openAlertsModal, dataMode, realtimeStatus } = useMarketData();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

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

  const navItems = [
    { label: 'Обзор', path: '/', icon: Compass },
    { label: 'Рынок', path: '/market', icon: LineChart },
    { label: 'Фьючерсы', path: '/futures', icon: Layers },
    { label: 'Ликвидации', path: '/liquidations', icon: Flame },
    { label: 'Скринер', path: '/screener', icon: Sliders },
    { label: 'Радар', path: '/radar', icon: Radio },
    { label: 'Карта рынка', path: '/heatmaps', icon: Grid3X3 },
    { label: 'Стратегии', path: '/strategies', icon: Cpu },
    { label: 'Сигналы', path: '/signals', icon: BarChart3 },
    { label: 'Инструменты', path: '/tools', icon: Wrench },
  ];

  return (
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur-md border-b border-surface-border">
      <div className="max-w-[1920px] mx-auto px-3 sm:px-4 flex items-center justify-between h-14">
        {/* Brand & Logo */}
        <div className="flex items-center space-x-3">
          <Link to="/" className="flex items-center space-x-2 group">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-brand-cyan to-brand-purple p-0.5 flex items-center justify-center shadow-lg shadow-sky-500/10">
              <div className="w-full h-full bg-surface rounded flex items-center justify-center">
                <span className="font-mono font-black text-sm text-brand-cyan group-hover:text-white transition-colors">
                  CR
                </span>
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="font-extrabold text-base tracking-wider text-white font-mono">
                  CRYPTORA
                </span>
                <span className="text-[10px] bg-brand-cyan/15 text-brand-cyan px-1.5 py-0.2 rounded font-mono font-semibold">
                  v0.1
                </span>
              </div>
              <span className="hidden xl:block text-[10px] text-slate-400 -mt-0.5 tracking-tight font-sans">
                Рынок. Данные. Решения.
              </span>
            </div>
          </Link>

          {/* Demo/Live Badge Trigger */}
          {dataMode === 'live' ? (
            <button
              onClick={openDemoModal}
              className="hidden sm:flex items-center space-x-1 text-[11px] font-mono px-2 py-0.5 rounded bg-brand-green/10 text-brand-green border border-brand-green/30 hover:bg-brand-green/20 transition-all cursor-pointer"
              title={`Режим LIVE Spot: Binance/KuCoin. Статус WebSocket: ${realtimeStatus}`}
            >
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              <span className="font-semibold">LIVE SPOT</span>
              <span
                className={`text-[9px] px-1 py-0.2 rounded font-sans ml-1 ${
                  realtimeStatus === 'connected'
                    ? 'bg-brand-green/20 text-brand-green'
                    : realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                {realtimeStatus === 'connected'
                  ? 'WS ●'
                  : realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting'
                  ? 'WS ⟳'
                  : 'WS ○'}
              </span>
            </button>
          ) : (
            <button
              onClick={openDemoModal}
              className="hidden sm:flex items-center space-x-1 text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-all cursor-pointer"
              title="Нажмите для просмотра информации о демо-режиме"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="font-semibold">ДЕМО-ДАННЫЕ</span>
            </button>
          )}
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center space-x-1 font-medium text-xs">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center space-x-1 px-2.5 py-1.5 rounded transition-all ${
                    isActive
                      ? 'bg-brand-cyan/15 text-brand-cyan font-semibold border border-brand-cyan/30'
                      : 'text-slate-300 hover:text-white hover:bg-surface-hover'
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5 opacity-80" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Right Section: Search, Watchlist, Alerts */}
        <div className="flex items-center space-x-2">
          {/* Quick Search */}
          <div className="relative">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Поиск монеты (BTC, SOL)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                className="w-36 sm:w-52 pl-8 pr-3 py-1 bg-surface-elevated border border-surface-border rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan transition-all font-mono"
              />
            </div>

            {/* Autocomplete Dropdown */}
            {isSearchFocused && searchResults.length > 0 && (
              <div className="absolute right-0 mt-1 w-64 bg-surface border border-surface-border rounded-md shadow-xl py-1 z-50">
                <div className="px-2.5 py-1 text-[10px] uppercase font-mono text-slate-500 border-b border-surface-border">
                  Результаты поиска
                </div>
                {searchResults.map((asset) => (
                  <button
                    key={asset.id}
                    onMouseDown={() => handleSelectAsset(asset.symbol)}
                    className="w-full px-3 py-2 text-left hover:bg-surface-hover flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold font-mono text-white mr-1.5">
                        {asset.symbol}
                      </span>
                      <span className="text-slate-400 text-[11px]">{asset.name}</span>
                    </div>
                    <span
                      className={`font-mono text-[11px] ${
                        asset.change24h >= 0 ? 'text-brand-green' : 'text-brand-red'
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
            className="relative p-2 rounded hover:bg-surface-hover text-slate-300 hover:text-white transition-colors"
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
            className="relative p-2 rounded hover:bg-surface-hover text-slate-300 hover:text-white transition-colors"
            title="Открыть алерты"
            aria-label="Открыть алерты"
          >
            <Bell className="w-4 h-4 text-brand-cyan" />
            {alerts.length > 0 && (
              <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-brand-cyan text-[9px] font-bold text-slate-950 flex items-center justify-center font-mono">
                {alerts.length}
              </span>
            )}
          </button>

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded hover:bg-surface-hover text-slate-300 hover:text-white transition-colors"
            aria-label="Меню"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-surface border-b border-surface-border px-4 py-3 space-y-1">
          <div className="pb-2 mb-2 border-b border-surface-border flex items-center justify-between">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                openDemoModal();
              }}
              className="text-xs font-mono text-amber-400 flex items-center space-x-1.5 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/30"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>ДЕМОНСТРАЦИОННЫЙ РЕЖИМ</span>
            </button>
            <span className="text-[11px] font-mono text-slate-500">v0.1.0</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center space-x-2 px-3 py-2 rounded text-xs transition-colors ${
                      isActive
                        ? 'bg-brand-cyan/20 text-brand-cyan font-bold'
                        : 'text-slate-300 hover:bg-surface-hover hover:text-white'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 opacity-80" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
};
