import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  Layers3,
  LineChart,
  Maximize2,
  Minimize2,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import type { OHLCV, Timeframe } from '@/types/market';
import { CandleChart, type CandleChartType, type ChartIndicatorData } from './CandleChart';
import type { KlineTick } from '@/types/realtime';

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

type TerminalMenuKey = 'timeframe' | 'chart-type' | 'indicators' | 'templates' | 'settings' | null;

interface TerminalDropdownProps {
  menuKey: Exclude<TerminalMenuKey, null>;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: React.ReactNode;
  testId: string;
  activeLabel?: string;
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
    const maxWidth = menuKey === 'indicators' ? 248 : 230;
    const width = Math.min(maxWidth, Math.max(170, window.innerWidth - 24));
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
    const estimatedHeight = menuKey === 'timeframe' ? 292 : 250;
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

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-qa={testId}
        data-testid={testId}
        onClick={onToggle}
        onKeyDown={onTriggerKeyDown}
        className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-sans text-[11px] font-semibold transition-colors sm:text-xs ${
          open
            ? 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan'
            : 'border-surface-border bg-surface-elevated text-slate-300 hover:border-brand-cyan/50 hover:text-white'
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
        {activeLabel && <span className="hidden font-mono text-slate-400 lg:inline">· {activeLabel}</span>}
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          data-qa={`${testId}-menu`}
          data-testid={`${testId}-menu`}
          style={{ position: 'fixed', top: position.top, left: position.left, width: position.width }}
          className="z-[80] max-h-[min(320px,calc(100vh-24px))] overflow-y-auto rounded-lg border border-surface-border bg-surface-elevated p-1.5 shadow-2xl shadow-black/40"
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
  const [openMenu, setOpenMenu] = useState<TerminalMenuKey>(null);
  const [resetViewToken, setResetViewToken] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenHeight, setFullscreenHeight] = useState(700);

  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const toggleMenu = useCallback((menu: Exclude<TerminalMenuKey, null>) => {
    setOpenMenu((current) => current === menu ? null : menu);
  }, []);

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

