/**
 * Сканер продукта V3.4.
 *
 * Один тик на символ:
 *   1. взять публичные закрытые свечи 1H и 4H у биржи (Binance Spot);
 *   2. прогнать ТУ ЖЕ frozen-логику V3.4 (`runV34Scan` → `runV34LiveReplay`);
 *   3. опубликовать сигналы последнего закрытого 1H-бара (правило CRYPTORA);
 *   4. провести уже опубликованные сигналы по закрытым свечам теми же
 *      функциями (`corridorStep` / `manageTrade` / `inspectTrade`);
 *   5. записать события — по одному разу, с дедупликацией на уровне БД;
 *   6. отправить push, если он настроен.
 *
 * Чего здесь НЕТ: расчёта уровней «по текущей цене», получения TP/SL на
 * клиенте, торговых ключей и ордеров. Ошибки данных не превращаются в пустой
 * список: они попадают в статус символа и в /api/v1/meta.
 */
import { DATA_FRESHNESS, runV34Scan, trackV34PublishedSignal, V34_STRATEGY_ID, V34_STRATEGY_VERSION } from '@v34/core';
import type { ReplayRecord, SignalFill, SignalOutcome, LifecycleProgress } from '@v34/core';
import type { CandleProvider } from './market';
import type { SignalRepository, SignalRow } from './repository';
import { toPublishedSignal } from './repository';
import type { SignalEventType } from './db';
import {
  classifyProgress, classifyTransition, occurredAtFor, progressOccurredAt,
  type SignalSnapshot,
} from './events';
import type { PushSender } from './push/fcm';

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

export const silentLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {},
};

export interface ScannerOptions {
  provider: CandleProvider;
  repo: SignalRepository;
  symbols: readonly string[];
  push?: PushSender | null;
  now?: () => number;
  logger?: Logger;
  limits?: { '1h': number; '4h': number };
}

export interface SymbolScanSummary {
  symbol: string;
  ok: boolean;
  dataError: string | null;
  signalsPublished: number;
  signalsFilled: number;
  signalsClosed: number;
  events: { signalId: string; type: SignalEventType }[];
  closedBars: { '1h': number; '4h': number };
  lastClosedBarOpenTime: number | null;
}

export interface ScanSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  symbols: SymbolScanSummary[];
  symbolsOk: number;
  signalsPublished: number;
  events: number;
  errors: string[];
}

