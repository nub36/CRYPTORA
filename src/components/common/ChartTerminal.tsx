import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  Layers3,
  LineChart,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  RotateCcw,
} from 'lucide-react';
import type { OHLCV, Timeframe } from '@/types/market';
import { CandleChart, type CandleChartType, type ChartIndicatorData } from './CandleChart';
import type { KlineTick } from '@/types/realtime';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * Брейкпоинт КОМПАКТНОЙ ПЛОТНОСТИ терминала.
 *
 * Состав контролов один и тот же на всех ширинах (см. `renderToolbar`):
 * `[1ч ▾] [Свечи ▾] [Индикаторы ▾] [⋯]` + fullscreen. Ниже 1024px меняется
 * только плотность (подписи короче, тап-цели 36px, fullscreen — оверлей
 * внутри рамки графика вместо правого рельса).
 */
export const CHART_TERMINAL_COMPACT_QUERY = '(max-width: 1023.98px)';

export const CHART_TERMINAL_TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1D', '1W'];

export function formatTerminalTimeframe(timeframe: Timeframe): string {
  const labels: Record<Timeframe, string> = {
    '5m': '5м',
    '15m': '15м',
    '30m': '30м',
    '1h': '1ч',
    '4h': '4ч',
    '1D': '1Д',
    '1W': '1Н',
  };
  return labels[timeframe];
}

const CHART_TYPE_LABELS: Record<CandleChartType, string> = {
  candles: 'Свечи',
  line: 'Линия',
  bars: 'Бары',
};

type TerminalMenuKey = 'timeframe' | 'chart-type' | 'indicators' | 'templates' | 'settings' | 'more' | null;

interface TerminalDropdownProps {
  menuKey: Exclude<TerminalMenuKey, null>;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: React.ReactNode;
  testId: string;
  activeLabel?: string;
  /** Компактный мобильный триггер: плотнее паддинги, тап-цель >= 36px. */
  compact?: boolean;
  /** Только иконка (мобильное «Ещё»): подпись живёт в tooltip/aria-label. */
  iconOnly?: boolean;
  /** Полное значение контрола для tooltip/скринридера, если подпись сокращена. */
  fullLabel?: string;
}

/**
 * A small keyboard/touch-safe popover used by the chart toolbar. It is positioned
 * against the viewport rather than the chart card so a menu cannot be clipped by
 * a narrow 360px layout or by a fullscreen chart.
 */
function TerminalDropdown({
  menuKey,
  label,
  icon: Icon,
  open,
  onToggle,
  onClose,
  children,
  testId,
  activeLabel,
  compact = false,
  iconOnly = false,
  fullLabel,
}: TerminalDropdownProps): React.ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 12, width: 220 });

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;
    const rect = trigger.getBoundingClientRect();
    /*
     * «Индикаторы» содержит самую длинную строку («MA и Bollinger Bands») плюс
     * фиксированную колонку чекбокса, поэтому меню чуть шире остальных: так текст
     * не обрезается и не ломает выравнивание правой оси контролов. Верхняя граница
     * по-прежнему ограничена вьюпортом (360px остаётся без overflow).
     */
    const maxWidth = menuKey === 'indicators' ? 248 : menuKey === 'more' ? 252 : 230;
    const width = Math.min(maxWidth, Math.max(170, window.innerWidth - 24));
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
    const estimatedHeight = menuKey === 'more' ? 340 : menuKey === 'timeframe' ? 292 : 250;
    const top = rect.bottom + 6 + estimatedHeight <= window.innerHeight
      ? rect.bottom + 6
      : Math.max(12, rect.top - estimatedHeight - 6);
    setPosition({ top, left, width });
  }, [menuKey]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const focusFirstItem = () => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')?.focus();
    };
    const focusTimer = window.setTimeout(focusFirstItem, 0);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        triggerRef.current?.focus();
        return;
      }
      if (!menuRef.current) return;
      const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'));
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + direction + items.length) % items.length]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        items.at(-1)?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [onClose, open, updatePosition]);

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) onToggle();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      onClose();
    }
  };

  const accessibleLabel = fullLabel ?? label;
  /*
   * `h-9` (36px), а НЕ `min-h-9`: глобальное базовое правило проекта
   * (`src/index.css`, «мобильные тач-таргеты ≥ 28px») задаёт
   * `button:not(:disabled) { min-height: 28px }` со специфичностью выше
   * одноклассовой утилиты, поэтому `min-h-*` на ≤640px не поднимает тап-цель.
   * Явная высота выигрывает у `min-height` и даёт честные 36px.
   */
  const geometry = compact
    ? `h-9 gap-1 px-2 text-xs${iconOnly ? ' w-9 justify-center px-0' : ''}`
    : 'min-h-8 gap-1.5 px-2.5 py-1.5 text-[11px] sm:text-xs';

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={accessibleLabel !== label || iconOnly ? accessibleLabel : undefined}
        title={accessibleLabel}
        data-qa={testId}
        data-testid={testId}
        onClick={onToggle}
        onKeyDown={onTriggerKeyDown}
        className={`inline-flex items-center rounded-md border font-sans font-semibold transition-colors ${geometry} ${
          open
            ? 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan'
            : 'border-surface-border bg-surface-elevated text-slate-300 hover:border-brand-cyan/50 hover:text-white'
        }`}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {!iconOnly && <span className="truncate">{label}</span>}
        {activeLabel && <span className="hidden font-mono text-slate-400 lg:inline">· {activeLabel}</span>}
        {!iconOnly && (
          <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={accessibleLabel}
          data-qa={`${testId}-menu`}
          data-testid={`${testId}-menu`}
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            width: position.width,
            maxHeight: `min(${menuKey === 'more' ? 400 : 320}px, calc(100vh - 24px))`,
          }}
          className="z-[80] overflow-y-auto rounded-lg border border-surface-border bg-surface-elevated p-1.5 shadow-2xl shadow-black/40"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function menuButtonClass(active = false): string {
  return `flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left font-sans text-xs transition-colors ${
    active ? 'bg-brand-cyan/10 text-brand-cyan' : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
  }`;
}

