/**
 * ChartDisplaySettingsModal — компактное меню настроек отображения графика (§6, §7).
 *
 * Переключатели:
 *   [✓] Сигналы — компактные маркеры на свечах;
 *   [✓] Уровни выбранного сигнала — линии входа, стопа и целей;
 *   [ ] Подписи уровней — компактные названия (E1, SL, TP1) на графике;
 *   [✓] Объём — гистограмма объёма под свечами;
 *   [ ] Технические бейджи — источник свечей и статус kline WS.
 *
 * Настройки сохраняются в localStorage и на mobile по умолчанию минималистичны (§7).
 * Время устройства отображается в заголовке окна без загрязнения canvas (§11).
 */

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { timeZoneLabelWithOffset } from '@/utils/timePresentation';

export interface ChartDisplaySettings {
  showMarkers: boolean;
  showLevels: boolean;
  showLevelLabels: boolean;
  showVolume: boolean;
  showBadges: boolean;
}

export const DEFAULT_CHART_DISPLAY_SETTINGS: ChartDisplaySettings = {
  showMarkers: true,
  showLevels: true,
  showLevelLabels: false,
  showVolume: true,
  showBadges: false,
};

export const CHART_SETTINGS_STORAGE_KEY = 'cryptora_chart_display_settings';

export function loadChartDisplaySettings(): ChartDisplaySettings {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(CHART_SETTINGS_STORAGE_KEY) : null;
    if (!raw) return DEFAULT_CHART_DISPLAY_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      showMarkers: typeof parsed.showMarkers === 'boolean' ? parsed.showMarkers : DEFAULT_CHART_DISPLAY_SETTINGS.showMarkers,
      showLevels: typeof parsed.showLevels === 'boolean' ? parsed.showLevels : DEFAULT_CHART_DISPLAY_SETTINGS.showLevels,
      showLevelLabels: typeof parsed.showLevelLabels === 'boolean' ? parsed.showLevelLabels : DEFAULT_CHART_DISPLAY_SETTINGS.showLevelLabels,
      showVolume: typeof parsed.showVolume === 'boolean' ? parsed.showVolume : DEFAULT_CHART_DISPLAY_SETTINGS.showVolume,
      showBadges: typeof parsed.showBadges === 'boolean' ? parsed.showBadges : DEFAULT_CHART_DISPLAY_SETTINGS.showBadges,
    };
  } catch {
    return DEFAULT_CHART_DISPLAY_SETTINGS;
  }
}

export function saveChartDisplaySettings(settings: ChartDisplaySettings): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(CHART_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
  } catch {
    // ignore quota errors
  }
}

interface ChartDisplaySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ChartDisplaySettings;
  onChange: (settings: ChartDisplaySettings) => void;
}

interface SettingToggleProps {
  id: string;
  testId: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const SettingToggle: React.FC<SettingToggleProps> = ({
  id,
  testId,
  label,
  description,
  checked,
  onChange,
}) => (
  <div className="flex items-start justify-between gap-3 rounded-lg border border-surface-border/60 bg-surface-elevated/40 p-2.5 transition-colors hover:border-surface-border hover:bg-surface-elevated/80">
    <label htmlFor={id} className="flex flex-1 cursor-pointer flex-col">
      <span className="font-sans text-xs font-semibold text-white">{label}</span>
      <span className="text-[11px] text-slate-400">{description}</span>
    </label>
    <div className="relative inline-flex items-center pt-0.5">
      <input
        id={id}
        data-qa={testId}
        data-testid={testId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 cursor-pointer rounded border border-slate-600 bg-surface text-brand-cyan accent-cyan-400 focus:ring-1 focus:ring-brand-cyan focus:ring-offset-0"
      />
    </div>
  </div>
);

export const ChartDisplaySettingsModal: React.FC<ChartDisplaySettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onChange,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Закрытие по Escape (§18)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const updateSetting = <K extends keyof ChartDisplaySettings>(key: K, value: ChartDisplaySettings[K]) => {
    const updated = { ...settings, [key]: value };
    onChange(updated);
    saveChartDisplaySettings(updated);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="chart-display-settings-title"
      data-qa="chart-display-settings-modal"
      data-testid="chart-display-settings-modal"
    >
      <div
        ref={modalRef}
        className="w-full max-w-sm rounded-xl border border-surface-border bg-slate-900 p-4 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-surface-border pb-3">
          <div>
            <h2 id="chart-display-settings-title" className="ui-card-title text-base font-bold text-white">
              Отображение графика
            </h2>
            <p
              className="text-[11px] text-slate-400 mt-0.5"
              data-qa="display-settings-timezone"
              data-testid="display-settings-timezone"
            >
              Время: системное ({timeZoneLabelWithOffset('BROWSER')})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть настройки"
            data-qa="chart-display-settings-close"
            data-testid="chart-display-settings-close"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-border bg-surface-elevated text-slate-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          <SettingToggle
            id="toggle-markers"
            testId="toggle-markers"
            label="Сигналы"
            description="Компактные маркеры направления на свечах"
            checked={settings.showMarkers}
            onChange={(checked) => updateSetting('showMarkers', checked)}
          />

          <SettingToggle
            id="toggle-levels"
            testId="toggle-levels"
            label="Уровни выбранного сигнала"
            description="Линии входа, стопа и целей на графике"
            checked={settings.showLevels}
            onChange={(checked) => updateSetting('showLevels', checked)}
          />

          <SettingToggle
            id="toggle-level-labels"
            testId="toggle-level-labels"
            label="Подписи уровней"
            description="Текстовые метки (Вход ↓, Стоп, TP1) у линий"
            checked={settings.showLevelLabels}
            onChange={(checked) => updateSetting('showLevelLabels', checked)}
          />

          <SettingToggle
            id="toggle-volume"
            testId="toggle-volume"
            label="Объём"
            description="Гистограмма объёма торгов под свечами"
            checked={settings.showVolume}
            onChange={(checked) => updateSetting('showVolume', checked)}
          />

          <SettingToggle
            id="toggle-badges"
            testId="toggle-badges"
            label="Технические бейджи"
            description="Источник котировок и статус соединения в шапке"
            checked={settings.showBadges}
            onChange={(checked) => updateSetting('showBadges', checked)}
          />
        </div>

        <div className="rounded border border-surface-border/40 bg-surface-elevated/20 px-2.5 py-1.5 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Справка сокращений:</span>
          <span className="font-mono text-slate-300">Вход (E) · Стоп (SL) · Цель (TP)</span>
        </div>
      </div>
    </div>
  );
};

export default ChartDisplaySettingsModal;
