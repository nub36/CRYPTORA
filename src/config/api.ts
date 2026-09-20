/**
 * CRYPTORA — API base resolver for static hosting (GitHub Pages) vs VPS
 *
 * - На VPS (Nginx) фронтенд и бэкенд на одном origin → VITE_API_BASE_URL не задаётся,
 *   apiUrl('/api/auth/session') === '/api/auth/session' → проксируется Nginx на 127.0.0.1:3000.
 * - На GitHub Pages бэкенда нет → запросы на /api/* вернут 404.html (статику GitHub).
 *   Чтобы не спамить сеть и не парсить HTML как JSON, проверяется isGithubPages без VITE_API_BASE_URL.
 * - Если есть выделенный API-хост (например, https://api.cryptora.app) → задай
 *   VITE_API_BASE_URL=https://api.cryptora.app  (без слеша на конце) и пересобери.
 */

function readViteEnv(): Record<string, string | undefined> | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string> }).env;
  } catch {
    return undefined;
  }
}

const env = readViteEnv();
const rawBase = env?.VITE_API_BASE_URL?.trim() ?? '';

/** Пустая строка = same-origin (Nginx-прокси). Непустая = абсолютный origin API. */
export const API_BASE_URL: string = rawBase.replace(/\/+$/, '');

export const isApiConfigured: boolean = API_BASE_URL.length > 0;

/** GitHub Pages детект (hostname *.github.io). Используется для graceful-degradation без сети. */
export function isGitHubPagesHost(): boolean {
  try {
    return typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');
  } catch {
    return false;
  }
}

/** true — когда мы на Pages и API не настроен → /api/* заведомо недоступен. */
export const isStaticHostingWithoutApi: boolean = !isApiConfigured && isGitHubPagesHost();

/**
 * Склейка пути API с базой.
 * apiUrl('/api/auth/session') → '/api/auth/session' (same-origin) или 'https://api.example.com/api/auth/session'
 */
export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

/**
 * Безопасный fetch для API. Если мы на Pages без бэкенда — не делает сети, а
 * кидает управляемую ошибку, которую вызывающий код ловит и показывает
 * «Авторизация недоступна в статической сборке».
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isStaticHostingWithoutApi) {
    throw new Error('API_NOT_CONFIGURED_ON_STATIC_HOST');
  }
  return fetch(apiUrl(input), init);
}