/**
 * Одна строка меню «Индикаторы».
 *
 * Геометрия строки задаётся ОДИН раз через grid `[label | control]`, а не
 * подгоняется отступами под каждый пункт:
 *  - `h-9` — одинаковая высота у всех строк (активной и неактивной);
 *  - `px-3` — одинаковые left/right paddings, поэтому текст всех индикаторов
 *    начинается по одной вертикальной линии;
 *  - вторая колонка фиксирована (`1rem`), поэтому чекбоксы стоят на одной правой
 *    оси независимо от длины подписи, а `gap-3` держит одинаковое расстояние
 *    между текстом и контролом;
 *  - активное состояние меняет только цвет/фон (и рамку чекбокса), поэтому
 *    hover/active/focus не двигают геометрию;
 *  - focus-ring рисуется `ring-inset`, чтобы не увеличивать бокс строки.
 */
const INDICATOR_ROW_CLASS =
  'grid h-9 w-full grid-cols-[minmax(0,1fr)_1rem] items-center gap-3 rounded-md px-3 text-left font-sans text-xs ' +
  'transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand-cyan';

function indicatorRowClass(active: boolean): string {
  return `${INDICATOR_ROW_CLASS} ${
    active ? 'bg-brand-cyan/10 text-brand-cyan' : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
  }`;
}

function indicatorCheckboxClass(active: boolean): string {
  return `flex h-4 w-4 shrink-0 items-center justify-center justify-self-end rounded border text-[11px] leading-none ${
    active ? 'border-brand-cyan bg-brand-cyan text-slate-950' : 'border-slate-600 bg-transparent text-transparent'
  }`;
}

export interface ChartTerminalProps {
  data: OHLCV[];
  symbol: string;
  timeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
  height?: number;
  indicators?: ChartIndicatorData;
  realtimeKline?: KlineTick | null;
  chartType: CandleChartType;
  onChartTypeChange: (chartType: CandleChartType) => void;
  showRSI: boolean;
  onShowRSIChange: (value: boolean) => void;
  showMACD: boolean;
  onShowMACDChange: (value: boolean) => void;
  showMA: boolean;
  onShowMAChange: (value: boolean) => void;
  showVolume: boolean;
  onShowVolumeChange: (value: boolean) => void;
  showTimezone: boolean;
  onShowTimezoneChange: (value: boolean) => void;
}

/**
 * CRYPTORA's terminal shell around the existing official TradingView
 * Lightweight Charts engine. Controls here are presentation-only: RSI, MACD,
 * moving averages and templates never enter the strategy/signal calculation path.
 */
