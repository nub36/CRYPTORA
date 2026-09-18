import React from 'react';
import { Moon, Sun, MonitorSmartphone } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { nextPreference, THEME_LABELS_RU } from '@/theme/theme';

const ICONS = { dark: Moon, light: Sun, system: MonitorSmartphone } as const;

/**
 * Циклический переключатель темы: Тёмная → Светлая → Системная.
 * Один компактный контрол в шапке; текущее состояние — в title/aria-label.
 */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { preference, resolved, setPreference } = useTheme();
  const Icon = ICONS[preference];
  const next = nextPreference(preference);
  const label = `Тема: ${THEME_LABELS_RU[preference]}${preference === 'system' ? ` (${THEME_LABELS_RU[resolved].toLowerCase()})` : ''}. Нажмите — ${THEME_LABELS_RU[next].toLowerCase()}`;
  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      title={label}
      aria-label={label}
      data-testid="theme-toggle"
      data-theme-preference={preference}
      className={`shrink-0 rounded-md border border-transparent p-2 text-slate-300 transition-colors hover:border-white/[0.08] hover:bg-white/[0.06] hover:text-white ${className}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
};
