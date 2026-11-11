/**
 * Публичный HTTP-API продукта V3.4.
 *
 * Только чтение сигналов + регистрация устройства для push. Никаких торговых
 * операций, ключей и приватных данных. Все сведения о стратегии отдаются из
 * конфигурации ядра, чтобы приложение не дублировало формулы у себя.
 *
 * Контракт:
 *   GET  /api/v1/health      — живость, версия, состояние БД и push
 *   GET  /api/v1/meta        — описание V3.4, источник данных, свежесть, статус символов
 *   GET  /api/v1/signals     — лента (limit ≤ 100, курсорная пагинация)
 *   GET  /api/v1/signals/:id — детально (уровни, события, прогресс)
 *   GET  /api/v1/candles     — свечи для графика (символ из вселенной, 1h/4h, ≤ 300)
 *   POST /api/v1/devices     — зарегистрировать FCM-токен
 *   GET  /api/v1/apk         — манифест APK (версия, размер, sha256) или честный «нет»
 *   GET  /                   — статический лендинг (если настроен каталог)
 */
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config';
import { pushConfigState } from './config';
import type { SignalRepository, EventRow } from './repository';
import { DEFAULT_LIMIT } from './repository';
import {
  CANDLE_INTERVALS, CANDLE_LIMIT_DEFAULT, CANDLE_LIMIT_MAX, CANDLE_LIMIT_MIN,
  CandleSourceError, type CandleService,
} from './candles';
import { pairOf } from './scanner';
import type { MarketInterval } from './market';
import { CLOSED_SIGNAL_STATUSES, OPEN_SIGNAL_STATUSES, SIGNAL_STATUSES } from './db';
import { computeDataStatus, toSignalView, type SignalPresentationContext } from './presentation';
import type { PushSender } from './push/fcm';
import {
  DATA_FRESHNESS, V34_DESCRIPTION, V34_SYMBOLS, V34_TIMEFRAMES, V34_STRATEGY_ID,
  V34_STRATEGY_NAME, V34_STRATEGY_NAME_RU, V34_STRATEGY_VERSION, V34_RESEARCH_BADGE,
  V34_RESEARCH_BADGE_LABEL, V34_RESEARCH_NOTE, V34_QUALITY_GATES, V34_CANDLE_LIMITS,
  V34_WARMUP_BARS, V34_DEFAULT_SCAN_INTERVAL_SECONDS, V34_ENTRY_ZONE_ATR_FRAC_TOTAL,
  V34_EXIT_RULE_RU, MARKET_DATA_SOURCE, V34_LIVE_VARIANT_ID,
} from '@v34/core';

export const API_VERSION = 'v1';
export const LIST_LIMIT_MAX = 100;

export interface ApiDeps {
  repo: SignalRepository;
  config: AppConfig;
  push: PushSender;
  /** Свечи для графика: только публичные данные, полученные сервером. */
  candles: CandleService;
  /** Версия сборки сервера. */
  version: string;
  startedAtMs: number;
  now?: () => number;
}

const STRATEGY_INFO = Object.freeze({
  id: V34_STRATEGY_ID,
  version: V34_STRATEGY_VERSION,
  name: V34_STRATEGY_NAME,
  nameRu: V34_STRATEGY_NAME_RU,
  liveVariant: V34_LIVE_VARIANT_ID,
  badge: V34_RESEARCH_BADGE,
  badgeLabel: V34_RESEARCH_BADGE_LABEL,
  researchNote: V34_RESEARCH_NOTE,
  exitRule: V34_EXIT_RULE_RU,
  qualityGates: V34_QUALITY_GATES,
  entryZoneHalfWidthAtr: V34_ENTRY_ZONE_ATR_FRAC_TOTAL,
  timeframes: { exec: V34_TIMEFRAMES.exec, context: V34_TIMEFRAMES.context },
  warmupBars: V34_WARMUP_BARS,
  candleLimits: V34_CANDLE_LIMITS,
  defaultScanIntervalSeconds: V34_DEFAULT_SCAN_INTERVAL_SECONDS,
  description: V34_DESCRIPTION,
});

