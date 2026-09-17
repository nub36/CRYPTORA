/**
 * Тема оформления терминала (UX-цикл п. 4).
 *
 * Три режима выбора: 'dark' | 'light' | 'system'. Режим 'system' следует за
 * `prefers-color-scheme` и реагирует на его изменение без перезагрузки.
 * Выбор сохраняется в localStorage (ключ THEME_STORAGE_KEY). Невалидное или
 * отсутствующее значение → 'system'. Эффективная тема ставится классом на <html>
 * (`dark` | `light`, см. tailwind `darkMode: 'class'` и токены src/index.css).
 *
 * Чистая логика без React — используется и в ThemeProvider, и в inline-скрипте
 * index.html (анти-FOUC), и в тестах.
 */
export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'cryptora_theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['dark', 'light', 'system'];

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'dark' || v === 'light' || v === 'system';
}

export function readStoredPreference(storage: Pick<Storage, 'getItem'> | null | undefined): ThemePreference {
  try {
    const raw = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

export function applyThemeToDocument(doc: Document, pref: ThemePreference, resolved: ResolvedTheme): void {
  const root = doc.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(resolved);
  root.setAttribute('data-theme', pref);
  root.style.colorScheme = resolved;
}

export function nextPreference(pref: ThemePreference): ThemePreference {
  const i = THEME_PREFERENCES.indexOf(pref);
  return THEME_PREFERENCES[(i + 1) % THEME_PREFERENCES.length];
}

export const THEME_LABELS_RU: Record<ThemePreference, string> = {
  dark: 'Тёмная',
  light: 'Светлая',
  system: 'Системная',
};

/** Прочитать CSS-токен темы (для графиков canvas/lightweight-charts). */
export function readThemeToken(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
