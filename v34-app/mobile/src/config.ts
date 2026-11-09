/**
 * Конфигурация сборки. Адрес backend задаётся при сборке и НЕ угадывается:
 * если он не задан, приложение честно говорит об этом вместо пустого списка.
 */

export interface ExpoConfigLike {
  version?: string;
  extra?: { apiBaseUrl?: unknown } | null;
}

export const DEFAULT_APP_VERSION = '0.1.0';

/** Приоритет: extra.apiBaseUrl (app.config.js) → EXPO_PUBLIC_API_BASE_URL. */
export function resolveApiBaseUrl(
  expoConfig: ExpoConfigLike | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  const extra = expoConfig?.extra;
  const fromExtra = extra && typeof extra.apiBaseUrl === 'string' ? extra.apiBaseUrl.trim() : '';
  if (fromExtra) return fromExtra;
  const fromEnv = typeof env.EXPO_PUBLIC_API_BASE_URL === 'string' ? env.EXPO_PUBLIC_API_BASE_URL.trim() : '';
  return fromEnv;
}

export function resolveAppVersion(expoConfig: ExpoConfigLike | null | undefined): string {
  const v = expoConfig?.version;
  return typeof v === 'string' && v.length > 0 ? v : DEFAULT_APP_VERSION;
}