/** Простой ограничитель запросов на IP (регистрация устройств). */
class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  allow(key: string, nowMs: number): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(nowMs);
    this.hits.set(key, list);
    return true;
  }
}

export function createApp(deps: ApiDeps): Express {
  const { repo, config, push, candles } = deps;
  const now = deps.now ?? Date.now;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '16kb' }));

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  if (config.allowedOrigins.length > 0) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      if (origin && config.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });
  }

  const signalsLimiter = new RateLimiter(60, 60_000);
  const devicesLimiter = new RateLimiter(10, 60_000);

  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip = req.ip ?? 'unknown';
    const isDeviceWrite = req.method === 'POST' && req.path === '/v1/devices';
    const allowed = isDeviceWrite ? devicesLimiter.allow(ip, now()) : signalsLimiter.allow(ip, now());
    if (!allowed) {
      res.status(429).json({ error: 'rate_limited', message: 'слишком много запросов, попробуйте позже' });
      return;
    }
    next();
  });

  /* ── Служебные ───────────────────────────────────────────────────────── */

  app.get('/api/v1/health', (_req: Request, res: Response) => {
    let dbOk = true;
    try {
      repo.countSignals({});
    } catch {
      dbOk = false;
    }
    res.json({
      ok: dbOk,
      version: deps.version,
      apiVersion: API_VERSION,
      uptimeSec: Math.round((now() - deps.startedAtMs) / 1000),
      serverTime: new Date(now()).toISOString(),
      db: dbOk ? 'ok' : 'error',
      push: { configured: push.state.configured, enabled: push.state.enabled },
    });
  });

  app.get('/api/v1/meta', (_req: Request, res: Response) => {
    const nowMs = now();
    const lastScan = repo.lastScan();
    const lastSuccessfulScanAt = repo.lastSuccessfulScanAt();
    const symbols = repo.symbolStatuses();
    const dataStatus = computeDataStatus({
      nowMs,
      scanStaleAfterMs: DATA_FRESHNESS.scanStaleAfterMs,
      lastScan,
      lastSuccessfulScanAt,
      symbols,
    });
    const devices = repo.countDevices();
    const pushState = push.state.configured
      ? { enabled: true, configured: true, missing: [], reason: null }
      : { ...pushConfigState(config), reason: push.state.reason };

    res.json({
      apiVersion: API_VERSION,
      serverVersion: deps.version,
      minAppVersion: config.minAppVersion,
      serverTime: new Date(nowMs).toISOString(),
      strategy: STRATEGY_INFO,
      universe: {
        symbols: config.symbols,
        defaultSymbols: V34_SYMBOLS,
        quote: MARKET_DATA_SOURCE.quote,
        // Витринные пары задаёт сервер: приложение не склеивает 'BTC/USDT' само
        // и не может показать пару, которой нет в конфигурации V3.4.
        pairs: config.symbols.map((s) => ({ symbol: pairOf(s), exchangeSymbol: s })),
      },
      candles: {
        endpoint: '/api/v1/candles',
        intervals: CANDLE_INTERVALS,
        defaultLimit: CANDLE_LIMIT_DEFAULT,
        minLimit: CANDLE_LIMIT_MIN,
        maxLimit: CANDLE_LIMIT_MAX,
        source: MARKET_DATA_SOURCE.id,
        note: 'Свечи отдаёт backend после проверки ответа биржи; приложение не запрашивает биржу напрямую.',
      },
      marketData: {
        id: MARKET_DATA_SOURCE.id,
        exchange: MARKET_DATA_SOURCE.exchange,
        venue: MARKET_DATA_SOURCE.venue,
        baseUrl: MARKET_DATA_SOURCE.baseUrl,
        readOnly: true,
        apiKeysRequired: false,
        orderPlacement: false,
        feeVenueAssumed: MARKET_DATA_SOURCE.feeVenueAssumed,
        requestTimeoutMs: config.marketTimeoutMs,
      },
      engine: {
        scanIntervalMs: config.scanIntervalMs,
        scanStaleAfterMs: DATA_FRESHNESS.scanStaleAfterMs,
        maxBarAgeMs: DATA_FRESHNESS.maxBarAgeMs,
        dataStatus: dataStatus.status,
        staleReason: dataStatus.reason,
        lastScanAt: dataStatus.lastScanAt,
        lastSuccessfulScanAt: dataStatus.lastSuccessfulScanAt,
        lastScan: lastScan
          ? {
            startedAt: lastScan.started_at,
            finishedAt: lastScan.finished_at,
            status: lastScan.status,
            symbolsTotal: lastScan.symbols_total,
            symbolsOk: lastScan.symbols_ok,
            signalsNew: lastScan.signals_new,
            error: lastScan.error,
          }
          : null,
        perSymbol: symbols.map((s) => ({
          symbol: s.exchange_symbol,
          lastScanAt: s.last_scan_at,
          lastSuccessAt: s.last_success_at,
          lastBarOpenTime: s.last_bar_open_time ? new Date(s.last_bar_open_time).toISOString() : null,
          closedBars: { '1h': s.closed_1h, '4h': s.closed_4h },
          gaps1h: s.gaps_1h,
          dataError: s.data_error,
          source: s.source ? (JSON.parse(s.source) as { exchange: string; isFallback: boolean }) : null,
          notes: s.notes ? (JSON.parse(s.notes) as string[]) : [],
        })),
      },
      push: { ...pushState, devices },
      statuses: {
        all: SIGNAL_STATUSES,
        open: OPEN_SIGNAL_STATUSES,
        closed: CLOSED_SIGNAL_STATUSES,
      },
      disclaimer:
        'Аналитические сигналы, не инвестиционная рекомендация. CRYPTORA V3.4 не исполняет сделки '
        + 'и не использует торговые ключи. Данные Binance публичные и могут быть недоступны.',
    });
  });

  /* ── Сигналы ─────────────────────────────────────────────────────────── */

  const presentationCtx = (): SignalPresentationContext => {
    const nowMs = now();
    const lastSuccessfulScanAt = repo.lastSuccessfulScanAt();
    const dataStatus = computeDataStatus({
      nowMs,
      scanStaleAfterMs: DATA_FRESHNESS.scanStaleAfterMs,
      lastScan: repo.lastScan(),
      lastSuccessfulScanAt,
      symbols: repo.symbolStatuses(),
    });
    return {
      stale: dataStatus.status !== 'fresh',
      staleReason: dataStatus.reason,
      now: new Date(nowMs).toISOString(),
    };
  };

  app.get('/api/v1/signals', (req: Request, res: Response) => {
    const limitRaw = Number(req.query.limit ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(limitRaw) ? Math.min(LIST_LIMIT_MAX, Math.max(1, Math.trunc(limitRaw))) : DEFAULT_LIMIT;

    const statusParam = typeof req.query.status === 'string' ? req.query.status : null;
    const statuses = statusParam
      ? statusParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : [];
    const invalidStatus = statuses.find((s) => !(SIGNAL_STATUSES as readonly string[]).includes(s));
    if (invalidStatus) {
      res.status(400).json({ error: 'bad_status', message: `неизвестный статус: ${invalidStatus}`, allowed: SIGNAL_STATUSES });
      return;
    }

    const directionRaw = typeof req.query.direction === 'string' ? req.query.direction.toUpperCase() : null;
    if (directionRaw && directionRaw !== 'LONG' && directionRaw !== 'SHORT') {
      res.status(400).json({ error: 'bad_direction', message: 'direction: LONG или SHORT' });
      return;
    }
    const symbolRaw = typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() : null;
    if (symbolRaw && !/^[A-Z0-9/]{4,20}$/.test(symbolRaw)) {
      res.status(400).json({ error: 'bad_symbol', message: 'symbol: например BTC/USDT или BTCUSDT' });
      return;
    }

    let cursor: { createdAt: string; id: string } | null = null;
    if (typeof req.query.cursor === 'string' && req.query.cursor.length > 0) {
      const [createdAt, id] = req.query.cursor.split('|');
      if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
        res.status(400).json({ error: 'bad_cursor', message: 'cursor: "<ISO>|<id>"' });
        return;
      }
      cursor = { createdAt, id };
    }

    const rows = repo.listSignals({
      status: statuses.length > 0 ? statuses : undefined,
      symbol: symbolRaw ?? undefined,
      direction: (directionRaw as 'LONG' | 'SHORT' | null) ?? undefined,
      limit,
      cursor,
    });
    const eventsBySignal = repo.eventsOfMany(rows.map((r) => r.id));
    const ctx = presentationCtx();
    const items = rows.map((row) =>
      toSignalView(row, eventsBySignal.get(row.id) ?? [], ctx, {
        id: STRATEGY_INFO.id, version: STRATEGY_INFO.version, name: STRATEGY_INFO.name,
      }),
    );
    const last = rows[rows.length - 1];
    res.json({
      items,
      count: items.length,
      total: repo.countSignals({
        status: statuses.length > 0 ? statuses : undefined,
        symbol: symbolRaw ?? undefined,
        direction: (directionRaw as 'LONG' | 'SHORT' | null) ?? undefined,
      }),
      limit,
      nextCursor: rows.length === limit && last ? `${last.created_at}|${last.id}` : null,
      appliedFilters: { status: statuses, symbol: symbolRaw, direction: directionRaw, limit },
      asOf: ctx.now,
      stale: ctx.stale,
      staleReason: ctx.staleReason,
      // Человекочитаемые подписи — забота клиента; функции в JSON не место.
    });
  });

  app.get('/api/v1/signals/:id', (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    if (!/^[A-Z0-9_-]{6,120}$/i.test(id)) {
      res.status(400).json({ error: 'bad_id', message: 'некорректный идентификатор сигнала' });
      return;
    }
    const row = repo.getById(id);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'сигнал не найден' });
      return;
    }
    const events = repo.eventsOf(id) as EventRow[];
    const ctx = presentationCtx();
    res.json({
      signal: toSignalView(row, events, ctx, {
        id: STRATEGY_INFO.id, version: STRATEGY_INFO.version, name: STRATEGY_INFO.name,
      }),
      asOf: ctx.now,
    });
  });

  /* ── Свечи для графика ───────────────────────────────────────────────── */

  /**
   * Ограниченный эндпоинт свечей.
   *
   * Ограничения намеренные и проверяются здесь, а не «где-то в клиенте»:
   *   • символ — только из вселенной V3.4 (env `V34_SYMBOLS` или канонический список);
   *   • интервал — только 1h/4h (таймфреймы стратегии);
   *   • limit — 20..300, значение вне диапазона ограничивается и возвращается
   *     в ответе как `limit`, чтобы клиент видел фактический объём;
   *   • таймаут/кэш/повторы — в CandleService; один IP не может устроить
   *     лавину запросов к бирже (общий rate limit на /api).
   *
   * Ошибка источника — 502 с кодом и коротким текстом. Пустой массив свечей
   * при сбое не отдаётся: это выглядело бы как «на рынке ничего нет».
   */
  app.get('/api/v1/candles', async (req: Request, res: Response) => {
    const symbolRaw = typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() : '';
    if (!symbolRaw) {
      res.status(400).json({ error: 'bad_symbol', message: 'symbol обязателен, например BTCUSDT', allowed: config.symbols });
      return;
    }
    if (!/^[A-Z0-9]{4,20}$/.test(symbolRaw)) {
      res.status(400).json({ error: 'bad_symbol', message: 'symbol: например BTCUSDT', allowed: config.symbols });
      return;
    }
    if (!config.symbols.includes(symbolRaw)) {
      res.status(400).json({
        error: 'bad_symbol',
        message: `символ ${symbolRaw} отсутствует в конфигурации V3.4`,
        allowed: config.symbols,
      });
      return;
    }

    const intervalRaw = (typeof req.query.interval === 'string' ? req.query.interval.trim().toLowerCase() : '1h');
    if (!(CANDLE_INTERVALS as readonly string[]).includes(intervalRaw)) {
      res.status(400).json({
        error: 'bad_interval',
        message: `interval: ${CANDLE_INTERVALS.join(' или ')}`,
        allowed: CANDLE_INTERVALS,
      });
      return;
    }
    const interval = intervalRaw as MarketInterval;

    const limitRaw = req.query.limit === undefined ? String(CANDLE_LIMIT_DEFAULT) : String(req.query.limit);
    const limitNum = Number(limitRaw);
    if (!Number.isFinite(limitNum) || !Number.isInteger(limitNum) || limitNum < 1) {
      res.status(400).json({
        error: 'bad_limit',
        message: `limit: целое число ${CANDLE_LIMIT_MIN}..${CANDLE_LIMIT_MAX}`,
      });
      return;
    }
    const limit = Math.min(CANDLE_LIMIT_MAX, Math.max(CANDLE_LIMIT_MIN, limitNum));

    try {
      const series = await candles.get(symbolRaw, interval, limit);
      const ctx = presentationCtx();
      res.json({
        symbol: pairOf(symbolRaw),
        exchangeSymbol: series.exchangeSymbol,
        interval: series.interval,
        limit: series.limit,
        count: series.candles.length,
        candles: series.candles,
        source: series.source,
        asOf: ctx.now,
        stale: ctx.stale,
        staleReason: ctx.staleReason,
      });
    } catch (e) {
      if (e instanceof CandleSourceError) {
        res.status(502).json({
          error: 'market_unavailable',
          code: e.code,
          message: `биржа не отдала свечи: ${e.message}`,
        });
        return;
      }
      res.status(502).json({
        error: 'market_unavailable',
        code: 'UNAVAILABLE',
        message: 'источник свечей недоступен',
      });
    }
  });

  /* ── Устройства (push) ───────────────────────────────────────────────── */

  /**
   * Регистрация FCM-токена.
   *
   * Публичный изменяющий эндпоинт без аккаунтов, поэтому он ограничен:
   *   • rate limit по IP (см. middleware выше);
   *   • потолок общего числа устройств (`V34_MAX_DEVICES`);
   *   • очистка регистраций, не обновлявшихся `V34_DEVICE_TTL_DAYS` дней;
   *   • токен НЕ возвращается в ответе и НЕ попадает в URL/логи.
   *
   * Отвязки через публичный API нет: DELETE по одному лишь токену позволял бы
   * любому, кто узнал чужой токен, отключить устройство. Отвязка — задача
   * отдельного этапа с аутентификацией (аккаунт/attestation).
   */
  app.post('/api/v1/devices', (req: Request, res: Response) => {
    const body = req.body as { token?: unknown; platform?: unknown } | undefined;
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const platform = typeof body?.platform === 'string' ? body.platform.trim().toLowerCase() : 'android';
    if (token.length < 20 || token.length > 4096) {
      res.status(400).json({ error: 'bad_token', message: 'token: строка 20–4096 символов' });
      return;
    }
    if (platform !== 'android' && platform !== 'ios') {
      res.status(400).json({ error: 'bad_platform', message: 'platform: android или ios' });
      return;
    }

    const nowIso = new Date(now()).toISOString();
    // Чистим просроченные регистрации, чтобы таблица не росла бесконечно.
    const cutoff = new Date(now() - config.deviceTtlDays * 24 * 60 * 60 * 1000).toISOString();
    repo.pruneDevices(cutoff);

    const known = repo.hasDevice(token);
    if (!known && repo.countDevices().total >= config.maxDevices) {
      res.status(503).json({
        error: 'device_capacity',
        message: 'Сервер достиг лимита зарегистрированных устройств. Попробуйте позже.',
        limit: config.maxDevices,
      });
      return;
    }

    repo.upsertDevice(token, platform, nowIso);
    res.status(201).json({
      ok: true,
      registered: true,
      pushConfigured: push.state.configured,
      note: push.state.configured
        ? null
        : 'Токен сохранён, но серверный push не настроен — уведомления не отправляются.',
      unregister: 'disabled',
    });
  });

  /* ── APK-манифест ────────────────────────────────────────────────────── */

  app.get('/api/v1/apk', (_req: Request, res: Response) => {
    const manifest = readApkManifest(config.apkDir);
    res.json(manifest);
  });

  /* ── Статика лендинга и APK ──────────────────────────────────────────── */

  if (config.staticDir && fs.existsSync(config.staticDir)) {
    app.use('/', express.static(config.staticDir, { index: 'index.html', maxAge: '5m' }));
  }
  if (config.apkDir && fs.existsSync(config.apkDir)) {
    app.use('/apk', express.static(config.apkDir, {
      index: false,
      maxAge: '1h',
      setHeaders: (res) => {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', 'attachment');
      },
    }));
  }

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found', message: 'неизвестный эндпоинт API' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Битый JSON от клиента — его ошибка, а не наша: 400 и без текста парсера
    // (внутренние детали наружу не уходят).
    const parseFailed = typeof err === 'object' && err !== null && 'type' in err
      && (err as { type?: unknown }).type === 'entity.parse.failed';
    if (parseFailed) {
      res.status(400).json({ error: 'bad_json', message: 'тело запроса не является корректным JSON' });
      return;
    }
    // Остальное — 500 без стека, путей и текста драйвера.
    res.status(500).json({ error: 'internal_error', message: 'внутренняя ошибка сервера' });
  });

  return app;
}

