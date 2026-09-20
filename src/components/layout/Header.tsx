import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { useMarketData } from '@/context/MarketDataContext';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';
import {
  PRIMARY_NAV_ITEMS,
  ANALYTICS_NAV_ITEMS,
  TOOLS_NAV_ITEMS,
  type NavItem,
  type SubNavItem,
} from '@/components/layout/navigation';

/** Какие выпадающие меню есть в шапке (общий тип для состояния и рендера). */
type DropdownKind = 'market' | 'analytics' | 'tools';
import {
  Search,
  Star,
  Bell,
  AlertTriangle,
  Menu,
  X,
  Radio,
  Wrench,
  Grid,
  ChevronDown,
  ChevronRight,
  Activity,
  User,
  LogIn,
  LogOut,
  Shield,
} from 'lucide-react';

/**
 * CRYPTORA — Header (адаптивная архитектура навигации терминала)
 * ---------------------------------------------------------------------------
 * Инварианты вёрстки:
 *  1. Шапка НИКОГДА не создаёт horizontal overflow и не обрезает элементы:
 *     ни один блок не выходит за `100vw` на ширинах 320–2560px.
 *  2. Primary navigation сохраняет читаемый кегль (13px, 14px на 2xl).
 *     Никакого «микроскопического» текста: минимум 11px только у вспомогательных
 *     служебных меток (WS-статус, бейдж версии).
 *  3. При нехватке места сначала сжимаются ВТОРИЧНЫЕ service controls
 *     (поиск → иконка, плашка режима → компактная, слоган/тариф → скрыты),
 *     и только затем элементы группируются.
 *
 * Точки перехода (см. tailwind.config.js):
 *   < 640   : мобильная шапка — бренд, режим-иконка, поиск-иконка, избранное, алерты, меню
 *   640     : появляется бейдж версии и текстовая плашка режима
 *   768     : появляется inline-поиск (w-44)
 *   1024    : базовая desktop-навигация (6 разделов + 2 dropdown), без иконок
 *   1152    : поиск расширяется, появляется чип тарифа в drawer
 *   1280    : иконки в primary navigation
 *   1440    : полная плашка LIVE SPOT + WS, поиск w-40
 *   1536    : кегль навигации 14px, слоган «Рынок. Данные. Решения.», чип тарифа
 *   1700    : чип тарифа с полным названием плана
 */
