/**
 * LiveSignalEngine — три архивные стратегии на LIVE-свечах биржи.
 *
 *   V3.0 — HTF Liquidation Trap      (VALIDATED в источнике; флагман)
 *   V3.3 — HTF Zone Mitigation        (TRAIN-only; headline-вариант while-protective-displacement)
 *   V2.8 — Zero-fee Sniper + Trailing (VALIDATED_GROSS_ONLY; замороженный движок V2 @4839074)
 *
 * Как это работает (без переписывания правил стратегий):
 *
 *   1. Раз в `scanIntervalMs` движок запрашивает у LIVE-провайдера закрытые свечи
 *      1h (+ 4h для структуры, + 1d для HTF-контекста V2.8) по каждому символу.
 *      Незакрытая (формирующаяся) свеча отбрасывается по `nowMs` — стратегия
 *      никогда не видит неполный бар.
 *   2. Когда появляется НОВЫЙ закрытый 1h-бар, для каждой стратегии запускается
 *      её LIVE-реплей — тот же цикл, что и в исследовательском раннере, на окне
 *      последних ~1000 закрытых баров (`replays/*`). Сетапы, сформированные на
 *      последнем закрытом баре, публикуются в журнал аудита (latency 0 баров).
 *      Остальные записи окна доступны как ретроспектива — диагностика, не журнал.
 *   3. На каждом скане опубликованные сетапы (ACTIVE/FILLED) ведутся по закрытым
 *      свечам теми же frozen-функциями (`lifecycle.ts`): исполнение коридора,
 *      отмена, истечение, TP/SL/таймаут/трейлинг. Исход пишется в журнал один раз.
 *
 * Ошибки провайдера не глотаются молча: они попадают в `getStatus().lastError`
 * и в статус символа. Движок идемпотентен к повторному `start()` (StrictMode).
 *
 * ⚠️ ТОЛЬКО СИГНАЛЫ — CRYPTORA НЕ исполняет сделки.
 */

import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { OHLCV, Timeframe } from '@/types/market';
import type { ArchiveCandle, ArchiveTimeframe } from '@/services/strategyArchive/types';
import { SignalsAuditLedger, type AnalyticalSetup, type SetupInput } from '@/services/signals/SignalsAuditLedger';
import { ohlcvToArchive } from '@/services/signals/live/ohlcvAdapter';
import { runV30LiveReplay, V30_STRATEGY_ID } from './replays/v30LiveReplay';
import { runV33LiveReplay, V33_STRATEGY_ID } from './replays/v33LiveReplay';
import { runV28LiveReplay, V28_STRATEGY_ID } from './replays/v28LiveReplay';
import type { ReplayOutput, ReplayRecord } from './replays/types';
import { trackPublishedSetup } from './lifecycle';
import { pairLabel } from '@/utils/labels';

export type SignalStrategy = 'V3.0' | 'V3.3' | 'V2.8';

export const STRATEGY_IDS: Readonly<Record<SignalStrategy, string>> = Object.freeze({
  'V3.0': V30_STRATEGY_ID,
  'V3.3': V33_STRATEGY_ID,
  'V2.8': V28_STRATEGY_ID,
});

export const DEFAULT_SIGNAL_SYMBOLS: readonly string[] = Object.freeze(['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE']);
export const DEFAULT_SCAN_INTERVAL_MS = 60_000;
export const DEFAULT_INITIAL_DELAY_MS = 5_000;
/** Binance /api/v3/klines отдаёт не более 1000 свечей за запрос. */
export const CANDLE_LIMIT_1H = 1000;
export const CANDLE_LIMIT_4H = 1000;
export const CANDLE_LIMIT_1D = 400;
export const EXEC_TIMEFRAME: Timeframe = '1h';