export interface ApkManifest {
  available: boolean;
  reason: string | null;
  fileName: string | null;
  version: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  builtAt: string | null;
  /** Подписан ли релизным ключом владельца (или это проверочная сборка). */
  signedWithReleaseKey: boolean;
  downloadPath: string | null;
}

/**
 * Манифест APK. Читается из файла рядом с APK; если APK нет — честный ответ
 * `available: false` с причиной. Лендинг не должен показывать кнопку скачивания
 * для несуществующего файла.
 */
export function readApkManifest(apkDir: string | null): ApkManifest {
  const empty = (reason: string): ApkManifest => ({
    available: false, reason, fileName: null, version: null, sizeBytes: null,
    sha256: null, builtAt: null, signedWithReleaseKey: false, downloadPath: null,
  });
  if (!apkDir) return empty('каталог APK не настроен (V34_APK_DIR)');
  const manifestPath = path.join(apkDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return empty('APK ещё не собран: нет manifest.json');
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<ApkManifest>;
    const fileName = typeof raw.fileName === 'string' ? raw.fileName : null;
    if (!fileName) return empty('в manifest.json нет fileName');
    const filePath = path.join(apkDir, fileName);
    if (!fs.existsSync(filePath)) return empty(`файл ${fileName} отсутствует рядом с manifest.json`);
    const size = fs.statSync(filePath).size;
    return {
      available: true,
      reason: null,
      fileName,
      version: raw.version ?? null,
      sizeBytes: size,
      sha256: raw.sha256 ?? null,
      builtAt: raw.builtAt ?? null,
      signedWithReleaseKey: raw.signedWithReleaseKey === true,
      downloadPath: `/apk/${encodeURIComponent(fileName)}`,
    };
  } catch (e) {
    return empty(`не удалось прочитать manifest.json: ${e instanceof Error ? e.message : String(e)}`);
  }
}
