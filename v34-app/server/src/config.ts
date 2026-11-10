/**
 * Конфигурация backend-продукта V3.4.
 *
 * Принципы:
 *   • никаких секретов в коде и в Git: значения приходят из окружения
 *     (systemd EnvironmentFile / .env вне репозитория);
 *   • торговых ключей здесь нет и быть не может — только публичные данные;
 *   • всё, что влияет на безопасность (пути, интервалы, список символов),
 *     имеет явные значения по умолчанию и валидируется при старте.
 */
import path from 'node:path';
import { V34_SYMBOLS, V34_DEFAULT_SCAN_INTERVAL_SECONDS, MARKET_DATA_SOURCE } from '@v34/core';

export interface AppConfig {
  host: string;
  /** true — сервер явно разрешён слушать не-loopback интерфейс. */
  publicBind: boolean;
  port: number;
  /** Путь к файлу SQLite (собственная БД продукта). */
  dbPath: string;
  /** Интервал скана, мс. */
  scanIntervalMs: number;
  /** Задержка первого скана после старта, мс. */
  scanInitialDelayMs: number;
  /** Вселенная скана (биржевые символы). */
  symbols: readonly string[];
  /** Таймаут запроса к бирже, мс. */
  marketTimeoutMs: number;
  /** Каталог со статикой лендинга (index.html, assets). */
  staticDir: string | null;
  /** Каталог с APK и apk/manifest.json. */
  apkDir: string | null;
  /** Публичный базовый URL продукта (для ссылок в лендинге и push). */
  publicBaseUrl: string | null;
  /** Разрешённые Origin для браузерных запросов. Пусто — CORS не включается. */
  allowedOrigins: readonly string[];
  /** Включать ли отправку push (требует Firebase-конфигурации). */
  pushEnabled: boolean;
  fcm: {
    projectId: string | null;
    /** Путь к JSON сервисного аккаунта ВНЕ репозитория. */
    serviceAccountFile: string | null;
  };
  /** Максимум записей устройств: защита от роста БД публичной регистрацией. */
  maxDevices: number;
  /** Срок жизни регистрации без обновления, дни (потом токен вычищается). */
  deviceTtlDays: number;
  /** Версия приложения, с которой совместим API (информативно). */
  minAppVersion: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', 'localhost.localdomain']);

/** Хост считается «наружу», если это не loopback. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

function list(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Хост прослушивания.
 *
 * По умолчанию — только loopback: наружу backend обязан выходить через
 * HTTPS-reverse-proxy (nginx), а не открытым портом. Не-loopback адрес
 * принимается только при явном `V34_ALLOW_PUBLIC_BIND=true` — чтобы внешний
 * bind не включался «случайно» и не оказывался API без TLS.
 */
function resolveHost(env: NodeJS.ProcessEnv): { host: string; publicBind: boolean } {
  const raw = env.V34_HOST?.trim() || '127.0.0.1';
  const explicitPublic = bool(env.V34_ALLOW_PUBLIC_BIND, false);
  if (isLoopbackHost(raw)) return { host: raw, publicBind: false };
  if (!explicitPublic) {
    throw new Error(
      `V34_HOST=${raw}: внешний bind запрещён. Backend должен слушать 127.0.0.1 за HTTPS-прокси; `
      + 'если это осознанное решение, задайте V34_ALLOW_PUBLIC_BIND=true.',
    );
  }
  return { host: raw, publicBind: true };
}

/**
 * Разбор окружения. Ошибки формулируются явно: сервер не стартует «на
 * полусломанной» конфигурации (например, с отрицательным интервалом).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = num(env.V34_PORT, 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`V34_PORT вне диапазона: ${env.V34_PORT}`);

  const scanIntervalSeconds = num(env.V34_SCAN_INTERVAL_SECONDS, V34_DEFAULT_SCAN_INTERVAL_SECONDS);
  if (!(scanIntervalSeconds >= 15)) throw new Error('V34_SCAN_INTERVAL_SECONDS должен быть ≥ 15');

  const symbols = list(env.V34_SYMBOLS);
  for (const s of symbols) {
    if (!/^[A-Z0-9]{4,20}$/.test(s)) throw new Error(`V34_SYMBOLS: недопустимый символ ${JSON.stringify(s)} (ожидается формат BTCUSDT)`);
  }

  const maxDevices = Math.trunc(num(env.V34_MAX_DEVICES, 5000));
  if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 1_000_000) {
    throw new Error(`V34_MAX_DEVICES вне диапазона 1..1000000: ${env.V34_MAX_DEVICES}`);
  }
  const deviceTtlDays = Math.trunc(num(env.V34_DEVICE_TTL_DAYS, 90));
  if (!Number.isInteger(deviceTtlDays) || deviceTtlDays < 1 || deviceTtlDays > 3650) {
    throw new Error(`V34_DEVICE_TTL_DAYS вне диапазона 1..3650: ${env.V34_DEVICE_TTL_DAYS}`);
  }

  const pushEnabled = bool(env.V34_PUSH_ENABLED, false);
  const fcmProjectId = env.V34_FCM_PROJECT_ID?.trim() || null;
  const fcmServiceAccountFile = env.V34_FCM_SERVICE_ACCOUNT_FILE?.trim() || null;

  return {
    ...resolveHost(env),
    port,
    dbPath: env.V34_DB_PATH?.trim() || path.resolve(process.cwd(), 'data/v34.sqlite'),
    scanIntervalMs: Math.round(scanIntervalSeconds * 1000),
    scanInitialDelayMs: Math.max(0, num(env.V34_SCAN_INITIAL_DELAY_MS, 5_000)),
    symbols: symbols.length > 0 ? symbols : V34_SYMBOLS,
    marketTimeoutMs: Math.max(1000, num(env.V34_MARKET_TIMEOUT_MS, MARKET_DATA_SOURCE.requestTimeoutMs)),
    staticDir: env.V34_STATIC_DIR?.trim() || null,
    apkDir: env.V34_APK_DIR?.trim() || null,
    publicBaseUrl: env.V34_PUBLIC_BASE_URL?.trim() || null,
    allowedOrigins: list(env.V34_ALLOWED_ORIGINS),
    pushEnabled,
    fcm: { projectId: fcmProjectId, serviceAccountFile: fcmServiceAccountFile },
    maxDevices,
    deviceTtlDays,
    minAppVersion: env.V34_MIN_APP_VERSION?.trim() || '0.1.0',
    logLevel: (['debug', 'info', 'warn', 'error'] as const).find((l) => l === env.V34_LOG_LEVEL) ?? 'info',
  };
}

/**
 * Состояние push-интеграции в честном виде.
 *
 * Пока Firebase-конфигурации нет, API обязан отвечать `configured: false` и
 * НЕ утверждать, что уведомления работают. Наличие файла ключа проверяется
 * при старте (см. push/fcm.ts), а не здесь, чтобы конфиг оставался чистым.
 */
export function pushConfigState(config: AppConfig): {
  enabled: boolean;
  configured: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!config.fcm.projectId) missing.push('V34_FCM_PROJECT_ID');
  if (!config.fcm.serviceAccountFile) missing.push('V34_FCM_SERVICE_ACCOUNT_FILE');
  if (!config.pushEnabled) missing.push('V34_PUSH_ENABLED=true');
  return { enabled: config.pushEnabled, configured: missing.length === 0, missing };
}