export interface LiveSignalConfig {
  provider: MarketDataProvider;
  symbols?: readonly string[];
  strategies?: SignalStrategy[];
  scanIntervalMs?: number;
  initialDelayMs?: number;
  /** Источник времени (тесты). */
  now?: () => number;
  /** Уступать событийному циклу между символами (по умолчанию да — UI не замирает). */
  yieldBetweenSymbols?: boolean;
}

export interface ReplaySummary {
  strategyId: string;
  records: number;
  awaiting: number;
  filled: number;
  closed: number;
  noTrade: number;
  /** Pending, отклонённые геометрией на баре сетапа (в журнал не публикуются, в воронке исследования = rejected). */
  unpublishable: number;
  positiveR: number;
  negativeR: number;
  netRSum: number;
  grossRSum: number;
  evaluatedBars: number;
  firstEvaluatedOpenTime: number | null;
  lastEvaluatedOpenTime: number | null;
  notes: string[];
}

export interface SymbolScanStatus {
  symbol: string;
  pair: string;
  lastScanAt: string | null;
  lastError: string | null;
  closedBars: { '1h': number; '4h': number; '1d': number };
  /** openTime последнего закрытого 1h-бара, по которому запускалось обнаружение. */
  lastEvaluatedBarOpenTime: number | null;
  /** Есть ли пропуски в 1h-серии окна (движок продолжает работу, но честно сообщает). */
  gaps1h: number;
  /**
   * Источник закрытых 1h-свечей окна (провенанс последней свечи от провайдера):
   * Binance — основной, KuCoin — резерв при недоступности Binance. Пользователь
   * должен видеть, чьи данные попали в сигнал, а не догадываться.
   */
  source: { exchange: string; isFallback: boolean } | null;
  replays: Record<string, ReplaySummary>;
  publishedTotal: number;
}

export interface EngineStatus {
  running: boolean;
  scanning: boolean;
  scanCount: number;
  lastScanStartedAt: string | null;
  lastScanFinishedAt: string | null;
  lastScanDurationMs: number | null;
  lastError: string | null;
  nextScanAt: string | null;
  scanIntervalMs: number;
  symbols: readonly string[];
  strategies: readonly SignalStrategy[];
  perSymbol: Record<string, SymbolScanStatus>;
  providerIsDemo: boolean;
}

interface SymbolState {
  status: SymbolScanStatus;
  retrospective: Record<string, ReplayRecord[]>;
}

type Listener = () => void;

/**
 * BASE → BASE/USDT (котировка LIVE-провайдера — USDT-спот Binance/KuCoin).
 *
 * Делегирует `pairLabel` — единой идемпотентной нормализации пары. Важно, что
 * нормализация применяется ДО записи в ledger: `SignalsPage` рендерит
 * `setup.symbol` как есть, и повторное добавление `/USDT` на слое карточки
 * давало на проде «ETH/USDT/USDT». `pairLabel` дополнительно разбирает
 * биржевой формат без слэша («ETHUSDT» → «ETH/USDT»), который прежняя
 * реализация оставляла без нормализации.
 */
export function toPair(symbol: string): string {
  return pairLabel(symbol).toUpperCase();
}

export function setupId(strategyId: string, symbol: string, setupOpenTime: number): string {
  return `${strategyId}-${symbol.toUpperCase()}-${setupOpenTime}`;
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'unknown error';
}

/**
 * Провенанс серии, которой пользовался скан: берём его у последней свечи,
 * у которой он есть (Binance — основной источник, KuCoin — резерв).
 * Если провайдер провенанс не отдаёт (демо/моки) — честный `null`, без догадок.
 */
function sourceOf(raw: readonly OHLCV[] | null | undefined): { exchange: string; isFallback: boolean } | null {
  if (!Array.isArray(raw)) return null;
  for (let i = raw.length - 1; i >= 0; i--) {
    const p = raw[i]?.provenance;
    if (p?.exchange) return { exchange: p.exchange, isFallback: Boolean(p.isFallback) };
  }
  return null;
}

