/**
 * Конфигурация сборки. Адрес backend задаётся при сборке и НЕ угадывается:
 * если он не задан, приложение честно говорит об этом вместо пустого списка.
 */

export interface ExpoConfigLike {
  version?: string;
  extra?: { apiBaseUrl?: unknown } | null;
}

export const DEFAULT_APP_VERSION = '0.1.0';

/** Домены-заглушки: сборка с ними не должна выглядеть «настроенной». */
const PLACEHOLDER_DOMAINS = ['example.com', 'example.org', 'example.net', 'example', 'test', 'invalid', 'localdomain'];
const PLACEHOLDER_PARTS = ['example.com', 'your-domain', 'yourdomain', 'changeme', 'placeholder', 'signals.example'];
/** Локальные адреса для отладки на эмуляторе — единственное исключение для http. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2', '::1']);

export interface ApiBaseUrlCheck {
  /** Нормализованный адрес или пустая строка, если адрес непригоден. */
  url: string;
  /** Причина отказа (для честного сообщения в UI), иначе null. */
  error: string | null;
}

/**
 * Проверка адреса backend'а.
 *
 * Заглушки (`signals.example.com` и подобные) и небезопасный http (кроме
 * локального эмулятора) считаются ОШИБКОЙ КОНФИГУРАЦИИ, а не рабочим адресом:
 * иначе приложение молча ходит в несуществующий домен и показывает «сеть
 * недоступна» вместо «сервер не настроен».
 */
export function checkApiBaseUrl(raw: string | null | undefined): ApiBaseUrlCheck {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return { url: '', error: 'адрес backend не задан при сборке' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { url: '', error: `адрес backend не является URL: ${value}` };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { url: '', error: `неподдерживаемая схема адреса backend: ${parsed.protocol}` };
  }
  const host = parsed.hostname.toLowerCase();
  const placeholderDomain = PLACEHOLDER_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  if (placeholderDomain || PLACEHOLDER_PARTS.some((p) => host.includes(p))) {
    return { url: '', error: `адрес backend — заглушка: ${host}` };
  }
  if (parsed.protocol === 'http:' && !LOCAL_HOSTS.has(host)) {
    return { url: '', error: 'backend должен быть доступен по HTTPS (http допускается только для локального эмулятора)' };
  }
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    return { url: '', error: 'адрес backend должен быть корнем сайта, без пути и параметров' };
  }
  // Хвостовой слэш не нужен: клиент склеивает пути сам.
  return { url: parsed.origin, error: null };
}

/** Приоритет: extra.apiBaseUrl (app.config.js) → EXPO_PUBLIC_API_BASE_URL. */
export function resolveApiBaseUrl(
  expoConfig: ExpoConfigLike | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  const extra = expoConfig?.extra;
  const fromExtra = extra && typeof extra.apiBaseUrl === 'string' ? extra.apiBaseUrl.trim() : '';
  if (fromExtra) return checkApiBaseUrl(fromExtra).url;
  const fromEnv = typeof env.EXPO_PUBLIC_API_BASE_URL === 'string' ? env.EXPO_PUBLIC_API_BASE_URL.trim() : '';
  return checkApiBaseUrl(fromEnv).url;
}

/** Причина, по которой адрес не принят (для экрана «Сервер не настроен»). */
export function apiBaseUrlError(
  expoConfig: ExpoConfigLike | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const extra = expoConfig?.extra;
  const fromExtra = extra && typeof extra.apiBaseUrl === 'string' ? extra.apiBaseUrl.trim() : '';
  const raw = fromExtra || (typeof env.EXPO_PUBLIC_API_BASE_URL === 'string' ? env.EXPO_PUBLIC_API_BASE_URL.trim() : '');
  return checkApiBaseUrl(raw).error;
}

export function resolveAppVersion(expoConfig: ExpoConfigLike | null | undefined): string {
  const v = expoConfig?.version;
  return typeof v === 'string' && v.length > 0 ? v : DEFAULT_APP_VERSION;
}