  return (
    <div
      ref={terminalRef}
      data-qa="chart-terminal"
      className={`w-full rounded-xl border border-white/[0.08] bg-surface shadow-panel-elevated ${isFullscreen ? 'min-h-screen p-3 sm:p-4' : ''}`}
    >
      <div
        data-qa="chart-terminal-toolbar"
        /*
         * Состав строки: [таймфрейм] [Тип графика] [Индикаторы] [Шаблоны]
         * [Настройки] … [Вписать]. Fullscreen-контрол переехал на правую кромку
         * chart workspace, спейсер под него НЕ оставлен: правая группа — обычный
         * `ml-auto`-кластер, он просто стал у́же на ширину бывшей иконки.
         *
         * Desktop (lg+, ≥1024px): единая профессиональная строка — `flex-nowrap`,
         * поэтому [Вписать] с `ml-auto` держится справа и НЕ переносится
         * на вторую строку (owner-репорт был на desktop). Ранее `flex-wrap` при чуть
         * более узкой рабочей области сбрасывал правую группу на новый ряд.
         * Tablet/mobile (<lg): перенос сохранён — на планшете (768px) все контролы в
         * одну строку не влезают, а `nowrap` дал бы page horizontal overflow (см.
         * e2e/mobileOverflow). `min-w-0` дополнительно страхует от распирания
         * grid-колонки. Вертикальные паддинги уменьшены — chrome компактнее,
         * график начинается выше (§11).
         */
        className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-white/[0.08] bg-surface/80 px-2.5 py-1.5 sm:px-3 lg:flex-nowrap"
      >
        <TerminalDropdown
          menuKey="timeframe"
          label={formatTerminalTimeframe(timeframe)}
          activeLabel="таймфрейм"
          icon={Layers3}
          open={openMenu === 'timeframe'}
          onToggle={() => toggleMenu('timeframe')}
          onClose={closeMenu}
          testId="chart-timeframe-trigger"
        >
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
        </TerminalDropdown>

        <TerminalDropdown
          menuKey="chart-type"
          label="Тип графика"
          activeLabel={CHART_TYPE_LABELS[chartType]}
          icon={BarChart3}
          open={openMenu === 'chart-type'}
          onToggle={() => toggleMenu('chart-type')}
          onClose={closeMenu}
          testId="chart-type-trigger"
        >
          {(['candles', 'line'] as CandleChartType[]).map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
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
        </TerminalDropdown>

        <TerminalDropdown
          menuKey="indicators"
          label="Индикаторы"
          icon={LineChart}
          open={openMenu === 'indicators'}
          onToggle={() => toggleMenu('indicators')}
          onClose={closeMenu}
          testId="chart-indicators-trigger"
        >
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
        </TerminalDropdown>

        <TerminalDropdown
          menuKey="templates"
          label="Шаблоны"
          icon={Layers3}
          open={openMenu === 'templates'}
          onToggle={() => toggleMenu('templates')}
          onClose={closeMenu}
          testId="chart-templates-trigger"
        >
          <button type="button" role="menuitem" className={menuButtonClass()} onClick={() => applyTemplate('default')}>
            <span><strong className="font-semibold text-white">По умолчанию</strong><span className="block text-[11px] text-slate-500">Свечи · MA · объём</span></span>
          </button>
          <button type="button" role="menuitem" className={menuButtonClass()} onClick={() => applyTemplate('clean')}>
            <span><strong className="font-semibold text-white">Чистый график</strong><span className="block text-[11px] text-slate-500">Цена и время</span></span>
          </button>
          <button type="button" role="menuitem" className={menuButtonClass()} onClick={() => applyTemplate('momentum')}>
            <span><strong className="font-semibold text-white">Momentum</strong><span className="block text-[11px] text-slate-500">RSI · MACD · объём</span></span>
          </button>
        </TerminalDropdown>

        <TerminalDropdown
          menuKey="settings"
          label="Настройки"
          icon={Settings2}
          open={openMenu === 'settings'}
          onToggle={() => toggleMenu('settings')}
          onClose={closeMenu}
          testId="chart-settings-trigger"
        >
          <button type="button" role="menuitemcheckbox" aria-checked={showVolume} className={menuButtonClass(showVolume)} onClick={() => onShowVolumeChange(!showVolume)}>
            <span>Объём</span>
            <span className="font-mono text-[11px] text-slate-500">{showVolume ? 'Вкл' : 'Выкл'}</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={showTimezone} className={menuButtonClass(showTimezone)} onClick={() => onShowTimezoneChange(!showTimezone)}>
            <span>Часовой пояс</span>
            <span className="font-mono text-[11px] text-slate-500">{showTimezone ? 'Вкл' : 'Выкл'}</span>
          </button>
          <button type="button" role="menuitem" className={menuButtonClass()} onClick={() => { setResetViewToken((value) => value + 1); closeMenu(); }}>
            <span>Вписать данные</span>
            <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
          </button>
        </TerminalDropdown>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            data-qa="chart-reset-view"
            title="Вписать данные в область графика"
            aria-label="Вписать данные"
            onClick={() => setResetViewToken((value) => value + 1)}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-surface-border bg-surface-elevated px-2.5 py-1.5 font-sans text-[11px] font-semibold text-slate-300 transition-colors hover:border-brand-cyan/50 hover:text-white sm:text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Вписать</span>
          </button>
        </div>
      </div>

      {/*
       * Chart workspace = [график | правая кромка терминала].
       *
       * Кнопка «Развернуть график» перенесена из верхнего toolbar на правую
       * боковую кромку терминала. Это НЕ absolute-наложение поверх графика:
       * рельс — обычная flex-колонка фиксированной ширины внутри того же
       * контейнера, поэтому он физически не может перекрыть price scale или
       * свечи, не требует отрицательных offsets и не выходит за пределы
       * terminal-колонки (никакого horizontal overflow и никакого конфликта с
       * правыми карточками страницы — они живут в соседней grid-колонке).
       * График занимает оставшуюся ширину (`min-w-0 flex-1`) и сжимается
       * штатным ResizeObserver'ом CandleChart — размер меняется in-place, серия
       * и история свечей не пересоздаются (регрессия PR #31 не затрагивается).
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
          />
        </div>
        <div
          data-qa="chart-side-rail"
          data-testid="chart-side-rail"
          className="flex w-8 shrink-0 flex-col items-center gap-1.5 self-stretch pl-1.5 pt-1.5 sm:w-9 sm:pl-2"
        >
          <button
            type="button"
            data-qa="chart-fullscreen"
            data-testid="chart-fullscreen"
            title={isFullscreen ? 'Выйти из полноэкранного режима' : 'Развернуть график'}
            aria-label={isFullscreen ? 'Выйти из полноэкранного режима' : 'Развернуть график'}
            aria-pressed={isFullscreen}
            onClick={() => void toggleFullscreen()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-surface-border bg-surface-elevated text-slate-300 shadow-sm shadow-black/20 transition-colors hover:border-brand-cyan/50 hover:bg-brand-cyan/10 hover:text-brand-cyan focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-cyan"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
};