/** Закрытые свечи по возрастанию времени, без дублей. */
function toClosedArchive(raw: readonly OHLCV[] | null | undefined, tf: ArchiveTimeframe, nowMs: number): ArchiveCandle[] {
  const conv = (Array.isArray(raw) ? raw : []).map((c) => ohlcvToArchive(c, tf, nowMs)).filter((c) => c.isClosed);
  conv.sort((a, b) => a.openTime - b.openTime);
  const out: ArchiveCandle[] = [];
  for (const c of conv) {
    const last = out[out.length - 1];
    if (last && last.openTime === c.openTime) out[out.length - 1] = c;
    else out.push(c);
  }
  return out;
}

function countGaps(candles: readonly ArchiveCandle[], spanMs: number): number {
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i]!.openTime - candles[i - 1]!.openTime !== spanMs) gaps++;
  }
  return gaps;
}

export function summarizeReplay(strategyId: string, out: ReplayOutput): ReplaySummary {
  const s: ReplaySummary = {
    strategyId, records: out.records.length, awaiting: 0, filled: 0, closed: 0, noTrade: 0, unpublishable: 0,
    positiveR: 0, negativeR: 0, netRSum: 0, grossRSum: 0,
    evaluatedBars: out.evaluatedBars, firstEvaluatedOpenTime: out.firstEvaluatedOpenTime,
    lastEvaluatedOpenTime: out.lastEvaluatedOpenTime, notes: [...out.notes],
  };
  for (const r of out.records) {
    if (!r.publishable) s.unpublishable++;
    if (r.fill) s.filled++;
    if (!r.outcome) { if (!r.fill) s.awaiting++; continue; }
    if (r.fill && r.outcome.grossR !== null) {
      s.closed++;
      s.grossRSum += r.outcome.grossR;
      s.netRSum += r.outcome.netR ?? r.outcome.grossR;
      if (r.outcome.grossR > 0) s.positiveR++; else s.negativeR++;
    } else {
      s.noTrade++;
    }
  }
  s.netRSum = Math.round(s.netRSum * 1000) / 1000;
  s.grossRSum = Math.round(s.grossRSum * 1000) / 1000;
  return s;
}

export class LiveSignalEngine {
  private static instance: LiveSignalEngine | null = null;

  private readonly provider: MarketDataProvider;
  /** Вселенная скана; меняется в runtime через updateSymbols (админка → Монеты). */
  private symbols: readonly string[];
  private readonly strategies: SignalStrategy[];
  private readonly ledger: SignalsAuditLedger;
  private readonly scanIntervalMs: number;
  private readonly initialDelayMs: number;
  private readonly now: () => number;
  private readonly yieldBetweenSymbols: boolean;

  private state = new Map<string, SymbolState>();
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private scanning = false;
  private scanCount = 0;
  private lastScanStartedAt: string | null = null;
  private lastScanFinishedAt: string | null = null;
  private lastScanDurationMs: number | null = null;
  private lastError: string | null = null;
  private nextScanAtMs: number | null = null;
  private currentScan: Promise<void> | null = null;

  constructor(config: LiveSignalConfig) {
    this.provider = config.provider;
    this.symbols = config.symbols ?? DEFAULT_SIGNAL_SYMBOLS;
    this.strategies = config.strategies ?? ['V3.0', 'V3.3', 'V2.8'];
    this.scanIntervalMs = config.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
    this.initialDelayMs = config.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    this.now = config.now ?? (() => Date.now());
    this.yieldBetweenSymbols = config.yieldBetweenSymbols ?? true;
    this.ledger = SignalsAuditLedger.getInstance();
    for (const symbol of this.symbols) this.state.set(symbol, this.freshState(symbol));
  }

  public static getInstance(config?: LiveSignalConfig): LiveSignalEngine | null {
    if (!LiveSignalEngine.instance && config) {
      LiveSignalEngine.instance = new LiveSignalEngine(config);
    }
    return LiveSignalEngine.instance;
  }