export const ChartTerminal: React.FC<ChartTerminalProps> = ({
  data,
  symbol,
  timeframe,
  onTimeframeChange,
  height = 460,
  indicators,
  realtimeKline,
  chartType,
  onChartTypeChange,
  showRSI,
  onShowRSIChange,
  showMACD,
  onShowMACDChange,
  showMA,
  onShowMAChange,
  showVolume,
  onShowVolumeChange,
  showTimezone,
  onShowTimezoneChange,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  /**
   * Компактная (мобильная) композиция контролов. В средах без `matchMedia`
   * (JSDOM) хук честно возвращает `false`, поэтому unit-окружение продолжает
   * рендерить desktop-раскладку PR #32.
   */
  const compact = useMediaQuery(CHART_TERMINAL_COMPACT_QUERY);
  const [openMenu, setOpenMenu] = useState<TerminalMenuKey>(null);
  const [resetViewToken, setResetViewToken] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenHeight, setFullscreenHeight] = useState(700);

  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const toggleMenu = useCallback((menu: Exclude<TerminalMenuKey, null>) => {
    setOpenMenu((current) => current === menu ? null : menu);
  }, []);

  /* Смена композиции (поворот экрана / resize через брейкпоинт) закрывает меню:
     его триггер в новой раскладке может отсутствовать. */
  useEffect(() => {
    setOpenMenu(null);
  }, [compact]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const active = document.fullscreenElement === terminalRef.current;
      setIsFullscreen(active);
      setFullscreenHeight(Math.max(520, window.innerHeight - 102));
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    window.addEventListener('resize', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      window.removeEventListener('resize', syncFullscreenState);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (terminalRef.current?.requestFullscreen) {
        await terminalRef.current.requestFullscreen();
      }
    } catch {
      // Fullscreen can be denied by the browser or an embedded preview. The
      // terminal remains fully usable, so no fake fullscreen state is shown.
    }
  };

  const applyTemplate = (template: 'default' | 'clean' | 'momentum') => {
    if (template === 'default') {
      onChartTypeChange('candles');
      onShowMAChange(true);
      onShowVolumeChange(true);
      onShowRSIChange(false);
      onShowMACDChange(false);
    } else if (template === 'clean') {
      onChartTypeChange('candles');
      onShowMAChange(false);
      onShowVolumeChange(false);
      onShowRSIChange(false);
      onShowMACDChange(false);
    } else {
      onChartTypeChange('candles');
      onShowMAChange(false);
      onShowVolumeChange(true);
      onShowRSIChange(true);
      onShowMACDChange(true);
    }
    closeMenu();
  };

  /*
   * ================= ОБЩЕЕ СОДЕРЖИМОЕ МЕНЮ =================
   *
   * Наполнение каждого меню описано ОДИН раз и переиспользуется обеими
   * композициями (desktop toolbar PR #32 и мобильная компактная строка).
   * Мобильные контролы не дублируют бизнес-логику: они открывают те же самые
   * пункты и вызывают те же самые handlers/состояние.
   */

  const timeframeItems = (
    <>
      <div className="px-3 pb-1.5 pt-1 font-sans text-[11px] font-semibold tracking-[0.14em] text-slate-500">Таймфрейм</div>
      {CHART_TERMINAL_TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          role="menuitem"
          data-qa={`chart-timeframe-${tf}`}
          data-testid={`chart-timeframe-${tf}`}
          aria-current={timeframe === tf ? 'true' : undefined}
          className={menuButtonClass(timeframe === tf)}
          onClick={() => {
            onTimeframeChange(tf);
            closeMenu();
          }}
        >
          <span>{formatTerminalTimeframe(tf)}</span>
          <span className="font-mono text-[11px] text-slate-500">{tf}</span>
        </button>
      ))}
    </>
  );

  const chartTypeItems = (
    <>
      {(['candles', 'line'] as CandleChartType[]).map((type) => (
        <button
          key={type}
          type="button"
          role="menuitem"
          data-qa={`chart-type-${type}`}
          className={menuButtonClass(chartType === type)}
          onClick={() => {
            onChartTypeChange(type);
            closeMenu();
          }}
        >
          <span className="flex items-center gap-2"><LineChart className="h-3.5 w-3.5" />{CHART_TYPE_LABELS[type]}</span>
          {chartType === type && <span aria-hidden="true" className="text-brand-cyan">✓</span>}
        </button>
      ))}
    </>
  );

  const indicatorItems = (
    <>
      {/* Заголовок отделён тонкой линией, но без лишнего вертикального воздуха. */}
      <div
        data-qa="chart-indicators-heading"
        className="mb-1 border-b border-white/[0.08] px-3 pb-1.5 pt-1 font-sans text-[11px] font-semibold tracking-[0.14em] text-slate-500"
      >
        Панели и оверлеи
      </div>
      {[
        { key: 'ma', label: 'MA и Bollinger Bands', value: showMA, setValue: onShowMAChange },
        { key: 'rsi', label: 'RSI (14)', value: showRSI, setValue: onShowRSIChange },
        { key: 'macd', label: 'MACD (12/26/9)', value: showMACD, setValue: onShowMACDChange },
      ].map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitemcheckbox"
          aria-checked={item.value}
          data-qa={`chart-indicator-row-${item.key}`}
          data-testid={`chart-indicator-row-${item.key}`}
          className={indicatorRowClass(item.value)}
          onClick={() => item.setValue(!item.value)}
        >
          <span data-qa={`chart-indicator-label-${item.key}`} className="min-w-0 truncate">{item.label}</span>
          <span aria-hidden="true" data-qa={`chart-indicator-box-${item.key}`} className={indicatorCheckboxClass(item.value)}>✓</span>
        </button>
      ))}
      <div className="mt-1 border-t border-white/[0.08] px-3 py-2 font-sans text-[11px] leading-4 text-slate-500">Визуальные инструменты графика. Сигналы и стратегии не изменяются.</div>
    </>
  );

  const templateItems = (
    <>
      <button type="button" role="menuitem" data-qa="chart-template-default" className={menuButtonClass()} onClick={() => applyTemplate('default')}>
        <span><strong className="font-semibold text-white">По умолчанию</strong><span className="block text-[11px] text-slate-500">Свечи · MA · объём</span></span>
      </button>
      <button type="button" role="menuitem" data-qa="chart-template-clean" className={menuButtonClass()} onClick={() => applyTemplate('clean')}>
        <span><strong className="font-semibold text-white">Чистый график</strong><span className="block text-[11px] text-slate-500">Цена и время</span></span>
      </button>
      <button type="button" role="menuitem" data-qa="chart-template-momentum" className={menuButtonClass()} onClick={() => applyTemplate('momentum')}>
        <span><strong className="font-semibold text-white">Momentum</strong><span className="block text-[11px] text-slate-500">RSI · MACD · объём</span></span>
      </button>
    </>
  );

  const settingsItems = (
    <>
      <button type="button" role="menuitemcheckbox" aria-checked={showVolume} data-qa="chart-setting-volume" className={menuButtonClass(showVolume)} onClick={() => onShowVolumeChange(!showVolume)}>
        <span>Объём</span>
        <span className="font-mono text-[11px] text-slate-500">{showVolume ? 'Вкл' : 'Выкл'}</span>
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={showTimezone} data-qa="chart-setting-timezone" className={menuButtonClass(showTimezone)} onClick={() => onShowTimezoneChange(!showTimezone)}>
        <span>Часовой пояс</span>
        <span className="font-mono text-[11px] text-slate-500">{showTimezone ? 'Вкл' : 'Выкл'}</span>
      </button>
    </>
  );

  /**
   * «Вписать данные». Один и тот же обработчик на всех ширинах: пункт живёт
   * внутри «Ещё», второй реализации сброса масштаба не создаётся.
   *
   * Кнопка ОТКЛЮЧЕНА, когда вписывать нечего (`data.length === 0`): вписать
   * пустую серию нельзя, и нажатие давало бы «мёртвый» контрол (UX-аудит §6).
   */
  const canFitData = data.length > 0;
  const renderFitDataItem = (qa?: string) => (
    <button
      type="button"
      role="menuitem"
      {...(qa ? { 'data-qa': qa, 'data-testid': qa } : {})}
      disabled={!canFitData}
      aria-disabled={!canFitData}
      title={canFitData ? 'Вписать данные в область графика' : 'Нет данных для масштабирования'}
      className={`${menuButtonClass()} ${canFitData ? '' : 'cursor-not-allowed opacity-40'}`}
      onClick={() => {
        if (!canFitData) return;
        setResetViewToken((value) => value + 1);
        closeMenu();
      }}
    >
      <span>Вписать данные</span>
      <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
    </button>
  );

  const fullscreenLabel = isFullscreen ? 'Выйти из полноэкранного режима' : 'Развернуть график';
  const fullscreenIcon = isFullscreen
    ? <Minimize2 className="h-4 w-4" aria-hidden="true" />
    : <Maximize2 className="h-4 w-4" aria-hidden="true" />;

  /*
   * ================= ЕДИНЫЙ TOOLBAR (desktop + mobile) =================
   *
   * Состав контролов ОДИН для всех ширин:
   *     [1ч ▾] [Свечи ▾] [Индикаторы ▾] … [⋯]
   * «Шаблоны», «Настройки» и «Вписать данные» живут внутри «Ещё» на любой
   * ширине — раньше это было верно только для мобильной композиции, а на
   * desktop дублировалось пятью постоянными кнопками с длинными подписями
   * («1ч · таймфрейм», «Тип графика · Свечи»). Одна композиция = одно место
   * правки: изменение toolbar автоматически применяется к Spot и Futures,
   * к мобильной и десктопной ширине (задача §10, §17).
   *
   * Отличается ТОЛЬКО плотность (`compact`): подписи, тап-цели 36px и место
   * fullscreen-контрола (рельс справа на desktop, оверлей внутри рамки на
   * мобильном).
   */
  const renderToolbar = (density: 'compact' | 'desktop') => {
    const dense = density === 'compact';
    return (
      <div
        data-qa="chart-terminal-toolbar"
        data-testid="chart-terminal-toolbar"
        data-layout={density}
        /* Единый состав контролов; `data-controls` фиксирует инвариант в DOM. */
        data-controls="unified"
        className={`flex w-full min-w-0 flex-nowrap items-center gap-1.5 border-b border-white/[0.08] bg-surface/80 py-1.5 ${
          dense ? 'px-2' : 'px-2.5 sm:px-3'
        }`}
      >
        <TerminalDropdown
          menuKey="timeframe"
          label={formatTerminalTimeframe(timeframe)}
          fullLabel={`Таймфрейм: ${formatTerminalTimeframe(timeframe)}`}
          icon={dense ? undefined : Layers3}
          compact={dense}
          open={openMenu === 'timeframe'}
          onToggle={() => toggleMenu('timeframe')}
          onClose={closeMenu}
          testId="chart-timeframe-trigger"
        >
          {timeframeItems}
        </TerminalDropdown>

        <TerminalDropdown
          menuKey="chart-type"
          label={dense ? 'Тип' : CHART_TYPE_LABELS[chartType]}
          fullLabel={`Тип графика: ${CHART_TYPE_LABELS[chartType]}`}
          icon={BarChart3}
          compact={dense}
          open={openMenu === 'chart-type'}
          onToggle={() => toggleMenu('chart-type')}
          onClose={closeMenu}
          testId="chart-type-trigger"
        >
          {chartTypeItems}
        </TerminalDropdown>

        <TerminalDropdown
          menuKey="indicators"
          label="Индикаторы"
          fullLabel="Индикаторы: панели и оверлеи"
          icon={dense ? undefined : LineChart}
          compact={dense}
          open={openMenu === 'indicators'}
          onToggle={() => toggleMenu('indicators')}
          onClose={closeMenu}
          testId="chart-indicators-trigger"
        >
          {indicatorItems}
        </TerminalDropdown>

        <div className="ml-auto flex shrink-0 items-center">
          <TerminalDropdown
            menuKey="more"
            label="Ещё"
            fullLabel="Ещё: шаблоны, настройки, вписать данные"
            icon={MoreHorizontal}
            compact={dense}
            iconOnly
            open={openMenu === 'more'}
            onToggle={() => toggleMenu('more')}
            onClose={closeMenu}
            testId="chart-more-trigger"
          >
            <div data-qa="chart-more-templates" className="px-3 pb-1.5 pt-1 font-sans text-[11px] font-semibold tracking-[0.14em] text-slate-500">Шаблоны</div>
            {templateItems}
            <div data-qa="chart-more-settings" className="mt-1 border-t border-white/[0.08] px-3 pb-1.5 pt-2 font-sans text-[11px] font-semibold tracking-[0.14em] text-slate-500">Настройки</div>
            {settingsItems}
            <div className="mt-1 border-t border-white/[0.08] pt-1">
              {renderFitDataItem('chart-reset-view')}
            </div>
          </TerminalDropdown>
        </div>
      </div>
    );
  };

  /**
   * Fullscreen-контрол существует ровно в ОДНОМ экземпляре: либо на desktop
   * side rail (PR #32), либо как мобильный оверлей внутри рамки графика.
   * Оба варианта вызывают тот же самый `toggleFullscreen()` и тот же
   * `terminalRef` fullscreen-элемент — второй реализации fullscreen нет
   * (инвариант PR #31 / #32).
   */
  const fullscreenButton = (variant: 'rail' | 'overlay') => (
    <button
      type="button"
      data-qa="chart-fullscreen"
      data-testid="chart-fullscreen"
      data-variant={variant}
      title={fullscreenLabel}
      aria-label={fullscreenLabel}
      aria-pressed={isFullscreen}
      onClick={() => void toggleFullscreen()}
      className={
        variant === 'rail'
          ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-surface-border bg-surface-elevated text-slate-300 shadow-sm shadow-black/20 transition-colors hover:border-brand-cyan/50 hover:bg-brand-cyan/10 hover:text-brand-cyan focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-cyan'
          : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-surface-border bg-surface/90 text-slate-200 shadow-sm shadow-black/30 backdrop-blur-sm transition-colors hover:border-brand-cyan/50 hover:bg-brand-cyan/10 hover:text-brand-cyan focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-cyan'
      }
    >
      {variant === 'rail'
        ? (isFullscreen ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />)
        : fullscreenIcon}
    </button>
  );

  return (
    <div
      ref={terminalRef}
      data-qa="chart-terminal"
      data-composition={compact ? 'compact' : 'desktop'}
      className={`w-full rounded-xl border border-white/[0.08] bg-surface shadow-panel-elevated ${isFullscreen ? 'min-h-screen p-3 sm:p-4' : ''}`}
    >
      {renderToolbar(compact ? 'compact' : 'desktop')}

      {/*
       * Chart workspace = [график | (только desktop) правая кромка терминала].
       *
       * Desktop (PR #32): рельс — обычная flex-колонка фиксированной ширины,
       * он не накладывается на график и не может перекрыть price scale.
       *
       * Mobile: отдельная вертикальная колонка справа НЕ выделяется — она
       * съедала ~32px и без того узкого канваса. Вместо неё контрол живёт
       * плавающим оверлеем внутри рамки графика (`topRightSlot`), который
       * позиционируется левее ФАКТИЧЕСКОЙ правой шкалы и стоит в одном flex-ряду
       * с бейджами, поэтому не перекрывает ни подписи цены, ни бейджи и не
       * уменьшает ширину канваса.
       *
       * Порядок дочерних узлов стабилен в обоих режимах: CandleChart всегда
       * первый ребёнок первой колонки, поэтому переход desktop <-> mobile
       * (смена ширины окна) НЕ размонтирует график — серия и история свечей
       * сохраняются (инвариант PR #31).
       */}
      <div className={`flex w-full items-stretch ${isFullscreen ? 'mt-3 flex-1' : ''}`}>
        <div className="min-w-0 flex-1">
          <CandleChart
            data={data}
            symbol={symbol}
            timeframe={timeframe}
            height={isFullscreen ? fullscreenHeight : height}
            indicators={indicators}
            realtimeKline={realtimeKline}
            showRSI={showRSI}
            showMACD={showMACD}
            chartType={chartType}
            showMA={showMA}
            showVolume={showVolume}
            showBadges
            showTimezone={showTimezone}
            showResetControl={false}
            resetViewToken={resetViewToken}
            compactPriceLabels={compact}
            topRightSlot={compact ? fullscreenButton('overlay') : undefined}
          />
        </div>
        {!compact && (
          <div
            data-qa="chart-side-rail"
            data-testid="chart-side-rail"
            className="flex w-8 shrink-0 flex-col items-center gap-1.5 self-stretch pl-1.5 pt-1.5 sm:w-9 sm:pl-2"
          >
            {fullscreenButton('rail')}
          </div>
        )}
      </div>
    </div>
  );
};