export const Header: React.FC = () => {
  const {
    watchlist,
    alerts,
    openWatchlist,
    openAlertsModal,
    unreadAlertCount,
    dataMode,
    provider,
    realtimeStatus,
    userPlan,
    openPlanModal,
  } = useMarketData();

  const { user, isAuthenticated, isAdmin, logout } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [compactSearchOpen, setCompactSearchOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<DropdownKind | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const marketDropdownRef = useRef<HTMLDivElement>(null);
  const analyticsDropdownRef = useRef<HTMLDivElement>(null);
  const toolsDropdownRef = useRef<HTMLDivElement>(null);
  const compactSearchRef = useRef<HTMLDivElement>(null);
  const compactSearchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const location = useLocation();

  const closeAllOverlays = useCallback(() => {
    setActiveDropdown(null);
    setMobileMenuOpen(false);
    setCompactSearchOpen(false);
    setIsSearchFocused(false);
    setUserMenuOpen(false);
  }, []);

  // Закрытие dropdown/search по клику вне области или клавише Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inMarket = marketDropdownRef.current?.contains(target);
      const inAnalytics = analyticsDropdownRef.current?.contains(target);
      const inTools = toolsDropdownRef.current?.contains(target);
      const inSearch = compactSearchRef.current?.contains(target);
      const inUserMenu = userMenuRef.current?.contains(target);
      if (!inMarket && !inAnalytics && !inTools) setActiveDropdown(null);
      if (!inSearch && !searchButtonRef.current?.contains(target)) setCompactSearchOpen(false);
      if (!inUserMenu) setUserMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAllOverlays();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeAllOverlays]);

  // Любая смена маршрута закрывает все оверлеи шапки
  useEffect(() => {
    closeAllOverlays();
  }, [location.pathname, closeAllOverlays]);

  // Метрики для поисковых подсказок: только фактически полученные от провайдера.
  useEffect(() => {
    let isActive = true;
    provider
      .getAssets()
      .then((list) => {
        if (isActive) setSearchMetrics(new Map(list.map((a) => [a.symbol, a.change24h])));
      })
      .catch(() => {
        if (isActive) setSearchMetrics(new Map());
      });
    return () => {
      isActive = false;
    };
  }, [provider]);

  // Фокус в поле компактного поиска после его раскрытия
  useEffect(() => {
    if (compactSearchOpen) compactSearchInputRef.current?.focus();
  }, [compactSearchOpen]);

  // Поиск работает по статическому каталогу символов. Рыночная метрика (24h)
  // показывается только если актив реально пришёл из активного провайдера —
  // иначе подсказка остаётся без чисел (LIVE-FIRST).
  const searchResults = searchQuery.trim()
    ? CANONICAL_ASSETS.filter(
        (a) =>
          a.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.name.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 6)
    : [];

  const handleSelectAsset = (symbol: string) => {
    setSearchQuery('');
    setIsSearchFocused(false);
    setCompactSearchOpen(false);
    navigate(`/coin/${symbol}`);
  };

  const primaryNavItems = PRIMARY_NAV_ITEMS;

  /** Пункт primary-навигации, у которого есть дети, рендерится как dropdown. */
  const DROPDOWN_KIND_BY_PATH: Record<string, DropdownKind> = { '/market': 'market' };
  const dropdownRefs: Record<DropdownKind, React.RefObject<HTMLDivElement>> = {
    market: marketDropdownRef,
    analytics: analyticsDropdownRef,
    tools: toolsDropdownRef,
  };
  const analyticsItems = ANALYTICS_NAV_ITEMS;
  const toolsItems = TOOLS_NAV_ITEMS;

  const isAnalyticsActive = analyticsItems.some((item) => location.pathname === item.path);
  const isToolsActive = toolsItems.some((item) => location.pathname === item.path);

  const planLabel = userPlan === 'FREE' ? 'FREE' : userPlan === 'PRO' ? 'PRO' : 'ENTERPRISE';
  const planShortLabel = userPlan === 'FREE' ? 'FREE' : userPlan === 'PRO' ? 'PRO' : 'ENT';
  const isLiveMode = dataMode === 'live';
  const [searchMetrics, setSearchMetrics] = useState<Map<string, number>>(new Map());
  const isRealtimeUp = realtimeStatus === 'connected';
  const realtimeLabel = isRealtimeUp
    ? 'WebSocket подключен'
    : realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting'
    ? 'WebSocket переподключается'
    : 'WebSocket отключен';

  /* ------------------------------------------------------------------ */
  /* Навигационные ссылки (общий рендер для desktop-панели и drawer)     */
  /* ------------------------------------------------------------------ */
  const renderPrimaryLink = (item: NavItem, inDrawer = false) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.path}
        to={item.path}
        onClick={inDrawer ? () => setMobileMenuOpen(false) : undefined}
        className={({ isActive }) =>
          inDrawer
            ? `flex items-center gap-x-2 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors ${
                isActive
                  ? 'border-cyan-500/40 bg-cyan-500/20 font-bold text-cyan-300'
                  : 'border-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white'
              }`
            : `relative flex shrink-0 items-center gap-x-1.5 whitespace-nowrap rounded-md border px-2 py-1.5 transition-all duration-150 xl:px-2.5 ${
                isActive
                  ? 'border-cyan-500/35 bg-cyan-500/15 font-semibold text-cyan-300 shadow-sm shadow-cyan-950/40'
                  : 'border-transparent text-slate-300 hover:bg-white/[0.05] hover:text-white'
              }`
        }
      >
        {({ isActive }) => (
          <>
            <Icon
              className={
                inDrawer
                  ? 'h-4 w-4 text-cyan-400 opacity-90'
                  : `hidden h-3.5 w-3.5 nav2xl:block ${isActive ? 'text-cyan-400' : 'text-slate-400'}`
              }
            />
            <span className={inDrawer ? 'truncate' : ''}>{item.label}</span>
            {!inDrawer && isActive && (
              <span className="absolute -bottom-1 left-2 right-2 h-[2px] rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 xl:left-2.5 xl:right-2.5" />
            )}
          </>
        )}
      </NavLink>
    );
  };

  /* ------------------------------------------------------------------ */
  /* Выпадающие меню вторичной навигации                                 */
  /* ------------------------------------------------------------------ */
  const renderDropdown = (
    kind: DropdownKind,
    label: string,
    items: SubNavItem[],
    isActive: boolean,
    ref: React.RefObject<HTMLDivElement>,
    menuTitle: string,
    accent: 'cyan' | 'violet' | 'blue',
    TriggerIcon: typeof Grid = Grid
  ) => {
    const isOpen = activeDropdown === kind;
    const accentClasses = {
      cyan: {
        active: 'border-cyan-500/35 bg-cyan-500/15 font-semibold text-cyan-300 shadow-sm shadow-cyan-950/40',
        icon: 'text-cyan-400',
        item: 'bg-cyan-500/15 text-cyan-300',
        underline: 'from-cyan-400 to-blue-500',
      },
      violet: {
        active: 'border-violet-500/35 bg-violet-500/15 font-semibold text-violet-300 shadow-sm shadow-violet-950/40',
        icon: 'text-violet-400',
        item: 'bg-cyan-500/15 text-cyan-300',
        underline: 'from-violet-400 to-cyan-400',
      },
      blue: {
        active: 'border-blue-500/35 bg-blue-500/15 font-semibold text-blue-300 shadow-sm shadow-blue-950/40',
        icon: 'text-blue-400',
        item: 'bg-blue-500/15 text-blue-300',
        underline: 'from-blue-400 to-cyan-400',
      },
    }[accent];

    return (
      <div className="relative shrink-0" ref={ref} key={`dropdown-${kind}`}>
        <button
          type="button"
          onClick={() => setActiveDropdown(isOpen ? null : kind)}
          aria-expanded={isOpen}
          aria-haspopup="true"
          className={`relative flex shrink-0 items-center gap-x-1 whitespace-nowrap rounded-md border px-2 py-1.5 transition-all duration-150 xl:px-2.5 ${
            isActive
              ? accentClasses.active
              : isOpen
              ? 'border-white/20 bg-white/[0.08] text-white'
              : 'border-transparent text-slate-300 hover:bg-white/[0.05] hover:text-white'
          }`}
        >
          <TriggerIcon
            className={`hidden h-3.5 w-3.5 nav2xl:block ${isActive ? accentClasses.icon : 'text-slate-400'}`}
          />
          <span>{label}</span>
          <ChevronDown
            className={`h-3 w-3 transition-transform duration-200 ${
              isOpen ? `rotate-180 ${accentClasses.icon}` : 'text-slate-400'
            }`}
          />
          {isActive && (
            <span
              className={`absolute -bottom-1 left-2 right-2 h-[2px] rounded-full bg-gradient-to-r xl:left-2.5 xl:right-2.5 ${accentClasses.underline}`}
            />
          )}
        </button>

        {isOpen && (
          <div
            role="menu"
            className="absolute left-0 z-50 mt-1.5 w-72 rounded-lg border border-white/[0.12] bg-surface/95 py-1.5 text-xs font-sans shadow-2xl shadow-black/80 backdrop-blur-2xl"
          >
            <div className="px-3 py-1 font-sans text-[11px] font-bold tracking-wide text-slate-400">
              {menuTitle}
            </div>
            <div className="py-1">
              {items.map((sub) => {
                const SubIcon = sub.icon;
                const isSubActive = location.pathname === sub.path;
                return (
                  <NavLink
                    key={sub.path}
                    to={sub.path}
                    role="menuitem"
                    className={`flex items-start gap-x-2.5 px-3 py-2 transition-colors ${
                      isSubActive ? accentClasses.item : 'text-slate-200 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    <SubIcon
                      className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                        isSubActive
                          ? accent === 'violet'
                            ? 'text-cyan-400'
                            : 'text-blue-400'
                          : 'text-slate-400'
                      }`}
                    />
                    <div className="flex flex-col">
                      <span className="whitespace-nowrap font-medium">{sub.label}</span>
                      <span className="text-[11px] leading-tight text-slate-400">{sub.sublabel}</span>
                    </div>
                  </NavLink>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /* Поиск: автокомплит-результаты (общий для inline и compact варианта) */
  /* ------------------------------------------------------------------ */
  const renderSearchResults = () => (
    <div className="absolute right-0 z-50 mt-1.5 w-64 rounded-lg border border-white/[0.12] bg-surface/95 py-1 shadow-2xl backdrop-blur-2xl">
      <div className="border-b border-white/[0.06] px-3 py-1 font-sans text-[11px] font-bold uppercase text-slate-400">
        Результаты поиска
      </div>
      {searchResults.map((asset) => {
        const change24h = searchMetrics.get(asset.symbol);
        return (
          <button
            key={asset.symbol}
            type="button"
            onMouseDown={() => handleSelectAsset(asset.symbol)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-white/[0.06]"
          >
            <div>
              <span className="mr-1.5 font-mono font-bold text-white">{asset.symbol}</span>
              <span className="text-[11px] text-slate-400">{asset.name}</span>
            </div>
            {typeof change24h === 'number' && (
              <span
                className={`font-mono text-[11px] font-semibold ${
                  change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {change24h >= 0 ? '+' : ''}
                {change24h}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-surface-inset/90 shadow-panel backdrop-blur-xl">
      <div className="mx-auto flex min-w-0 max-w-[1920px] flex-wrap items-center gap-x-2 px-3 sm:px-4">
        {/* ----------------------------- Brand ----------------------------- */}
        <div className="order-1 flex h-14 shrink-0 items-center gap-x-2 pr-1 sm:gap-x-3 sm:pr-2">
          <Link
            to="/"
            className="group flex min-w-0 items-center gap-x-2.5 focus:outline-none"
            aria-label="CRYPTORA Главная"
          >
            {/* Technological Brand Mark */}
            <div className="relative h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-cyan-400 via-blue-500 to-violet-600 p-[1px] shadow-sm shadow-cyan-500/20 transition-all duration-300 group-hover:shadow-cyan-400/30">
              <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[7px] bg-surface">
                <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/15 via-transparent to-violet-500/10 opacity-70 transition-opacity group-hover:opacity-100" />
                <svg
                  className="relative z-10 h-4 w-4 text-cyan-400 transition-colors group-hover:text-white"
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

            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-x-1.5">
                <span className="hidden font-mono text-sm font-black tracking-[0.16em] text-white transition-colors group-hover:text-cyan-300 min-[400px]:inline 2xl:text-base">
                  CRYPTORA
                </span>
                <span className="hidden shrink-0 rounded border border-cyan-500/30 bg-cyan-950/80 px-1.5 font-mono text-[11px] font-semibold tracking-normal text-cyan-400 navxl:inline-block">
                  v0.8.48
                </span>
              </div>
              <span className="hidden whitespace-nowrap font-sans text-[11px] tracking-tight text-slate-400 2xl:block">
                Рынок. Данные. Решения.
              </span>
            </div>
          </Link>
        </div>

        {/* ------------------ Primary desktop navigation (lg+) ------------------ */}
        <nav
          className="order-3 hidden w-full min-w-0 items-center justify-start gap-x-1 border-t border-white/[0.07] py-1.5 text-[13px] font-medium lg:flex xl:order-2 xl:w-auto xl:flex-1 xl:justify-center xl:border-t-0 xl:py-0 2xl:text-sm"
          aria-label="Главная навигация"
        >
          {primaryNavItems.map((item) =>
            item.children ? (
              renderDropdown(
                DROPDOWN_KIND_BY_PATH[item.path] ?? 'market',
                item.label,
                item.children,
                item.children.some((sub) => location.pathname === sub.path),
                dropdownRefs[DROPDOWN_KIND_BY_PATH[item.path] ?? 'market'],
                `${item.label}: разделы`,
                'cyan',
                item.icon
              )
            ) : (
              renderPrimaryLink(item)
            )
          )}

          {renderDropdown(
            'analytics',
            'Аналитика',
            analyticsItems,
            isAnalyticsActive,
            analyticsDropdownRef,
            'Аналитические модули',
            'violet'
          )}

          {renderDropdown(
            'tools',
            'Инструменты',
            toolsItems,
            isToolsActive,
            toolsDropdownRef,
            'Инструменты терминала',
            'blue',
            Wrench
          )}
        </nav>

        {/* ----------------------- Secondary service controls ----------------------- */}
        <div className="order-2 ml-auto flex h-14 shrink-0 items-center gap-x-1.5 sm:gap-x-2">
          {/* Статус источника и соединения: только индикация, переключателя режима в интерфейсе нет */}
          <span
            role="status"
            data-qa="data-source-status"
            aria-label={`Источник данных: ${isLiveMode ? `LIVE Spot, ${realtimeLabel}` : 'внутренний датасет QA'}`}
            title={`Источник данных: ${isLiveMode ? 'LIVE Spot (Binance / KuCoin)' : 'внутренний датасет QA'}. Статус WebSocket: ${realtimeStatus}`}
            className={`hidden shrink-0 items-center gap-x-1.5 whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[11px] sm:inline-flex navxl:px-2.5 ${
              isLiveMode
                ? 'border-emerald-500/35 bg-emerald-950/40 text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}
          >
            {isLiveMode ? (
              <Radio className="h-3.5 w-3.5 shrink-0 animate-pulse text-emerald-400" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            )}
            <span className="hidden font-bold navxl:inline">{isLiveMode ? 'LIVE SPOT' : 'QA-ДАТАСЕТ'}</span>
            <span className="font-bold navxl:hidden">{isLiveMode ? 'LIVE' : 'QA'}</span>
            {isLiveMode && (
              <span
                className={`ml-0.5 shrink-0 rounded px-1 font-mono text-[11px] font-bold ${
                  isRealtimeUp
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {isRealtimeUp ? 'WS ●' : 'WS ⟳'}
              </span>
            )}
          </span>

          {/* Компактный статус источника для узких экранов (< 640px) */}
          <span
            role="status"
            data-qa="data-source-status-compact"
            aria-label={`Источник данных: ${isLiveMode ? `LIVE Spot, ${realtimeLabel}` : 'внутренний датасет QA'}`}
            title={`Источник данных: ${isLiveMode ? 'LIVE Spot (Binance / KuCoin)' : 'внутренний датасет QA'}`}
            className={`inline-flex shrink-0 items-center gap-x-1 rounded-md border p-1.5 sm:hidden ${
              isLiveMode
                ? 'border-emerald-500/35 bg-emerald-950/40 text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}
          >
            {isLiveMode ? <Activity className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isLiveMode ? (isRealtimeUp ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-amber-400'
              }`}
            />
          </span>

          {/* Plan tier chip (раскрывается только на очень широких экранах) */}
          <button
            type="button"
            onClick={openPlanModal}
            className="hidden shrink-0 cursor-pointer items-center gap-x-1 whitespace-nowrap rounded border border-violet-500/30 bg-violet-950/40 px-2 py-0.5 font-sans text-[11px] font-bold text-violet-300 transition-all hover:border-violet-400/50 hover:bg-violet-900/40 nav2xl:inline-flex"
            title={`Тарифный план: ${planLabel}. Тарифные планы и права доступа`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            <span className="hidden min-[1920px]:inline">{planLabel}</span>
            <span className="min-[1920px]:hidden">{planShortLabel}</span>
          </button>

          {/* Inline search (navmd+): заменяет компактную иконку поиска */}
          <div className="relative hidden navxl:block">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Поиск монеты..."
                aria-label="Поиск монеты"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                className="w-36 rounded-md border border-white/[0.08] bg-surface-2/80 py-1 pl-8 pr-2.5 font-mono text-xs text-slate-200 placeholder-slate-500 transition-all focus:border-cyan-400/60 focus:bg-surface-elevated focus:outline-none 2xl:w-40 nav2xl:w-44"
              />
            </div>
            {isSearchFocused && !compactSearchOpen && searchResults.length > 0 && renderSearchResults()}
          </div>

          {/* Compact search toggle (< navmd): раскрывает панель поиска под шапкой */}
          <div className="navxl:hidden" ref={compactSearchRef}>
            <button
              ref={searchButtonRef}
              type="button"
              onClick={() => setCompactSearchOpen((open) => !open)}
              aria-label="Поиск монеты"
              aria-expanded={compactSearchOpen}
              className={`rounded-md border border-transparent p-2 transition-colors hover:bg-white/[0.06] hover:text-white ${
                compactSearchOpen ? 'bg-white/[0.08] text-white' : 'text-slate-300'
              }`}
              title="Поиск монеты"
            >
              {compactSearchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </button>
          </div>

          <ThemeToggle />

          {/* Watchlist Drawer Button */}
          <button
            type="button"
            onClick={openWatchlist}
            className="relative shrink-0 rounded-md border border-transparent p-2 text-slate-300 transition-colors hover:border-white/[0.08] hover:bg-white/[0.06] hover:text-white"
            title="Открыть избранное"
            aria-label="Открыть избранное"
          >
            <Star className="h-4 w-4 text-amber-400" />
            {watchlist.length > 0 && (
              <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 font-mono text-[11px] font-bold text-slate-950">
                {watchlist.length}
              </span>
            )}
          </button>

          {/* Alerts Modal Button */}
          <button
            type="button"
            onClick={openAlertsModal}
            className="relative shrink-0 rounded-md border border-transparent p-2 text-slate-300 transition-colors hover:border-white/[0.08] hover:bg-white/[0.06] hover:text-white"
            title="Открыть алерты"
            aria-label="Открыть алерты"
          >
            <Bell className="h-4 w-4 text-cyan-400" />
            {unreadAlertCount > 0 ? (
              <span
                data-qa="alerts-unread-badge"
                className="absolute right-1 top-1 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-rose-500 px-0.5 font-mono text-[11px] font-bold text-white"
              >
                {unreadAlertCount}
              </span>
            ) : alerts.length > 0 ? (
              <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-cyan-400 font-mono text-[11px] font-bold text-slate-950">
                {alerts.length}
              </span>
            ) : null}
          </button>

          {/* ── Auth UI ─────────────────────────────────────────────────── */}
          {isAuthenticated && user ? (
            <div className="relative shrink-0" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((open) => !open)}
                aria-label="Меню пользователя"
                aria-expanded={userMenuOpen}
                className={`flex shrink-0 items-center gap-x-1.5 rounded-md border p-1.5 transition-colors ${
                  userMenuOpen
                    ? 'border-white/20 bg-white/[0.08] text-white'
                    : 'border-transparent text-slate-300 hover:border-white/[0.08] hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-500">
                  <User className="h-3.5 w-3.5 text-white" />
                </div>
                <ChevronDown className={`hidden h-3 w-3 transition-transform sm:block ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {userMenuOpen && (
                <div
                  role="menu"
                  aria-label="Меню пользователя"
                  onKeyDown={(e) => {
                    // Стрелки перемещают фокус внутри меню, Escape закрывает.
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                    e.preventDefault();
                    const items = Array.from(
                      (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]')
                    );
                    const idx = items.indexOf(document.activeElement as HTMLElement);
                    const next =
                      e.key === 'ArrowDown'
                        ? (idx + 1) % items.length
                        : (idx - 1 + items.length) % items.length;
                    items[next]?.focus();
                  }}
                  className="absolute right-0 z-50 mt-1.5 w-56 max-w-[calc(100vw-1.5rem)] rounded-lg border border-white/[0.12] bg-surface/95 py-1.5 text-xs font-sans shadow-2xl shadow-black/80 backdrop-blur-2xl"
                >
                  <div className="border-b border-white/[0.06] px-3 py-2">
                    <div className="truncate font-medium text-white">{user.displayName}</div>
                    <div className="truncate text-[11px] text-slate-400">{user.email}</div>
                  </div>
                  <div className="py-1">
                    <NavLink
                      to="/profile"
                      role="menuitem"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-x-2.5 px-3 py-2 text-slate-200 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      <User className="h-4 w-4 text-slate-400" />
                      <span>Профиль</span>
                    </NavLink>
                    {isAdmin && (
                      <NavLink
                        to="/admin"
                        role="menuitem"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-x-2.5 px-3 py-2 text-cyan-300 transition-colors hover:bg-white/[0.06]"
                      >
                        <Shield className="h-4 w-4 text-cyan-400" />
                        <span>Админка</span>
                      </NavLink>
                    )}
                  </div>
                  <div className="border-t border-white/[0.06] pt-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await logout();
                      }}
                      className="flex w-full items-center gap-x-2.5 px-3 py-2 text-left text-rose-300 transition-colors hover:bg-white/[0.06]"
                    >
                      <LogOut className="h-4 w-4 text-rose-400" />
                      <span>Выйти</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="hidden shrink-0 items-center gap-x-1.5 sm:flex">
              <NavLink
                to="/login"
                className="flex items-center gap-x-1 rounded-md border border-transparent px-2 py-1.5 text-[13px] font-medium text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-white"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Войти</span>
              </NavLink>
              <NavLink
                to="/register"
                className="flex items-center gap-x-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-[13px] font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20"
              >
                <span>Регистрация</span>
              </NavLink>
            </div>
          )}

          {/* Mobile Menu Hamburger (< 1024px) */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label="Меню"
            aria-expanded={mobileMenuOpen}
            className="shrink-0 rounded-md p-2 text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white lg:hidden"
          >
            {mobileMenuOpen ? <X className="h-5 w-5 text-white" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Compact search panel (< navmd) */}
      {compactSearchOpen && (
        <div
          role="search"
          className="border-b border-white/[0.08] bg-surface-inset/98 px-3 py-2.5 backdrop-blur-2xl sm:px-4 navxl:hidden"
        >
          <div className="relative mx-auto flex max-w-[1920px] items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
            <input
              ref={compactSearchInputRef}
              type="text"
              placeholder="Тикер или название монеты..."
              aria-label="Поиск монеты"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
              className="w-full rounded-md border border-white/[0.1] bg-surface-2 py-2 pl-9 pr-3 font-mono text-[13px] text-slate-200 placeholder-slate-500 transition-all focus:border-cyan-400/60 focus:bg-surface-elevated focus:outline-none"
            />
          </div>

          {searchQuery.trim() && (
            <div className="mx-auto mt-2 max-w-[1920px] overflow-hidden rounded-md border border-white/[0.1] bg-surface/95">
              {searchResults.length === 0 ? (
                <div className="px-3 py-2.5 font-sans text-xs text-slate-400">
                  Совпадений не найдено
                </div>
              ) : (
                searchResults.map((asset) => {
                  const change24h = searchMetrics.get(asset.symbol);
                  return (
                    <button
                      key={asset.symbol}
                      type="button"
                      onMouseDown={() => handleSelectAsset(asset.symbol)}
                      className="flex w-full items-center justify-between border-b border-white/[0.05] px-3 py-2.5 text-left last:border-b-0 hover:bg-white/[0.06]"
                    >
                      <div className="flex items-center gap-x-2">
                        <span className="font-mono text-[13px] font-bold text-white">{asset.symbol}</span>
                        <span className="text-xs text-slate-400">{asset.name}</span>
                      </div>
                      {typeof change24h === 'number' && (
                        <span
                          className={`font-mono text-xs font-semibold ${
                            change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {change24h >= 0 ? '+' : ''}
                          {change24h}%
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* Mobile / tablet menu (< 1024px) */}
      {mobileMenuOpen && (
        <div className="max-h-[85vh] space-y-3 overflow-y-auto border-b border-white/[0.1] bg-surface-inset/98 px-4 py-4 backdrop-blur-2xl lg:hidden">
          {/* Status strip: источник данных, realtime, тариф */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] pb-3">
            <span
              role="status"
              className={`flex items-center gap-x-1.5 rounded border px-2.5 py-1 font-mono text-xs ${
                isLiveMode
                  ? 'border-emerald-500/35 bg-emerald-950/40 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              {isLiveMode ? (
                <Radio className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              )}
              <span>{isLiveMode ? 'LIVE SPOT' : 'QA-ДАТАСЕТ'}</span>
            </span>

            <span
              className={`flex items-center gap-x-1.5 rounded border px-2.5 py-1 font-mono text-xs ${
                isRealtimeUp
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-600/40 bg-slate-800/50 text-slate-300'
              }`}
              title={realtimeLabel}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${isRealtimeUp ? 'bg-emerald-400' : 'bg-slate-400'}`}
              />
              <span>{isRealtimeUp ? 'WS ОНЛАЙН' : 'WS ОЖИДАНИЕ'}</span>
            </span>

            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                openPlanModal();
              }}
              className="flex items-center gap-x-1.5 rounded border border-violet-500/30 bg-violet-950/40 px-2.5 py-1 font-mono text-xs text-violet-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              <span>{planLabel}</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Primary Navigation Grid */}
          <div>
            <div className="mb-1.5 font-sans text-[11px] font-bold tracking-wide text-slate-400">
              Основные разделы
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {/* Пункты с подпунктами в мобильном drawer раскрываются сразу:
                  «Рынок» -> «Спот» и «Фьючерсы» как прямые ссылки. */}
              {primaryNavItems.flatMap((item) =>
                item.children
                  ? item.children.map((sub) => renderPrimaryLink(sub, true))
                  : [renderPrimaryLink(item, true)]
              )}
            </div>
          </div>

          {/* Analytics Group */}
          <div>
            <div className="mb-1.5 font-sans text-[11px] font-bold tracking-wide text-slate-400">
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
                      `flex items-center gap-x-2 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors ${
                        isActive
                          ? 'border-violet-500/40 bg-violet-500/20 font-bold text-violet-300'
                          : 'border-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 text-violet-400 opacity-90" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>

          {/* Tools Group */}
          <div>
            <div className="mb-1.5 font-sans text-[11px] font-bold tracking-wide text-slate-400">
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
                      `flex items-center gap-x-2 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors ${
                        isActive
                          ? 'border-blue-500/40 bg-blue-500/20 font-bold text-blue-300'
                          : 'border-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 text-blue-400 opacity-90" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>

          {/* Auth Section in Mobile Menu */}
          <div className="border-t border-white/[0.08] pt-3">
            {isAuthenticated && user ? (
              <div className="space-y-1.5">
                <div className="mb-2 flex items-center gap-x-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-500">
                    <User className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{user.displayName}</div>
                    <div className="text-[11px] text-slate-400">{user.email}</div>
                  </div>
                </div>
                <NavLink
                  to="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-x-2 rounded-md px-3 py-2 text-[13px] font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white"
                >
                  <User className="h-4 w-4 text-slate-400" />
                  <span>Профиль</span>
                </NavLink>
                {isAdmin && (
                  <NavLink
                    to="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-x-2 rounded-md px-3 py-2 text-[13px] font-medium text-cyan-300 hover:bg-white/[0.06]"
                  >
                    <Shield className="h-4 w-4 text-cyan-400" />
                    <span>Админка</span>
                  </NavLink>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    setMobileMenuOpen(false);
                    await logout();
                  }}
                  className="flex w-full items-center gap-x-2 rounded-md px-3 py-2 text-left text-[13px] font-medium text-rose-300 hover:bg-white/[0.06]"
                >
                  <LogOut className="h-4 w-4 text-rose-400" />
                  <span>Выйти</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                <NavLink
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center gap-x-1.5 rounded-md border border-white/[0.1] px-3 py-2 text-[13px] font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white"
                >
                  <LogIn className="h-4 w-4" />
                  <span>Войти</span>
                </NavLink>
                <NavLink
                  to="/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center gap-x-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[13px] font-medium text-cyan-300 hover:bg-cyan-500/20"
                >
                  <span>Регистрация</span>
                </NavLink>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.08] pt-3 font-sans text-[11px] text-slate-400">
            <span>CRYPTORA v0.8.48</span>
            <span>{dataMode === 'live' ? 'LIVE-ДАННЫЕ РЫНКА' : 'QA-ДАТАСЕТ'}</span>
          </div>
        </div>
      )}
    </header>
  );
};