  public static resetInstance(): void {
    if (LiveSignalEngine.instance?.running) {
      LiveSignalEngine.instance.stop();
    }
    LiveSignalEngine.instance = null;
  }

  /**
   * Обновить вселенную скана в runtime (админка → Монеты). Пустой список
   * допустим: вселенная не подтверждена exchangeInfo → скан по пустому списку
   * (ничего не сканируется, fallback на канонический реестр НЕ делается). Состояния и
   * ретроспектива существующих символов сохраняются; новые получают чистое
   * состояние. Следующий скан уже идёт по новому списку.
   */
  public updateSymbols(symbols: readonly string[]): void {
    const next = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
    this.symbols = next;
    for (const symbol of next) {
      if (!this.state.has(symbol)) this.state.set(symbol, this.freshState(symbol));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Жизненный цикл движка                                               */
  /* ------------------------------------------------------------------ */

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.scan(false);
    }, this.initialDelayMs);
    this.timer = setInterval(() => { void this.scan(false); }, this.scanIntervalMs);
    this.nextScanAtMs = this.now() + this.initialDelayMs;
    this.emit();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.initialTimer) { clearTimeout(this.initialTimer); this.initialTimer = null; }
    this.nextScanAtMs = null;
    this.emit();
  }

  public isActive(): boolean { return this.running; }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* слушатель не должен ломать движок */ }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Статус и ретроспектива                                              */
  /* ------------------------------------------------------------------ */

  public getStatus(): EngineStatus {
    const perSymbol: Record<string, SymbolScanStatus> = {};
    for (const [symbol, st] of this.state) {
      perSymbol[symbol] = {
        ...st.status,
        closedBars: { ...st.status.closedBars },
        replays: Object.fromEntries(Object.entries(st.status.replays).map(([k, v]) => [k, { ...v, notes: [...v.notes] }])),
      };
    }
    return {
      running: this.running,
      scanning: this.scanning,
      scanCount: this.scanCount,
      lastScanStartedAt: this.lastScanStartedAt,
      lastScanFinishedAt: this.lastScanFinishedAt,
      lastScanDurationMs: this.lastScanDurationMs,
      lastError: this.lastError,
      nextScanAt: this.nextScanAtMs !== null ? new Date(this.nextScanAtMs).toISOString() : null,
      scanIntervalMs: this.scanIntervalMs,
      symbols: this.symbols,
      strategies: [...this.strategies],
      perSymbol,
      providerIsDemo: this.provider.isDemo,
    };
  }

  /**
   * Ретроспектива окна: все сетапы, которые реплей стратегии нашёл на последних
   * закрытых барах (включая исходы по закрытым свечам). Диагностика того, что
   * стратегии действительно считаются на фактических данных. НЕ журнал аудита,
   * не хэшируется и не является трек-рекордом.
   */
  public getRetrospective(filter?: { symbol?: string; strategyId?: string }): ReplayRecord[] {
    const out: ReplayRecord[] = [];
    for (const [symbol, st] of this.state) {
      if (filter?.symbol && filter.symbol !== symbol) continue;
      for (const [strategyId, records] of Object.entries(st.retrospective)) {
        if (filter?.strategyId && filter.strategyId !== strategyId) continue;
        out.push(...records);
      }
    }
    out.sort((a, b) => b.setupOpenTime - a.setupOpenTime);
    return out;
  }

  /** Выполнить один скан немедленно (кнопка «Проверить сейчас», тесты) — работает и без start(). */
  public async scanNow(): Promise<void> {
    await this.scan(true);
  }

  /* ------------------------------------------------------------------ */
  /* Скан                                                                */
  /* ------------------------------------------------------------------ */

  private freshState(symbol: string): SymbolState {
    return {
      status: {
        symbol, pair: toPair(symbol), lastScanAt: null, lastError: null,
        closedBars: { '1h': 0, '4h': 0, '1d': 0 }, lastEvaluatedBarOpenTime: null, gaps1h: 0,
        source: null, replays: {}, publishedTotal: 0,
      },
      retrospective: {},
    };
  }

  private async scan(manual = false): Promise<void> {
    if (this.currentScan) return this.currentScan;
    // Н8 (v0.9.0): фоновая вкладка не сканируется — лимиты источников данных
    // не сжигаются в фоне. Пропущенный таймерный тик не планируется заново:
    // следующий тик интервала выполнится после возврата видимости.
    if (typeof document !== 'undefined' && document.hidden && !manual) return;
    this.currentScan = this.runScan(manual).finally(() => { this.currentScan = null; });
    return this.currentScan;
  }

  private async runScan(manual: boolean): Promise<void> {
    const startedMs = this.now();
    this.scanning = true;
    this.lastScanStartedAt = new Date(startedMs).toISOString();
    this.emit();
    let firstError: string | null = null;
    for (const symbol of this.symbols) {
      // Скан по таймеру прерывается, если движок остановили во время обхода; ручной — доводится до конца.
      if (!manual && !this.running) break;
      try {
        await this.scanSymbol(symbol);
      } catch (e) {
        const msg = errMessage(e);
        const st = this.state.get(symbol);
        if (st) st.status.lastError = msg;
        if (!firstError) firstError = `${symbol}: ${msg}`;
      }
      if (this.yieldBetweenSymbols) await new Promise<void>((r) => setTimeout(r, 0));
    }
    this.scanCount++;
    this.lastError = firstError;
    const finishedMs = this.now();
    this.lastScanFinishedAt = new Date(finishedMs).toISOString();
    this.lastScanDurationMs = finishedMs - startedMs;
    this.nextScanAtMs = this.running ? finishedMs + this.scanIntervalMs : null;
    this.scanning = false;
    this.emit();
  }

  private async scanSymbol(symbol: string): Promise<void> {
    const st = this.state.get(symbol) ?? this.freshState(symbol);
    this.state.set(symbol, st);
    const pair = st.status.pair;

    const nowMs = this.now();
    const h1Raw = await this.provider.getCandles(symbol, '1h', CANDLE_LIMIT_1H);
    st.status.source = sourceOf(h1Raw);
    const h1 = toClosedArchive(h1Raw, '1h', nowMs);
    st.status.closedBars['1h'] = h1.length;
    st.status.gaps1h = countGaps(h1, 3_600_000);
    st.status.lastScanAt = new Date(nowMs).toISOString();

    // 1. Ведение опубликованных сетапов по закрытым свечам (всегда — дёшево).
    this.trackOpenSetups(pair, h1);

    const lastClosed = h1[h1.length - 1];
    if (!lastClosed) {
      st.status.lastError = 'нет закрытых 1h-свечей';
      return;
    }
    if (st.status.lastEvaluatedBarOpenTime === lastClosed.openTime) {
      st.status.lastError = null;
      return;   // новый бар ещё не закрылся — обнаружение не повторяем
    }

    // 2. Структурные серии нужны только при появлении нового закрытого бара.
    const needs1d = this.strategies.includes('V2.8');
    const [h4Raw, h1dRaw] = await Promise.all([
      this.provider.getCandles(symbol, '4h', CANDLE_LIMIT_4H),
      needs1d ? this.provider.getCandles(symbol, '1D', CANDLE_LIMIT_1D) : Promise.resolve<OHLCV[]>([]),
    ]);
    const h4 = toClosedArchive(h4Raw, '4h', nowMs);
    const h1d = toClosedArchive(h1dRaw, '1d', nowMs);
    st.status.closedBars['4h'] = h4.length;
    st.status.closedBars['1d'] = h1d.length;

    // 3. Реплеи стратегий на окне закрытых свечей; публикация сетапов последнего закрытого бара.
    let published = 0;
    for (const strategy of this.strategies) {
      const strategyId = STRATEGY_IDS[strategy];
      let out: ReplayOutput;
      try {
        out = this.runReplay(strategy, symbol, h1, h4, h1d);
      } catch (e) {
        st.status.replays[strategyId] = {
          ...summarizeReplay(strategyId, { records: [], evaluatedBars: 0, firstEvaluatedOpenTime: null, lastEvaluatedOpenTime: null, notes: [] }),
          notes: [`Ошибка реплея: ${errMessage(e)}`],
        };
        st.retrospective[strategyId] = [];
        continue;
      }
      st.status.replays[strategyId] = summarizeReplay(strategyId, out);
      st.retrospective[strategyId] = out.records;
      // Журнал аудита — только фактические сетапы: на QA-фикстуре диагностика окна остаётся
      // видимой (ретроспектива/статус), но в журнал ничего не пишется (см. providerIsDemo).
      if (!this.provider.isDemo) {
        for (const rec of out.records) {
          if (rec.setupOpenTime !== lastClosed.openTime) continue;
          if (!rec.publishable) continue;
          if (this.publish(rec, pair, nowMs)) published++;
        }
      }
    }
    st.status.publishedTotal += published;
    st.status.lastEvaluatedBarOpenTime = lastClosed.openTime;
    st.status.lastError = null;
  }

  private runReplay(
    strategy: SignalStrategy, symbol: string,
    h1: readonly ArchiveCandle[], h4: readonly ArchiveCandle[], h1d: readonly ArchiveCandle[],
  ): ReplayOutput {
    switch (strategy) {
      case 'V3.0': return runV30LiveReplay({ symbol, h1, h4 });
      case 'V3.3': return runV33LiveReplay({ symbol, h1, h4 });
      case 'V2.8': return runV28LiveReplay({ symbol, h1, htf: { '4h': h4, '1d': h1d } });
      default: return { records: [], evaluatedBars: 0, firstEvaluatedOpenTime: null, lastEvaluatedOpenTime: null, notes: [] };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Публикация и ведение                                                */
  /* ------------------------------------------------------------------ */

  private publish(rec: ReplayRecord, pair: string, nowMs: number): boolean {
    const id = setupId(rec.strategyId, rec.symbol, rec.setupOpenTime);
    if (this.ledger.getById(id)) return false;
    const input: SetupInput = {
      id,
      strategyId: rec.strategyId,
      strategyVersion: rec.strategyVersion,
      symbol: pair,
      direction: rec.direction,
      timeframe: EXEC_TIMEFRAME,
      setupOpenTime: rec.setupOpenTime,
      entryType: rec.entryType,
      entryZone: [rec.entryZone[0], rec.entryZone[1]],
      invalidationLevel: rec.stop,
      targets: [...rec.targets],
      riskRewardRatio: rec.riskRewardRatio,
      confirmingFactors: [...rec.confirmingFactors],
      invalidationFactors: [...rec.invalidationFactors],
      exitRule: rec.exitRule,
      validForBars: rec.validForBars,
      createdAt: new Date(nowMs).toISOString(),
      latencyBars: 0,
      status: 'ACTIVE',
    };
    this.ledger.append(input);
    return true;
  }

  private trackOpenSetups(pair: string, h1: readonly ArchiveCandle[]): void {
    const open: AnalyticalSetup[] = this.ledger.getActiveSetups().filter((s) => s.symbol === pair && s.timeframe === EXEC_TIMEFRAME);
    for (const entry of open) {
      const res = trackPublishedSetup(entry, h1);
      if (res.kind === 'UNCHANGED' || res.kind === 'SKIP') continue;
      if (res.kind === 'FILLED') {
        if (entry.status === 'ACTIVE') this.ledger.markFilled(entry.id, res.fill);
        continue;
      }
      if (res.fill && entry.status === 'ACTIVE') this.ledger.markFilled(entry.id, res.fill);
      this.ledger.resolve(entry.id, res.outcome, res.fill ?? undefined);
    }
  }
}