/** Биржевой символ → пара для витрины ('BTCUSDT' → 'BTC/USDT'). */
export function pairOf(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}/USDT`;
  return s;
}

/** Стабильный идентификатор сигнала: стратегия + символ + бар сетапа. */
export function signalIdOf(symbol: string, setupOpenTime: number): string {
  return `${V34_STRATEGY_ID}-${symbol.toUpperCase()}-${setupOpenTime}`;
}

export class Scanner {
  private readonly provider: CandleProvider;
  private readonly repo: SignalRepository;
  private readonly symbols: readonly string[];
  private readonly push: PushSender | null;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly limits: { '1h': number; '4h': number };
  private inFlight: Promise<ScanSummary> | null = null;

  constructor(opts: ScannerOptions) {
    this.provider = opts.provider;
    this.repo = opts.repo;
    this.symbols = opts.symbols;
    this.push = opts.push ?? null;
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? silentLogger;
    this.limits = opts.limits ?? { '1h': 1000, '4h': 1000 };
  }

  /** Полный проход. Параллельные вызовы не дублируют работу. */
  async scanAll(): Promise<ScanSummary> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runScanAll().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runScanAll(): Promise<ScanSummary> {
    const startedMs = this.now();
    const startedAt = new Date(startedMs).toISOString();
    const scanId = this.repo.startScan(startedAt, this.symbols.length);

    const summaries: SymbolScanSummary[] = [];
    const errors: string[] = [];
    for (const symbol of this.symbols) {
      try {
        summaries.push(await this.scanSymbol(symbol));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`${symbol}: ${message}`);
        this.log.error('scan symbol failed', { symbol, message });
        summaries.push({
          symbol, ok: false, dataError: message, signalsPublished: 0, signalsFilled: 0,
          signalsClosed: 0, events: [], closedBars: { '1h': 0, '4h': 0 }, lastClosedBarOpenTime: null,
        });
      }
    }

    const finishedMs = this.now();
    const finishedAt = new Date(finishedMs).toISOString();
    const symbolsOk = summaries.filter((s) => s.ok).length;
    const signalsPublished = summaries.reduce((n, s) => n + s.signalsPublished, 0);
    const events = summaries.reduce((n, s) => n + s.events.length, 0);
    const status = errors.length === 0 ? 'OK' : symbolsOk > 0 ? 'PARTIAL' : 'FAILED';
    this.repo.finishScan(scanId, {
      finishedAt,
      status,
      symbolsOk,
      signalsNew: signalsPublished,
      error: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
    });

    return {
      startedAt, finishedAt, durationMs: finishedMs - startedMs, symbols: summaries,
      symbolsOk, signalsPublished, events, errors,
    };
  }

  async scanSymbol(symbol: string): Promise<SymbolScanSummary> {
    const nowMs = this.now();
    const scanAt = new Date(nowMs).toISOString();

    let h1Raw: Awaited<ReturnType<CandleProvider['getKlines']>>;
    let h4Raw: Awaited<ReturnType<CandleProvider['getKlines']>>;
    try {
      [h1Raw, h4Raw] = await Promise.all([
        this.provider.getKlines(symbol, '1h', this.limits['1h']),
        this.provider.getKlines(symbol, '4h', this.limits['4h']),
      ]);
    } catch (e) {
      // Сбой источника — это состояние символа, а не «нет сигналов». Статус
      // пишется ДО проброса ошибки, чтобы /api/v1/meta объяснял простой.
      const message = e instanceof Error ? e.message : String(e);
      this.repo.upsertSymbolStatus({
        exchangeSymbol: symbol,
        lastScanAt: scanAt,
        lastSuccessAt: null,
        lastBarOpenTime: null,
        closed1h: 0,
        closed4h: 0,
        gaps1h: 0,
        dataError: message,
        source: null,
        notes: [`источник данных недоступен: ${message}`],
      });
      throw e;
    }

    const scan = runV34Scan({ symbol, h1Raw, h4Raw, nowMs });
    const stale = scan.lastBarAgeMs !== null && scan.lastBarAgeMs > DATA_FRESHNESS.maxBarAgeMs;

    this.repo.upsertSymbolStatus({
      exchangeSymbol: symbol,
      lastScanAt: scanAt,
      lastSuccessAt: scan.dataError ? null : scanAt,
      lastBarOpenTime: scan.lastClosedBarOpenTime,
      closed1h: scan.closedBars['1h'],
      closed4h: scan.closedBars['4h'],
      gaps1h: scan.gaps1h,
      dataError: scan.dataError,
      source: scan.source ? JSON.stringify(scan.source) : null,
      notes: stale ? [...scan.notes, 'данные биржи устарели: последний закрытый бар старше допустимого'] : scan.notes,
    });

    const summary: SymbolScanSummary = {
      symbol,
      ok: scan.dataError === null,
      dataError: scan.dataError,
      signalsPublished: 0,
      signalsFilled: 0,
      signalsClosed: 0,
      events: [],
      closedBars: scan.closedBars,
      lastClosedBarOpenTime: scan.lastClosedBarOpenTime,
    };
    if (scan.dataError) {
      // Данные непригодны: ни публикации, ни ведения. Старые сигналы не
      // трогаем — выдуманный исход хуже паузы.
      this.log.warn('scan data error', { symbol, error: scan.dataError });
      return summary;
    }

    // 1. Ведение уже опубликованных сигналов.
    for (const row of this.repo.openSignalsForSymbol(symbol)) {
      const step = this.trackSignal(row, scan.closedH1, scanAt);
      summary.events.push(...step.events);
      if (step.filled) summary.signalsFilled++;
      if (step.closed) summary.signalsClosed++;
    }

    // 2. Публикация новых сигналов последнего закрытого бара.
    for (const rec of scan.publishable) {
      const published = await this.publishSignal(symbol, rec, scanAt, scan.source);
      if (!published) continue;
      summary.signalsPublished++;
      summary.events.push({ signalId: signalIdOf(symbol, rec.setupOpenTime), type: 'NEW_SIGNAL' });
    }

    return summary;
  }

  /** Ведение одного опубликованного сигнала по закрытым 1H-свечам. */
  private trackSignal(
    row: SignalRow,
    closedH1: Parameters<typeof trackV34PublishedSignal>[1],
    nowIso: string,
  ): { events: { signalId: string; type: SignalEventType }[]; filled: boolean; closed: boolean } {
    const events: { signalId: string; type: SignalEventType }[] = [];
    const signal = toPublishedSignal(row);
    if (!Number.isFinite(signal.invalidationLevel) || signal.targets.length < 2) {
      this.log.warn('signal skipped: нет стопа или целей', { id: row.id });
      return { events, filled: false, closed: false };
    }
    if (!Number.isFinite(signal.entryZone[0]) || !Number.isFinite(signal.entryZone[1])) {
      this.log.warn('signal skipped: нет зоны входа', { id: row.id });
      return { events, filled: false, closed: false };
    }

    const result = trackV34PublishedSignal(signal, closedH1);
    if (result.kind === 'UNCHANGED') return { events, filled: false, closed: false };
    if (result.kind === 'SKIP') {
      this.log.warn('signal tracking skipped', { id: row.id, reason: result.reason });
      return { events, filled: false, closed: false };
    }

    const before: SignalSnapshot = {
      status: row.status,
      fillPrice: row.fill_price,
      closeReason: row.close_reason,
      closedAt: row.closed_at,
      createdAt: row.created_at,
      filledAt: row.filled_at,
    };

    let progress: LifecycleProgress | null = null;
    if (result.kind === 'FILLED') {
      progress = result.progress ?? null;
      if (row.status === 'ACTIVE') {
        this.repo.updateLifecycle(
          row.id,
          {
            status: 'FILLED',
            filledAt: result.fill.at,
            fillPrice: result.fill.price,
          },
          nowIso,
        );
      }
    } else {
      const fill: SignalFill | null = result.fill;
      const outcome: SignalOutcome = result.outcome;
      this.repo.updateLifecycle(
        row.id,
        {
          status: outcome.status,
          ...(fill ? { filledAt: fill.at, fillPrice: fill.price } : {}),
          closedAt: outcome.closedAt,
          closePrice: outcome.exitPrice,
          closeReason: outcome.exitReason,
          resultR: outcome.resultR,
          netResultR: outcome.netResultR,
          pnlResultPct: outcome.pnlResultPct,
          barsHeld: outcome.barsHeld,
        },
        nowIso,
      );
    }

    const updated = this.repo.getById(row.id);
    if (!updated) return { events, filled: false, closed: false };
    const after: SignalSnapshot = {
      status: updated.status,
      fillPrice: updated.fill_price,
      closeReason: updated.close_reason,
      closedAt: updated.closed_at,
      createdAt: updated.created_at,
      filledAt: updated.filled_at,
    };

    // Промежуточные события открытой позиции — только из frozen-прогресса.
    for (const type of classifyProgress(progress)) {
      const occurredAt = progressOccurredAt(progress, type);
      if (this.dispatchEvent(row.id, type, occurredAt, updated)) events.push({ signalId: row.id, type });
    }

    // Переход строки (вход/исход) — независимый источник тех же фактов.
    for (const type of classifyTransition(before, after)) {
      const occurredAt = type === 'FILL' ? occurredAtFor(after, 'FILL') : occurredAtFor(after, type);
      if (this.dispatchEvent(row.id, type, occurredAt, updated)) events.push({ signalId: row.id, type });
    }

    const closed = result.kind === 'RESOLVED';
    return { events, filled: row.status === 'ACTIVE' && updated.status === 'FILLED', closed };
  }

  /** Публикация сигнала из записи реплея. false — уже существовал. */
  private async publishSignal(
    symbol: string,
    rec: ReplayRecord,
    nowIso: string,
    source: { exchange: string; isFallback: boolean } | null,
  ): Promise<boolean> {
    const id = signalIdOf(symbol, rec.setupOpenTime);
    const inserted = this.repo.insertSignal({
      id,
      strategyId: V34_STRATEGY_ID,
      strategyVersion: V34_STRATEGY_VERSION,
      symbol: pairOf(symbol),
      exchangeSymbol: symbol.toUpperCase(),
      timeframe: '1h',
      direction: rec.direction,
      setupOpenTime: rec.setupOpenTime,
      entryMin: rec.entryZone[0] ?? null,
      entryMax: rec.entryZone[1] ?? null,
      stopLoss: rec.stop ?? null,
      tp1: rec.targets[0] ?? null,
      tp2: rec.targets[1] ?? null,
      riskRewardRatio: rec.riskRewardRatio,
      dataSource: source,
      createdAt: nowIso,
      metadata: {
        confirmingFactors: rec.confirmingFactors,
        invalidationFactors: rec.invalidationFactors,
        exitRule: rec.exitRule,
        validForBars: rec.validForBars,
        publishNote: rec.publishNote,
        setupClose: rec.setupClose,
        setupCloseTime: rec.setupCloseTime,
        core: rec.meta ?? {},
      },
    });
    if (!inserted) return false;

    const row = this.repo.getById(id);
    if (row && this.dispatchEvent(id, 'NEW_SIGNAL', row.created_at, row)) {
      this.log.info('signal published', { id, symbol, direction: rec.direction });
    }
    return true;
  }

  /**
   * Записать событие и (если оно первое) отправить push. Возвращает true, если
   * строка события действительно создана этим вызовом.
   */
  private dispatchEvent(signalId: string, type: SignalEventType, occurredAt: string | null, row: SignalRow): boolean {
    const recorded = this.repo.recordEvent(signalId, type, occurredAt ?? null, null);
    if (!recorded) return false;
    if (this.push) {
      // Fire-and-forget: сбой доставки не должен ронять скан.
      void this.sendPush(row, type).catch((e) => this.log.warn('push failed', { signalId, type, message: String(e) }));
    }
    return true;
  }

  private async sendPush(row: SignalRow, type: SignalEventType): Promise<void> {
    if (!this.push || !this.push.state.configured) return;
    const devices = this.repo.enabledDevices();
    if (devices.length === 0) return;
    const message = composePush(row, type);
    for (const device of devices) {
      const res = await this.push.send(device.token, message);
      this.repo.recordPushDelivery(row.id, type, device.token, res.ok ? 'SENT' : 'FAILED', res.code ?? null);
      if (!res.ok && res.code === 'UNREGISTERED') this.repo.disableDevice(device.token);
    }
  }
}

/** Текст push собирается ТОЛЬКО из сохранённых серверных фактов. */
export function composePush(
  row: SignalRow,
  type: SignalEventType,
): { title: string; body: string; data: Record<string, string> } {
  const dir = row.direction === 'LONG' ? 'LONG' : 'SHORT';
  const head = `${row.symbol} ${dir} · V3.4`;
  const price = (v: number | null): string => (v === null ? '—' : String(round(v)));
  switch (type) {
    case 'NEW_SIGNAL':
      return {
        title: `Новый сигнал: ${head}`,
        body: `Вход ${price(row.entry_min)}–${price(row.entry_max)}, SL ${price(row.stop_loss)}, `
          + `TP1 ${price(row.tp1)}, TP2 ${price(row.tp2)}`,
        data: { type, signalId: row.id, event: type },
      };
    case 'FILL':
      return {
        title: `Вход исполнен: ${head}`,
        body: `Цена входа ${price(row.fill_price)}, первоначальный SL ${price(row.stop_loss)}`,
        data: { type, signalId: row.id, event: type },
      };
    case 'TP1':
      return {
        title: `TP1 достигнут: ${head}`,
        body: `Цель 1 ${price(row.tp1)} достигнута; стоп переводится в безубыток со следующего бара`,
        data: { type, signalId: row.id, event: type },
      };
    case 'BREAKEVEN':
      return {
        title: `Стоп в безубытке: ${head}`,
        body: `Действующий стоп — цена входа ${price(row.fill_price)}`,
        data: { type, signalId: row.id, event: type },
      };
    case 'TP2':
      return {
        title: `TP2 достигнут: ${head}`,
        body: `Цель 2 ${price(row.tp2)} достигнута · результат ${row.result_r ?? '—'} R`,
        data: { type, signalId: row.id, event: type },
      };
    case 'STOP_LOSS':
      return {
        title: `Стоп сработал: ${head}`,
        body: `Сделка закрыта по ${row.close_reason ?? 'SL'} · результат ${row.result_r ?? '—'} R`,
        data: { type, signalId: row.id, event: type },
      };
    case 'CANCELLED':
      return {
        title: `Сигнал отменён: ${head}`,
        body: row.close_reason === 'EXPIRED' ? 'Коридор истёк — сделки не было' : 'Коридор отменён — сделки не было',
        data: { type, signalId: row.id, event: type },
      };
    case 'CLOSED':
    default:
      return {
        title: `Сделка закрыта: ${head}`,
        body: `Выход по правилам стратегии (${row.close_reason ?? '—'}) · ${row.result_r ?? '—'} R`,
        data: { type, signalId: row.id, event: type },
      };
  }
}

function round(x: number): number {
  const abs = Math.abs(x);
  const digits = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return Number(x.toFixed(digits));
}
